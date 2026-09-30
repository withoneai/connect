/**
 * The seam between the two ways an app can hold a user's grant.
 *
 * Everything around it is shared: the authorize leg, the callback, and
 * the calls made with the grant. A credential answers only what differs:
 * what to keep when a user connects, what to send on a call, and how to
 * read One refusing it.
 *
 * - key mode (`./key`): the app's connect key plus a permanent id for
 *   the user. Nothing expires, so nothing is refreshed.
 * - token mode (`./token`): an access token and a refresh token per
 *   user, rotated before they expire.
 */
import type { OneConnectError } from "./types";

/** What One's token endpoint answers on success. `connect_user_id` is
 *  present whenever a durable grant backs the token. */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  connect_user_id?: string;
}

/** What One's token endpoint answered. A network failure throws instead. */
export type TokenAnswer =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: number; error?: string };

export type PostToken = (body: URLSearchParams) => Promise<TokenAnswer>;

export interface Credential {
  /** The callback exchanged the code: keep what this mode needs. */
  connected: (userId: string, response: TokenResponse) => Promise<void>;
  /** The headers that make a /v1 call act for this user. Throws
   *  `not_connected` when the user has nothing stored. */
  headers: (userId: string) => Promise<Record<string, string>>;
  isConnected: (userId: string) => Promise<boolean>;
  /** Drops the app's copy. The user revokes the grant itself in One. */
  disconnect: (userId: string) => Promise<void>;
  /** One refused the credential itself, rather than the call it carried:
   *  the error to throw, or null when this answer is not that. */
  refusal: (status: number, body: string) => OneConnectError | null;
}
