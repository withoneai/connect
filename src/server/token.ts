/**
 * Token mode: the app holds an access token and a refresh token per
 * user, and the SDK keeps them fresh.
 *
 * Refresh. One's access token lives an hour by default, its refresh token 30
 * days; every refresh rotates both, and One treats a second use of a
 * rotated refresh token as theft and revokes the whole grant. So the
 * client refreshes one user at a time (in this process always, across
 * processes through `tokenStore.withLock`), re-reads the store before
 * spending a refresh token, clears tokens only when One declares the
 * grant dead, and never lets a failing old pair delete a newer one.
 */
import type { Credential, PostToken, TokenAnswer, TokenResponse } from "./credential";
import { refreshTokenExpiresAt, tenancyHeaders } from "./oauth";
import {
  OneConnectError,
  type OneConnectTokenStore,
  type OneConnectTokens,
  type RefreshIfExpiringOptions,
} from "./types";

/** Refresh this long before expiry, so a call never races the clock. */
const REFRESH_MARGIN_MS = 60_000;

/** The one refusal that means the grant is gone for good: revoked by the
 *  user, expired, or burned by a reused refresh token (RFC 6749 §5.2). */
const isDeadGrant = (answer: TokenAnswer): boolean =>
  !answer.ok && answer.status === 400 && answer.error === "invalid_grant";

export interface TokenCredential extends Credential {
  getAccessToken: (userId: string) => Promise<string>;
  getTokens: (userId: string) => Promise<OneConnectTokens | null>;
  refreshTokens: (userId: string) => Promise<OneConnectTokens>;
  refreshIfExpiring: (
    userId: string,
    options?: RefreshIfExpiringOptions,
  ) => Promise<OneConnectTokens>;
}

export function createTokenCredential(
  tokenStore: OneConnectTokenStore,
  postToken: PostToken,
): TokenCredential {
  /** One refresh in flight per user: two concurrent refreshes with the
   *  same refresh token trip One's reuse detection. */
  const refreshing = new Map<string, Promise<OneConnectTokens>>();

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

  return {
    // Under the lock, so a refresh in flight on another server cannot
    // interleave with this save.
    connected: (userId, response) => {
      const tokens = toTokens(response);
      return locked(userId, () => tokenStore.saveTokens(userId, tokens));
    },
    headers: async (userId) => {
      const accessToken = await getAccessToken(userId);
      return {
        Authorization: `Bearer ${accessToken}`,
        ...tenancyHeaders(accessToken),
      };
    },
    isConnected: async (userId) => (await tokenStore.loadTokens(userId)) !== null,
    disconnect: (userId) => tokenStore.clearTokens(userId),
    // A dead grant surfaces at the refresh, before any call is made.
    refusal: () => null,
    getAccessToken,
    getTokens: (userId) => tokenStore.loadTokens(userId),
    refreshTokens,
    refreshIfExpiring,
  };
}
