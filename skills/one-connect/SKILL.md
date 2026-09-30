---
name: one-connect
description: Add One Connect to an application so its users can grant the app scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and 500 more). Use when wiring @withone/connect into an app - the button, the two backend routes, choosing key mode or token mode, and calling One with the grant.
---

# One Connect

You are adding One Connect to this application. Its users will grant the app
scoped, revocable access to their own tools. The package does the OAuth work;
you wire three things: a button, two routes, and the calls made with the grant.

```
Browser                    Your backend                          One
<ConnectButton>  ------>   GET /api/one/authorize   ---302--->  hosted page: sign in, pick tools, set access
                           GET /api/one/callback    <--302----  ?code&state
                             saves one id for the user, redirects home
                 <------   onSuccess fires
Later:                     oneConnect.runAction(userId, ...) -> One, grant enforced
```

The client secret and the connect key stay on the server.

## 1 - Ask the human for these

They create the app in the One dashboard: Developers -> Connect -> New app.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | From the app. |
| `ONE_CLIENT_SECRET` | Starts with `one_secret_`. Shown once. |
| `ONE_CONNECT_KEY` | Key mode only. On the app's page: Credentials -> Connect key -> Create key. Shown once. It is made for the environment the dashboard is on (Production or Sandbox). |
| Redirect URI | Registered on the app. Must match the callback route exactly, e.g. `http://localhost:3000/api/one/callback`. |
| `ONE_PERMISSION_SET` | Optional. The tools and access levels to ask for. |
| `ONE_API_URL` | Optional. Production when unset; `https://development-api.withone.ai` for the development dashboard. |

Never ask the human to paste the secret or the connect key into the chat.
Tell them which environment variable to set and read it from there.

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_CONNECT_KEY=sk_live_...   # key mode
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
ONE_PERMISSION_SET=...        # optional
ONE_API_URL=...               # optional
```

## 3 - Choose a mode

The server holds a user's grant in one of two ways. The button, the two
routes and every call are identical in both. The mode is whichever
credential you pass to `createOneConnect`.

| | Key mode (default) | Token mode |
|---|---|---|
| The server holds | one connect key for the app | nothing app-wide |
| Stored per user | one string, saved once | an access token and a refresh token |
| Expires | nothing; One checks the consent on every call | the tokens, on the lifetime set on the app |
| Refreshing | none | the SDK does it; several servers need a shared lock |

How to decide:

- New integration: **key mode**.
- The app already passes a `tokenStore`: it is in token mode. Leave it as it
  is unless the human asks to move.
- The human asks for OAuth bearer tokens: token mode.

```ts
// key mode
createOneConnect({ ...app, connectKey: process.env.ONE_CONNECT_KEY!, userStore });

// token mode
createOneConnect({ ...app, tokenStore });
```

`mode: "key"` or `mode: "token"` may be added to be explicit.
`oneConnect.mode` reports which one is running.

## 4 - Install and create the client

```bash
npm install @withone/connect
```

Key mode:

```ts
// lib/one.ts  (server only)
import { createOneConnect } from "@withone/connect/server";

export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  oneApiUrl: process.env.ONE_API_URL,
  connectKey: process.env.ONE_CONNECT_KEY!,
  userStore: {
    saveUser: (userId, reference) => /* save the string on the app's user row */,
    loadUser: (userId) => /* read it; null when never connected */,
    clearUser: (userId) => /* set it to null */,
  },
});
```

`reference` is one short string: the user's permanent One id and the space
they granted from. One text column on the user row is enough. Store it as
given and hand it back unchanged; do not parse or rebuild it. It is an
identifier, not a secret, so it needs no encryption and no lock.

Token mode:

```ts
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

In token mode, if the app runs more than one server process or a background
worker, also add `withLock: (userId, run) => ...`, which runs `run()` while
holding a per-user lock all processes share (for example a Postgres advisory
lock). Once a day, call
`oneConnect.refreshIfExpiring(userId, { withinMs: 7 * 24 * 3_600_000 })` to
keep idle users connected.

In both modes use the app's own user id as the key and the database it
already has.

## 5 - The two routes

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

## 6 - The button

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

## 7 - Calling One with the grant

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
// { status, ok, blockedByGrant, data }
```

A `403` reply means the call is outside what the user granted. Do not retry
it. In key mode `blockedByGrant` is `true` for those.

Errors are `OneConnectError` with a `code`. Handle them where the app calls One:

| `code` | Mode | Meaning | Do |
|---|---|---|---|
| `not_connected` | both | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | key | One will not act for this user: they revoked access, or the app is deactivated. The stored value is kept. | Ask the user to connect again. |
| `refresh_failed` | token | The grant ended. The tokens were cleared. | Ask the user to connect again. |
| `request_failed` | both | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

```ts
import { OneConnectError } from "@withone/connect/server";

try {
  await oneConnect.runAction(userId, action);
} catch (error) {
  if (
    error instanceof OneConnectError &&
    ["not_connected", "reconnect_required", "refresh_failed"].includes(error.code)
  ) {
    // show the Connect button again
  } else {
    throw error;
  }
}
```

In key mode `isConnected(userId)` says the user has connected before. One
confirms the consent on each call, so a user who revoked is found by the
next call throwing `reconnect_required`.

## 8 - Rules

- Never put the client secret or the connect key in browser code, logs,
  error reports, source files or prompts. Environment variables only.
- A connect key works in one environment. Use the Production key against
  production and the Sandbox key against sandbox.
- Key mode: store the per-user string as given. Token mode: store tokens
  encrypted, keyed by the app's user.
- The registered redirect URI and `ONE_REDIRECT_URI` must be identical.
- Do not build a completion page; the callback redirect is the completion.
- Do not write OAuth steps or One request headers by hand; use the package.
- Do not switch an existing app from one mode to the other unless asked.

## 9 - Done when

1. The button leads to One's page; after signing in and authorizing, the user
   lands back in the app and `onSuccess` fires.
2. Key mode: one string is saved for the user. Token mode: the tokens are saved.
3. `listConnections` returns only the granted connections.
4. `runAction` works for an action inside the grant and returns `403` for
   one outside it.
5. After the user revokes the app in their One dashboard, the next call
   fails with `reconnect_required` (key mode) or `refresh_failed` (token
   mode) and the app asks them to connect again.
