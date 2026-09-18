---
name: one-connect
description: Add One Connect to an application so its users can grant the app scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and 500 more). Use when wiring @withone/connect into an app - the button, the two backend routes, and calling One with the grant.
---

# One Connect

You are adding One Connect to this application. Its users will grant the app
scoped, revocable access to their own One-connected tools. The package does
the OAuth work; you wire three things: a button, the two routes, and the
calls you make with the grant.

```
Browser                    Your backend                              One
<ConnectButton>  ------>   GET /api/one/authorize   ---302--->  One's hosted page (connect.withone.ai)
                                                                sign-in code, pick tools, set access
                           GET /api/one/callback    <--302----  ?code=...&state=...
                             exchanges the code, stores the tokens
                             302 -> /?one_connect=success
                 <------   SDK reads the param and fires onSuccess
Later:                     oneConnect.runAction(userId, ...) -> /v1/passthrough, grant enforced by One
```

Secrets and tokens never reach the browser.

## 1 - Collect from the human first

The human creates the app in the One dashboard: Developers -> Connect ->
New app. Confidential client. The secret is shown once.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | 40 hex characters |
| `ONE_CLIENT_SECRET` | starts with `one_secret_` |
| Registered redirect URI | Must be the exact URL of the callback route (scheme, host, path, no trailing slash). One compares the string as-is and answers `invalid redirect_uri` on any difference. Use `https` for anything public; `http://localhost:3000/api/one/callback` is fine locally. |
| `ONE_PERMISSION_SET` (optional) | The id of the app's ask: the connectors and levels the consent page opens on. Users can narrow it, never widen it. Without one, the page lists everything the user has connected. |
| Environment | Production is the default. For the development dashboard set `ONE_API_URL=https://development-api.withone.ai`. |

Two facts to tell the human:

- The app can show its users one line saying why it asks. It is set on the
  app in the dashboard, not sent by this package.
- Users can change or revoke the grant from their One dashboard at any time.
  Treat a `401` from One as "ask the user to reconnect", never as a bug.

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback   # exactly the registered value
ONE_PERMISSION_SET=...                                     # optional
ONE_API_URL=https://api.withone.ai                         # optional; development-api.withone.ai for development
```

## 3 - Install and create the client

```bash
npm install @withone/connect
```

```ts
// lib/one.ts  (server only)
import { createOneConnect } from "@withone/connect/server";

export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  oneApiUrl: process.env.ONE_API_URL,
  tokenStore: {
    saveTokens: (userId, tokens) => /* write to this app's database, encrypted, keyed by its user */,
    loadTokens: (userId) => /* read; null when the user never connected */,
    clearTokens: (userId) => /* delete */,
  },
});
```

`tokens` is `{ accessToken, refreshToken, expiresAt }`. Use the app's own user
id as the key. Implement the store on whatever the app already uses; do not
add a database for it.

## 4 - The two routes

Next.js App Router (also Remix, SvelteKit, Hono, Bun: anything with the web `Request`):

```ts
// app/api/one/[action]/route.ts
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => /* this app's signed-in user id, or null */,
  loginHintFor: async (request) => /* their email, to pre-fill One's sign-in; or null */,
  signInUrl: "/login",   // where to send a visitor who is not signed in
});
```

That file serves `/api/one/authorize` and `/api/one/callback`.

Express, Fastify, Koa, plain Node:

```ts
import { createOneConnectHandlers } from "@withone/connect/node";
import { oneConnect } from "./one";

const { authorize, callback } = createOneConnectHandlers(oneConnect, {
  identifyUser: (request) => /* user id or null */,
});
app.get("/api/one/authorize", authorize);
app.get("/api/one/callback", callback);
```

The routes mint `state` and PKCE, keep them in a per-flow httpOnly cookie
(`one_tx_<state>`, SameSite=Lax, 30 minutes), verify the state on return,
exchange the code with the secret over HTTP Basic, store both tokens, and
redirect to `/` with `?one_connect=success` or
`?one_connect=error&one_connect_message=...`. Pass `returnTo` to
`createOneConnect` to land somewhere else.

## 5 - The button

```tsx
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  platforms={["stripe", "google-calendar"]}   // connector slugs; logos and names come from One
  onSuccess={() => { /* refresh app state; the tokens are already stored */ }}
  onError={(message) => { /* show it; the user may simply have declined */ }}
/>
```

Vue: `import { ConnectButton } from "@withone/connect/vue"` with `authorize-url`,
`:platforms`, `@success`, `@error`. Svelte: `import { connectButton } from
"@withone/connect/svelte"` as `use:connectButton={{ authorizeUrl, platforms,
onSuccess }}`. Anything else: `import "@withone/connect"` registers
`<one-connect-button authorize-url="/api/one/authorize" platforms="stripe, notion">`,
which dispatches `success` and `error` events. A custom element:
`useOneConnect({ authorizeUrl, onSuccess, onError }).open` on a click.

The flow is a same-tab redirect. `onSuccess` and `onError` fire once when the
tab comes back, and the SDK removes the `one_connect` params from the URL.

## 6 - Calling One with the grant

Everything runs on the server through the client. Tokens refresh themselves.

```ts
const connections = await oneConnect.listConnections(userId);
// [{ key, platform, name, title, image, access }]
// access.policy: "full" | "methods" (+ methods: ["GET", ...]) | "actions" (+ actions: [{ actionId, title, method }])

const actions = await oneConnect.listActions(userId, "gmail");
// [{ _id, title, method, path }]  - what exists, not what is permitted

const reply = await oneConnect.runAction(userId, {
  connectionKey: connection.key,
  actionId: action._id,
  method: action.method,
  path: action.path,
  body: payload,
});
// { status, ok, blockedByGrant, data }
```

`blockedByGrant` true means One refused the call because it is outside the
grant; the provider was never called. Do not retry. Any other `/v1` call:
`oneConnect.fetch(userId, "/connections", init)`.

`OneConnectError` codes: `not_connected` (no tokens stored), `refresh_failed`
(One refused the refresh; the tokens were cleared; ask the user to connect
again), `request_failed` (One answered with an error; `status` carries it).

## 7 - Rules

- Never put the secret in a client bundle, a log line or an error report.
- Store tokens encrypted, keyed by the app's user. Delete them when the user
  is deleted. The client deletes them itself when a refresh fails.
- The registered redirect URI and `ONE_REDIRECT_URI` must be the same string.
- Do not build a completion page. The callback redirect is the completion.
- Do not write the OAuth steps by hand when the package exposes them.

## 8 - Done when all of these pass

1. Button -> One's hosted page -> sign-in code from a real inbox -> choose
   tools and levels -> "You're all set" -> back in the app with `onSuccess`
   fired. Repeat once in a private window.
2. `listConnections` returns only the granted connections, each with `access`.
3. `runAction` on an action inside the grant reaches the provider; one outside
   it returns `blockedByGrant: true`.
4. Revoking the app from the user's One dashboard makes the next call throw
   `refresh_failed` or return `401`, and the app shows its reconnect prompt.
