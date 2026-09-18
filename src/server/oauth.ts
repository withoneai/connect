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

/** The cookie scoped to the routes that need it: the directory of the
 *  callback path, which is also where the authorize route lives. */
export function txCookie(
  state: string,
  verifier: string,
  redirectUri: string,
): OneConnectCookie {
  const url = new URL(redirectUri);
  const path = url.pathname.replace(/\/[^/]*$/, "") || "/";
  return {
    name: txCookieName(state),
    value: verifier,
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
