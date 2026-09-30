import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOneConnectRoutes } from "@withone/connect/next";
import {
  OneConnectError,
  createOneConnect,
  encodeUserReference,
  parseUserReference,
  type OneConnectTokenStore,
  type OneConnectUserStore,
} from "@withone/connect/server";

const CONNECT_USER_ID = `cu_${"a1".repeat(32)}`;
const ORGANIZATION_ID = "0b6d2f0e-2a4b-4f0e-9a3c-5f6f6a1d2c3b";
const PROJECT_ID = "7c1e9a52-8d3f-4c6b-b1a0-2e4f6a8c0d1e";

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

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

/** What One's token endpoint answers when a durable grant backs the token. */
function exchanged(claims: Record<string, unknown> = {}, connectUserId: string | null = CONNECT_USER_ID): Response {
  return new Response(
    JSON.stringify({
      access_token: jwt(claims),
      refresh_token: jwt({ exp: 9_999_999_999 }),
      expires_in: 3600,
      ...(connectUserId ? { connect_user_id: connectUserId } : {}),
    }),
    { status: 200 },
  );
}

/** One refusing a credential: the bare status line, nothing else. */
const bare = (status: 401 | 403): Response =>
  new Response(status === 403 ? "403 Forbidden" : "401 Unauthorized", {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

const app = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.com/api/one/callback",
  permissionSet: "set-1",
  oneApiUrl: "https://api.example.test/",
};
const CONNECT_KEY = "sk_live_connect_key";

const callbackUrl = `${app.redirectUri}?code=c1&state=s1`;
const withVerifier = (name: string) => (name === "one_tx_s1" ? "verifier" : undefined);

describe("choosing a mode", () => {
  it("is key mode when a connect key is configured", () => {
    const oneConnect = createOneConnect({ ...app, connectKey: CONNECT_KEY, userStore: memoryUsers() });
    expect(oneConnect.mode).toBe("key");
    expect(oneConnect).toHaveProperty("getConnectUserId");
    // Nothing to refresh, so nothing that refreshes.
    expect(oneConnect).not.toHaveProperty("refreshTokens");
    expect(oneConnect).not.toHaveProperty("getAccessToken");
  });

  it("is token mode when only a token store is configured, as before key mode existed", () => {
    const oneConnect = createOneConnect({ ...app, tokenStore: memoryTokens() });
    expect(oneConnect.mode).toBe("token");
    expect(oneConnect).toHaveProperty("refreshIfExpiring");
    expect(oneConnect).not.toHaveProperty("getConnectUserId");
  });

  it("follows an explicit mode", () => {
    expect(createOneConnect({ ...app, mode: "token", tokenStore: memoryTokens() }).mode).toBe("token");
    expect(
      createOneConnect({ ...app, mode: "key", connectKey: CONNECT_KEY, userStore: memoryUsers() }).mode,
    ).toBe("key");
  });

  it("refuses a config with no credential, and points at key mode", () => {
    // A JavaScript caller, or a config assembled from missing env vars.
    const create = createOneConnect as (config: unknown) => unknown;
    expect(() => create({ ...app })).toThrow(/connectKey.*userStore.*key mode/);
    expect(() => create({ ...app, connectKey: CONNECT_KEY })).toThrow(/key mode needs `connectKey`.*`userStore`/);
    expect(() => create({ ...app, userStore: memoryUsers() })).toThrow(/needs a credential/);
    expect(() => create({ ...app, mode: "token" })).toThrow(/token mode needs `tokenStore`/);
    expect(() => create({ ...app, mode: "keys", connectKey: CONNECT_KEY })).toThrow(/"key" or "token"/);
    // An empty connect key is a missing env var, not key mode.
    expect(() => create({ ...app, connectKey: "", userStore: memoryUsers() })).toThrow(/needs a credential/);
  });
});

describe("the user reference", () => {
  it("is the bare id for a personal space", () => {
    expect(encodeUserReference({ connectUserId: CONNECT_USER_ID })).toBe(CONNECT_USER_ID);
    expect(parseUserReference(CONNECT_USER_ID)).toEqual({ connectUserId: CONNECT_USER_ID });
  });

  it("carries the space the user granted from, and reads it back", () => {
    const reference = { connectUserId: CONNECT_USER_ID, organizationId: ORGANIZATION_ID, projectId: PROJECT_ID };
    const stored = encodeUserReference(reference);
    expect(stored).toBe(`${CONNECT_USER_ID};org=${ORGANIZATION_ID};project=${PROJECT_ID}`);
    expect(parseUserReference(stored)).toEqual(reference);
    expect(parseUserReference(` ${stored}\n`)).toEqual(reference);
  });

  it("rejects anything that is not an id One issued", () => {
    for (const value of ["", "42", "cu_short", `cu_${"g".repeat(64)}`, `org=${ORGANIZATION_ID}`, "eyJhbGciOi"])
      expect(parseUserReference(value)).toBeNull();
  });
});

describe("key mode", () => {
  let users: ReturnType<typeof memoryUsers>;
  const fetchMock = vi.fn<typeof fetch>();
  const client = () => createOneConnect({ ...app, connectKey: CONNECT_KEY, userStore: users });

  beforeEach(() => {
    users = memoryUsers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts the same flow as token mode", () => {
    const { redirectUrl, cookie } = client().startAuthorization({ loginHint: "user@example.com" });
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe("https://api.example.test/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("permission_set")).toBe("set-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(cookie.name).toBe(`one_tx_${url.searchParams.get("state")}`);
    // The connect key never travels with the browser.
    expect(redirectUrl).not.toContain(CONNECT_KEY);
    expect(cookie.value).not.toContain(CONNECT_KEY);
  });

  it("keeps the user's id from the exchange, and no token", async () => {
    fetchMock.mockResolvedValueOnce(exchanged());
    const result = await client().completeAuthorization({ userId: "u1", url: callbackUrl, getCookie: withVerifier });

    expect(result.outcome).toBe("connected");
    expect(new URL(result.redirectUrl).searchParams.get("one_connect")).toBe("success");
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);

    // The exchange is the ordinary one: Basic auth, the code, the verifier.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/oauth/token");
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /);
    expect(String(init?.body)).toContain("grant_type=authorization_code");
    expect(String(init?.body)).toContain("code_verifier=verifier");
  });

  it("keeps the space the user granted from beside the id", async () => {
    fetchMock.mockResolvedValueOnce(
      exchanged({ organization_ids: [ORGANIZATION_ID], project_ids: [PROJECT_ID] }),
    );
    await client().completeAuthorization({ userId: "u1", url: callbackUrl, getCookie: withVerifier });
    expect(users.users.get("u1")).toBe(`${CONNECT_USER_ID};org=${ORGANIZATION_ID};project=${PROJECT_ID}`);
  });

  it("fails the flow when One returns no connect user id, and stores nothing", async () => {
    for (const missing of [null, "not-an-id"]) {
      fetchMock.mockResolvedValueOnce(exchanged({}, missing));
      const result = await client().completeAuthorization({ userId: "u1", url: callbackUrl, getCookie: withVerifier });
      expect(result.outcome).toBe("failed");
      expect(result.message).toMatch(/did not return a connect user id/);
      expect(new URL(result.redirectUrl).searchParams.get("one_connect_error")).toBe("failed");
    }
    expect(users.users.size).toBe(0);
  });

  it("updates the space when the user connects again from another one", async () => {
    const oneConnect = client();
    fetchMock.mockResolvedValueOnce(exchanged({ organization_ids: [ORGANIZATION_ID] }));
    await oneConnect.completeAuthorization({ userId: "u1", url: callbackUrl, getCookie: withVerifier });
    expect(users.users.get("u1")).toBe(`${CONNECT_USER_ID};org=${ORGANIZATION_ID}`);

    fetchMock.mockResolvedValueOnce(exchanged());
    await oneConnect.completeAuthorization({ userId: "u1", url: callbackUrl, getCookie: withVerifier });
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
  });

  it("calls One with the connect key and the user's id, and no bearer", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [{ key: "k1", platform: "gmail", access: { policy: "full" } }] })),
    );
    const rows = await client().listConnections("u1");
    expect(rows).toEqual([{ key: "k1", platform: "gmail", access: { policy: "full" } }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/connections/reachable");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-one-secret")).toBe(CONNECT_KEY);
    expect(headers.get("x-one-connect-user-id")).toBe(CONNECT_USER_ID);
    expect(headers.has("authorization")).toBe(false);
    // A personal-space grant names no tenant.
    expect(headers.has("x-one-organization-id")).toBe(false);
    expect(headers.has("x-one-project-id")).toBe(false);
  });

  it("names the user's space on every call when they granted from one", async () => {
    users.users.set("u1", `${CONNECT_USER_ID};org=${ORGANIZATION_ID};project=${PROJECT_ID}`);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ rows: [] })));
    const oneConnect = client();
    await oneConnect.listConnections("u1");
    await oneConnect.runAction("u1", { connectionKey: "k1", actionId: "a1", method: "get", path: "/me" });
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-one-organization-id")).toBe(ORGANIZATION_ID);
      expect(headers.get("x-one-project-id")).toBe(PROJECT_ID);
    }
  });

  it("runs an action with the action headers beside the credential", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    const reply = await client().runAction("u1", {
      connectionKey: "k1",
      actionId: "a1",
      method: "post",
      path: "/users/me/messages/send",
      body: { raw: "…" },
      query: { alt: "json" },
    });
    expect(reply).toEqual({ status: 200, ok: true, blockedByGrant: false, data: { id: "m1" } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/passthrough/users/me/messages/send?alt=json");
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(headers.get("x-one-secret")).toBe(CONNECT_KEY);
    expect(headers.get("x-one-connect-user-id")).toBe(CONNECT_USER_ID);
    expect(headers.get("x-one-connection-key")).toBe("k1");
    expect(headers.get("x-one-action-id")).toBe("a1");
    expect(init?.body).toBe(JSON.stringify({ raw: "…" }));
  });

  it("asks the user to connect again when One will not act for them, and keeps their id", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    const oneConnect = client();

    fetchMock.mockResolvedValueOnce(bare(403));
    await expect(oneConnect.listConnections("u1")).rejects.toMatchObject({
      name: "OneConnectError",
      code: "reconnect_required",
      status: 403,
    });

    // An action refused with the bare 403, and One refuses the user's
    // connections too: it is the consent that is gone.
    fetchMock.mockResolvedValueOnce(bare(403)).mockResolvedValueOnce(bare(403));
    await expect(
      oneConnect.runAction("u1", { connectionKey: "k1", actionId: "a1", method: "GET", path: "/me" }),
    ).rejects.toMatchObject({ code: "reconnect_required" });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      "https://api.example.test/v1/connections/reachable?limit=1",
    );

    // The id is the same after a reconnect, and a wrong-environment key
    // refuses every user at once: deleting here would disconnect them all.
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
    expect(await oneConnect.isConnected("u1")).toBe(true);
  });

  it("reports a connect key One does not accept as a request failure, not a disconnect", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(bare(401));
    const error = await client().listConnections("u1").catch((caught) => caught);
    expect(error).toBeInstanceOf(OneConnectError);
    expect(error.code).toBe("request_failed");
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/connect key/);
    // The message names the problem, never the key.
    expect(error.message).not.toContain(CONNECT_KEY);
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
  });

  it("tells a call outside the grant from a consent that is gone, which One answers alike", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    // The same bare 403, but the user's connections still answer: the
    // consent stands, and it was this call One refused.
    fetchMock
      .mockResolvedValueOnce(bare(403))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] })));
    const reply = await client().runAction("u1", { connectionKey: "k1", actionId: "a1", method: "GET", path: "/x" });
    expect(reply).toEqual({ status: 403, ok: false, blockedByGrant: true, data: "403 Forbidden" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
  });

  it("does not guess when One cannot say whether the consent stands", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(bare(403)).mockResolvedValueOnce(new Response("upstream", { status: 503 }));
    await expect(
      client().runAction("u1", { connectionKey: "k1", actionId: "a1", method: "GET", path: "/x" }),
    ).rejects.toMatchObject({ code: "request_failed", status: 503 });

    // A key One stops accepting mid-way is a key problem, not a disconnect.
    fetchMock.mockResolvedValueOnce(bare(403)).mockResolvedValueOnce(bare(401));
    await expect(
      client().runAction("u1", { connectionKey: "k1", actionId: "a1", method: "GET", path: "/x" }),
    ).rejects.toMatchObject({ code: "request_failed", status: 401 });
  });

  it("returns a call the grant does not cover as blockedByGrant, like token mode", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "access", status: 403, message: "Access denied", correlationId: "c1" }), {
        status: 403,
      }),
    );
    const reply = await client().runAction("u1", { connectionKey: "k1", actionId: "a1", method: "DELETE", path: "/x" });
    expect(reply).toMatchObject({ status: 403, ok: false, blockedByGrant: true });
  });

  it("returns a provider's own 403 as the provider's answer", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    // Not One's bare status line: a provider page, or a provider's JSON.
    for (const body of ["<html>403 Forbidden</html>", "Forbidden", JSON.stringify({ error: "insufficient_scope" })]) {
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 403 }));
      const reply = await client().runAction("u1", { connectionKey: "k1", actionId: "a1", method: "GET", path: "/x" });
      expect(reply).toMatchObject({ status: 403, ok: false, blockedByGrant: false });
    }
  });

  it("keeps a server error a request failure worth retrying", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(new Response("upstream", { status: 503 }));
    await expect(client().listConnections("u1")).rejects.toMatchObject({ code: "request_failed", status: 503 });
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
  });

  it("throws not_connected for a user who never connected, without calling One", async () => {
    const oneConnect = client();
    expect(await oneConnect.isConnected("nobody")).toBe(false);
    expect(await oneConnect.getConnectUserId("nobody")).toBeNull();
    await expect(oneConnect.listConnections("nobody")).rejects.toMatchObject({ code: "not_connected" });
    await expect(
      oneConnect.runAction("nobody", { connectionKey: "k", actionId: "a", method: "GET", path: "/" }),
    ).rejects.toMatchObject({ code: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a stored value it did not write as not connected", async () => {
    users.users.set("u1", "something-else");
    await expect(client().listConnections("u1")).rejects.toMatchObject({ code: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hands back the user's id, and forgets it only on disconnect", async () => {
    users.users.set("u1", `${CONNECT_USER_ID};org=${ORGANIZATION_ID}`);
    const oneConnect = client();
    expect(await oneConnect.getConnectUserId("u1")).toBe(CONNECT_USER_ID);
    await oneConnect.disconnect("u1");
    expect(users.users.has("u1")).toBe(false);
    expect(await oneConnect.isConnected("u1")).toBe(false);
  });

  it("lists a platform's actions with the same credential", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [{ _id: "a1", title: "Send", method: "POST", path: "/send" }], pages: 1 })),
    );
    const actions = await client().listActions("u1", "gmail");
    expect(actions).toEqual([{ _id: "a1", title: "Send", method: "POST", path: "/send" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/knowledge?connectionPlatform=gmail");
    expect(new Headers(init?.headers).get("x-one-connect-user-id")).toBe(CONNECT_USER_ID);
  });

  it("says so when the catalog does not take the connect key, rather than blaming the consent", async () => {
    users.users.set("u1", CONNECT_USER_ID);
    // The catalog answers the bare 403, but the user's connections still do.
    fetchMock
      .mockResolvedValueOnce(bare(403))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] })));
    const error = await client().listActions("u1", "gmail").catch((caught) => caught);
    expect(error).toMatchObject({ code: "request_failed", status: 403 });
    expect(error.message).toMatch(/catalog refused the connect key/);

    // The same answer with the consent gone is the consent.
    fetchMock.mockResolvedValueOnce(bare(403)).mockResolvedValueOnce(bare(403));
    await expect(client().listActions("u1", "gmail")).rejects.toMatchObject({ code: "reconnect_required" });
  });

  it("serves both routes through the same adapter as token mode", async () => {
    const routes = createOneConnectRoutes(client(), { identifyUser: () => "u1" });
    const started = await routes.GET(new Request("https://app.example.com/api/one/authorize"));
    expect(started.status).toBe(302);
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;

    fetchMock.mockResolvedValueOnce(exchanged());
    const finished = await routes.GET(
      new Request(`https://app.example.com/api/one/callback?code=c1&state=${state}`, {
        headers: { cookie: `one_tx_${state}=verifier` },
      }),
    );
    expect(finished.status).toBe(302);
    expect(new URL(finished.headers.get("location")!).searchParams.get("one_connect")).toBe("success");
    expect(users.users.get("u1")).toBe(CONNECT_USER_ID);
  });
});
