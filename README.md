<img src="https://assets.withone.ai/banners/connect.png" alt="One Connect. Let your users grant your app scoped, revocable access to their own tools." style="border-radius: 5px;">

<h3 align="center">One Connect</h3>

<p align="center">
  <a href="https://withone.ai"><strong>Website</strong></a>
  &nbsp;·&nbsp;
  <a href="https://withone.ai/docs/connect"><strong>Docs</strong></a>
  &nbsp;·&nbsp;
  <a href="https://app.withone.ai/developers/connect"><strong>Dashboard</strong></a>
  &nbsp;·&nbsp;
  <a href="https://withone.ai/changelog"><strong>Changelog</strong></a>
  &nbsp;·&nbsp;
  <a href="https://x.com/withoneai"><strong>X</strong></a>
  &nbsp;·&nbsp;
  <a href="https://linkedin.com/company/withoneai"><strong>LinkedIn</strong></a>
</p>

<p align="center">
  <a href="https://npmjs.com/package/@withone/connect"><img src="https://img.shields.io/npm/v/%40withone%2Fconnect" alt="npm version"></a>
</p>

One Connect lets your users grant your app **scoped, revocable access to their own One-connected tools**: Gmail, Slack, Notion, Stripe and 500 more. Your user keeps their connections in One. Your app holds only what they granted, and One checks that on every call.

You build three things: a button, two backend routes, and the calls you make with the grant. This package gives you all three.

```
Browser                       Your server                          One
<ConnectButton>  ───────►  GET /api/one/authorize  ──302──►  One's hosted connect page
                                                              sign in · pick tools · set access
                           GET /api/one/callback   ◄──302──  ?code&state
                             exchanges the code, stores the tokens
                             302 → /?one_connect=success
onSuccess() fires ◄────────
later:                     oneConnect.runAction(userId, …)  ──►  /v1/passthrough (grant enforced)
```

> **Connect vs. Auth.** [`@withone/auth`](https://github.com/withoneai/auth) puts connections in *your* One project: you own them. Connect puts connections in *your user's* One account and hands you a grant.

## Install

```bash
npm install @withone/connect
```

Or let your coding agent do the whole setup:

```bash
npx skills add withoneai/connect
```

## 1 · Create your app in One

Dashboard → **Developers → Connect → New app**.

- You get a **client id** (public) and a **client secret** (shown once; server only).
- Register the **redirect URI** of your callback route, exactly: `https://yourapp.com/api/one/callback`.
- Choose what the app asks for: specific connectors and levels (an *ask*, which gives you a permission set id), or everything the user has connected.
- Optionally write the one line users see about why you ask.

Environment variables, server side:

```env
ONE_CLIENT_ID=…
ONE_CLIENT_SECRET=one_secret_…
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
ONE_PERMISSION_SET=…                    # optional: the ask to open on
ONE_API_URL=https://api.withone.ai      # optional: production when unset
```

| Variable | Required | What it is |
|---|---|---|
| `ONE_CLIENT_ID` | yes | Public client id from your app |
| `ONE_CLIENT_SECRET` | yes | Server only. Never in a browser, a log or an error report. |
| `ONE_REDIRECT_URI` | yes | Must equal the registered URI character for character |
| `ONE_PERMISSION_SET` | no | The ask the consent page opens on. Without it, the page lists everything the user has connected. |
| `ONE_API_URL` | no | `https://development-api.withone.ai` for the development environment |

## 2 · The button

Any element wired to `open()` works. The pre-built button draws connector logos from their slugs and handles Connect → Connecting → Connected itself. It renders in its own shadow root, so your page's CSS can't break it, and it keeps its look under a strict Content Security Policy (`style-src 'self'`).

```tsx
// React / Next.js: safe to import from a Server Component (the bundle is "use client")
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  platforms={["stripe", "google-calendar", "gmail"]}
  connected={user.hasOneGrant}          // from your server; see below
  onSuccess={() => refreshAppState()}
  onError={(message, code) => showBanner(message)}
/>
```

```vue
<!-- Vue 3 -->
<script setup>
import { ConnectButton } from "@withone/connect/vue";
</script>
<template>
  <ConnectButton authorize-url="/api/one/authorize" :platforms="['stripe', 'notion']" :connected="hasGrant" @success="onConnected" />
</template>
```

```svelte
<!-- Svelte, as an action -->
<script>
  import { connectButton } from "@withone/connect/svelte";
</script>
<div use:connectButton={{ authorizeUrl: "/api/one/authorize", platforms: ["stripe", "notion"], connected: data.hasGrant, onSuccess }} />
```

```html
<!-- Plain HTML or any other framework: importing the package registers the element -->
<one-connect-button authorize-url="/api/one/authorize" platforms="stripe, notion" connected></one-connect-button>
<script type="module">
  import "@withone/connect";
  document.querySelector("one-connect-button").addEventListener("success", () => location.reload());
</script>
```

Every surface takes the same props. Attributes are the kebab-case names, and `connected`, `disabled` and `full-width` are boolean attributes. The React and Vue components render the host element themselves, `<span class="one-connect">`, and React's `className` and `style` apply to it. The button inside never changes the host's attributes, so server-rendered pages hydrate without a mismatch, and `fullWidth` fills whatever container you put the button in, flex rows included.

| Prop (attribute) | What it does |
|---|---|
| `authorizeUrl` (`authorize-url`) | Your authorize route. Relative paths resolve against the page. Required. |
| `platforms` | Connector slugs: `["stripe", "google-calendar"]`. Logos come from One's CDN and names from the slug, spelled the way each brand spells itself (`hubspot` → HubSpot). Pass `{ slug, name, imageUrl }` to override either. As an attribute: `"stripe, notion"`. The first three draw as logos; the rest fold into a `+N` chip. |
| `connected` | Whether this user has a live grant, **from your server**. When set, it decides the Connected state, so the button stays right after a reload. When omitted, the button shows Connected only right after a successful return. |
| `disabled` | Not clickable, for example until terms are accepted. |
| `variant` | `default` neutral · `accent` your brand colour · `block` a card with a description and a "Secured by One" foot |
| `size` | `sm` · `md` (default) · `lg` |
| `fullWidth` (`full-width`) | Stretches to its container. |
| `theme` | `light` (default), `dark`, or `auto` to follow the visitor's setting. Matches *your* page. |
| `connectTheme` (`connect-theme`) | `light` or `dark` for One's hosted page. `appTheme` still works and is deprecated. |
| `accentColor` (`accent-color`) | Fill of the `accent` variant; One's lime when omitted. The label is black or white, whichever reads better on it. |
| `label` · `connectedLabel` (`connected-label`) | Button text. Defaults: "Connect your apps" · "Connected". |
| `description` | Sub-line on the `block` variant. |
| `onSuccess` | The grant was stored. Fires once per page load, on the first button still mounted. Refetch; your server is the truth. |
| `onError(message, code)` | The flow ended without a grant. `code` is `declined`, `expired` or `failed`, and `message` is the SDK's fixed text for it, safe to show. |
| `onCancel` | The user came back with the browser's Back button before finishing. The button is already clickable again. |

The custom element dispatches `success`, `error` (`detail: { message, code }`) and `cancel` events.

**Matching your design system.** The button inherits your page's font. Two custom properties and two parts do the rest:

```css
one-connect-button, .one-connect {
  --one-connect-font: var(--font-sans);
  --one-connect-radius: 8px;
}
.one-connect::part(button) { box-shadow: none; }   /* the React, Vue and Svelte host */
one-connect-button::part(label) { font-weight: 600; }
```

Under a strict CSP, allow One's connector logos in `img-src` (`https://assets.withone.ai`). If they're blocked, each chip falls back to the connector's first letter.

**Your own element.** In React, use the hook:

```tsx
import { useOneConnect } from "@withone/connect/react";

const { open, status, error } = useOneConnect({ authorizeUrl: "/api/one/authorize" });
// status: "idle" | "connecting" | "connected" | "error"
<button onClick={open} disabled={status === "connecting"}>Connect your tools</button>
```

Anywhere else, use `createConnectFlow`:

```ts
import { createConnectFlow } from "@withone/connect";

const flow = createConnectFlow({
  authorizeUrl: "/api/one/authorize",
  onSuccess: () => {},
  onError: (message, code) => {},
  onCancel: () => {},
});
button.addEventListener("click", flow.open);
// later: flow.destroy()
```

**How the return works.** The flow is a full-page redirect in the same tab, so it works in every browser with no popup or iframe. When your callback route redirects home, it appends `?one_connect=success` or `?one_connect=error&one_connect_error=<code>`. The SDK reads that once per page load, shows it on every button, calls back once, and removes the params from the address bar. Only the code travels on the URL. The text comes from the SDK, so a crafted link can't put its own words in front of your users. `readConnectReturn()` returns the same outcome if you want to show it yourself.

## 3 · The two routes, as one import

Create the client once, on the server:

```ts
// lib/one.ts
import { createOneConnect } from "@withone/connect/server";

export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  oneApiUrl: process.env.ONE_API_URL,
  tokenStore: {
    // Your database, keyed by your own user id. Store them encrypted.
    saveTokens: (userId, tokens) => db.oneTokens.upsert(userId, tokens),
    loadTokens: (userId) => db.oneTokens.find(userId),
    clearTokens: (userId) => db.oneTokens.delete(userId),
    // Required when you run more than one server or a worker. See "Tokens" below.
    withLock: (userId, run) => db.withUserLock(userId, run),
  },
});
```

Then mount the routes for your server.

**Next.js (App Router), Remix, SvelteKit, Hono, Bun** and anything else that speaks the web `Request`:

```ts
// app/api/one/[action]/route.ts
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => (await getSession(request))?.userId ?? null,
  loginHintFor: async (request) => (await getSession(request))?.email ?? null,
  signInUrl: "/login",
});
```

That one file serves `/api/one/authorize` and `/api/one/callback`.

**Express, Fastify, Koa, plain Node:**

```ts
import { createOneConnectHandlers } from "@withone/connect/node";
import { oneConnect } from "./one";

const { authorize, callback } = createOneConnectHandlers(oneConnect, {
  identifyUser: (request) => request.session?.userId ?? null,
});
app.get("/api/one/authorize", authorize);
app.get("/api/one/callback", callback);
```

What the routes do for you: mint `state` and a PKCE verifier, keep them in a per-flow httpOnly cookie, send the browser to One, verify the returned state, exchange the code with your secret over HTTP Basic, store both tokens through your `tokenStore`, and redirect home with the outcome. A declined consent, an expired attempt and a failed exchange come back as `?one_connect=error&one_connect_error=declined|expired|failed`. `completeAuthorization` also returns a `message` describing what happened, for your logs only.

**Another language?** The routes are ordinary OAuth 2.1 authorization code with PKCE. The reference behaviour is in `src/server/index.ts`; the same steps work in Python, Go or Ruby.

## 4 · Using the grant

Everything runs on your server through the same client. Every call refreshes the tokens first when they are about to expire (see [Tokens](#5--tokens-storing-refreshing-keeping-alive)).

```ts
// What the grant reaches, each connection with its access
const connections = await oneConnect.listConnections(userId);
// [{ key, platform, name, title, image, access: { policy: "full" | "methods" | "actions", … } }]

// What actions a platform has (what exists, not what is permitted)
const actions = await oneConnect.listActions(userId, "gmail");
// [{ _id, title, method, path }]

// Run one
const reply = await oneConnect.runAction(userId, {
  connectionKey: connections[0].key,
  actionId: actions[0]._id,
  method: actions[0].method,
  path: actions[0].path,
  body: { … },
});
// { status, ok, blockedByGrant, data }
```

`blockedByGrant` is true when One refused the call because it is outside what the user granted. The provider was never called. Do not retry; the user chose that. Anything else on One's `/v1` API: `oneConnect.fetch(userId, "/connections", init)` adds the bearer and the tenancy headers for you.

Other calls on the client: `isConnected`, `getAccessToken`, `getTokens`, `refreshTokens`, `refreshIfExpiring`, `disconnect`.

## 5 · Tokens: storing, refreshing, keeping alive

Your app owns the tokens. The SDK never stores anything itself: it calls your `tokenStore`, and it refreshes through it.

**What One issues**

| | Lifetime | On refresh |
|---|---|---|
| Access token | The lifetime set on your app: 1 hour by default, or 7, 30, 90 or 365 days | Replaced |
| Refresh token | 30 days | Replaced, with a fresh 30 days |

Every refresh returns a **new pair** and retires the old refresh token. If the old refresh token is ever used again, One treats it as stolen and **revokes the whole grant**. The user then has to connect again.

**Store them in your database, encrypted, keyed by your user id**

```sql
create table one_tokens (
  user_id       text primary key,
  access_token  text not null,          -- encrypted
  refresh_token text not null,          -- encrypted
  expires_at    timestamptz not null    -- tokens.expiresAt
);
```

**Give the store a lock when more than one process can refresh**

Serverless functions, several instances, a background worker: any two of them can decide to refresh the same user at the same moment.

```
without a lock                              with withLock
web ──refresh(R1)──► One: here is R2         web ──lock──refresh(R1)──► R2 ──save──unlock
worker ─refresh(R1)─► One: R1 reused!        worker ──wait─────────────────────────────┐
                      revoke everything ✗                   reload: R2 is fresh, use it ✓
```

The SDK takes the lock around every refresh and around the save in the callback. It re-reads the store inside the lock, so the process that waited uses the pair the first one saved instead of spending the old refresh token again. The SDK never takes the lock twice for the same call. Postgres, with a transaction-scoped advisory lock:

```ts
withLock: async (userId, run) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`one-connect:${userId}`]);
    return await run();
  } finally {
    await client.query("commit").catch(() => {});
    client.release();
  }
},
```

A single long-running process can leave `withLock` out; the SDK already runs one refresh per user at a time inside a process. If your lock has a timeout, make it at least 60 seconds, because it spans one call to One.

**Refreshing ahead of time**

`getAccessToken`, `runAction`, `listConnections` and `fetch` refresh on their own when the access token has less than a minute left. For work that runs in the background, refresh ahead with `refreshIfExpiring`. It refreshes only when the access token **or** the refresh token expires within the window, and otherwise returns the stored pair without calling One.

```ts
// Every 10 minutes: users whose access token expires in the next 15 minutes
// (your table knows expires_at).
await oneConnect.refreshIfExpiring(userId, { withinMs: 15 * 60_000 });

// Once a day, for every connected user: renews refresh tokens before their
// 30 days run out, so a user who has not been active stays connected.
await oneConnect.refreshIfExpiring(userId, { withinMs: 7 * 24 * 3_600_000 });
```

**When a refresh fails**

| `OneConnectError.code` | What happened | Tokens | What to do |
|---|---|---|---|
| `refresh_failed` | One declared the grant dead: the user revoked it, the refresh token expired, or it was reused | Cleared | Show "Reconnect", which runs Connect again |
| `request_failed` | One could not be reached, answered with a server error, or refused your client credentials | **Kept** | Retry later. Check `status` for a 401, which means your client secret is wrong. |
| `not_connected` | No tokens are stored for this user | — | Show "Connect" |

The SDK clears tokens only when One says the grant is dead (`invalid_grant`), or when the refresh token's own expiry has passed. It calls `clearTokens(userId, failed)` with the pair that failed. Just before that, it re-reads the store: if a newer pair has landed (the user reconnected while an old refresh was failing), it keeps and returns the newer pair. To make that check atomic, delete only when the stored refresh token is still `failed.refreshToken`. `disconnect(userId)` calls `clearTokens(userId)` without `failed`, and always deletes.

**Asking for more tools later**

Edit the app's permission set in the dashboard (Developers → Connect). The next time a user presses the button, One shows them the new tools as "{your app} needs one more connection", with what they already granted pre-selected. Authorizing replaces the user's grant and old tokens at once, and the callback saves the new pair.

## What your users see

In their One dashboard the app appears under **Access control**, with what they granted and when it was last used. They can lower a level, remove an account, or revoke the app at any time. Your next call reflects it: a `401` means reconnect, a `403` means outside the grant.

In *your* dashboard the app lists every user who said yes, what each one granted, and lets you revoke a user.

## Security notes

- The client secret is used on your server only, for the code exchange and refresh, over HTTP Basic.
- The authorization code is single use and expires ten minutes after consent.
- Refresh tokens rotate on every use. Reusing an old one revokes the whole family, which is why the client refreshes one user at a time: inside a process on its own, and across processes through `tokenStore.withLock`.
- The browser half of this package never sees a token. It navigates and reads one query parameter.

## Development

```bash
npm run check     # typecheck, tests, build
```

## License

GPL-3.0. See [LICENSE](LICENSE).
