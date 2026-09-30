import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOneConnectRoutes, readCookie, routeFor } from "@withone/connect/next";
import {
  OneConnectError,
  createOneConnect,
  type OneConnectTokenStore,
  type OneConnectTokens,
} from "@withone/connect/server";
import { createHash } from "node:crypto";

import { pkceChallenge, txCookie } from "../src/server/oauth";

function memoryStore(): OneConnectTokenStore & { tokens: Map<string, OneConnectTokens> } {
  const tokens = new Map<string, OneConnectTokens>();
  return {
    tokens,
    saveTokens: async (userId, next) => {
      tokens.set(userId, next);
    },
    loadTokens: async (userId) => tokens.get(userId) ?? null,
    clearTokens: async (userId) => {
      tokens.delete(userId);
    },
  };
}

function invalidGrant(): Response {
  return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
}

function tokenResponse(accessToken: string, refreshToken: string): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 }),
    { status: 200 },
  );
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

const config = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.com/api/one/callback",
  permissionSet: "set-1",
  oneApiUrl: "https://api.example.test/",
};

describe("oauth helpers", () => {
  it("derives the PKCE challenge with S256", () => {
    expect(pkceChallenge("verifier")).toBe(
      createHash("sha256").update("verifier").digest("base64url"),
    );
    expect(pkceChallenge("verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("scopes the transaction cookie to the routes' directory", () => {
    const cookie = txCookie("abc", "v", "https://app.example.com/api/one/callback");
    expect(cookie.name).toBe("one_tx_abc");
    expect(cookie.options).toMatchObject({ path: "/api/one", secure: true, sameSite: "lax" });
    expect(txCookie("abc", "v", "http://localhost:3000/callback").options).toMatchObject({
      path: "/",
      secure: false,
    });
  });
});

describe("createOneConnect", () => {
  let store: ReturnType<typeof memoryStore>;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    store = memoryStore();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts the flow with every OAuth parameter and a cookie", () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    const { redirectUrl, cookie } = oneConnect.startAuthorization({
      loginHint: "user@example.com",
    });
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe("https://api.example.test/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("permission_set")).toBe("set-1");
    expect(url.searchParams.get("login_hint")).toBe("user@example.com");
    expect(url.searchParams.get("scope")).toContain("project:connections:write");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(cookie.value));
    expect(cookie.name).toBe(`one_tx_${url.searchParams.get("state")}`);
  });

  it("reports a declined consent without calling One", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    const result = await oneConnect.completeAuthorization({
      userId: "u1",
      url: `${config.redirectUri}?error=access_denied&state=s1`,
      getCookie: () => "verifier",
    });
    expect(result.outcome).toBe("declined");
    expect(result.code).toBe("declined");
    // Only a code travels on the URL, never text a link could forge.
    const back = new URL(result.redirectUrl);
    expect(back.searchParams.get("one_connect")).toBe("error");
    expect(back.searchParams.get("one_connect_error")).toBe("declined");
    expect(back.searchParams.has("one_connect_message")).toBe(false);
    expect(result.clearCookieName).toBe("one_tx_s1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a callback whose state has no cookie", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    const result = await oneConnect.completeAuthorization({
      userId: "u1",
      url: `${config.redirectUri}?code=c&state=forged`,
      getCookie: () => undefined,
    });
    expect(result.outcome).toBe("failed");
    expect(result.code).toBe("expired");
    expect(result.redirectUrl).toContain("one_connect_error=expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the code with Basic auth and stores both tokens", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
        { status: 200 },
      ),
    );
    const oneConnect = createOneConnect({ ...config, returnTo: "/home", tokenStore: store });
    const result = await oneConnect.completeAuthorization({
      userId: "u1",
      url: `${config.redirectUri}?code=the-code&state=s1`,
      getCookie: (name) => (name === "one_tx_s1" ? "the-verifier" : undefined),
    });
    expect(result.outcome).toBe("connected");
    expect(result.redirectUrl).toBe("https://app.example.com/home?one_connect=success");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/oauth/token");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
    );
    const body = init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(store.tokens.get("u1")).toMatchObject({ accessToken: "at", refreshToken: "rt" });
  });

  it("refreshes an expiring token once and clears the store when One refuses", async () => {
    store.tokens.set("u1", { accessToken: "old", refreshToken: "rt", expiresAt: Date.now() });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "new", refresh_token: "rt2", expires_in: 3600 }),
        { status: 200 },
      ),
    );
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    const [a, b] = await Promise.all([
      oneConnect.getAccessToken("u1"),
      oneConnect.getAccessToken("u1"),
    ]);
    expect(a).toBe("new");
    expect(b).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    store.tokens.set("u1", { accessToken: "old", refreshToken: "rt", expiresAt: Date.now() });
    fetchMock.mockResolvedValueOnce(invalidGrant());
    await expect(oneConnect.getAccessToken("u1")).rejects.toMatchObject({
      code: "refresh_failed",
    } satisfies Partial<OneConnectError>);
    expect(store.tokens.has("u1")).toBe(false);
  });

  it("calls One with the bearer, the tenancy headers and the action headers", async () => {
    const token = jwt({ organization_ids: ["org-1"], project_ids: [] });
    store.tokens.set("u1", { accessToken: token, refreshToken: "rt", expiresAt: Date.now() + 1e6 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ correlationId: "x", message: "outside the grant" }), {
        status: 403,
      }),
    );
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    const result = await oneConnect.runAction("u1", {
      connectionKey: "live::gmail::default::k",
      actionId: "conn_mod_def::1",
      method: "post",
      path: "/messages",
      body: { to: "a@b.c" },
    });
    expect(result.blockedByGrant).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/passthrough/messages");
    const headers = init?.headers as Headers;
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("x-one-organization-id")).toBe("org-1");
    expect(headers.get("x-one-project-id")).toBeNull();
    expect(headers.get("x-one-connection-key")).toBe("live::gmail::default::k");
    expect(headers.get("x-one-action-id")).toBe("conn_mod_def::1");
    expect(init?.method).toBe("POST");
  });

  it("throws not_connected for a user with no tokens", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    await expect(oneConnect.listConnections("nobody")).rejects.toMatchObject({
      code: "not_connected",
    });
  });
});

describe("createOneConnectRoutes", () => {
  it("names the leg from the path and reads cookies", () => {
    expect(routeFor("https://app.example.com/api/one/authorize?x=1")).toBe("authorize");
    expect(routeFor("https://app.example.com/api/one/callback/")).toBe("callback");
    expect(
      readCookie(new Request("https://x", { headers: { cookie: "a=1; one_tx_s=v%20v" } }), "one_tx_s"),
    ).toBe("v v");
  });

  it("serves both legs from one handler", async () => {
    const store = memoryStore();
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    const { GET } = createOneConnectRoutes(oneConnect, { identifyUser: () => "u1" });

    const start = await GET(new Request("https://app.example.com/api/one/authorize"));
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toContain("/oauth/authorize?");
    const setCookie = start.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^one_tx_[0-9a-f]+=.*; Path=\/api\/one; Max-Age=1800; SameSite=Lax; HttpOnly; Secure$/);

    const declined = await GET(
      new Request("https://app.example.com/api/one/callback?error=access_denied&state=s"),
    );
    expect(declined.status).toBe(302);
    expect(declined.headers.get("location")).toContain("one_connect=error");
    expect(declined.headers.get("set-cookie")).toContain("one_tx_s=; Path=/api/one; Max-Age=0");

    const unknown = await GET(new Request("https://app.example.com/api/one/other"));
    expect(unknown.status).toBe(404);
  });

  it("refuses a visitor who is not signed in", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: memoryStore() });
    const { GET } = createOneConnectRoutes(oneConnect, {
      identifyUser: () => null,
      signInUrl: "/login",
    });
    const response = await GET(new Request("https://app.example.com/api/one/authorize"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
  });
});

/** A store shared by several "servers", with the cross-process lock a
 *  database would give: one holder at a time, the rest queue. */
function sharedStore() {
  const store = memoryStore();
  let tail: Promise<unknown> = Promise.resolve();
  const lockCalls: string[] = [];
  const clearCalls: { userId: string; failed?: OneConnectTokens }[] = [];
  return Object.assign(store, {
    lockCalls,
    clearCalls,
    clearTokens: async (userId: string, failed?: OneConnectTokens) => {
      clearCalls.push({ userId, failed });
      store.tokens.delete(userId);
    },
    withLock: <T>(userId: string, run: () => Promise<T>): Promise<T> => {
      lockCalls.push(userId);
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
  });
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A refresh token whose `exp` claim is `expiresInMs` from now. */
function refreshJwt(id: string, expiresInMs: number): string {
  return jwt({ jti: id, token_type: "refresh", exp: Math.floor((Date.now() + expiresInMs) / 1000) });
}

/** A refresh token issued `ageMs` ago, as One mints them: 30 days of life. */
function agedRefreshJwt(id: string, ageMs: number, lifeMs = 30 * DAY): string {
  const issuedAt = Date.now() - ageMs;
  return jwt({
    jti: id,
    token_type: "refresh",
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor((issuedAt + lifeMs) / 1000),
  });
}

/** Resolves when the test calls the returned `release`. */
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
}

describe("refresh", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  // One timestamp for the whole suite: tests compare the pair they stored
  // with the pair they expect, and a second Date.now() can land a
  // millisecond later on a slow machine. Within the refresh margin either way.
  const EXPIRES_AT = Date.now() + 1000;
  const expiring = (refreshToken = "rt"): OneConnectTokens => ({
    accessToken: "old",
    refreshToken,
    expiresAt: EXPIRES_AT,
  });

  it("keeps the tokens when One has a server error, and says to retry", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(new Response("Endpoint, primitive error", { status: 500 }));
    await expect(oneConnect.getAccessToken("u1")).rejects.toMatchObject({
      code: "request_failed",
      status: 500,
    });
    expect(store.tokens.get("u1")).toEqual(expiring());
    expect(store.clearCalls).toHaveLength(0);
  });

  it("keeps the tokens when One cannot be reached", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(oneConnect.getAccessToken("u1")).rejects.toMatchObject({ code: "request_failed" });
    expect(store.tokens.has("u1")).toBe(true);
  });

  it("keeps the tokens on a refusal that is not about the grant", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }),
    );
    await expect(oneConnect.getAccessToken("u1")).rejects.toMatchObject({
      code: "request_failed",
      status: 401,
    });
    expect(store.tokens.has("u1")).toBe(true);
  });

  it("clears on invalid_grant and tells the store which pair failed", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(invalidGrant());
    await expect(oneConnect.getAccessToken("u1")).rejects.toMatchObject({
      code: "refresh_failed",
      status: 400,
    });
    expect(store.tokens.has("u1")).toBe(false);
    expect(store.clearCalls).toEqual([{ userId: "u1", failed: expiring() }]);
  });

  it("asks to connect again once both tokens have run out, without calling One", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring(refreshJwt("r1", -HOUR)));
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    await expect(oneConnect.getAccessToken("u1")).rejects.toMatchObject({ code: "refresh_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.tokens.has("u1")).toBe(false);
  });

  it("never deletes a newer pair saved while the old one was failing", async () => {
    // A reconnect: One revokes the old pair at consent, the callback saves
    // the new one, and a refresh that started with the old pair fails.
    const store = sharedStore();
    store.tokens.set("u1", expiring("r1"));
    const fresh = { accessToken: "new", refreshToken: "r9", expiresAt: Date.now() + HOUR };
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockImplementationOnce(async () => {
      store.tokens.set("u1", fresh);
      return invalidGrant();
    });
    await expect(oneConnect.getAccessToken("u1")).resolves.toBe("new");
    expect(store.tokens.get("u1")).toEqual(fresh);
    expect(store.clearCalls).toHaveLength(0);
  });

  it("keeps using an access token that outlives its refresh token", async () => {
    // A 1-year lifetime, and nobody refreshed within the refresh token's 30 days.
    const store = sharedStore();
    const pair = {
      accessToken: "a1",
      refreshToken: agedRefreshJwt("r1", 40 * DAY),
      expiresAt: Date.now() + 325 * DAY,
    };
    store.tokens.set("u1", pair);
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    await expect(oneConnect.getAccessToken("u1")).resolves.toBe("a1");
    await expect(oneConnect.refreshIfExpiring("u1", { withinMs: 7 * DAY })).resolves.toEqual(pair);
    await expect(oneConnect.refreshTokens("u1")).resolves.toEqual(pair);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.tokens.get("u1")).toEqual(pair);
    expect(store.clearCalls).toHaveLength(0);
  });

  it("spends a refresh token once across two servers that share the lock", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring("r1"));
    const web = createOneConnect({ ...config, tokenStore: store });
    const worker = createOneConnect({ ...config, tokenStore: store });

    const answer = deferred<Response>();
    fetchMock.mockImplementationOnce(() => answer.promise);
    const both = Promise.all([web.getAccessToken("u1"), worker.getAccessToken("u1")]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answer.release(tokenResponse("a2", "r2"));

    expect(await both).toEqual(["a2", "a2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.tokens.get("u1")?.refreshToken).toBe("r2");
  });

  it("does not refresh when another server already did while it waited", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring("r1"));
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    const gate = deferred<void>();
    // Another server holds the lock and saves a fresh pair.
    const other = store.withLock("u1", async () => {
      await gate.promise;
      store.tokens.set("u1", { accessToken: "a2", refreshToken: "r2", expiresAt: Date.now() + HOUR });
    });
    const mine = oneConnect.getAccessToken("u1");
    gate.release();
    await other;

    expect(await mine).toBe("a2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves the callback's tokens under the lock", async () => {
    const store = sharedStore();
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(tokenResponse("at", "rt"));
    const result = await oneConnect.completeAuthorization({
      userId: "u1",
      url: `${config.redirectUri}?code=c&state=s1`,
      getCookie: () => "verifier",
    });
    expect(result.outcome).toBe("connected");
    expect(store.lockCalls).toEqual(["u1"]);
    expect(store.tokens.get("u1")?.accessToken).toBe("at");
  });

  it("refreshIfExpiring leaves a fresh pair alone and refreshes inside the window", async () => {
    const store = sharedStore();
    const pair = { accessToken: "a1", refreshToken: refreshJwt("r1", 30 * DAY), expiresAt: Date.now() + HOUR };
    store.tokens.set("u1", pair);
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    await expect(oneConnect.refreshIfExpiring("u1")).resolves.toEqual(pair);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    await expect(
      oneConnect.refreshIfExpiring("u1", { withinMs: 2 * HOUR }),
    ).resolves.toMatchObject({ accessToken: "a2", refreshToken: "r2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshIfExpiring keeps an idle user alive before the refresh token runs out", async () => {
    const store = sharedStore();
    // Access token valid for days, refresh token with 2 days left.
    store.tokens.set("u1", {
      accessToken: "a1",
      refreshToken: refreshJwt("r1", 2 * DAY),
      expiresAt: Date.now() + 7 * DAY,
    });
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    await oneConnect.refreshIfExpiring("u1", { withinMs: 3 * DAY });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.tokens.get("u1")?.refreshToken).toBe("r2");
  });

  it("refreshTokens rotates a fresh pair once, however many callers ask", async () => {
    const store = sharedStore();
    store.tokens.set("u1", { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + HOUR });
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    const [a, b] = await Promise.all([oneConnect.refreshTokens("u1"), oneConnect.refreshTokens("u1")]);
    expect(a.refreshToken).toBe("r2");
    expect(b.refreshToken).toBe("r2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disconnect deletes unconditionally", async () => {
    const store = sharedStore();
    store.tokens.set("u1", expiring());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    await oneConnect.disconnect("u1");
    expect(store.clearCalls).toEqual([{ userId: "u1", failed: undefined }]);
    expect(store.tokens.has("u1")).toBe(false);
  });

  it("works without a lock, as before, for a single process", async () => {
    const store = memoryStore();
    store.tokens.set("u1", expiring());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });

    fetchMock.mockResolvedValueOnce(tokenResponse("a2", "r2"));
    const [a, b] = await Promise.all([oneConnect.getAccessToken("u1"), oneConnect.getAccessToken("u1")]);
    expect([a, b]).toEqual(["a2", "a2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
