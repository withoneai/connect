import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createOneConnectRoutes } from "@withone/connect/next";
import { createOneConnectHandlers } from "../src/node";
import type { CompleteAuthorizationResult, OneConnectClient, StartAuthorizationInput } from "@withone/connect/server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const failed: CompleteAuthorizationResult = {
  outcome: "failed",
  code: "failed",
  message: "One rejected the code exchange (HTTP 400).",
  redirectUrl: "https://app.test/?one_connect=error&one_connect_error=failed",
  clearCookieName: "one_tx_s",
};

/** Only what the routes use: the hint goes on the redirect so a test can read it back. */
const stubClient = (
  result: CompleteAuthorizationResult = failed,
): Pick<OneConnectClient, "startAuthorization" | "completeAuthorization"> => ({
  startAuthorization: (input?: StartAuthorizationInput) => ({
    redirectUrl: `https://one.test/oauth/authorize?login_hint=${encodeURIComponent(input?.loginHint ?? "")}`,
    cookie: { name: "one_tx_s", value: "v", options: { httpOnly: true, secure: false, sameSite: "lax" as const, maxAge: 60, path: "/api/one" } },
  }),
  completeAuthorization: async () => result,
});

const nodeRequest = (url: string, headers: Record<string, string>) =>
  ({ url, method: "GET", headers: { host: "app.test", ...headers }, socket: {} }) as unknown as IncomingMessage;

const nodeResponse = () => {
  const headers: Record<string, unknown> = {};
  const response = {
    statusCode: 0,
    setHeader: (name: string, value: unknown) => { headers[name.toLowerCase()] = value; },
    end: vi.fn(),
  };
  return { response: response as unknown as ServerResponse, headers, status: () => response.statusCode };
};

describe("createOneConnectHandlers (Node)", () => {
  it("keeps concurrent requests apart: each user gets their own login hint", async () => {
    const { authorize } = createOneConnectHandlers(stubClient(), {
      identifyUser: async (request) => {
        await sleep(request.headers["x-user"] === "a" ? 20 : 1);
        return String(request.headers["x-user"]);
      },
      loginHintFor: async (request) => {
        await sleep(request.headers["x-user"] === "a" ? 1 : 20);
        return String(request.headers["x-email"]);
      },
    });
    const a = nodeResponse();
    const b = nodeResponse();
    await Promise.all([
      authorize(nodeRequest("/api/one/authorize", { "x-user": "a", "x-email": "a@acme.test" }), a.response),
      authorize(nodeRequest("/api/one/authorize", { "x-user": "b", "x-email": "b@acme.test" }), b.response),
    ]);
    expect(a.status()).toBe(302);
    expect(String(a.headers.location)).toContain("login_hint=a%40acme.test");
    expect(String(b.headers.location)).toContain("login_hint=b%40acme.test");
  });

  it("passes onComplete through", async () => {
    const onComplete = vi.fn();
    const { callback } = createOneConnectHandlers(stubClient(), { identifyUser: () => "u1", onComplete });
    const res = nodeResponse();
    await callback(nodeRequest("/api/one/callback?code=c&state=s", {}), res.response);
    expect(onComplete).toHaveBeenCalledWith({ userId: "u1", result: failed });
    expect(res.status()).toBe(302);
  });
});

describe("createOneConnectRoutes onComplete", () => {
  it("reports how the callback ended, with the reason, before redirecting", async () => {
    const onComplete = vi.fn();
    const { GET } = createOneConnectRoutes(stubClient(), { identifyUser: () => "u1", onComplete });
    const response = await GET(new Request("https://app.test/api/one/callback?code=c&state=s"));
    expect(onComplete).toHaveBeenCalledWith({ userId: "u1", result: failed });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(failed.redirectUrl);
  });

  it("still redirects when the hook throws", async () => {
    const { GET } = createOneConnectRoutes(stubClient(), {
      identifyUser: () => "u1",
      onComplete: () => { throw new Error("logger down"); },
    });
    const response = await GET(new Request("https://app.test/api/one/callback?code=c&state=s"));
    expect(response.status).toBe(302);
  });

  it("is not called for the authorize leg", async () => {
    const onComplete = vi.fn();
    const { GET } = createOneConnectRoutes(stubClient(), { identifyUser: () => "u1", onComplete });
    await GET(new Request("https://app.test/api/one/authorize"));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
