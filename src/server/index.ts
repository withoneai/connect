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
 *   // afterwards, the same way the One CLI works: find the action, read
 *   // its knowledge, run it
 *   const rows = await oneConnect.listConnections(userId);
 *   const [action] = await oneConnect.searchActions(userId, "stripe", "create an invoice");
 *   const guide = await oneConnect.getActionKnowledge(userId, action._id);
 *   const reply = await oneConnect.runAction(userId, { connectionKey, actionId: action._id, body });
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
  type ActionKnowledge,
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
  type SearchActionsOptions,
  type StartAuthorizationInput,
  type StartAuthorizationResult,
} from "./types";

export * from "./types";
export { encodeUserReference, parseUserReference } from "./key";
export { refreshTokenExpiresAt, tenancyHeaders, tokenScopes } from "./oauth";

const CATALOG_PAGE_SIZE = 100;
const CATALOG_MAX_PAGES = 20;
const SEARCH_DEFAULT_LIMIT = 5;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Blob) &&
  !(value instanceof FormData);

/** Fills a path's `{{placeholders}}`. A placeholder with no value is an
 *  error the caller can read, rather than a request One cannot route. */
export function fillPath(
  path: string,
  params: Record<string, string | number | boolean> = {},
): string {
  return path.replace(/\{\{([^}]+)\}\}/g, (_match, name: string) => {
    const key = name.trim();
    const value = params[key];
    if (value === undefined || value === null || value === "")
      throw new OneConnectError(
        "request_failed",
        `The action's path needs a value for {{${key}}}; pass it in pathParams.`,
      );
    return encodeURIComponent(String(value));
  });
}

/** `application/x-www-form-urlencoded` with nested objects and arrays in
 *  bracket notation, as Stripe and other form providers read it. */
export function formEncode(value: unknown): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v))
      v.forEach((item, i) => walk(`${prefix}[${typeof item === "object" ? i : ""}]`, item));
    else if (typeof v === "object")
      for (const [k, inner] of Object.entries(v as Record<string, unknown>))
        walk(prefix ? `${prefix}[${k}]` : k, inner);
    else out.append(prefix, String(v));
  };
  walk("", value);
  return out.toString();
}

const toKnowledge = (row: Record<string, unknown>): ActionKnowledge => ({
  _id: String(row._id ?? ""),
  title: String(row.title ?? ""),
  method: String(row.method ?? "").toUpperCase(),
  path: String(row.path ?? ""),
  tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
  knowledge: String(row.knowledge ?? ""),
  ioSchema: row.ioSchema,
  platform: row.connectionPlatform ? String(row.connectionPlatform) : undefined,
});

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
  /** The actions of a platform that fit a request in words, best first. */
  searchActions: (
    userId: string,
    platform: string,
    query: string,
    options?: SearchActionsOptions,
  ) => Promise<PlatformAction[]>;
  /** An action's guide, input shape, method and path. Read it before
   *  running an action for the first time. */
  getActionKnowledge: (userId: string, actionId: string) => Promise<ActionKnowledge>;
  /** Runs one action through One with the grant: fills the path, encodes
   *  the body, adds what the action needs. */
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
   *  For the app's scheduled job: a daily run with a window of days
   *  renews each user's pair before the 30-day refresh token runs out. */
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

  /**
   * Turns a catalog refusal into the right error. A One API that does not
   * take the credential on its catalog answers the same bare 403 as a
   * consent that is gone; asking what the grant reaches tells them apart.
   */
  const catalogRefusal = async (
    userId: string,
    what: string,
    response: Response,
  ): Promise<OneConnectError> => {
    const refused = credential.refusal(response.status, await response.text());
    if (refused?.code === "reconnect_required") {
      if (await consentStands(userId, refused))
        return new OneConnectError(
          "request_failed",
          `One's ${what} refused the ${keyCredential ? "connect key" : "access token"} (HTTP 403) although the user's consent stands: this One API does not accept it on the ${what}.`,
          response.status,
        );
      return refused;
    }
    if (refused) return refused;
    return new OneConnectError(
      "request_failed",
      `One refused the ${what} request (HTTP ${response.status}).`,
      response.status,
    );
  };

  const slim = (rows: Record<string, unknown>[]): PlatformAction[] =>
    rows.map((row) => ({
      _id: String(row._id ?? row.systemId ?? ""),
      title: String(row.title ?? ""),
      method: String(row.method ?? "").toUpperCase(),
      path: String(row.path ?? ""),
      ...(Array.isArray(row.tags) ? { tags: row.tags.map(String) } : {}),
    }));

  const listActions = async (
    userId: string,
    platform: string,
  ): Promise<PlatformAction[]> => {
    const pageUrl = (page: number) =>
      `/knowledge?connectionPlatform=${encodeURIComponent(platform)}&limit=${CATALOG_PAGE_SIZE}&page=${page}`;
    const first = await oneFetch(userId, pageUrl(1));
    if (!first.ok) throw await catalogRefusal(userId, "action catalog", first);
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

  /** The actions that fit a request in words, best first: One's search,
   *  the one the One CLI's `actions search` uses. */
  const searchActions = async (
    userId: string,
    platform: string,
    query: string,
    options: SearchActionsOptions = {},
  ): Promise<PlatformAction[]> => {
    const params = new URLSearchParams({
      query,
      limit: String(options.limit ?? SEARCH_DEFAULT_LIMIT),
      [options.mode === "knowledge" ? "knowledgeAgent" : "executeAgent"]: "true",
    });
    const response = await oneFetch(
      userId,
      `/available-actions/search/${encodeURIComponent(platform)}?${params}`,
    );
    if (!response.ok) throw await catalogRefusal(userId, "action search", response);
    const body = (await response.json()) as
      | Record<string, unknown>[]
      | { rows?: Record<string, unknown>[] };
    return slim(Array.isArray(body) ? body : (body.rows ?? []));
  };

  /** One action's knowledge, cached for the life of the client: an
   *  action's guide does not change between two calls. */
  const knowledgeCache = new Map<string, Promise<ActionKnowledge>>();
  const getActionKnowledge = (userId: string, actionId: string): Promise<ActionKnowledge> => {
    const cached = knowledgeCache.get(actionId);
    if (cached) return cached;
    const loading = (async () => {
      const response = await oneFetch(userId, `/knowledge?_id=${encodeURIComponent(actionId)}`);
      if (!response.ok) throw await catalogRefusal(userId, "action knowledge", response);
      const body = (await response.json()) as { rows?: Record<string, unknown>[] };
      const row = body.rows?.[0];
      if (!row)
        throw new OneConnectError("request_failed", `One has no action with the id ${actionId}.`, 404);
      return toKnowledge(row);
    })();
    knowledgeCache.set(actionId, loading);
    loading.catch(() => knowledgeCache.delete(actionId));
    return loading;
  };

  /**
   * Runs one action through One the way the One CLI's `actions execute`
   * does: the method and path come from the action itself, the path's
   * placeholders are filled, an action One serves gets the connection key
   * in its body, and the body is encoded as the provider reads it.
   */
  const runAction = async (
    userId: string,
    input: RunActionInput,
  ): Promise<RunActionResult> => {
    // The caller may hand over method and path from the catalog; otherwise
    // the action says, and its tags say whether it is one One serves.
    const action =
      input.method && input.path
        ? { method: input.method, path: input.path, tags: [] as string[] }
        : await getActionKnowledge(userId, input.actionId);
    const method = action.method.toUpperCase();
    const path = fillPath(action.path, input.pathParams);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {}))
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
    const query = search.size ? `?${search}` : "";

    const headers: Record<string, string> = {
      ...input.headers,
      "x-one-connection-key": input.connectionKey,
      "x-one-action-id": input.actionId,
    };
    const takesBody = method !== "GET" && method !== "HEAD";
    let payload: unknown = input.body;
    // An action One serves itself reads the connection key from its body.
    if (
      takesBody &&
      action.tags.includes("custom") &&
      (payload === undefined || isPlainObject(payload))
    )
      payload = { ...(payload ?? {}), connectionKey: input.connectionKey };
    let body: BodyInit | undefined;
    if (takesBody && payload !== undefined) {
      const encoding = input.encoding ?? "json";
      if (encoding === "form") {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = formEncode(payload);
      } else if (encoding === "multipart") {
        const form = new FormData();
        for (const [key, value] of Object.entries(isPlainObject(payload) ? payload : {}))
          form.append(
            key,
            value instanceof Blob
              ? value
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value),
          );
        body = form; // fetch sets the multipart boundary itself
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(payload);
      }
    }

    const response = await oneFetch(userId, `/passthrough${path}${query}`, {
      method,
      headers,
      body,
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
    searchActions,
    getActionKnowledge,
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
