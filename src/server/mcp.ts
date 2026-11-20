/**
 * Key mode: short-lived bearers for One's remote MCP server, minted from
 * the app's connect key for one connected user. An app that runs its own
 * agent hands the bearer to the agent's MCP client, which then lists,
 * finds and runs actions within that user's grant.
 *
 *   POST {oneMcpUrl}/connect/token
 *   X-One-Secret:           the app's connect key
 *   X-One-Connect-User-Id:  cu_… for the user
 *
 * The bearer lasts 15 minutes and comes with no refresh token: the key
 * does not expire, so the app mints again. The user revoking, the key
 * being deleted or the app being paused ends it on its next call. The
 * user's space is not sent: the grant already carries it.
 */
import {
  CONNECT_USER_HEADER,
  KEY_NOT_ACCEPTED_MESSAGE,
  RECONNECT_REQUIRED_MESSAGE,
  SECRET_HEADER,
} from "./key";
import {
  OneConnectError,
  type GetMcpTokenOptions,
  type OneConnectMcpToken,
} from "./types";

/** A bearer is reused until this close to expiry, so an agent run never
 *  starts on one about to lapse. */
const REUSE_MARGIN_MS = 60_000;

/** One's refusals that only the user connecting again repairs. */
const RECONNECT_REFUSALS = new Set(["invalid_grant", "unauthorized_client"]);

type Attempt =
  | { ok: true; token: OneConnectMcpToken }
  | { ok: false; error: OneConnectError; retry: boolean };

/** One's refusal of a mint, as the error the app handles. Only a grant
 *  replaced mid-mint is worth one more try. */
function refusal(status: number, error: string | undefined): Attempt {
  if (status === 503 && error === "temporarily_unavailable")
    return {
      ok: false,
      retry: true,
      error: new OneConnectError(
        "request_failed",
        "The user's grant changed twice while One minted the MCP token. Try again.",
        status,
      ),
    };
  if (status === 401 && error === "invalid_client")
    return {
      ok: false,
      retry: false,
      error: new OneConnectError(
        "request_failed",
        KEY_NOT_ACCEPTED_MESSAGE,
        status,
      ),
    };
  if (status === 403 && error === "invalid_scope")
    return {
      ok: false,
      retry: false,
      error: new OneConnectError(
        "reconnect_required",
        "The user's consent grants no connections scope, so One's MCP server would refuse every tool. Ask the user to connect again with the default scopes.",
        status,
      ),
    };
  if (status === 403 && error && RECONNECT_REFUSALS.has(error))
    return {
      ok: false,
      retry: false,
      error: new OneConnectError(
        "reconnect_required",
        RECONNECT_REQUIRED_MESSAGE,
        status,
      ),
    };
  return {
    ok: false,
    retry: false,
    error: new OneConnectError(
      "request_failed",
      `One's MCP server refused the token request (HTTP ${status}).`,
      status,
    ),
  };
}

export function createMcpTokens(
  connectKey: string,
  connectUserId: (userId: string) => Promise<string | null>,
  oneMcpUrl: string,
): (
  userId: string,
  options?: GetMcpTokenOptions,
) => Promise<OneConnectMcpToken> {
  const url = `${oneMcpUrl}/mcp`;
  const tokenUrl = `${oneMcpUrl}/connect/token`;
  // Keyed by One's id for the user rather than the app's, so a user who
  // reconnects as another One account never gets the old account's bearer.
  const live = new Map<string, OneConnectMcpToken>();
  const minting = new Map<string, Promise<OneConnectMcpToken>>();

  const attempt = async (id: string): Promise<Attempt> => {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { [SECRET_HEADER]: connectKey, [CONNECT_USER_HEADER]: id },
      });
    } catch {
      // The cause is dropped: a header the runtime rejects can quote its value.
      return {
        ok: false,
        retry: false,
        error: new OneConnectError(
          "request_failed",
          "One's MCP server could not be reached to mint a token.",
        ),
      };
    }
    let body: {
      access_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* not JSON: a bare status line, a proxy page or a server error */
    }
    if (!response.ok)
      return refusal(
        response.status,
        typeof body.error === "string" ? body.error : undefined,
      );
    if (
      typeof body.access_token !== "string" ||
      !body.access_token ||
      typeof body.expires_in !== "number" ||
      !(body.expires_in > 0)
    )
      return {
        ok: false,
        retry: false,
        error: new OneConnectError(
          "request_failed",
          "One's MCP server answered the token request without a token.",
          response.status,
        ),
      };
    return {
      ok: true,
      token: {
        accessToken: body.access_token,
        expiresAt: startedAt + body.expires_in * 1000,
        url,
      },
    };
  };

  const mint = async (id: string): Promise<OneConnectMcpToken> => {
    let result = await attempt(id);
    if (!result.ok && result.retry) result = await attempt(id);
    if (!result.ok) {
      if (result.error.code === "reconnect_required") live.delete(id);
      throw result.error;
    }
    const now = Date.now();
    for (const [key, token] of live)
      if (token.expiresAt <= now) live.delete(key);
    live.set(id, result.token);
    return result.token;
  };

  return async (userId, options = {}) => {
    const id = await connectUserId(userId);
    if (!id)
      throw new OneConnectError("not_connected", "This user is not connected.");
    // The caller saw the kept bearer refused, so it is dropped whatever
    // the new mint says. A mint already under way is new enough.
    if (options.fresh) live.delete(id);
    const cached = live.get(id);
    if (cached && cached.expiresAt - REUSE_MARGIN_MS > Date.now())
      return { ...cached };
    let pending = minting.get(id);
    if (!pending) {
      pending = mint(id).finally(() => minting.delete(id));
      minting.set(id, pending);
    }
    return { ...(await pending) };
  };
}
