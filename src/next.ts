/**
 * `@withone/connect/next`: the two routes as one file, for any server
 * that speaks the web `Request` and `Response` (Next.js App Router,
 * Remix, SvelteKit, Nuxt/h3 via its adapters, Hono, Bun).
 *
 *   // app/api/one/[action]/route.ts
 *   import { createOneConnectRoutes } from "@withone/connect/next";
 *   import { oneConnect } from "@/lib/one";
 *
 *   export const { GET } = createOneConnectRoutes(oneConnect, {
 *     identifyUser: async (request) => getSessionUserId(request),
 *   });
 *
 * That serves /api/one/authorize and /api/one/callback. Register
 * `https://yourapp.com/api/one/callback` as the app's redirect URI.
 */
import {
  isState,
  MAX_PENDING_FLOWS,
  RETURN_TO_PARAM,
  TX_COOKIE_PREFIX,
} from "./constants";
import type { CompleteAuthorizationResult, OneConnectClient } from "./server";

export interface OneConnectRoutesOptions {
  /** The app's own id for the signed-in user, or null when nobody is
   *  signed in. The grant is stored under this id. */
  identifyUser: (request: Request) => Promise<string | null> | string | null;
  /** Pre-fills the sign-in email on One's page for this user. */
  loginHintFor?: (request: Request) => Promise<string | null> | string | null;
  /** Where to send the browser when nobody is signed in. Answers 401
   *  when omitted. */
  signInUrl?: string;
  /** Called after every callback, before the browser is redirected:
   *  `result.outcome` is "connected", "declined" or "failed", and
   *  `result.message` says why a flow failed. For your logs and metrics;
   *  never show the message to the user. An error it throws is ignored,
   *  so the user still lands back in the app. */
  onComplete?: (event: {
    userId: string;
    result: CompleteAuthorizationResult;
  }) => void | Promise<void>;
}

export interface OneConnectRoutes {
  GET: (request: Request) => Promise<Response>;
}

export const AUTHORIZE_ROUTE = "authorize";
export const CALLBACK_ROUTE = "callback";

function redirectWithCookies(
  location: string,
  setCookies: string[],
): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; maxAge: number; path: string },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=Lax`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function expireCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; SameSite=Lax; HttpOnly`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      // A malformed value is no cookie.
      return undefined;
    }
  }
  return undefined;
}

/** The unfinished flows this browser holds, oldest first (browsers send
 *  older cookies first). Only names this SDK made are listed. */
export function pendingFlowCookies(request: Request): string[] {
  const header = request.headers.get("cookie");
  if (!header) return [];
  const names: string[] = [];
  for (const part of header.split(";")) {
    const name = part.trim().split("=")[0];
    if (
      name.startsWith(TX_COOKIE_PREFIX) &&
      isState(name.slice(TX_COOKIE_PREFIX.length)) &&
      !names.includes(name)
    )
      names.push(name);
  }
  return names;
}

/** The last path segment names the leg: ".../authorize" or ".../callback". */
export function routeFor(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}

export function createOneConnectRoutes(
  oneConnect: Pick<OneConnectClient, "startAuthorization" | "completeAuthorization">,
  options: OneConnectRoutesOptions,
): OneConnectRoutes {
  const cookiePath = (): string =>
    oneConnect.startAuthorization().cookie.options.path;

  const requireUser = async (request: Request): Promise<string | Response> => {
    const userId = await options.identifyUser(request);
    if (userId) return userId;
    if (options.signInUrl)
      return redirectWithCookies(new URL(options.signInUrl, request.url).toString(), []);
    return new Response("Sign in to your account before connecting One.", {
      status: 401,
    });
  };

  const authorize = async (request: Request): Promise<Response> => {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const loginHint = (await options.loginHintFor?.(request)) ?? undefined;
    // The browser flow names where this one flow returns to; the client
    // keeps only a path on the app, so a crafted link goes nowhere else.
    const returnTo =
      new URL(request.url).searchParams.get(RETURN_TO_PARAM) ?? undefined;
    const { redirectUrl, cookie } = oneConnect.startAuthorization({ loginHint, returnTo });
    // Room for this flow: the oldest unfinished ones go, so repeated
    // starts never pile cookies up until the app refuses the request.
    const pending = pendingFlowCookies(request);
    const stale = pending.slice(
      0,
      Math.max(0, pending.length - (MAX_PENDING_FLOWS - 1)),
    );
    return redirectWithCookies(redirectUrl, [
      ...stale.map((name) => expireCookie(name, cookie.options.path)),
      serializeCookie(cookie.name, cookie.value, cookie.options),
    ]);
  };

  const callback = async (request: Request): Promise<Response> => {
    const user = await requireUser(request);
    if (user instanceof Response) return user;
    const result = await oneConnect.completeAuthorization({
      userId: user,
      url: request.url,
      getCookie: (name) => readCookie(request, name),
    });
    if (options.onComplete) {
      try {
        await options.onComplete({ userId: user, result });
      } catch {
        /* the app's own hook threw; the redirect still happens */
      }
    }
    return redirectWithCookies(
      result.redirectUrl,
      result.clearCookieName
        ? [expireCookie(result.clearCookieName, cookiePath())]
        : [],
    );
  };

  return {
    GET: async (request: Request): Promise<Response> => {
      const route = routeFor(request.url);
      if (route === AUTHORIZE_ROUTE) return authorize(request);
      if (route === CALLBACK_ROUTE) return callback(request);
      return new Response("Not found", { status: 404 });
    },
  };
}
