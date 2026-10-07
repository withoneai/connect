/**
 * Types for `@withone/connect/server`: the half of the SDK that runs on
 * the app's server and holds the client secret.
 */

/**
 * How the app holds a user's grant.
 *
 * - `"key"`: the app's connect key plus a permanent id per user. Nothing
 *   expires, so there is nothing to refresh. The default.
 * - `"token"`: an access token and a refresh token per user, which the
 *   SDK keeps fresh.
 */
export type OneConnectMode = "key" | "token";

/** Key mode: who a stored user is to One, and where their grant lives. */
export interface OneConnectUserReference {
  /** One's permanent id for this user, for this app: `cu_…`. */
  connectUserId: string;
  /** The organization the user granted from; absent for their personal
   *  space. */
  organizationId?: string;
  /** The project the user granted from, when it was one. */
  projectId?: string;
}

/**
 * Key mode: where the app keeps the one value the SDK gives it per user.
 * A single string, written when the user connects and the same until
 * they connect again, so one column on the app's user row is enough.
 * `userId` is the app's own id for its user.
 *
 * It is an identifier, not a credential: it does nothing without the
 * app's connect key. No lock is needed, because nothing rotates.
 */
export interface OneConnectUserStore {
  saveUser: (userId: string, reference: string) => Promise<void>;
  loadUser: (userId: string) => Promise<string | null>;
  clearUser: (userId: string) => Promise<void>;
}

/** What the app stores per user after the exchange. */
export interface OneConnectTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
}

/**
 * Where the app keeps each user's tokens: its database, a cache, an
 * encrypted cookie. The SDK never sees a token outside these calls.
 * `userId` is the app's own id for its user.
 */
export interface OneConnectTokenStore {
  saveTokens: (userId: string, tokens: OneConnectTokens) => Promise<void>;
  loadTokens: (userId: string) => Promise<OneConnectTokens | null>;
  /**
   * Deletes the user's tokens.
   *
   * `failed` is set when the SDK clears because One declared that pair
   * dead. Delete only when the stored refresh token is still
   * `failed.refreshToken`: a newer pair saved in the meantime (a
   * reconnect, another server's refresh) must survive. `failed` is
   * undefined for `disconnect`, which always deletes.
   */
  clearTokens: (userId: string, failed?: OneConnectTokens) => Promise<void>;
  /**
   * Runs `run` while holding a lock on this user that every server and
   * worker of the app shares: a Postgres advisory lock, a Redis lock, a
   * row lock. The SDK loads, refreshes and saves the user's tokens
   * inside it.
   *
   * Required when the app runs more than one process (serverless,
   * several instances, a background worker). One rotates the refresh
   * token on every use and treats a second use of the old one as theft,
   * revoking the whole grant, so two processes refreshing the same user
   * at once disconnect that user. Without a lock the SDK can only stop
   * that inside a single process.
   *
   * Hold it for at least 60 seconds before any timeout: it spans one
   * call to One's token endpoint.
   */
  withLock?: <T>(userId: string, run: () => Promise<T>) => Promise<T>;
}

export interface RefreshIfExpiringOptions {
  /** Refresh when the access token or the refresh token expires within
   *  this many milliseconds. One minute when omitted. A refresh token
   *  that has already run out cannot be refreshed: the pair is returned
   *  as it is while its access token still works. */
  withinMs?: number;
}

/** What every app configures, whichever mode it uses. */
export interface OneConnectBaseConfig {
  /** The app's client id from the dashboard. */
  clientId: string;
  /** The app's client secret. Server only. */
  clientSecret: string;
  /** Exactly the callback URL registered on the app, character for
   *  character, for example "https://yourapp.com/api/one/callback". */
  redirectUri: string;
  /** The ask (permission set) to open the consent card on. Omit to ask
   *  for everything the user has connected. */
  permissionSet?: string;
  /** One's API origin. Production when omitted. */
  oneApiUrl?: string;
  /** Where the callback sends the browser afterwards. "/" when omitted;
   *  the outcome is appended as `?one_connect=…`. */
  returnTo?: string;
  /** OAuth scopes. All three tenancy tiers when omitted, so the user may
   *  grant from any space. */
  scopes?: string[];
}

/**
 * Key mode, the default: pass the app's connect key and a place to keep
 * one value per user.
 */
export interface OneConnectKeyConfig extends OneConnectBaseConfig {
  mode?: "key";
  /** The app's connect key, minted on the app's page in the dashboard.
   *  Server only. Connect keys work in Production. */
  connectKey: string;
  userStore: OneConnectUserStore;
  tokenStore?: never;
}

/**
 * Token mode: pass a token store and the SDK keeps each user's tokens
 * fresh.
 */
export interface OneConnectTokenConfig extends OneConnectBaseConfig {
  mode?: "token";
  tokenStore: OneConnectTokenStore;
  connectKey?: never;
  userStore?: never;
}

/**
 * The mode is whichever credential is configured: a `connectKey` is key
 * mode, a `tokenStore` alone is token mode. Set `mode` to say so
 * explicitly.
 */
export type OneConnectServerConfig = OneConnectKeyConfig | OneConnectTokenConfig;

/** The transaction cookie the authorize leg sets and the callback reads. */
export interface OneConnectCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    maxAge: number;
    path: string;
  };
}

export interface StartAuthorizationInput {
  /** Pre-fills the sign-in email on One's page. Never locks it. */
  loginHint?: string;
  /** Where this one flow returns to: a path on your app ("/chat/42").
   *  Kept in the flow's cookie, never sent to One. Anything that is not
   *  a plain path is ignored and the configured `returnTo` applies. */
  returnTo?: string;
}

export interface StartAuthorizationResult {
  /** Send the browser here with a 302. */
  redirectUrl: string;
  /** Set this cookie on the same response. */
  cookie: OneConnectCookie;
}

export interface CompleteAuthorizationInput {
  /** The app's user the grant belongs to. */
  userId: string;
  /** The full callback URL One redirected to, with its query string. */
  url: string;
  /** Reads a cookie by name from the incoming request. */
  getCookie: (name: string) => string | undefined;
}

import type { ConnectFailureCode } from "../types";
export type { ConnectFailureCode };

export type AuthorizationOutcome = "connected" | "declined" | "failed";

export interface CompleteAuthorizationResult {
  outcome: AuthorizationOutcome;
  /** Why it failed, as the code the browser receives. Only the code goes
   *  on the return URL; the browser shows fixed text for it. */
  code?: ConnectFailureCode;
  /** What happened, for your logs. Never put it in front of the user. */
  message?: string;
  /** Send the browser here with a 302; it carries `?one_connect=…`. */
  redirectUrl: string;
  /** Delete this cookie on the same response, when one was involved. */
  clearCookieName?: string;
}

/** One connection the grant reaches, with the access it confers. */
export interface ReachableConnection {
  key: string;
  platform: string;
  name?: string;
  title?: string;
  image?: string;
  access: ConnectionAccess;
}

export type ConnectionAccess =
  | { policy: "full" }
  | { policy: "methods"; methods: string[] }
  | {
      policy: "actions";
      actions: { actionId: string; title: string; method: string }[];
    };

/** One catalog action for a platform. */
export interface PlatformAction {
  _id: string;
  title: string;
  method: string;
  path: string;
  /** One's tags for the action. "custom" marks an action One itself
   *  serves, which takes the connection key in its body. */
  tags?: string[];
}

export interface SearchActionsOptions {
  /** How many candidates to return. Five when omitted. */
  limit?: number;
  /** What the search ranks for: actions to run now (the default), or
   *  actions to write code and flows against. */
  mode?: "execute" | "knowledge";
}

/**
 * Everything One knows about one action: the guide a caller reads before
 * running it (`knowledge`, Markdown), the shape of its input, and the
 * method and path the SDK runs it with.
 */
export interface ActionKnowledge extends PlatformAction {
  tags: string[];
  /** The action's documentation: what it does, every field it takes,
   *  what it answers. Markdown. */
  knowledge: string;
  /** The input and output shape, when One has one. */
  ioSchema?: unknown;
  /** The platform the action belongs to. */
  platform?: string;
}

export type ActionBodyEncoding = "json" | "form" | "multipart";

export interface RunActionInput {
  /** From `listConnections`. */
  connectionKey: string;
  /** From `searchActions`, `listActions` or `getActionKnowledge`. */
  actionId: string;
  /** The action's method. Looked up from `actionId` when omitted. */
  method?: string;
  /** The action's path, appended to /v1/passthrough. Looked up from
   *  `actionId` when omitted. */
  path?: string;
  /** Values for the path's `{{placeholders}}`, such as `{ calendarId: "primary" }`. */
  pathParams?: Record<string, string | number | boolean>;
  body?: unknown;
  query?: Record<string, string | string[]>;
  /** Extra request headers an action's knowledge asks for, such as a
   *  provider's version header. */
  headers?: Record<string, string>;
  /** How `body` is sent. JSON when omitted; "form" for providers that
   *  take `application/x-www-form-urlencoded` (nested fields in bracket
   *  notation); "multipart" for file-style uploads. */
  encoding?: ActionBodyEncoding;
}

export interface RunActionResult {
  status: number;
  ok: boolean;
  /** True when One refused the call because it is outside the grant.
   *  The provider was never called. Do not retry. Key mode sets it; in
   *  token mode it stays false today, so treat any 403 there as refused. */
  blockedByGrant: boolean;
  data: unknown;
}

/**
 * - `not_connected`: nothing is stored for this user.
 * - `reconnect_required` (key mode): One will not act for this user.
 *   Their consent was revoked, or the app is deactivated. What the app
 *   stored is kept; ask the user to connect again.
 * - `refresh_failed` (token mode): One declared the grant dead (revoked,
 *   expired or reused). The tokens were cleared; ask the user to connect
 *   again.
 * - `request_failed`: One answered with an error or could not be
 *   reached. Nothing stored was changed, so retry later.
 */
export type OneConnectErrorCode =
  | "not_connected"
  | "reconnect_required"
  | "refresh_failed"
  | "request_failed";

export class OneConnectError extends Error {
  readonly code: OneConnectErrorCode;
  readonly status?: number;

  constructor(code: OneConnectErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OneConnectError";
    this.code = code;
    this.status = status;
  }
}
