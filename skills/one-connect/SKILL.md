---
name: one-connect
description: Add One Connect to an application so its users can grant the app scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and 500 more). Use when wiring @withone/connect into an app - the button, the two backend routes, and calling One with the grant.
---

# One Connect

You are adding One Connect to this application. Its users will grant the app
scoped, revocable access to their own tools. The package does the OAuth work;
you wire three things: a button, two routes, and the calls made with the grant.

```
Browser                    Your backend                          One
<ConnectButton>  ------>   GET /api/one/authorize   ---302--->  hosted page: sign in, pick tools, set access
                           GET /api/one/callback    <--302----  ?code&state
                             stores the tokens, redirects home
                 <------   onSuccess fires
Later:                     oneConnect.runAction(userId, ...) -> One, grant enforced
```

Secrets and tokens stay on the server.

## 1 - Ask the human for these

They create the app in the One dashboard: Developers -> Connect -> New app.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | From the app. |
| `ONE_CLIENT_SECRET` | Starts with `one_secret_`. Shown once. |
| Redirect URI | Registered on the app. Must match the callback route exactly, e.g. `http://localhost:3000/api/one/callback`. |
| `ONE_PERMISSION_SET` | Optional. The tools and access levels to ask for. |
| `ONE_API_URL` | Optional. Production when unset; `https://development-api.withone.ai` for the development dashboard. |

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
ONE_PERMISSION_SET=...        # optional
ONE_API_URL=...               # optional
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
    saveTokens: (userId, tokens) => /* save in the app's database, encrypted */,
    loadTokens: (userId) => /* read; null when never connected */,
    clearTokens: (userId) => /* delete */,
  },
});
```

Use the app's own user id as the key and the database it already has.

If the app runs more than one server process or a background worker, also
add `withLock: (userId, run) => ...`, which runs `run()` while holding a
per-user lock all processes share (for example a Postgres advisory lock).

## 4 - The two routes

Next.js App Router (also Remix, SvelteKit, Hono, Bun):

```ts
// app/api/one/[action]/route.ts
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => /* the signed-in user's id, or null */,
  loginHintFor: async (request) => /* their email, optional */,
  signInUrl: "/login",
});
```

Express or plain Node: `createOneConnectHandlers(oneConnect, { identifyUser })`
from `@withone/connect/node`, mounted at `/api/one/authorize` and
`/api/one/callback`.

## 5 - The button

```tsx
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  platforms={["gmail", "stripe"]}   // connector slugs
  connected={hasGrant}              // from the server: await oneConnect.isConnected(userId)
  onSuccess={() => { /* refetch app state */ }}
  onError={(message) => { /* show message */ }}
/>
```

Optional props: `variant` ("default" | "accent" | "block"), `accentColor`,
`size` ("sm" | "md" | "lg"), `fullWidth`, `theme` ("light" | "dark" | "auto"),
`label`, `description`, `disabled`.

Vue: `@withone/connect/vue`, same props. Svelte: `use:connectButton` from
`@withone/connect/svelte`. Anything else: `import "@withone/connect"` and use
`<one-connect-button authorize-url="/api/one/authorize" platforms="gmail, stripe">`.
A custom button in React: `useOneConnect({ authorizeUrl })` returns `{ open, status }`.

## 6 - Calling One with the grant

```ts
const connections = await oneConnect.listConnections(userId);   // [{ key, platform, access }]
const actions = await oneConnect.listActions(userId, "gmail");  // [{ _id, title, method, path }]

const reply = await oneConnect.runAction(userId, {
  connectionKey: connection.key,
  actionId: action._id,
  method: action.method,
  path: action.path,
  body: payload,
});
// { status, ok, data }
```

A `403` means the call is outside what the user granted. Do not retry it.
A `refresh_failed` error means the grant ended; ask the user to connect again.

## 7 - Rules

- Never put the client secret in browser code, logs or error reports.
- Store tokens encrypted, keyed by the app's user.
- The registered redirect URI and `ONE_REDIRECT_URI` must be identical.
- Do not build a completion page; the callback redirect is the completion.
- Do not write OAuth steps by hand; use the package.

## 8 - Done when

1. The button leads to One's page; after signing in and authorizing, the user
   lands back in the app and `onSuccess` fires.
2. `listConnections` returns only the granted connections.
3. `runAction` works for an action inside the grant and returns `403` for
   one outside it.
4. After the user revokes the app in their One dashboard, the app asks them
   to connect again.
