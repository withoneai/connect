/**
 * Types for `@withone/connect/server`: the half of the SDK that runs on
 * the app's server and holds the client secret.
 */

/** What the app stores per user after the exchange. */
export interface OneConnectTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number;
}

/**
 * Where the app keeps each user's tokens: its database, a cache, an
 * encrypted cookie. The SDK never sees a token outside these three
 * calls. `userId` is the app's own id for its user.
 */
export interface OneConnectTokenStore {
  saveTokens: (userId: string, tokens: OneConnectTokens) => Promise<void>;
  loadTokens: (userId: string) => Promise<OneConnectTokens | null>;
  clearTokens: (userId: string) => Promise<void>;
}

export interface OneConnectServerConfig {
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
  tokenStore: OneConnectTokenStore;
}

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

export type AuthorizationOutcome = "connected" | "declined" | "failed";

export interface CompleteAuthorizationResult {
  outcome: AuthorizationOutcome;
  /** Safe to show to the user when the outcome is not "connected". */
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
}

export interface RunActionInput {
  /** From `listConnections`. */
  connectionKey: string;
  /** From `listActions`. */
  actionId: string;
  method: string;
  /** The action's path, appended to /v1/passthrough. */
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

export interface RunActionResult {
  status: number;
  ok: boolean;
  /** True when One refused the call because it is outside the grant.
   *  The provider was never called. Do not retry. */
  blockedByGrant: boolean;
  data: unknown;
}

export type OneConnectErrorCode =
  | "not_connected"
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
