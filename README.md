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

Any element wired to `open()` works. The pre-built button draws connector logos from their slugs, and manages Connect → Connecting → Connected on its own.

```tsx
// React / Next.js
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  platforms={["stripe", "google-calendar", "gmail"]}
  moreCount={274}
  onSuccess={() => refreshAppState()}
  onError={(message) => showBanner(message)}
/>
```

```vue
<!-- Vue 3 -->
<script setup>
import { ConnectButton } from "@withone/connect/vue";
</script>
<template>
  <ConnectButton authorize-url="/api/one/authorize" :platforms="['stripe', 'notion']" @success="onConnected" />
</template>
```

```svelte
<!-- Svelte, as an action -->
<script>
  import { connectButton } from "@withone/connect/svelte";
</script>
<div use:connectButton={{ authorizeUrl: "/api/one/authorize", platforms: ["stripe", "notion"], onSuccess }} />
```

```html
<!-- Plain HTML or any other framework: importing the package registers the element -->
<one-connect-button authorize-url="/api/one/authorize" platforms="stripe, notion" more-count="274"></one-connect-button>
<script type="module">
  import "@withone/connect";
  document.querySelector("one-connect-button").addEventListener("success", () => location.reload());
</script>
```

| Prop (attribute) | What it does |
|---|---|
| `authorizeUrl` (`authorize-url`) | Your authorize route. Relative paths resolve against the page. Required. |
| `platforms` | Connector slugs: `["stripe", "google-calendar"]`. Logos and names come from One. To override either, pass `{ slug, name, imageUrl }`. As an attribute: `"stripe, notion"`. |
| `moreCount` (`more-count`) | The `+N` chip after the first three logos |
| `label` | Button text. Default "Connect your apps". |
| `connectedLabel` (`connected-label`) | Text after a successful return. Default "Connected". |
| `variant` | `default` pill · `accent` brand-colored pill · `block` card with a description |
| `description` | Sub-line on the `block` variant |
| `theme` | `light` or `dark`, matching *your* page |
| `appTheme` (`app-theme`) | `light` or `dark` for One's page |
| `accentColor` (`accent-color`) | Fill of the `accent` variant. One's lime when omitted. |
| `onSuccess` / `onError` | Fire once when the tab returns. `onError` receives a message safe to show. The element also dispatches `success` and `error` events. |

Your own element:

```ts
import { useOneConnect } from "@withone/connect";

const { open } = useOneConnect({
  authorizeUrl: "/api/one/authorize",
  onSuccess: () => {},
  onError: (message) => {},
});
button.addEventListener("click", open);
```

The flow is a full-page redirect in the same tab, so it works in every browser with no popup or iframe. When your callback route redirects home it appends `?one_connect=success` (or `?one_connect=error&one_connect_message=…`); the SDK reads that on load, fires your callback once, and removes the params from the address bar.

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

What the routes do for you: mint `state` and a PKCE verifier, keep them in a per-flow httpOnly cookie, send the browser to One, verify the returned state, exchange the code with your secret over HTTP Basic, store both tokens through your `tokenStore`, and redirect home with the outcome. A declined consent, an expired attempt and a failed exchange all come back as `?one_connect=error` with a message you can show.

**Another language?** The routes are ordinary OAuth 2.1 authorization code with PKCE. The reference behaviour is in `src/server/index.ts`; the same steps work in Python, Go or Ruby.

## 4 · Using the grant

Everything runs on your server through the same client. Tokens are refreshed for you before they expire; a refresh One refuses clears the stored tokens and throws `OneConnectError` with code `refresh_failed`, which means "ask the user to connect again".

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

Other calls on the client: `isConnected`, `getAccessToken`, `getTokens`, `refreshTokens`, `disconnect`.

## What your users see

In their One dashboard the app appears under **Access control**, with what they granted and when it was last used. They can lower a level, remove an account, or revoke the app at any time. Your next call reflects it: a `401` means reconnect, a `403` means outside the grant.

In *your* dashboard the app lists every user who said yes, what each one granted, and lets you revoke a user.

## Security notes

- The client secret is used on your server only, for the code exchange and refresh, over HTTP Basic.
- The authorization code is single use and expires ten minutes after consent.
- Refresh tokens rotate on every use. Reusing an old one revokes the whole family, which is why the client serialises refreshes per user.
- The browser half of this package never sees a token. It navigates and reads one query parameter.

## Development

```bash
npm run check     # typecheck, tests, build
```

## License

GPL-3.0. See [LICENSE](LICENSE).
