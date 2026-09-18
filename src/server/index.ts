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
 */
import { DEFAULT_ONE_API_URL, RETURN_MESSAGE_PARAM, RETURN_STATUS_PARAM } from "../constants";
import {
  DEFAULT_SCOPES,
  basicAuthorization,
  createPkceVerifier,
  createState,
  pkceChallenge,
  tenancyHeaders,
  txCookie,
  txCookieName,
} from "./oauth";
import {
  OneConnectError,
  type CompleteAuthorizationInput,
  type CompleteAuthorizationResult,
  type OneConnectServerConfig,
  type OneConnectTokens,
  type PlatformAction,
  type ReachableConnection,
  type RunActionInput,
  type RunActionResult,
  type StartAuthorizationInput,
  type StartAuthorizationResult,
} from "./types";

export * from "./types";
export { tenancyHeaders, tokenScopes } from "./oauth";

/** Refresh this long before expiry, so a call never races the clock. */
const REFRESH_MARGIN_MS = 60_000;
const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 20;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

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
  /** Forces a refresh now. */
  refreshTokens: (userId: string) => Promise<OneConnectTokens>;
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

  const returnUrl = (status: "success" | "error", message?: string): string => {
    const url = new URL(returnTo, config.redirectUri);
    url.searchParams.set(RETURN_STATUS_PARAM, status);
    if (message) url.searchParams.set(RETURN_MESSAGE_PARAM, message);
    return url.toString();
  };

  const exchange = async (body: URLSearchParams): Promise<TokenResponse> => {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: basicAuthorization(config.clientId, config.clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      throw new OneConnectError(
        "request_failed",
        `One refused the token request (HTTP ${response.status}).`,
        response.status,
      );
    }
    return (await response.json()) as TokenResponse;
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
      outcome: "declined" | "failed",
      message: string,
    ): CompleteAuthorizationResult => ({
      outcome,
      message,
      redirectUrl: returnUrl("error", message),
      clearCookieName: cookieName,
    });

    if (oauthError === "access_denied")
      return fail("declined", "You cancelled the request.");
    if (oauthError)
      return fail("failed", `One reported an error: ${oauthError}.`);
    // The returned state names its own cookie. No cookie means a forged
    // or stale state; the code is never exchanged in that case.
    if (!code || !state || !verifier)
      return fail("failed", "The sign-in attempt expired or was tampered with.");

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
      await tokenStore.saveTokens(input.userId, tokens);
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

  const refreshTokens = (userId: string): Promise<OneConnectTokens> => {
    const inFlight = refreshing.get(userId);
    if (inFlight) return inFlight;
    const job = (async () => {
      const current = await tokenStore.loadTokens(userId);
      if (!current)
        throw new OneConnectError("not_connected", "This user is not connected.");
      try {
        const next = toTokens(
          await exchange(
            new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: current.refreshToken,
            }),
          ),
        );
        // Both tokens: One rotates the pair on every refresh.
        await tokenStore.saveTokens(userId, next);
        return next;
      } catch (error) {
        // The family is dead: revoked, expired or reused. Keeping the
        // pair would only fail again; the user has to reconnect.
        await tokenStore.clearTokens(userId);
        const status = error instanceof OneConnectError ? error.status : undefined;
        throw new OneConnectError(
          "refresh_failed",
          "The connection to One has expired or was revoked. Ask the user to connect again.",
          status,
        );
      } finally {
        refreshing.delete(userId);
      }
    })();
    refreshing.set(userId, job);
    return job;
  };

  const getAccessToken = async (userId: string): Promise<string> => {
    const tokens = await tokenStore.loadTokens(userId);
    if (!tokens)
      throw new OneConnectError("not_connected", "This user is not connected.");
    if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) return tokens.accessToken;
    return (await refreshTokens(userId)).accessToken;
  };

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
    disconnect: (userId) => tokenStore.clearTokens(userId),
    listConnections,
    listActions,
    runAction,
    fetch: oneFetch,
  };
}
