import { createHash, randomBytes } from "node:crypto";

import type { OneConnectCookie } from "./types";

/** One cookie per flow, named by its state, so a retry or a second tab
 *  never overwrites the verifier of a flow still in progress. */
export const TX_COOKIE_PREFIX = "one_tx_";

/** One gives the consent 10 minutes and then the code 10 minutes, so a
 *  legitimate callback can arrive up to twenty minutes after the start.
 *  Thirty minutes leaves a margin. */
export const TX_COOKIE_MAX_AGE_SECONDS = 1800;

export const DEFAULT_SCOPES = [
  "user:connections:read",
  "user:connections:write",
  "org:connections:read",
  "org:connections:write",
  "project:connections:read",
  "project:connections:write",
];

export function createState(): string {
  return randomBytes(16).toString("hex");
}

export function createPkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function txCookieName(state: string): string {
  return `${TX_COOKIE_PREFIX}${state}`;
}

/** A return path this one flow may use: a path on the app itself. A
 *  full URL, a protocol-relative one or anything else is dropped, so
 *  the callback never sends a user to another site. */
export function appPath(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("/")) return undefined;
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
  return value;
}

/** The cookie value: the verifier, then the flow's own return path when
 *  it has one. A dot separates them; the verifier is base64url, which
 *  never contains one, so a value written before 0.17 still reads. */
export function txCookieValue(verifier: string, returnTo?: string): string {
  return returnTo
    ? `${verifier}.${Buffer.from(returnTo).toString("base64url")}`
    : verifier;
}

export function parseTxCookieValue(value: string): {
  verifier: string;
  returnTo?: string;
} {
  const dot = value.indexOf(".");
  if (dot < 0) return { verifier: value };
  return {
    verifier: value.slice(0, dot),
    returnTo: appPath(Buffer.from(value.slice(dot + 1), "base64url").toString()),
  };
}

/** The cookie scoped to the routes that need it: the directory of the
 *  callback path, which is also where the authorize route lives. */
export function txCookie(
  state: string,
  verifier: string,
  redirectUri: string,
  returnTo?: string,
): OneConnectCookie {
  const url = new URL(redirectUri);
  const path = url.pathname.replace(/\/[^/]*$/, "") || "/";
  return {
    name: txCookieName(state),
    value: txCookieValue(verifier, returnTo),
    options: {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: TX_COOKIE_MAX_AGE_SECONDS,
      path,
    },
  };
}

export function basicAuthorization(
  clientId: string,
  clientSecret: string,
): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/** The tenant headers a grant needs on every call. A grant made into an
 *  organization or project lives there; One resolves the tenant from
 *  these headers, and without them the call runs in the user's personal
 *  space. The access token's claims name the tenant, so echo them. */
export function tenancyHeaders(accessToken: string): Record<string, string> {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString(),
    ) as { organization_ids?: string[]; project_ids?: string[] };
    const headers: Record<string, string> = {};
    const organizationId = payload.organization_ids?.[0];
    const projectId = payload.project_ids?.[0];
    if (organizationId) headers["X-One-Organization-Id"] = organizationId;
    if (projectId) headers["X-One-Project-Id"] = projectId;
    return headers;
  } catch {
    return {};
  }
}

/** When a refresh token stops working, in epoch milliseconds, from its
 *  `exp` claim. Null when the token carries no readable expiry, in which
 *  case only One can say whether it still works. */
export function refreshTokenExpiresAt(refreshToken: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(refreshToken.split(".")[1], "base64url").toString(),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/** The scopes the token was granted, from its claims. Display only. */
export function tokenScopes(accessToken: string): string[] {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString(),
    ) as { scope?: string };
    return (payload.scope ?? "").split(" ").filter(Boolean);
  } catch {
    return [];
  }
}
