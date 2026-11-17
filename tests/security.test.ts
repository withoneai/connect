import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

import { createOneConnectRoutes, pendingFlowCookies, readCookie } from "@withone/connect/next";
import {
  createOneConnect,
  type OneConnectTokens,
  type OneConnectTokenStore,
} from "@withone/connect/server";
import { createOneConnectHandlers } from "../src/node";
import { appPath, MAX_RETURN_PATH_LENGTH, parseTxCookieValue, txCookieValue } from "../src/server/oauth";

const config = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.com/api/one/callback",
  permissionSet: "set-1",
  oneApiUrl: "https://api.example.test/",
};

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

/** The same store with a cross-process lock, as a database would give. */
function lockedStore() {
  const store = memoryStore();
  let tail: Promise<unknown> = Promise.resolve();
  return Object.assign(store, {
    withLock: <T>(_userId: string, run: () => Promise<T>): Promise<T> => {
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
  });
}

function tokenResponse(accessToken: string, refreshToken: string): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: 3600 }),
    { status: 200 },
  );
}

/** Resolves when the test calls the returned `release`. */
function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  return { promise, release };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** One raw request, so a header no client library would send gets through. */
function raw(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(request));
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("end", () => resolve(answer));
    socket.on("error", reject);
  });
}

describe("a return path stays on the app", () => {
  it("keeps a path on the app", () => {
    for (const path of ["/", "/chat/42", "/settings?tab=apps#one", "/a//b"])
      expect(appPath(path)).toBe(path);
  });

  it("drops a path the URL parser reads as another site", () => {
    for (const path of [
      "/\t/evil.example/x",
      "/\n/evil.example/x",
      "/\r/evil.example/x",
      "/\t\\evil.example/x",
      "/\\evil.example/x",
      "//evil.example/x",
      "https://evil.example/x",
      "chat",
      "",
    ])
      expect(appPath(path)).toBeUndefined();
  });

  it("drops one too long to be a real page", () => {
    expect(appPath(`/${"a".repeat(MAX_RETURN_PATH_LENGTH - 1)}`)).toBeDefined();
    expect(appPath(`/${"a".repeat(MAX_RETURN_PATH_LENGTH)}`)).toBeUndefined();
  });

  it("checks again when the cookie is read back", () => {
    expect(parseTxCookieValue(txCookieValue("v", "/\t/evil.example/x"))).toEqual({
      verifier: "v",
      returnTo: undefined,
    });
  });

  it("returns to the configured page, on the app, for a crafted link", async () => {
    const oneConnect = createOneConnect({ ...config, returnTo: "/home", tokenStore: memoryStore() });
    const { redirectUrl, cookie } = oneConnect.startAuthorization({ returnTo: "/\t/evil.example/x" });
    expect(cookie.value).not.toContain(".");
    const state = new URL(redirectUrl).searchParams.get("state");
    const result = await oneConnect.completeAuthorization({
      userId: "u1",
      url: `${config.redirectUri}?error=access_denied&state=${state}`,
      getCookie: (name) => (name === cookie.name ? cookie.value : undefined),
    });
    expect(result.redirectUrl).toBe(
      "https://app.example.com/home?one_connect=error&one_connect_error=declined",
    );
  });
});

describe("malformed input never throws", () => {
  it("reads a malformed cookie as no cookie", () => {
    const request = new Request("https://x", { headers: { cookie: "one_tx_a=%E0%A4%A" } });
    expect(readCookie(request, "one_tx_a")).toBeUndefined();
  });

  it("gives a state it did not make no cookie", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: memoryStore() });
    const getCookie = vi.fn(() => "verifier");
    const result = await oneConnect.completeAuthorization({
      userId: "u1",
      url: `${config.redirectUri}?code=c&state=%0d%0a`,
      getCookie,
    });
    expect(result.outcome).toBe("failed");
    expect(result.code).toBe("expired");
    expect(result.clearCookieName).toBeUndefined();
    expect(getCookie).not.toHaveBeenCalled();
  });

  it("answers the callback for a state with line breaks", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: memoryStore() });
    const { GET } = createOneConnectRoutes(oneConnect, { identifyUser: () => "u1" });
    const response = await GET(
      new Request("https://app.example.com/api/one/callback?code=c&state=%0d%0a"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("the Node handlers on a server that ignores their promise", () => {
  const oneConnect = createOneConnect({ ...config, tokenStore: memoryStore() });
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    rejections.length = 0;
    process.on("unhandledRejection", onRejection);
    const { authorize } = createOneConnectHandlers(oneConnect, { identifyUser: () => "u1" });
    // Plain http, the promise dropped: what Express 4 does too.
    server = http.createServer((request, response) => {
      void authorize(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    process.off("unhandledRejection", onRejection);
    await new Promise((resolve) => server.close(resolve));
  });

  const request = (headers: string[]) =>
    raw(port, ["GET /api/one/authorize HTTP/1.1", ...headers, "Connection: close", "", ""].join("\r\n"));

  it("answers 400 to a request it cannot read, and keeps serving", async () => {
    for (const headers of [
      ["Host: app.test", "X-Forwarded-Host: a b"],
      ["Host: app.test", "X-Forwarded-Proto: a b"],
      ["Host: a b"],
      ["Host: app.test", "X-Forwarded-Host: user:pass@evil.example"],
    ]) {
      const answer = await request(headers);
      expect(answer.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request");
    }
    await tick();
    expect(rejections).toEqual([]);
    const ok = await request(["Host: app.test"]);
    expect(ok.split("\r\n")[0]).toBe("HTTP/1.1 302 Found");
  });

  it("uses the first forwarded host when proxies chained theirs", async () => {
    const answer = await request(["Host: internal", "X-Forwarded-Host: app.test, proxy.internal"]);
    expect(answer.split("\r\n")[0]).toBe("HTTP/1.1 302 Found");
  });

  it("answers 500 when the app's own code throws", async () => {
    const { authorize } = createOneConnectHandlers(oneConnect, {
      identifyUser: () => {
        throw new Error("session store down");
      },
    });
    const broken = http.createServer((req, res) => void authorize(req, res));
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
    const answer = await raw(
      (broken.address() as AddressInfo).port,
      "GET /api/one/authorize HTTP/1.1\r\nHost: app.test\r\nConnection: close\r\n\r\n",
    );
    await new Promise((resolve) => broken.close(resolve));
    expect(answer.split("\r\n")[0]).toBe("HTTP/1.1 500 Internal Server Error");
    await tick();
    expect(rejections).toEqual([]);
  });
});

describe("unfinished flows do not pile up", () => {
  const state = (n: number) => n.toString(16).padStart(32, "0");

  it("lists only the cookies this SDK made, oldest first", () => {
    const request = new Request("https://x", {
      headers: { cookie: `session=1; one_tx_${state(1)}=a; one_tx_nope=b; one_tx_${state(2)}=c` },
    });
    expect(pendingFlowCookies(request)).toEqual([`one_tx_${state(1)}`, `one_tx_${state(2)}`]);
  });

  it("expires the oldest when a browser already holds the limit", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: memoryStore() });
    const { GET } = createOneConnectRoutes(oneConnect, { identifyUser: () => "u1" });
    const held = [1, 2, 3, 4, 5, 6].map((n) => `one_tx_${state(n)}=v`).join("; ");
    const response = await GET(
      new Request("https://app.example.com/api/one/authorize", { headers: { cookie: held } }),
    );
    const setCookies = response.headers.getSetCookie();
    const expired = setCookies.filter((cookie) => cookie.includes("Max-Age=0"));
    expect(expired.map((cookie) => cookie.split("=")[0])).toEqual([
      `one_tx_${state(1)}`,
      `one_tx_${state(2)}`,
    ]);
    expect(expired[0]).toContain("Path=/api/one");
    expect(setCookies.filter((cookie) => cookie.includes("Max-Age=1800"))).toHaveLength(1);
  });

  it("leaves a second tab's flow alone", async () => {
    const oneConnect = createOneConnect({ ...config, tokenStore: memoryStore() });
    const { GET } = createOneConnectRoutes(oneConnect, { identifyUser: () => "u1" });
    const response = await GET(
      new Request("https://app.example.com/api/one/authorize", {
        headers: { cookie: `one_tx_${state(1)}=v` },
      }),
    );
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });
});

describe("a refresh in flight", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const old = (): OneConnectTokens => ({
    accessToken: "access-old",
    refreshToken: "refresh-old",
    expiresAt: Date.now() + 1000,
  });

  for (const [name, makeStore] of [
    ["without a lock", memoryStore],
    ["with a lock", lockedStore],
  ] as const) {
    it(`cannot restore tokens after a disconnect, ${name}`, async () => {
      const store = makeStore();
      store.tokens.set("u1", old());
      const oneConnect = createOneConnect({ ...config, tokenStore: store });
      const held = deferred<Response>();
      fetchMock.mockReturnValueOnce(held.promise);

      const refresh = oneConnect.refreshTokens("u1");
      await tick();
      const disconnect = oneConnect.disconnect("u1");
      await tick();
      held.release(tokenResponse("access-rotated", "refresh-rotated"));
      await refresh;
      await disconnect;

      expect(store.tokens.has("u1")).toBe(false);
      expect(await oneConnect.isConnected("u1")).toBe(false);
    });

    it(`cannot overwrite a reconnect, ${name}`, async () => {
      const store = makeStore();
      store.tokens.set("u1", old());
      const oneConnect = createOneConnect({ ...config, tokenStore: store });
      const held = deferred<Response>();
      fetchMock.mockReturnValueOnce(held.promise);
      fetchMock.mockResolvedValueOnce(tokenResponse("access-reconnected", "refresh-reconnected"));

      const refresh = oneConnect.refreshTokens("u1");
      await tick();
      const { redirectUrl, cookie } = oneConnect.startAuthorization();
      const reconnect = oneConnect.completeAuthorization({
        userId: "u1",
        url: `${config.redirectUri}?code=c&state=${new URL(redirectUrl).searchParams.get("state")}`,
        getCookie: (cookieName) => (cookieName === cookie.name ? cookie.value : undefined),
      });
      await tick();
      held.release(tokenResponse("access-rotated", "refresh-rotated"));
      await refresh;
      expect((await reconnect).outcome).toBe("connected");

      expect(store.tokens.get("u1")?.accessToken).toBe("access-reconnected");
    });
  }

  it("still disconnects after a refresh that failed", async () => {
    const store = memoryStore();
    store.tokens.set("u1", old());
    const oneConnect = createOneConnect({ ...config, tokenStore: store });
    fetchMock.mockRejectedValueOnce(new Error("network"));

    await expect(oneConnect.refreshTokens("u1")).rejects.toThrow();
    await oneConnect.disconnect("u1");
    expect(store.tokens.has("u1")).toBe(false);
  });
});
