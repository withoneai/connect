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
    expect(result.redirectUrl).toContain("one_connect=error");
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
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
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
