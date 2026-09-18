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
import type { OneConnect } from "./server";

export interface OneConnectRoutesOptions {
  /** The app's own id for the signed-in user, or null when nobody is
   *  signed in. The grant is stored under this id. */
  identifyUser: (request: Request) => Promise<string | null> | string | null;
  /** Pre-fills the sign-in email on One's page for this user. */
  loginHintFor?: (request: Request) => Promise<string | null> | string | null;
  /** Where to send the browser when nobody is signed in. Answers 401
   *  when omitted. */
  signInUrl?: string;
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
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** The last path segment names the leg: ".../authorize" or ".../callback". */
export function routeFor(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  return pathname.slice(pathname.lastIndexOf("/") + 1);
}

export function createOneConnectRoutes(
  oneConnect: OneConnect,
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
    const { redirectUrl, cookie } = oneConnect.startAuthorization({ loginHint });
    return redirectWithCookies(redirectUrl, [
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
