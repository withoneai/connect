/**
 * `@withone/connect/server`: the half of One Connect that runs on the
 * app's server. It starts the flow, completes it, and makes every call
 * with the grant. The app's secrets never leave here.
 *
 * An app holds a user's grant in one of two ways, and picks by what it
 * configures. Everything else is the same in both.
 *
 *   // key mode (default): one connect key for the app, one permanent id
 *   // per user, nothing to refresh
 *   const oneConnect = createOneConnect({ clientId, clientSecret,
 *     redirectUri, permissionSet, connectKey, userStore });
 *
 *   // token mode: an access and a refresh token per user, kept fresh
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
 * See `./key` and `./token` for what each mode stores and sends.
 */
import { DEFAULT_ONE_API_URL, RETURN_ERROR_PARAM, RETURN_STATUS_PARAM } from "../constants";
import type { Credential, PostToken, TokenResponse } from "./credential";
import { createKeyCredential } from "./key";
import {
  DEFAULT_SCOPES,
  basicAuthorization,
  createPkceVerifier,
  createState,
  pkceChallenge,
  txCookie,
  txCookieName,
} from "./oauth";
import { createTokenCredential } from "./token";
import {
  OneConnectError,
  type CompleteAuthorizationInput,
  type CompleteAuthorizationResult,
  type ConnectFailureCode,
  type OneConnectKeyConfig,
  type OneConnectMode,
  type OneConnectServerConfig,
  type OneConnectTokenConfig,
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
export { encodeUserReference, parseUserReference } from "./key";
export { refreshTokenExpiresAt, tenancyHeaders, tokenScopes } from "./oauth";

const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 20;

/** What an app does with One in either mode. */
export interface OneConnectClient {
  /** How this client holds each user's grant. */
  readonly mode: OneConnectMode;
  /** The authorize leg: where to send the browser and the cookie to set. */
  startAuthorization: (
    input?: StartAuthorizationInput,
  ) => StartAuthorizationResult;
  /** The callback leg: verifies state, exchanges the code, stores what
   *  the mode keeps, and says where to send the browser next. Never
   *  throws for a failed flow; read `outcome`. */
  completeAuthorization: (
    input: CompleteAuthorizationInput,
  ) => Promise<CompleteAuthorizationResult>;
  /** Whether the app has something stored for the user. In key mode One
   *  confirms the consent on each call, so a user who revoked still
   *  reads as connected here until a call throws `reconnect_required`. */
  isConnected: (userId: string) => Promise<boolean>;
  /** Drops the app's copy of what it stored. The user revokes the grant
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

/** The client key mode returns. */
export interface OneConnectKeyClient extends OneConnectClient {
  readonly mode: "key";
  /** One's permanent id for this user (`cu_…`), or null when they have
   *  never connected. */
  getConnectUserId: (userId: string) => Promise<string | null>;
}

/** The client token mode returns. */
export interface OneConnect extends OneConnectClient {
  readonly mode: "token";
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
}

/**
 * Which mode a config asks for. A stated `mode` wins; otherwise a
 * connect key means key mode and a token store alone means token mode,
 * so an app written before key mode existed keeps working untouched.
 */
function resolveMode(config: OneConnectServerConfig): OneConnectMode {
  const given = config as Partial<OneConnectKeyConfig> & Partial<OneConnectTokenConfig>;
  const mode: OneConnectMode | undefined =
    given.mode ?? (given.connectKey ? "key" : given.tokenStore ? "token" : undefined);
  if (mode === undefined) {
    throw new TypeError(
      "createOneConnect needs a credential: pass `connectKey` and `userStore` (key mode, recommended), or `tokenStore` (token mode).",
    );
  }
  if (mode !== "key" && mode !== "token") {
    throw new TypeError('createOneConnect: `mode` is "key" or "token".');
  }
  if (mode === "key" && !(given.connectKey && given.userStore)) {
    throw new TypeError(
      "createOneConnect: key mode needs `connectKey` (mint one on the app's page in the One dashboard) and `userStore`.",
    );
  }
  if (mode === "token" && !given.tokenStore) {
    throw new TypeError("createOneConnect: token mode needs `tokenStore`.");
  }
  return mode;
}

/** Key mode: a connect key for the app and one permanent id per user. */
export function createOneConnect(config: OneConnectKeyConfig): OneConnectKeyClient;
/** Token mode: an access and a refresh token per user, kept fresh. */
export function createOneConnect(config: OneConnectTokenConfig): OneConnect;
export function createOneConnect(
  config: OneConnectServerConfig,
): OneConnectKeyClient | OneConnect;
export function createOneConnect(
  config: OneConnectServerConfig,
): OneConnectKeyClient | OneConnect {
  const mode = resolveMode(config);
  const oneApiUrl = (config.oneApiUrl ?? DEFAULT_ONE_API_URL).replace(/\/+$/, "");
  const authorizeUrl = `${oneApiUrl}/oauth/authorize`;
  const tokenUrl = `${oneApiUrl}/oauth/token`;
  const apiUrl = `${oneApiUrl}/v1`;
  const returnTo = config.returnTo ?? "/";
  const scopes = config.scopes ?? DEFAULT_SCOPES;

  const returnUrl = (status: "success" | "error", code?: ConnectFailureCode): string => {
    const url = new URL(returnTo, config.redirectUri);
    url.searchParams.set(RETURN_STATUS_PARAM, status);
    if (code) url.searchParams.set(RETURN_ERROR_PARAM, code);
    return url.toString();
  };

  const postToken: PostToken = async (body) => {
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

  // The one thing the modes differ in: what is kept per user, and what
  // is sent on a call. `resolveMode` already checked each has its parts.
  const keyCredential =
    mode === "key"
      ? createKeyCredential(
          (config as OneConnectKeyConfig).connectKey,
          (config as OneConnectKeyConfig).userStore,
        )
      : null;
  const tokenCredential =
    mode === "token"
      ? createTokenCredential((config as OneConnectTokenConfig).tokenStore, postToken)
      : null;
  const credential = (keyCredential ?? tokenCredential) as Credential;

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
      const response = await exchange(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: verifier,
        }),
      );
      // Tokens in token mode, the user's permanent id in key mode.
      await credential.connected(input.userId, response);
    } catch (error) {
      const status = error instanceof OneConnectError ? error.status : undefined;
      return fail(
        "failed",
        status
          ? `One rejected the code exchange (HTTP ${status}).`
          : error instanceof OneConnectError
            ? error.message
            : "One could not be reached to complete the connection.",
      );
    }

    return {
      outcome: "connected",
      redirectUrl: returnUrl("success"),
      clearCookieName: cookieName,
    };
  };

  const oneFetch = async (
    userId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(await credential.headers(userId)))
      headers.set(name, value);
    return fetch(`${apiUrl}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers,
    });
  };

  /**
   * Whether One still acts for this user at all, asked of the one route
   * that needs nothing but the credential. Throws when the question
   * itself cannot be answered, rather than guessing.
   */
  const consentStands = async (userId: string, refused: OneConnectError): Promise<boolean> => {
    const probe = await oneFetch(userId, "/connections/reachable?limit=1");
    if (probe.ok) return true;
    const verdict = credential.refusal(probe.status, await probe.text());
    if (verdict?.code === refused.code) return false;
    throw (
      verdict ??
      new OneConnectError(
        "request_failed",
        `One could not confirm the user's consent (HTTP ${probe.status}). Nothing stored was changed; try again.`,
        probe.status,
      )
    );
  };

  const listConnections = async (userId: string): Promise<ReachableConnection[]> => {
    const response = await oneFetch(userId, "/connections/reachable");
    if (!response.ok) {
      const refused = credential.refusal(response.status, await response.text());
      if (refused) throw refused;
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
      const refused = credential.refusal(first.status, await first.text());
      if (refused?.code === "reconnect_required") {
        // The same bare 403 is what a One API answers when its catalog
        // does not take the connect key. If the consent stands, that is
        // what happened, and asking the user to reconnect would not help.
        if (await consentStands(userId, refused)) {
          throw new OneConnectError(
            "request_failed",
            "One's action catalog refused the connect key (HTTP 403) although the user's consent stands: this One API does not accept the connect key on the catalog.",
            first.status,
          );
        }
        throw refused;
      }
      if (refused) throw refused;
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
    if (!response.ok) {
      const refused = credential.refusal(response.status, text);
      if (refused?.code === "reconnect_required") {
        // One answers a call outside the grant with the same bare 403 it
        // gives a consent that is gone. Asking what the grant reaches
        // tells them apart: if that still answers, the consent stands
        // and it was this call One refused.
        if (await consentStands(userId, refused))
          return { status: response.status, ok: false, blockedByGrant: true, data: text };
        throw refused;
      }
      // One refusing the credential is not an answer to the action.
      if (refused) throw refused;
    }
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

  const shared = {
    startAuthorization,
    completeAuthorization,
    isConnected: credential.isConnected,
    disconnect: credential.disconnect,
    listConnections,
    listActions,
    runAction,
    fetch: oneFetch,
  };

  if (keyCredential) {
    return {
      mode: "key",
      ...shared,
      getConnectUserId: keyCredential.getConnectUserId,
    };
  }
  const tokens = tokenCredential!;
  return {
    mode: "token",
    ...shared,
    getAccessToken: tokens.getAccessToken,
    getTokens: tokens.getTokens,
    refreshTokens: tokens.refreshTokens,
    refreshIfExpiring: tokens.refreshIfExpiring,
  };
}
