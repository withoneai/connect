---
name: one-connect
description: Add One Connect to an application - a drop-in OAuth 2.1 flow that lets its users grant the app scoped, revocable access to their own connected tools (Gmail, Slack, Notion, Stripe and 500+ more). Use when wiring @withone/connect into an app - the button, the two backend routes, token refresh and calling One with the grant.
---

# One Connect

You are adding One Connect to this application. Its users will grant the app
scoped, revocable access to their own One-connected tools through standard
OAuth 2.1 (authorization code with PKCE). You build four small things: a
button, an authorize route, a callback route, and a token helper.

```
Browser                    Your backend                              One
-------                    ------------                              ---
<ConnectButton>  ------>   GET /api/one/authorize  ---302--->  api.withone.ai/oauth/authorize
                                                              -> One's hosted page (app.withone.ai)
                                                                 sign-in code, pick tools, consent
                           GET /api/one/callback   <--302----  ?code=...&state=...
                             exchanges code for tokens (server to server)
                             stores tokens, redirects to /?one_connect=success
                 <------   SDK sees the param and fires onSuccess

Every later call:          getOneAccessToken(user)  -> refresh when needed
                           Authorization: Bearer <token> -> api.withone.ai/v1/...
```

Secrets and tokens never reach the browser. One's endpoints are the SDK's
defaults; nothing about One's URLs needs configuring.

## 1 - Collect from the human first

The human creates the app at https://app.withone.ai -> Settings -> OAuth Apps
-> New OAuth App. Client type **Confidential**. The secret is shown once.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | 40 hex characters |
| `ONE_CLIENT_SECRET` | starts with `one_secret_` |
| Registered redirect URI | Must be the exact URL of the callback route from step 5 (scheme, host, path, no trailing slash). One compares the string as-is and answers `invalid redirect_uri` on any difference. Use `https` for anything public. |
| Access-token lifetime | Set on the app: 7 days (604800 s), 30 days, 90 days or 1 year. This is what `expires_in` returns. |
| `ONE_PERMISSION_SET` (optional) | UUID of a permission set on the app: the connectors and access levels the consent screen asks for. Users can narrow it, never widen it. Without one, the app asks for everything the user has connected. |

Two more facts to tell the human:

- The app can show its users one sentence saying why it asks, for example
  "Dormata needs Notion to keep your workspace in sync". It is set on the app
  in the dashboard ("Why you're asking", one line, up to 200 characters). It
  is not a URL parameter and this SDK never sends it.
- Users can revoke the grant from their One dashboard at any time. The app
  must treat a `401` from One as "ask the user to reconnect", not as a bug.

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback   # exactly the registered value
ONE_PERMISSION_SET=...                                     # optional
```

Never put the secret in a client bundle, a log line or an error report.

## 3 - Frontend: the button

```bash
npm install @withone/connect
```

React / Next:

```tsx
import { ConnectButton } from "@withone/connect/react";

export function ConnectWithOne() {
  return (
    <ConnectButton
      authorizeUrl="/api/one/authorize"   // your route from step 4; relative is fine
      label="Connect your apps"
      variant="default"                    // "default" | "accent" | "block"
      theme="light"                        // "light" | "dark", match your page
      platforms={[{ name: "Stripe" }, { name: "Google Calendar" }]}
      onSuccess={() => {/* tokens are already stored by your callback */}}
      onError={(message) => console.error(message)}
    />
  );
}
```

`platforms` draws provider logos on the button; pass a `name` and the SDK
finds the logo, or pass `imageUrl` to override it. Optional props:
`moreCount`, `description`, `accentColor`, `connectedLabel`, `onClose`.

Vue 3: `import { ConnectButton } from "@withone/connect/vue"` with
`authorize-url`, `:platforms`, and `@success` / `@error` / `@close`.

Svelte: `import { connectButton } from "@withone/connect/svelte"` and
`<div use:connectButton={{ authorizeUrl, platforms, onSuccess }} />`.

Anything else: `import "@withone/connect"` registers
`<one-connect-button authorize-url="/api/one/authorize" platforms='[{"name":"Stripe"}]'>`,
which emits `success` / `error` / `close` events.

Your own element:

```tsx
import { useOneConnect } from "@withone/connect";

const { open } = useOneConnect({
  authorize: { url: "/api/one/authorize" },
  onSuccess: () => {},
  onError: (message) => console.error(message),
});
// <button onClick={open}>Connect your tools</button>
```

How completion works: the flow navigates the same tab to One's hosted page and
back. Your callback (step 5) ends by redirecting to any page of your app with
`?one_connect=success` (or `?one_connect=error&one_connect_message=...`). The
SDK reads that on page load, fires `onSuccess` or `onError`, and removes the
params from the address bar.

## 4 - Backend route 1: authorize

```ts
// app/api/one/authorize/route.ts   (Next.js App Router; adapt to your stack)
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");                          // CSRF proof
  const verifier = randomBytes(32).toString("base64url");                 // PKCE secret, stays here
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL("https://api.withone.ai/oauth/authorize");
  url.searchParams.set("client_id", process.env.ONE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.ONE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  // The user picks where the grant lives (personal, organization or project)
  // on the consent screen. Ask for all three tiers so any choice works.
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
  if (userEmail) url.searchParams.set("login_hint", userEmail);   // pre-fills sign-in, never locks it

  const res = NextResponse.redirect(url.toString(), 302);
  // One cookie per flow, named by its state, so a retry or a second tab
  // cannot overwrite the verifier of a flow still in progress.
  res.cookies.set(`one_tx_${state}`, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",       // the callback is a top-level navigation back to your site
    maxAge: 1800,
    path: "/",             // must cover the callback route's path
  });
  return res;
}
```

## 5 - Backend route 2: callback

Served at exactly the registered redirect URI.

```ts
// app/api/one/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");        // "access_denied" when the user declines
  // The returned state names its own cookie. No cookie means a forged or
  // stale state: never exchange the code in that case.
  const verifier = state ? req.cookies.get(`one_tx_${state}`)?.value : undefined;

  const fail = (message: string) => {
    const r = NextResponse.redirect(
      new URL(`/?one_connect=error&one_connect_message=${encodeURIComponent(message)}`, req.url), 302);
    if (state) r.cookies.delete(`one_tx_${state}`);
    return r;
  };
  if (error === "access_denied") return fail("You cancelled the request.");
  if (!code || !state || !verifier) return fail("The sign-in attempt expired or was tampered with.");

  // Client authentication is HTTP Basic (client_secret_basic). One does not
  // accept the secret in the POST body.
  const basic = Buffer.from(`${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch("https://api.withone.ai/oauth/token", {
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
    expires_in: number;      // seconds; the app's access-token lifetime
    token_type: "Bearer";
  };
  // Store encrypted, keyed by YOUR user id (the signed-in user of this app).
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

- Access tokens live for the app's access-token lifetime (`expires_in`).
- Refresh tokens live 30 days and rotate on every use: each refresh returns
  a new access token and a new refresh token. Store both.
- Reusing a refresh token that was already rotated is treated as theft: One
  revokes the whole token family and the user must reconnect.
- The refresh call is Basic-authenticated, like the code exchange.

```ts
export async function getOneAccessToken(appUserId: string): Promise<string> {
  const t = await loadOneTokens(appUserId);
  if (!t) throw new Error("not connected");
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;     // still valid, 60 s margin

  const basic = Buffer.from(`${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.withone.ai/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }),
  });
  if (!res.ok) {
    await clearOneTokens(appUserId);           // family is dead: revoked, expired, or reused
    throw new Error("One refresh failed - user must reconnect");
  }
  const next = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await saveOneTokens(appUserId, {             // both tokens: rotation
    accessToken: next.access_token,
    refreshToken: next.refresh_token,
    expiresAt: Date.now() + next.expires_in * 1000,
  });
  return next.access_token;
}
```

Serialize refreshes per user (a lock or single-flight). Two concurrent
refreshes with the same refresh token trip reuse detection.

## 7 - Calling One with the grant

Every call carries the bearer plus the tenant headers from the token itself.
On the consent screen the user chose where the grant lives: personal,
organization or project. One reads the tenant from two headers, and without
them the call runs in the user's personal space, where an organization grant
reaches nothing and the app looks disconnected. The access token's JWT
payload (plain base64url JSON) names the tenant, so send it back:

```ts
const api = "https://api.withone.ai/v1";

function tenancyHeaders(accessToken: string): Record<string, string> {
  const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
  const headers: Record<string, string> = {};
  if (payload.organization_ids?.[0]) headers["X-One-Organization-Id"] = payload.organization_ids[0];
  if (payload.project_ids?.[0]) headers["X-One-Project-Id"] = payload.project_ids[0];
  return headers;                              // empty for a personal grant
}

async function oneHeaders(appUserId: string) {
  const token = await getOneAccessToken(appUserId);
  return { Authorization: `Bearer ${token}`, ...tenancyHeaders(token) };
}
```

Three calls cover everything.

What the grant reaches: `GET /v1/connections/reachable`

```ts
const { rows } = await (await fetch(`${api}/connections/reachable`, { headers: await oneHeaders(appUserId) })).json();
// rows[]: { key, connector, platform, name, title, image, access }
// access.policy: "full"
//             or "methods" + methods: ["GET", ...]                  only these HTTP methods
//             or "actions" + actions: [{ actionId, title, method }] only these actions
```

What actions exist: `GET /v1/knowledge?connectionPlatform=<platform>&limit=100&page=N`
returns rows with `_id`, `title`, `method`, `path`. It is paged; read `pages`.
The catalog is what is possible; the grant is what is permitted.

Execute: `{method} /v1/passthrough{path}` with two extra headers:

```ts
await fetch(`${api}/passthrough${action.path}`, {
  method: action.method,
  headers: {
    ...(await oneHeaders(appUserId)),
    "x-one-connection-key": row.key,
    "x-one-action-id": action._id,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
```

Inside the grant, One forwards the call to the provider and returns its reply.
Outside the grant, One answers `403` with a `correlationId` and the provider
is never called. That is the grant working; do not retry it.

## 8 - Rules

- `401` from One: the token is expired, revoked or invalid. Clear the stored
  tokens and show "Reconnect". `403`: the call is outside the grant. Do not
  retry; the user chose that.
- Users change or revoke a grant from their One dashboard. The app's next
  call reflects it. To ask for more, send the user through the button again.
- Check `state` before touching the code. Never exchange on a mismatch.
- Store tokens encrypted, keyed by your user. Delete them when the user is
  deleted and when a refresh fails.
- The registered redirect URI, the `redirect_uri` in step 4 and the one in
  step 5 must be the same string.

## 9 - Done when all of these pass

1. Button -> One's hosted page -> sign-in code from a real inbox -> choose
   tools and access -> "You're all set" -> back in the app with `onSuccess`
   fired. Repeat once in a private window.
2. Stored `expires_in` equals the app's access-token lifetime (for example
   604800 for 7 days).
3. A refresh returns a rotated pair; sending the old refresh token again is
   refused and the app's reconnect path engages.
4. `GET /v1/connections/reachable` with the bearer and tenant headers lists
   only the granted connections with their `access`; one call outside the
   grant returns `403`.
5. Revoking the app from the user's One dashboard makes the app's next call
   `401` and the app shows its reconnect prompt.
