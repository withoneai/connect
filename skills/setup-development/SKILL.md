---
name: one-connect-setup-development
description: Wire @withone/connect into an application against One's DEVELOPMENT environment — the button, the two backend routes, token storage/refresh, and using the grant — with a verification checklist. Use when integrating or testing One Connect before going to production.
---

# One Connect — development setup

You are wiring **One Connect** into this application: its users will grant it
scoped, revocable access to their own One-connected tools via standard
OAuth 2.1 (authorization-code + PKCE). Everything sensitive — state, PKCE
verifier, client secret, tokens — lives on this app's **backend**. The
frontend gets exactly one button. This skill targets One's **development**
environment.

## 0 · Collect from the human first

Ask for these (created at https://development.withone.ai → Settings →
OAuth Apps → New OAuth App; client type **Confidential**; secret shown once):

- `ONE_CLIENT_ID`
- `ONE_CLIENT_SECRET` (`one_secret_…`)
- The **registered redirect URI** — it must EXACTLY equal the callback URL
  you will implement below, string-for-string.
- Optional: `ONE_PERMISSION_SET` (uuid) — the curated connector set the
  consent screen pre-fills; users can only narrow it. Without one the app
  asks for general access, which users also narrow.

Development constraints to tell the human up front:
- Sign-in codes are only issued to allowed email domains on development
  (`@withone.ai`, `@picaos.com`). Other domains get a silent 202 and no
  email — use a plus-alias like `you+test@withone.ai` for test users.
- The full-page hosted flow works in EVERY browser — the page is
  first-party on One's own domain (Safari, Firefox, incognito included).

## 1 · Environment

```bash
# .env — server only. NEVER expose the secret to a browser.
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=<the exact registered redirect URI>
ONE_PERMISSION_SET=...            # optional

# Development endpoints (production is the default when unset):
ONE_AUTHORIZE_URL=https://development-api.withone.ai/oauth/authorize
ONE_TOKEN_URL=https://development-api.withone.ai/oauth/token
ONE_API_URL=https://development-api.withone.ai/v1
```

## 2 · Frontend — one component (or one hook)

```bash
npm install @withone/connect
```

**Fast path — the pre-built button** (optional but recommended). It
wires the whole flow itself and manages Connect → Connecting →
Connected. Provider icons are yours to supply — the SDK ships no One
URLs.

```tsx
// React / Next
import { ConnectButton } from "@withone/connect/react";

export function ConnectWithOne() {
  return (
    <ConnectButton
      authorizeUrl="/api/one/authorize"   // relative is fine
      label="Connect your apps"
      variant="default"                    // "default" | "accent" | "block"
      theme="light"                        // matches YOUR page
      platforms={[
        { name: "Stripe", imageUrl: "/icons/stripe.svg" },
      ]}
      onSuccess={() => {/* backend already stored the tokens */}}
      onError={(error) => console.error(error)}
    />
  );
}
```

```vue
<!-- Vue 3 -->
<script setup>import { ConnectButton } from "@withone/connect/vue";</script>
<template>
  <ConnectButton authorize-url="/api/one/authorize"
    :platforms="[{ name: 'Stripe', imageUrl: '/icons/stripe.svg' }]"
    @success="onConnected" />
</template>
```

```svelte
<!-- Svelte (an action) -->
<script>import { connectButton } from "@withone/connect/svelte";</script>
<div use:connectButton={{ authorizeUrl: "/api/one/authorize",
  platforms: [{ name: "Stripe", imageUrl: "/icons/stripe.svg" }],
  onSuccess: () => {} }} />
```

Plain HTML / any other framework: `import "@withone/connect"` registers
the `<one-connect-button>` custom element (same attributes, kebab-case;
`platforms` as a JSON string; `success`/`error`/`close` CustomEvents).

**Headless path** — any element you like, wired to `open()`:

```tsx
"use client";
import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    authorize: { url: "/api/one/authorize" },  // relative resolves to the page origin
    appTheme: "light",              // or "dark"
    onSuccess: () => {/* backend already stored the tokens */},
    onError: (error) => console.error(error),
    onClose: () => {},
  });
  return <button onClick={open}>Connect your tools</button>;
}
```
The flow opens FULL-PAGE in the same tab on One's hosted connect page
(`development-connect.withone.ai`) — first-party cookies, so every
browser works (Safari, Firefox, incognito included). No completion page
exists: when this app's callback finally redirects to any same-origin
URL carrying `?one_connect=success` (or `error` + `one_connect_message`),
the SDK fires `onSuccess`/`onError` and scrubs the params from the
address bar (with retries, so frameworks that restore their own URL on
hydration — Next.js App Router — can't undo it). The SDK paints no
result UI of its own: One's hosted page already showed the "You're all
set" beat before sending the user back.

## 3 · Backend route 1 — authorize (starts the flow)

Mints `state` (CSRF) + PKCE, stashes both in an httpOnly cookie, 302s to
One. Example is Next.js App Router; translate idioms for other stacks.

```ts
// app/api/one/authorize/route.ts
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(process.env.ONE_AUTHORIZE_URL!);
  url.searchParams.set("client_id", process.env.ONE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.ONE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user:connections:read user:connections:write org:connections:read org:connections:write project:connections:read project:connections:write"); // all 3 tenancy tiers — org/project grants 403 without theirs
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (process.env.ONE_PERMISSION_SET)
    url.searchParams.set("permission_set", process.env.ONE_PERMISSION_SET);
  const userEmail = null; // ← this app's signed-in user email, if known
  if (userEmail) url.searchParams.set("login_hint", userEmail);

  const res = NextResponse.redirect(url.toString(), 302);
  // One cookie PER flow — the name carries the state. Users open the
  // flow more than once (retries, second tabs); a single shared cookie
  // would be overwritten by each start, so only the LAST-opened flow
  // could ever complete. Expiry reaps the strays.
  res.cookies.set(`one_tx_${state}`, verifier, {
    httpOnly: true,
    // The callback is a TOP-LEVEL navigation on your own site, so Lax
    // survives the cross-site redirect chain (One -> here).
    sameSite: "lax",
    secure: true,
    maxAge: 600, // matches One's 10-minute single-use authorization code
    // CRITICAL: the path must cover the CALLBACK route's path, or the
    // browser will not send the cookie there and every exchange fails
    // with a state mismatch.
    path: "/",
  });
  return res;
}
```

## 4 · Backend route 2 — callback (finishes the flow)

Must live at the EXACT registered redirect URI path.

```ts
// e.g. app/api/one/callback/route.ts  (adjust to the registered path!)
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  // The state that came back selects its own cookie — not finding one
  // IS the CSRF failure (forged or stale state has no cookie).
  const verifier = state ? req.cookies.get(`one_tx_${state}`)?.value : undefined;

  const fail = (message: string) => {
    const r = NextResponse.redirect(
      new URL(`/?one_connect=error&one_connect_message=${encodeURIComponent(message)}`, req.url), 302);
    if (state) r.cookies.delete(`one_tx_${state}`);
    return r;
  };
  if (err === "access_denied") return fail("You cancelled the request.");

  if (!code || !state || !verifier)
    return fail("The sign-in attempt expired or was tampered with.");

  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch(process.env.ONE_TOKEN_URL!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`,
               "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.ONE_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail("One rejected the code exchange.");

  const t = await tokenRes.json();
  // Persist in THIS APP's database, keyed by its user:
  // { accessToken: t.access_token, refreshToken: t.refresh_token,
  //   expiresAt: Date.now() + t.expires_in * 1000 }
  await saveOneTokens(/* your storage */);

  const ok = NextResponse.redirect(new URL("/?one_connect=success", req.url), 302);
  ok.cookies.delete(`one_tx_${state}`);
  return ok;
}
```

## 5 · Refresh (Basic-authenticated, rotate BOTH tokens)

Access tokens last whatever the app chose at creation (7d/30d/90d/1y).
Refresh tokens last 30 days and are **rotated on every use** — reusing an
old refresh token revokes the whole token family (theft protection). The
refresh exchange is authenticated exactly like the code exchange; the
public-client form (client_id in the body, no secret) gets 401.

```ts
export async function getOneAccessToken(userId: string): Promise<string> {
  const t = await loadOneTokens(userId);
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;

  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(process.env.ONE_TOKEN_URL!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`,
               "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token",
                                refresh_token: t.refreshToken }),
  });
  if (!res.ok) throw new Error("One refresh failed — re-run the connect flow");
  const next = await res.json();
  await saveOneTokens(userId, {           // BOTH tokens — rotation!
    accessToken: next.access_token,
    refreshToken: next.refresh_token,
    expiresAt: Date.now() + next.expires_in * 1000,
  });
  return next.access_token;
}
```

## 6 · Using the grant — HTTP `/v1`

The bearer is a normal credential on One's standard `/v1` API — every
route below accepts `auth: [oauth]`. One resolves the token to the
user + their consent grant and enforces it on every call; a call outside
the grant returns `403` **this app cannot override**. Handle 401/403 by
prompting the user to reconnect (they may have revoked in One).

```ts
const token = await getOneAccessToken(userId);
const h = { Authorization: `Bearer ${token}` };
const api = process.env.ONE_API_URL; // development-api.withone.ai/v1
```

**Discover what the grant reaches** — `GET /v1/connections/reachable`.
Every connection the grant reaches, each labelled with the access it
confers, so the app never guesses what it was granted:

```ts
const { rows } = await (
  await fetch(`${api}/connections/reachable`, { headers: h })
).json();
// rows[].access.policy:
//   "full"    → every action
//   "methods" → { methods: ["GET", ...] }        (read-only / read-write)
//   "actions" → { actions: [{ actionId, title, method }] }  (custom)
```

(`GET /v1/connections` also works and returns only granted connections,
but without the `access` label — prefer `reachable`.)

**Browse the catalog** — `GET /v1/knowledge?connectionPlatform=<p>`.
What actions EXIST on a platform (the catalog is not the grant — it's
what's possible; the grant is what's permitted). Each row has `_id`
(the actionId), `method`, `path`, `title`.

**Execute** — `{METHOD} /v1/passthrough/<path>` with two headers naming
which connection and which action:

```ts
const res = await fetch(`${api}/passthrough${action.path}`, {
  method: action.method,
  headers: {
    ...h,
    "x-one-connection-key": connectionKey,   // from reachable
    "x-one-action-id": action._id,           // from knowledge
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
// Inside the grant → One proxies to the provider, real response returns.
// Outside the grant → 403 with a `correlationId` field: the request died
// INSIDE One and never reached the provider. That is the grant working.
```

## 6b · Using the grant — remote MCP (agents / assistants)

The **same bearer** authenticates One's remote MCP gateway
(`https://development-mcp.withone.ai/mcp`) — and MCP accepts the OAuth
bearer **exclusively** (no API key, no session; a missing or bad bearer
is 401). Point any MCP client at the endpoint with the token as the
`Authorization` header. Standard client config shape (the URL + bearer
are One's contract; the surrounding JSON is your MCP client's own
format):

```json
{
  "mcpServers": {
    "one": {
      "url": "https://development-mcp.withone.ai/mcp",
      "headers": { "Authorization": "Bearer <the user's access token>" }
    }
  }
}
```

The gateway exposes four tools, and every one enforces the **same
consent grant** as the HTTP path above (one enforcement, two transports):

- `list_one_integrations` — the granted connections + their access
  labels (identical to `/v1/connections/reachable`).
- `search_one_platform_actions` — find an action on a connected platform.
- `get_one_action_knowledge` — an action's inputs (read before executing).
- `execute_one_action` — run it. Args are `connection_key`, `action_id`,
  and optional `data` / `path_variables` / `query_params` / `headers`.
  A call outside the grant returns
  `"this connection or action is not permitted by the consent grant"`.

## 6c · The CLI does NOT take the grant token

The One CLI authenticates to the API **only** with an `sk_live_`/
`sk_test_` secret key in the `x-one-secret` header — it has no
`Authorization: Bearer` / OAuth path. A 2nd-degree user's OAuth grant
token therefore **cannot** drive the CLI. For agentic/programmatic use
of a grant, use the HTTP `/v1` API (§6) or remote MCP (§6b). (The CLI's
own `one login` yields a secret key, not a grant token — a different
credential model entirely.)

## 7 · Verify — done when ALL of these pass

1. Clicking the button navigates the TAB to
   `development-connect.withone.ai/oauth/connect?…` — the hosted page
   with the app's name on the left rail, and the "asking for" strip
   when a permission set is configured.
2. A fresh allowed-domain email receives a 6-digit code; entering it
   lands on the consent screen with the permission set's connectors.
3. Authorize shows the "You're all set" summary with a countdown, then
   auto-returns to the app with `?one_connect=success` (scrubbed from
   the address bar moments later), and the stored token's `expires_in`
   matches the app's chosen TTL (604800 for 7 days — NOT 3600).
4. The refresh helper returns a NEW access token and a NEW refresh token.
5. `GET {ONE_API_URL}/connections/reachable` with the bearer returns
   exactly the granted rows, each with its `access` label; a
   passthrough call outside the grant returns a 403 carrying a
   `correlationId`.
6. (If using MCP) an MCP client pointed at
   `development-mcp.withone.ai/mcp` with the bearer lists four `one`
   tools; `list_one_integrations` matches the reachable rows, and
   `execute_one_action` on an ungranted action is refused with "not
   permitted by the consent grant".
7. In the user's One dashboard (Settings → OAuth Apps → Authorized Apps)
   the app appears with what was granted; revoking there makes this
   app's bearer 401.
