---
name: one-connect-setup-development
description: Wire @withone/connect into an application against One's DEVELOPMENT environment (development-api.withone.ai) - the button, the two backend routes, token refresh, using the grant, and a verification checklist. Use when integrating or testing One Connect before going to production.
---

# One Connect - development setup

You are adding **One Connect** to this application against One's
**development** environment. Its users will grant the app scoped, revocable
access to their own One-connected tools (Gmail, Stripe, Notion, ...) through
standard OAuth 2.1 (authorization code + PKCE).

What you build is small:

```
Frontend                Your backend                          One (development)
--------                ------------                          -----------------
<ConnectButton>  ---->  GET /api/one/authorize  ----302---->  development-api.withone.ai/oauth/authorize
                                                              -> hosted page on development-connect.withone.ai
                                                                 (sign-in code, pick tools, consent)
                        GET /api/one/callback   <---302-----  ?code=...&state=...
                          exchanges code -> tokens (server-to-server)
                          stores tokens, redirects to /?one_connect=success
                                                  <---------- SDK fires onSuccess

Later, every call:      getOneAccessToken(user) -> refresh if needed
                        Authorization: Bearer <token> -> development-api.withone.ai/v1/...
```

All secrets and tokens stay on the backend. The browser only ever sees the
button and the redirects. The SDK defaults to production, so development
needs the three endpoint URLs set explicitly (step 2).

## 1 - Collect from the human first

The human creates the app at https://development.withone.ai -> Settings ->
OAuth Apps -> New OAuth App (client type **Confidential**; the secret is
shown exactly once). Ask them for:

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | 40-hex id |
| `ONE_CLIENT_SECRET` | starts with `one_secret_` |
| Registered **redirect URI** | Must be EXACTLY the URL of the callback route you implement below (scheme, host, port, path; no trailing slash). `http://localhost:3000/api/one/callback` is fine on development. One rejects any mismatch with `invalid redirect_uri`. |
| Access-token lifetime | Chosen at creation: 7 days (604800 s), 30 days, 90 days or 1 year. This is what `expires_in` will return. |
| `ONE_PERMISSION_SET` (optional) | UUID of the curated connector ask. The consent screen pre-fills it; users can only narrow it. Without it the app asks for the whole catalog. |

Development constraints to tell the human up front:

- **New accounts only for `@withone.ai` and `@picaos.com` emails.** The
  development deployment blocks unknown domains at sign-up: the code
  request is accepted silently and no email is sent. Use a plus-alias
  such as `you+test@withone.ai` for each test user. An account that
  already exists can sign in from any domain.
- The hosted flow runs full-page on One's own domain, so it works in every
  browser.
- Users can revoke the grant at any time from their One manage page. The
  app must treat a `401` from One as "prompt to reconnect", never as a bug.

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=http://localhost:3000/api/one/callback   # exactly the registered value
ONE_PERMISSION_SET=...                                      # optional

# Development endpoints. Production is the default when these are unset.
ONE_AUTHORIZE_URL=https://development-api.withone.ai/oauth/authorize
ONE_TOKEN_URL=https://development-api.withone.ai/oauth/token
ONE_API_URL=https://development-api.withone.ai/v1
```

Never put the secret in a client bundle, a log line or an error report.

## 3 - Frontend: the button

```bash
npm install @withone/connect
```

**React / Next (recommended):**

```tsx
import { ConnectButton } from "@withone/connect/react";

export function ConnectWithOne() {
  return (
    <ConnectButton
      authorizeUrl="/api/one/authorize"        // your route from step 4; relative is fine
      label="Connect your apps"
      variant="default"                         // "default" | "accent" | "block"
      theme="light"                             // "light" | "dark" - match YOUR page
      platforms={[{ name: "Stripe" }, { name: "Google Calendar" }]}
      onSuccess={() => {/* tokens are already stored by your callback */}}
      onError={(message) => console.error(message)}
    />
  );
}
```

`platforms` draws the little provider logos on the button. Pass just a
`name`: the SDK derives the logo from One's connector assets
(`https://assets.withone.ai/connectors/<slug>.svg`, "Google Calendar" ->
`google-calendar`). Pass `imageUrl` only to override it.

**Vue 3:** `import { ConnectButton } from "@withone/connect/vue"` with
`authorize-url`, `:platforms`, and `@success` / `@error` / `@close`.

**Svelte:** `import { connectButton } from "@withone/connect/svelte"` and
`<div use:connectButton={{ authorizeUrl, platforms, onSuccess }} />`.

**Anything else:** `import "@withone/connect"` registers
`<one-connect-button authorize-url="/api/one/authorize" platforms='[{"name":"Stripe"}]'>`
and emits `success` / `error` / `close` CustomEvents.

**Headless (your own element):**

```tsx
"use client";
import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    authorize: { url: "/api/one/authorize" },
    appTheme: "light",
    onSuccess: () => {},
    onError: (message) => console.error(message),
  });
  return <button onClick={open}>Connect your tools</button>;
}
```

How completion works: the flow navigates the same tab to One's hosted page
and back. Your callback (step 5) finishes by redirecting to any same-origin
URL carrying `?one_connect=success` (or `?one_connect=error&one_connect_message=...`).
The SDK sees that on page load, fires `onSuccess` / `onError`, and removes
the params from the address bar. The SDK paints no result screen of its
own; One's hosted page already showed "You're all set" before returning.

## 4 - Backend route 1: authorize (starts the flow)

```ts
// app/api/one/authorize/route.ts   (Next.js App Router; adapt per stack)
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");                         // CSRF proof
  const verifier = randomBytes(32).toString("base64url");                // PKCE secret, stays here
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(process.env.ONE_AUTHORIZE_URL!);
  url.searchParams.set("client_id", process.env.ONE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.ONE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  // All three tenancy tiers: the user picks where the grant lives (personal,
  // organization or project) on the consent screen, and the matching tier's
  // scopes must be on the token or that tier's routes return 403.
  url.searchParams.set(
    "scope",
    "user:connections:read user:connections:write org:connections:read org:connections:write project:connections:read project:connections:write",
  );
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (process.env.ONE_PERMISSION_SET)
    url.searchParams.set("permission_set", process.env.ONE_PERMISSION_SET);
  const userEmail: string | null = null;   // this app's signed-in user, if known
  if (userEmail) url.searchParams.set("login_hint", userEmail);  // pre-fills sign-in, never locks it

  const res = NextResponse.redirect(url.toString(), 302);
  // One cookie PER flow, named by its state. Users open the flow more than
  // once (retries, second tabs); a single shared cookie would be overwritten
  // and only the last-opened flow could complete.
  res.cookies.set(`one_tx_${state}`, verifier, {
    httpOnly: true,
    // Secure ONLY where the page is https. On http://localhost Safari drops
    // a Secure cookie silently, the callback then sees no cookie, and every
    // exchange fails as "tampered".
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",       // the callback is a top-level navigation back to your site
    maxAge: 600,           // One's authorization code lives 10 minutes
    path: "/",             // MUST cover the callback route's path, or the cookie never arrives
  });
  return res;
}
```

## 5 - Backend route 2: callback (finishes the flow)

Must be served at EXACTLY the registered redirect URI.

```ts
// app/api/one/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");        // "access_denied" when the user declines
  // The returned state selects its own cookie. No cookie = forged or stale
  // state = the CSRF check failed. Never exchange the code in that case.
  const verifier = state ? req.cookies.get(`one_tx_${state}`)?.value : undefined;

  const fail = (message: string) => {
    const r = NextResponse.redirect(
      new URL(`/?one_connect=error&one_connect_message=${encodeURIComponent(message)}`, req.url), 302);
    if (state) r.cookies.delete(`one_tx_${state}`);
    return r;
  };
  if (error === "access_denied") return fail("You cancelled the request.");
  if (!code || !state || !verifier) return fail("The sign-in attempt expired or was tampered with.");

  // Exchange the code. Client auth is HTTP Basic (client_secret_basic).
  // client_secret_post (secret in the body) is NOT supported by One.
  const basic = Buffer.from(`${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch(process.env.ONE_TOKEN_URL!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.ONE_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail("One rejected the code exchange.");

  const t = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;      // seconds; equals the lifetime chosen when the app was created
    token_type: "Bearer";
  };
  // Persist in THIS app's storage, keyed by YOUR user id (the signed-in user of this app):
  await saveOneTokens(appUserId, {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  });

  const ok = NextResponse.redirect(new URL("/?one_connect=success", req.url), 302);
  ok.cookies.delete(`one_tx_${state}`);
  return ok;
}
```

The code is single-use and expires 10 minutes after consent.

## 6 - Refreshing the access token

Facts that shape the code:

- Access tokens live for the lifetime chosen at app creation (`expires_in`).
- Refresh tokens live 30 days and **rotate on every use**: each refresh
  returns a NEW access token AND a NEW refresh token. Store both.
- Reusing an old refresh token is treated as theft: One revokes the whole
  token family and the user must reconnect.
- The refresh call is Basic-authenticated, same as the code exchange.

Call this before every request to One:

```ts
export async function getOneAccessToken(appUserId: string): Promise<string> {
  const t = await loadOneTokens(appUserId);
  if (!t) throw new Error("not connected");
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;    // still valid, 60 s safety margin

  const basic = Buffer.from(`${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(process.env.ONE_TOKEN_URL!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }),
  });
  if (!res.ok) {
    await clearOneTokens(appUserId);          // family is dead (revoked, expired, or reused)
    throw new Error("One refresh failed - user must reconnect");
  }
  const next = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await saveOneTokens(appUserId, {            // BOTH tokens - rotation
    accessToken: next.access_token,
    refreshToken: next.refresh_token,
    expiresAt: Date.now() + next.expires_in * 1000,
  });
  return next.access_token;
}
```

Serialize refreshes per user (a lock or single-flight). Two concurrent
refreshes with the same refresh token trip reuse detection and revoke the
family.

## 7 - Using the grant

```ts
const api = process.env.ONE_API_URL!;   // https://development-api.withone.ai/v1
const headers = { Authorization: `Bearer ${await getOneAccessToken(appUserId)}` };
```

The bearer works on One's normal `/v1` API. One resolves it to the user's
consent grant and enforces the grant on every call, down to individual
actions. Three calls cover everything:

**What the grant reaches:** `GET /v1/connections/reachable`

```ts
const { rows } = await (await fetch(`${api}/connections/reachable`, { headers })).json();
// rows[]: { key, connector, platform, name, title, image, access }
// access.policy: "full"
//             or "methods" + methods: ["GET", ...]              (only these HTTP methods)
//             or "actions" + actions: [{ actionId, title, method }] (only these actions)
```

**What actions exist:** `GET /v1/knowledge?connectionPlatform=<platform>&limit=100&page=N`
returns rows with `_id`, `title`, `method`, `path`. Paged; read `pages`.
The catalog is what is possible; the grant is what is permitted.

**Execute:** `{method} /v1/passthrough{path}` with two extra headers:

```ts
await fetch(`${api}/passthrough${action.path}`, {
  method: action.method,
  headers: { ...headers, "x-one-connection-key": row.key, "x-one-action-id": action._id, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

Inside the grant, One proxies the call to the provider and returns its
reply. Outside the grant, One answers `403` with a `correlationId` and the
provider is never called. That is the grant working, not an error to retry.

**Agents / assistants over MCP:** the same bearer authenticates One's remote
MCP gateway at `https://development-mcp.withone.ai/mcp`
(`Authorization: Bearer <token>`, no API key). Its tools enforce the same
grant: `list_one_integrations`, `search_one_platform_actions`,
`get_one_action_knowledge`, `execute_one_action`.

The One CLI does not accept grant tokens (it uses `sk_live_` / `sk_test_`
keys only). Use HTTP `/v1` or MCP for a 2nd-degree user's grant.

## 8 - Rules that keep the integration correct

- `401` from One means the token is expired, revoked or invalid: clear the
  stored tokens and show "Reconnect". `403` means the call is outside the
  grant: do not retry, the user chose that.
- Users revoke from their One manage page
  (`development-connect.withone.ai/oauth/connect/manage`) at any time; the
  app's next call gets `401`. To change what an app may do, the user goes
  through the button again and picks different access.
- Validate `state` before touching the code. Never exchange on a mismatch.
- Redirect URIs: exact match. The registered value, the `redirect_uri` sent
  in step 4, and the one sent in step 5 must be the same string.

## 9 - Verify: done when ALL of these pass

1. Clicking the button navigates the tab to
   `development-connect.withone.ai/oauth/connect?...`, showing the app's
   name and, when a permission set is configured, the connectors it asks for.
2. A `@withone.ai` or `@picaos.com` test address receives a 6-digit code;
   entering it lands on the consent screen.
3. Authorize shows "You're all set" with a short countdown, then returns to
   the app with `?one_connect=success` (removed from the address bar
   moments later) and `onSuccess` fired.
4. Stored `expires_in` equals the lifetime chosen at app creation (for
   example 604800 for 7 days).
5. A refresh returns a rotated pair; sending the OLD refresh token again is
   refused and the app's reconnect path engages.
6. `GET {ONE_API_URL}/connections/reachable` with the bearer lists only the
   granted connections with their `access`; one call outside the grant
   returns `403` with a `correlationId`.
7. Revoking the app from the user's manage page makes the app's next call
   `401` and the app shows its reconnect prompt.
