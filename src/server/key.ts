/**
 * Key mode: the app holds one connect key, and one permanent id per
 * user. Both go on every call; One reads the user's consent live each
 * time. Nothing expires, so there is nothing to refresh, rotate or lock.
 *
 *   X-One-Secret:           the app's connect key
 *   X-One-Connect-User-Id:  cu_… for the user being acted for
 *
 * The id comes from the one code exchange the callback makes. It is the
 * same for a user for the life of the app, through revocation and
 * re-consent, so it is saved once and never deleted by the SDK.
 */
import type { Credential, TokenResponse } from "./credential";
import { tenancyHeaders } from "./oauth";
import {
  OneConnectError,
  type OneConnectUserReference,
  type OneConnectUserStore,
} from "./types";

/** `cu_` and a hex HMAC-SHA256, as One derives it. */
const CONNECT_USER_ID = /^cu_[0-9a-f]{64}$/;
const ORGANIZATION = "org=";
const PROJECT = "project=";
const SEPARATOR = ";";

const ORGANIZATION_HEADER = "X-One-Organization-Id";
const PROJECT_HEADER = "X-One-Project-Id";

/**
 * The one value an app stores per user, as a string for one column:
 * `cu_…`, then the space the user granted from when it is not their
 * personal one (`cu_…;org=<id>;project=<id>`).
 *
 * The space travels with the id because One resolves a call's tenant
 * from headers: a grant made from an organization lives there, and a
 * call that names none runs in the user's personal space and reaches
 * nothing. In token mode the access token names the space on every
 * call; here there is no token after the exchange, so it is kept.
 */
export function encodeUserReference(reference: OneConnectUserReference): string {
  const parts = [reference.connectUserId];
  if (reference.organizationId) parts.push(`${ORGANIZATION}${reference.organizationId}`);
  if (reference.projectId) parts.push(`${PROJECT}${reference.projectId}`);
  return parts.join(SEPARATOR);
}

/** Reads a stored value back. Null when it is not one this SDK wrote. */
export function parseUserReference(value: string): OneConnectUserReference | null {
  const [connectUserId, ...rest] = value.trim().split(SEPARATOR);
  if (!CONNECT_USER_ID.test(connectUserId)) return null;
  const reference: OneConnectUserReference = { connectUserId };
  for (const part of rest) {
    if (part.startsWith(ORGANIZATION)) reference.organizationId = part.slice(ORGANIZATION.length);
    else if (part.startsWith(PROJECT)) reference.projectId = part.slice(PROJECT.length);
  }
  return reference;
}

/**
 * One answers a credential it will not accept with the bare status line
 * and nothing else. Anything richer came from the route or from the
 * provider behind a passthrough, and is not a verdict on the credential.
 */
const isBareRefusal = (status: number, body: string, reason: string): boolean =>
  body.trim() === `${status} ${reason}`;

export interface KeyCredential extends Credential {
  getConnectUserId: (userId: string) => Promise<string | null>;
}

export function createKeyCredential(
  connectKey: string,
  userStore: OneConnectUserStore,
): KeyCredential {
  const load = async (userId: string): Promise<OneConnectUserReference | null> => {
    const stored = await userStore.loadUser(userId);
    return stored ? parseUserReference(stored) : null;
  };

  return {
    connected: async (userId, response: TokenResponse) => {
      const connectUserId = response.connect_user_id;
      if (!connectUserId || !CONNECT_USER_ID.test(connectUserId)) {
        throw new OneConnectError(
          "request_failed",
          "One did not return a connect user id for this user, so key mode cannot act for them.",
        );
      }
      // The space the user granted from, read once from the token that
      // named it. The token itself is not kept.
      const space = tenancyHeaders(response.access_token);
      await userStore.saveUser(
        userId,
        encodeUserReference({
          connectUserId,
          organizationId: space[ORGANIZATION_HEADER],
          projectId: space[PROJECT_HEADER],
        }),
      );
    },

    headers: async (userId) => {
      const reference = await load(userId);
      if (!reference)
        throw new OneConnectError("not_connected", "This user is not connected.");
      const headers: Record<string, string> = {
        "X-One-Secret": connectKey,
        "X-One-Connect-User-Id": reference.connectUserId,
      };
      if (reference.organizationId) headers[ORGANIZATION_HEADER] = reference.organizationId;
      if (reference.projectId) headers[PROJECT_HEADER] = reference.projectId;
      return headers;
    },

    isConnected: async (userId) => (await load(userId)) !== null,
    disconnect: (userId) => userStore.clearUser(userId),

    refusal: (status, body) => {
      // One does not say which: the consent was revoked, was never given
      // in this key's environment, or the app is deactivated. The saved id
      // is kept either way, because it is the same id after a reconnect.
      if (status === 403 && isBareRefusal(status, body, "Forbidden")) {
        return new OneConnectError(
          "reconnect_required",
          "One will not act for this user: their consent was revoked, or the app is deactivated. Ask the user to connect again. If every user fails, check that the connect key is for this environment and that the app is active.",
          status,
        );
      }
      if (status === 401 && isBareRefusal(status, body, "Unauthorized")) {
        return new OneConnectError(
          "request_failed",
          "One did not accept the connect key. Check that it is this app's connect key, minted on the app's page in the One dashboard.",
          status,
        );
      }
      return null;
    },

    getConnectUserId: async (userId) => (await load(userId))?.connectUserId ?? null,
  };
}
