/**
 * `@withone/connect/server`: the half of One Connect that runs on the
 * app's server. It starts the flow, completes it, keeps the tokens fresh
 * and makes every call with the grant. The client secret never leaves
 * here.
 *
 *   const oneConnect = createOneConnect({ clientId, clientSecret,
 *     redirectUri, permissionSet, tokenStore });
 *
 *   // in the authorize route
 *   const { redirectUrl, cookie } = oneConnect.startAuthorization({ loginHint });
 *   // in the callback route
 *   const result = await oneConnect.completeAuthorization({ userId, url, getCookie });
 *   // afterwards
 *   const rows = await oneConnect.listConnections(userId);
 *   const reply = await oneConnect.runAction(userId, { connectionKey, actionId, method, path });
 *
 * The Next.js and Node adapters turn the first two into route handlers.
 *
 * Refresh. One's access token lives an hour by default, its refresh token 30
 * days; every refresh rotates both, and One treats a second use of a
 * rotated refresh token as theft and revokes the whole grant. So the
 * client refreshes one user at a time (in this process always, across
 * processes through `tokenStore.withLock`), re-reads the store before
 * spending a refresh token, clears tokens only when One declares the
 * grant dead, and never lets a failing old pair delete a newer one.
 */
import { DEFAULT_ONE_API_URL, RETURN_ERROR_PARAM, RETURN_STATUS_PARAM } from "../constants";
import {
  DEFAULT_SCOPES,
  basicAuthorization,
  createPkceVerifier,
  createState,
  pkceChallenge,
  refreshTokenExpiresAt,
  tenancyHeaders,
  txCookie,
  txCookieName,
} from "./oauth";
import {
  OneConnectError,
  type CompleteAuthorizationInput,
  type CompleteAuthorizationResult,
  type ConnectFailureCode,
  type OneConnectServerConfig,
  type OneConnectTokens,
  type PlatformAction,
  type ReachableConnection,
  type RefreshIfExpiringOptions,
  type RunActionInput,
  type RunActionResult,
  type StartAuthorizationInput,
  type StartAuthorizationResult,
} from "./types";

export * from "./types";
export { refreshTokenExpiresAt, tenancyHeaders, tokenScopes } from "./oauth";

/** Refresh this long before expiry, so a call never races the clock. */
const REFRESH_MARGIN_MS = 60_000;
const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 20;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** What One's token endpoint answered. A network failure throws instead. */
type TokenAnswer =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: number; error?: string };

/** The one refusal that means the grant is gone for good: revoked by the
 *  user, expired, or burned by a reused refresh token (RFC 6749 §5.2). */
const isDeadGrant = (answer: TokenAnswer): boolean =>
  !answer.ok && answer.status === 400 && answer.error === "invalid_grant";

export interface OneConnect {
  /** The authorize leg: where to send the browser and the cookie to set. */
  startAuthorization: (
    input?: StartAuthorizationInput,
  ) => StartAuthorizationResult;
  /** The callback leg: verifies state, exchanges the code, stores the
   *  tokens, and says where to send the browser next. Never throws for
   *  a failed flow; read `outcome`. */
  completeAuthorization: (
    input: CompleteAuthorizationInput,
  ) => Promise<CompleteAuthorizationResult>;
  /** Whether the user has tokens stored. */
  isConnected: (userId: string) => Promise<boolean>;
  /** A live access token, refreshed first when it is about to expire. */
  getAccessToken: (userId: string) => Promise<string>;
  /** The stored tokens, for display. Null when not connected. */
  getTokens: (userId: string) => Promise<OneConnectTokens | null>;
  /** Refreshes now and returns the new pair. When another caller rotated
   *  the pair a moment earlier, returns that pair instead of rotating it
   *  a second time. */
  refreshTokens: (userId: string) => Promise<OneConnectTokens>;
  /** Refreshes only when the access token or the refresh token expires
   *  within `withinMs`, and returns the pair that is current afterwards.
   *  For background jobs: a frequent run keeps access tokens warm, and a
   *  daily run with a window of days keeps idle users' 30-day refresh
   *  tokens from running out. */
  refreshIfExpiring: (
    userId: string,
    options?: RefreshIfExpiringOptions,
  ) => Promise<OneConnectTokens>;
  /** Drops the app's copy of the tokens. The user revokes the grant
   *  itself from their One dashboard. */
  disconnect: (userId: string) => Promise<void>;
  /** The connections the grant reaches, each with its access. */
  listConnections: (userId: string) => Promise<ReachableConnection[]>;
  /** Every catalog action of a platform. What exists, not what is
   *  permitted; the grant decides that when the action runs. */
  listActions: (userId: string, platform: string) => Promise<PlatformAction[]>;
  /** Runs one action through One with the grant. */
  runAction: (userId: string, input: RunActionInput) => Promise<RunActionResult>;
  /** Any authenticated request to One's /v1 API, headers handled. */
  fetch: (
    userId: string,
    path: string,
    init?: RequestInit,
  ) => Promise<Response>;
}

export function createOneConnect(config: OneConnectServerConfig): OneConnect {
  const oneApiUrl = (config.oneApiUrl ?? DEFAULT_ONE_API_URL).replace(/\/+$/, "");
  const authorizeUrl = `${oneApiUrl}/oauth/authorize`;
  const tokenUrl = `${oneApiUrl}/oauth/token`;
  const apiUrl = `${oneApiUrl}/v1`;
  const returnTo = config.returnTo ?? "/";
  const scopes = config.scopes ?? DEFAULT_SCOPES;
  const { tokenStore } = config;

  /** One refresh in flight per user: two concurrent refreshes with the
   *  same refresh token trip One's reuse detection. */
  const refreshing = new Map<string, Promise<OneConnectTokens>>();

  const returnUrl = (status: "success" | "error", code?: ConnectFailureCode): string => {
    const url = new URL(returnTo, config.redirectUri);
    url.searchParams.set(RETURN_STATUS_PARAM, status);
    if (code) url.searchParams.set(RETURN_ERROR_PARAM, code);
    return url.toString();
  };

  const postToken = async (body: URLSearchParams): Promise<TokenAnswer> => {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(config.clientId, config.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (response.ok)
      return { ok: true, body: (await response.json()) as TokenResponse };
    let error: string | undefined;
    try {
      const refusal = (await response.json()) as { error?: unknown };
      if (typeof refusal.error === "string") error = refusal.error;
    } catch {
      /* not an OAuth error body: a proxy page or a server error */
    }
    return { ok: false, status: response.status, error };
  };

  const exchange = async (body: URLSearchParams): Promise<TokenResponse> => {
    const answer = await postToken(body);
    if (!answer.ok) {
      throw new OneConnectError(
        "request_failed",
        `One refused the token request (HTTP ${answer.status}).`,
        answer.status,
      );
    }
    return answer.body;
  };

  /** Runs `run` under the app's cross-process lock for this user, when
   *  the store has one. */
  const locked = <T>(userId: string, run: () => Promise<T>): Promise<T> =>
    tokenStore.withLock ? tokenStore.withLock(userId, run) : run();

  /** Whether either token of the pair stops working within `withinMs`. */
  const expiresWithin = (tokens: OneConnectTokens, withinMs: number): boolean => {
    const horizon = Date.now() + withinMs;
    const refreshExpiresAt = refreshTokenExpiresAt(tokens.refreshToken);
    return (
      tokens.expiresAt <= horizon ||
      (refreshExpiresAt !== null && refreshExpiresAt <= horizon)
    );
  };

  const toTokens = (response: TokenResponse): OneConnectTokens => ({
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  });

  const startAuthorization = (
    input: StartAuthorizationInput = {},
  ): StartAuthorizationResult => {
    const state = createState();
    const verifier = createPkceVerifier();
    const url = new URL(authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkceChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    if (config.permissionSet)
      url.searchParams.set("permission_set", config.permissionSet);
    if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
    return {
      redirectUrl: url.toString(),
      cookie: txCookie(state, verifier, config.redirectUri),
    };
  };

  const completeAuthorization = async (
    input: CompleteAuthorizationInput,
  ): Promise<CompleteAuthorizationResult> => {
    const params = new URL(input.url).searchParams;
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    const cookieName = state ? txCookieName(state) : undefined;
    const verifier = cookieName ? input.getCookie(cookieName) : undefined;

    const fail = (
      failure: ConnectFailureCode,
      message: string,
    ): CompleteAuthorizationResult => ({
      outcome: failure === "declined" ? "declined" : "failed",
      code: failure,
      message,
      redirectUrl: returnUrl("error", failure),
      clearCookieName: cookieName,
    });

    if (oauthError === "access_denied")
      return fail("declined", "The user cancelled on One's page.");
    if (oauthError)
      return fail("failed", `One reported an error: ${oauthError}.`);
    // The returned state names its own cookie. No cookie means a stale,
    // foreign or forged state; the code is never exchanged in that case.
    if (!code || !state || !verifier)
      return fail("expired", "The attempt expired, or its state cookie was missing.");

    try {
      const tokens = toTokens(
        await exchange(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: config.redirectUri,
            code_verifier: verifier,
          }),
        ),
      );
      // Under the lock, so a refresh in flight on another server cannot
      // interleave with this save.
      await locked(input.userId, () => tokenStore.saveTokens(input.userId, tokens));
    } catch (error) {
      const status = error instanceof OneConnectError ? error.status : undefined;
      return fail(
        "failed",
        status
          ? `One rejected the code exchange (HTTP ${status}).`
          : "One could not be reached to complete the connection.",
      );
    }

    return {
      outcome: "connected",
      redirectUrl: returnUrl("success"),
      clearCookieName: cookieName,
    };
  };

  const notConnected = () =>
    new OneConnectError("not_connected", "This user is not connected.");

  /**
   * The grant behind `failed` is dead. Clears it, unless a newer pair
   * landed while it was failing (a reconnect's callback, another
   * server's refresh): that pair is returned instead, because the user
   * did nothing wrong and deleting it would disconnect them.
   */
  const retire = async (
    userId: string,
    failed: OneConnectTokens,
    status?: number,
  ): Promise<OneConnectTokens> => {
    const latest = await tokenStore.loadTokens(userId);
    if (latest && latest.refreshToken !== failed.refreshToken) return latest;
    await tokenStore.clearTokens(userId, failed);
    throw new OneConnectError(
      "refresh_failed",
      "The connection to One has expired or was revoked. Ask the user to connect again.",
      status,
    );
  };

  /**
   * The one place a refresh token is spent. Under the app's lock it
   * re-reads the store, and refreshes only when `stillNeeded` says the
   * stored pair still needs it: another process may have refreshed while
   * this one waited, and spending the same refresh token twice makes One
   * revoke the grant.
   */
  const refreshUnderLock = (
    userId: string,
    stillNeeded: (current: OneConnectTokens) => boolean,
  ): Promise<OneConnectTokens> =>
    locked(userId, async () => {
      const current = await tokenStore.loadTokens(userId);
      if (!current) throw notConnected();
      if (!stillNeeded(current)) return current;

      // An expired refresh token cannot work, and One answers one with a
      // server error rather than invalid_grant, so settle it here.
      const refreshExpiresAt = refreshTokenExpiresAt(current.refreshToken);
      if (refreshExpiresAt !== null && refreshExpiresAt <= Date.now())
        return retire(userId, current);

      let answer: TokenAnswer;
      try {
        answer = await postToken(
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: current.refreshToken,
          }),
        );
      } catch {
        throw new OneConnectError(
          "request_failed",
          "One could not be reached to refresh the connection. The tokens were kept; try again.",
        );
      }

      if (answer.ok) {
        // Both tokens: One rotates the pair on every refresh.
        const next = toTokens(answer.body);
        await tokenStore.saveTokens(userId, next);
        return next;
      }
      if (isDeadGrant(answer)) return retire(userId, current, answer.status);
      // A server error, a rate limit, a misconfigured secret: nothing says
      // the grant is gone, so keep the tokens and let the caller retry.
      throw new OneConnectError(
        "request_failed",
        `One could not refresh the connection (HTTP ${answer.status}). The tokens were kept; try again.`,
        answer.status,
      );
    });

  /** One refresh per user in this process; concurrent callers share it. */
  const singleFlight = (
    userId: string,
    job: () => Promise<OneConnectTokens>,
  ): Promise<OneConnectTokens> => {
    const inFlight = refreshing.get(userId);
    if (inFlight) return inFlight;
    const running = job().finally(() => refreshing.delete(userId));
    refreshing.set(userId, running);
    return running;
  };

  const refreshTokens = (userId: string): Promise<OneConnectTokens> =>
    singleFlight(userId, async () => {
      const before = await tokenStore.loadTokens(userId);
      if (!before) throw notConnected();
      // Rotate the pair seen now; a pair someone else rotated since is
      // already fresh.
      return refreshUnderLock(
        userId,
        (current) => current.refreshToken === before.refreshToken,
      );
    });

  const refreshIfExpiring = async (
    userId: string,
    options: RefreshIfExpiringOptions = {},
  ): Promise<OneConnectTokens> => {
    const withinMs = options.withinMs ?? REFRESH_MARGIN_MS;
    const tokens = await tokenStore.loadTokens(userId);
    if (!tokens) throw notConnected();
    if (!expiresWithin(tokens, withinMs)) return tokens;
    return singleFlight(userId, () =>
      refreshUnderLock(userId, (current) => expiresWithin(current, withinMs)),
    );
  };

  const getAccessToken = async (userId: string): Promise<string> =>
    (await refreshIfExpiring(userId)).accessToken;

  const oneFetch = async (
    userId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const accessToken = await getAccessToken(userId);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    for (const [name, value] of Object.entries(tenancyHeaders(accessToken)))
      headers.set(name, value);
    return fetch(`${apiUrl}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers,
    });
  };

  const listConnections = async (userId: string): Promise<ReachableConnection[]> => {
    const response = await oneFetch(userId, "/connections/reachable");
    if (!response.ok) {
      throw new OneConnectError(
        "request_failed",
        `One refused the connections request (HTTP ${response.status}).`,
        response.status,
      );
    }
    const body = (await response.json()) as { rows?: ReachableConnection[] };
    return body.rows ?? [];
  };

  const listActions = async (
    userId: string,
    platform: string,
  ): Promise<PlatformAction[]> => {
    const pageUrl = (page: number) =>
      `/knowledge?connectionPlatform=${encodeURIComponent(platform)}&limit=${CATALOG_PAGE_SIZE}&page=${page}`;
    const slim = (rows: Record<string, unknown>[]): PlatformAction[] =>
      rows.map((row) => ({
        _id: String(row._id ?? ""),
        title: String(row.title ?? ""),
        method: String(row.method ?? ""),
        path: String(row.path ?? ""),
      }));
    const first = await oneFetch(userId, pageUrl(1));
    if (!first.ok) {
      throw new OneConnectError(
        "request_failed",
        `One refused the catalog request (HTTP ${first.status}).`,
        first.status,
      );
    }
    const page1 = (await first.json()) as {
      rows?: Record<string, unknown>[];
      pages?: number;
    };
    const pages = Math.min(Math.max(page1.pages ?? 1, 1), CATALOG_MAX_PAGES);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        oneFetch(userId, pageUrl(index + 2))
          .then((response) =>
            response.ok
              ? (response.json() as Promise<{ rows?: Record<string, unknown>[] }>)
              : null,
          )
          .catch(() => null),
      ),
    );
    return slim([page1, ...rest].flatMap((page) => page?.rows ?? []));
  };

  const runAction = async (
    userId: string,
    input: RunActionInput,
  ): Promise<RunActionResult> => {
    const method = input.method.toUpperCase();
    const query = input.query ? `?${new URLSearchParams(input.query)}` : "";
    const headers: Record<string, string> = {
      "x-one-connection-key": input.connectionKey,
      "x-one-action-id": input.actionId,
    };
    const hasBody = method !== "GET" && method !== "HEAD" && input.body !== undefined;
    if (hasBody) headers["Content-Type"] = "application/json";
    const response = await oneFetch(userId, `/passthrough${input.path}${query}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(input.body) : undefined,
    });
    const text = await response.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* the provider answered with something other than JSON */
    }
    // One's own refusals carry a correlationId; a provider's error does
    // not. A One-shaped 403 is the grant working, not the provider.
    const blockedByGrant =
      !response.ok &&
      typeof data === "object" &&
      data !== null &&
      "correlationId" in (data as Record<string, unknown>);
    return { status: response.status, ok: response.ok, blockedByGrant, data };
  };

  return {
    startAuthorization,
    completeAuthorization,
    isConnected: async (userId) => (await tokenStore.loadTokens(userId)) !== null,
    getAccessToken,
    getTokens: (userId) => tokenStore.loadTokens(userId),
    refreshTokens,
    refreshIfExpiring,
    disconnect: (userId) => tokenStore.clearTokens(userId),
    listConnections,
    listActions,
    runAction,
    fetch: oneFetch,
  };
}
