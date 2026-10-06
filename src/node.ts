/**
 * `@withone/connect/node`: the two routes as handlers for Node's
 * `http` request and response objects, which is what Express, Fastify
 * (via `reply.raw`), Koa (via `ctx.req`/`ctx.res`) and plain
 * `http.createServer` hand you.
 *
 *   import express from "express";
 *   import { createOneConnectHandlers } from "@withone/connect/node";
 *   import { oneConnect } from "./one";
 *
 *   const { authorize, callback } = createOneConnectHandlers(oneConnect, {
 *     identifyUser: (request) => request.session?.userId ?? null,
 *   });
 *   app.get("/api/one/authorize", authorize);
 *   app.get("/api/one/callback", callback);
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { createOneConnectRoutes, type OneConnectRoutesOptions } from "@withone/connect/next";
import type { OneConnectClient } from "./server";

export interface OneConnectNodeOptions {
  /** The app's own id for the signed-in user, or null when nobody is
   *  signed in. */
  identifyUser: (
    request: IncomingMessage,
  ) => Promise<string | null> | string | null;
  /** Pre-fills the sign-in email on One's page for this user. */
  loginHintFor?: (
    request: IncomingMessage,
  ) => Promise<string | null> | string | null;
  /** Where to send the browser when nobody is signed in. Answers 401
   *  when omitted. */
  signInUrl?: string;
  /** Called after every callback with how it ended; see
   *  `OneConnectRoutesOptions.onComplete`. */
  onComplete?: OneConnectRoutesOptions["onComplete"];
}

export type NodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export interface OneConnectHandlers {
  authorize: NodeHandler;
  callback: NodeHandler;
}

/** The incoming request as a web Request, so both adapters share one
 *  implementation. */
function toWebRequest(request: IncomingMessage): Request {
  const protocol =
    request.headers["x-forwarded-proto"]?.toString().split(",")[0] ??
    ((request.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return new Request(`${protocol}://${host}${request.url ?? "/"}`, {
    method: request.method ?? "GET",
    headers,
  });
}

async function send(response: ServerResponse, web: Response): Promise<void> {
  const setCookies =
    typeof (web.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (web.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [];
  web.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") response.setHeader(name, value);
  });
  if (setCookies.length > 0) response.setHeader("Set-Cookie", setCookies);
  response.statusCode = web.status;
  response.end(await web.text());
}

export function createOneConnectHandlers(
  oneConnect: Pick<OneConnectClient, "startAuthorization" | "completeAuthorization">,
  options: OneConnectNodeOptions,
): OneConnectHandlers {
  // The web adapter receives a Request; the Node callbacks want the
  // original IncomingMessage. Each Request maps to its own message, so
  // concurrent requests never read each other's session or login hint.
  const origin = new WeakMap<Request, IncomingMessage>();
  const nodeRequestFor = (request: Request): IncomingMessage => {
    const message = origin.get(request);
    if (!message) throw new Error("@withone/connect/node: unknown request");
    return message;
  };
  const loginHintFor = options.loginHintFor;
  const routes = createOneConnectRoutes(oneConnect, {
    identifyUser: (request) => options.identifyUser(nodeRequestFor(request)),
    loginHintFor: loginHintFor
      ? (request) => loginHintFor(nodeRequestFor(request))
      : undefined,
    signInUrl: options.signInUrl,
    onComplete: options.onComplete,
  } satisfies OneConnectRoutesOptions);

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const web = toWebRequest(request);
    origin.set(web, request);
    await send(response, await routes.GET(web));
  };

  return { authorize: handle, callback: handle };
}
