import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OneConnectError,
  createOneConnect,
  type OneConnectTokenStore,
  type OneConnectUserStore,
} from "@withone/connect/server";

const CONNECT_USER_ID = `cu_${"a1".repeat(32)}`;
const OTHER_CONNECT_USER_ID = `cu_${"b2".repeat(32)}`;
const ORGANIZATION_ID = "0b6d2f0e-2a4b-4f0e-9a3c-5f6f6a1d2c3b";
const CONNECT_KEY = "sk_live_connect_key";
const NOW = new Date("2026-11-20T18:00:00Z").getTime();

function memoryUsers(): OneConnectUserStore & { users: Map<string, string> } {
  const users = new Map<string, string>();
  return {
    users,
    saveUser: async (userId, reference) => {
      users.set(userId, reference);
    },
    loadUser: async (userId) => users.get(userId) ?? null,
    clearUser: async (userId) => {
      users.delete(userId);
    },
  };
}

function memoryTokens(): OneConnectTokenStore {
  const tokens = new Map();
  return {
    saveTokens: async (userId, next) => {
      tokens.set(userId, next);
    },
    loadTokens: async (userId) => tokens.get(userId) ?? null,
    clearTokens: async (userId) => {
      tokens.delete(userId);
    },
  };
}

/** What One's MCP server answers a mint with. */
const minted = (token = "mcp-token-1", expiresIn = 900): Response =>
  new Response(
    JSON.stringify({
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: "user:connections:read user:connections:write",
      resource: "https://mcp.withone.ai/mcp",
      connect_user_id: CONNECT_USER_ID,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );

/** One refusing a mint, in RFC 6749's error shape. */
const refused = (status: number, error: string): Response =>
  new Response(JSON.stringify({ error, error_description: "refused" }), {
    status,
    headers: { "content-type": "application/json" },
  });

/** The route's own refusal of a missing or malformed header. */
const plain = (status: number): Response =>
  new Response(`${status} ${status === 401 ? "Unauthorized" : "Bad Gateway"}`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

const app = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.com/api/one/callback",
};

describe("getMcpToken in key mode", () => {
  let users: ReturnType<typeof memoryUsers>;
  const fetchMock = vi.fn<typeof fetch>();
  const client = (extra: { oneMcpUrl?: string } = {}) =>
    createOneConnect({
      ...app,
      ...extra,
      connectKey: CONNECT_KEY,
      userStore: users,
    });

  beforeEach(() => {
    users = memoryUsers();
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mints a bearer for the user from the connect key", async () => {
    fetchMock.mockResolvedValueOnce(minted());
    const token = await client().getMcpToken("u1");

    expect(token).toEqual({
      accessToken: "mcp-token-1",
      expiresAt: NOW + 900_000,
      url: "https://mcp.withone.ai/mcp",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mcp.withone.ai/connect/token");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("x-one-secret")).toBe(CONNECT_KEY);
    expect(headers.get("x-one-connect-user-id")).toBe(CONNECT_USER_ID);
    expect([...headers.keys()].sort()).toEqual([
      "x-one-connect-user-id",
      "x-one-secret",
    ]);
  });

  it("sends only the user's id when they granted from a space: the grant carries it", async () => {
    users.users.set("u1", `${CONNECT_USER_ID};org=${ORGANIZATION_ID}`);
    fetchMock.mockResolvedValueOnce(minted());
    await client().getMcpToken("u1");
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("x-one-connect-user-id")).toBe(CONNECT_USER_ID);
    expect(headers.has("x-one-organization-id")).toBe(false);
  });

  it("reuses a bearer until a minute before it expires", async () => {
    fetchMock
      .mockResolvedValueOnce(minted("first"))
      .mockResolvedValueOnce(minted("second"));
    const oneConnect = client();

    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe("first");
    vi.setSystemTime(NOW + 839_000);
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe("first");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 840_000);
    const renewed = await oneConnect.getMcpToken("u1");
    expect(renewed.accessToken).toBe("second");
    expect(renewed.expiresAt).toBe(NOW + 840_000 + 900_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mints a new bearer when asked for a fresh one, and keeps that one", async () => {
    fetchMock
      .mockResolvedValueOnce(minted("kept"))
      .mockResolvedValueOnce(minted("fresh"));
    const oneConnect = client();
    await oneConnect.getMcpToken("u1");
    expect(
      (await oneConnect.getMcpToken("u1", { fresh: true })).accessToken,
    ).toBe("fresh");
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the kept bearer on a fresh request even when the mint fails", async () => {
    fetchMock
      .mockResolvedValueOnce(minted("revoked"))
      .mockResolvedValueOnce(refused(401, "invalid_client"))
      .mockResolvedValueOnce(minted("after-new-key"));
    const oneConnect = client();
    await oneConnect.getMcpToken("u1");
    await expect(
      oneConnect.getMcpToken("u1", { fresh: true }),
    ).rejects.toMatchObject({ code: "request_failed", status: 401 });
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe(
      "after-new-key",
    );
  });

  it("joins a mint already under way when asked for a fresh one", async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    const oneConnect = client();
    const first = oneConnect.getMcpToken("u1");
    const fresh = oneConnect.getMcpToken("u1", { fresh: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answer(minted());
    expect((await first).accessToken).toBe("mcp-token-1");
    expect((await fresh).accessToken).toBe("mcp-token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hands out copies, so changing one does not change the cache", async () => {
    fetchMock.mockResolvedValueOnce(minted());
    const oneConnect = client();
    const first = await oneConnect.getMcpToken("u1");
    first.accessToken = "tampered";
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe(
      "mcp-token-1",
    );
  });

  it("mints once for concurrent calls for the same user", async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    const oneConnect = client();
    const calls = Promise.all([
      oneConnect.getMcpToken("u1"),
      oneConnect.getMcpToken("u1"),
      oneConnect.getMcpToken("u1"),
    ]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answer(minted());
    const tokens = await calls;
    expect(tokens.map((token) => token.accessToken)).toEqual([
      "mcp-token-1",
      "mcp-token-1",
      "mcp-token-1",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a bearer per user, and mints anew when the user is another One account", async () => {
    users.users.set("u2", OTHER_CONNECT_USER_ID);
    fetchMock
      .mockResolvedValueOnce(minted("for-u1"))
      .mockResolvedValueOnce(minted("for-u2"))
      .mockResolvedValueOnce(minted("for-u1-reconnected"));
    const oneConnect = client();

    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe("for-u1");
    expect((await oneConnect.getMcpToken("u2")).accessToken).toBe("for-u2");
    // u1 reconnected as another One account: the old bearer is not theirs.
    users.users.set("u1", OTHER_CONNECT_USER_ID);
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe("for-u2");
    users.users.set("u1", `cu_${"c3".repeat(32)}`);
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe(
      "for-u1-reconnected",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws not_connected when nothing is stored, without calling One", async () => {
    await expect(client().getMcpToken("nobody")).rejects.toMatchObject({
      code: "not_connected",
    });
    // After disconnect, a cached bearer is not handed out either.
    fetchMock.mockResolvedValueOnce(minted());
    const oneConnect = client();
    await oneConnect.getMcpToken("u1");
    await oneConnect.disconnect("u1");
    await expect(oneConnect.getMcpToken("u1")).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a key One does not accept as request_failed, with the key-mode message", async () => {
    fetchMock.mockResolvedValueOnce(refused(401, "invalid_client"));
    const error = await client()
      .getMcpToken("u1")
      .catch((e) => e);
    expect(error).toBeInstanceOf(OneConnectError);
    expect(error).toMatchObject({ code: "request_failed", status: 401 });
    expect(error.message).toMatch(/did not accept the connect key/);
  });

  it.each(["invalid_grant", "unauthorized_client"])(
    "reads %s as reconnect_required and keeps the stored value",
    async (code) => {
      fetchMock.mockResolvedValueOnce(refused(403, code));
      await expect(client().getMcpToken("u1")).rejects.toMatchObject({
        code: "reconnect_required",
        status: 403,
      });
      expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
    },
  );

  it("reads invalid_scope as reconnect_required, naming the missing scope", async () => {
    fetchMock.mockResolvedValueOnce(refused(403, "invalid_scope"));
    const error = await client()
      .getMcpToken("u1")
      .catch((e) => e);
    expect(error).toMatchObject({ code: "reconnect_required", status: 403 });
    expect(error.message).toMatch(/connections scope/);
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
  });

  it("does not keep a refused bearer: the next call mints again", async () => {
    fetchMock
      .mockResolvedValueOnce(minted("before"))
      .mockResolvedValueOnce(refused(403, "invalid_grant"))
      .mockResolvedValueOnce(minted("after"));
    const oneConnect = client();
    await oneConnect.getMcpToken("u1");
    vi.setSystemTime(NOW + 900_000);
    await expect(oneConnect.getMcpToken("u1")).rejects.toMatchObject({
      code: "reconnect_required",
    });
    expect((await oneConnect.getMcpToken("u1")).accessToken).toBe("after");
  });

  it("mints again once when the grant changed mid-mint", async () => {
    fetchMock
      .mockResolvedValueOnce(refused(503, "temporarily_unavailable"))
      .mockResolvedValueOnce(minted());
    expect((await client().getMcpToken("u1")).accessToken).toBe("mcp-token-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second temporarily_unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(refused(503, "temporarily_unavailable"))
      .mockResolvedValueOnce(refused(503, "temporarily_unavailable"))
      .mockResolvedValueOnce(minted());
    await expect(client().getMcpToken("u1")).rejects.toMatchObject({
      code: "request_failed",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a missing-header 401", () => plain(401), 401],
    ["a 500", () => refused(500, "server_error"), 500],
    ["an unreachable core (502)", () => plain(502), 502],
    [
      "a 503 that is not a grant change",
      () => new Response("down", { status: 503 }),
      503,
    ],
    [
      "a 403 One does not name",
      () => new Response("403 Forbidden", { status: 403 }),
      403,
    ],
  ])(
    "reads %s as request_failed, without a retry",
    async (_, response, status) => {
      fetchMock.mockResolvedValueOnce(response());
      await expect(client().getMcpToken("u1")).rejects.toMatchObject({
        code: "request_failed",
        status,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("reads a network failure as request_failed", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const error = await client()
      .getMcpToken("u1")
      .catch((e) => e);
    expect(error).toMatchObject({ code: "request_failed" });
    expect(error.status).toBeUndefined();
  });

  it("reads a 200 without a token as request_failed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: "Bearer" }), { status: 200 }),
    );
    await expect(client().getMcpToken("u1")).rejects.toMatchObject({
      code: "request_failed",
    });
  });

  it("never puts the connect key in an error", async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => refused(401, "invalid_client"),
      async () => refused(403, "invalid_grant"),
      async () => refused(403, "unauthorized_client"),
      async () => refused(403, "invalid_scope"),
      async () => refused(500, "server_error"),
      async () => plain(401),
      async () => plain(502),
      // A runtime refusing a header can quote its value.
      async () => {
        throw new TypeError(
          `Headers.append: "${CONNECT_KEY}" is an invalid header value.`,
        );
      },
    ];
    for (const answer of answers) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(answer);
      const error = await client()
        .getMcpToken("u1")
        .catch((e) => e);
      expect(error).toBeInstanceOf(OneConnectError);
      expect(error.message).not.toContain(CONNECT_KEY);
      expect(String(error.stack)).not.toContain(CONNECT_KEY);
      expect(JSON.stringify(error)).not.toContain(CONNECT_KEY);
      expect(error.cause).toBeUndefined();
    }
  });

  it("mints at oneMcpUrl when given one", async () => {
    fetchMock.mockResolvedValueOnce(minted());
    const token = await client({
      oneMcpUrl: "https://development-mcp.example.test/",
    }).getMcpToken("u1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://development-mcp.example.test/connect/token",
    );
    expect(token.url).toBe("https://development-mcp.example.test/mcp");
  });
});

describe("getMcpToken in token mode", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const HOUR = 3_600_000;
  const jwt = (payload: Record<string, unknown>): string =>
    `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
  const refreshToken = (id: string): string =>
    jwt({
      jti: id,
      token_type: "refresh",
      exp: Math.floor((Date.now() + 30 * 24 * HOUR) / 1000),
    });
  const refreshed = (accessToken: string): Response =>
    new Response(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken("r2"),
        expires_in: 3600,
      }),
      { status: 200 },
    );

  const withPair = (expiresInMs: number) => {
    const tokenStore = memoryTokens();
    const pair = {
      accessToken: "a1",
      refreshToken: refreshToken("r1"),
      expiresAt: Date.now() + expiresInMs,
    };
    void tokenStore.saveTokens("u1", pair);
    return { oneConnect: createOneConnect({ ...app, tokenStore }), pair };
  };

  it("returns the user's live access token, with no mint", async () => {
    const { oneConnect, pair } = withPair(24 * HOUR);
    await expect(oneConnect.getMcpToken("u1")).resolves.toEqual({
      accessToken: "a1",
      expiresAt: pair.expiresAt,
      url: "https://mcp.withone.ai/mcp",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes first when the access token is about to expire", async () => {
    const { oneConnect } = withPair(30_000);
    fetchMock.mockResolvedValueOnce(refreshed("a2"));
    await expect(oneConnect.getMcpToken("u1")).resolves.toMatchObject({
      accessToken: "a2",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes on fresh, and throws refresh_failed for a revoked grant", async () => {
    const { oneConnect } = withPair(24 * HOUR);
    fetchMock.mockResolvedValueOnce(refreshed("a2"));
    await expect(
      oneConnect.getMcpToken("u1", { fresh: true }),
    ).resolves.toMatchObject({ accessToken: "a2" });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    await expect(
      oneConnect.getMcpToken("u1", { fresh: true }),
    ).rejects.toMatchObject({
      code: "refresh_failed",
    });
  });

  it("throws not_connected when nothing is stored", async () => {
    const oneConnect = createOneConnect({ ...app, tokenStore: memoryTokens() });
    const error = await oneConnect.getMcpToken("u1").catch((e) => e);
    expect(error).toBeInstanceOf(OneConnectError);
    expect(error).toMatchObject({ code: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
