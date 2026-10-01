---
name: one-connect
description: Add One Connect to an application so its users can grant the app scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and 500 more). Use when wiring @withone/connect into an app - the button, the two backend routes, the connect key, and calling One with the grant.
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

Use **key mode**, described in sections 1 to 7: the app holds one connect
key and saves one id per user, and nothing is refreshed. Token mode
(section 9) is the other way to hold the grant; use it only when the human
asks for it, or when the app already passes a `tokenStore`.

The client secret and the connect key stay on the server.

## 1 - Ask the human for these

They create the app in the One dashboard: Developers -> Connect -> New app.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | From the app. |
| `ONE_CLIENT_SECRET` | Starts with `one_secret_`. Shown once. |
| `ONE_CONNECT_KEY` | On the app's page: Credentials -> Connect keys -> Create key, with the dashboard on Production. Shown once. |
| Redirect URI | Registered on the app. Must match the callback route exactly, e.g. `http://localhost:3000/api/one/callback`. |
| `ONE_PERMISSION_SET` | Optional. The tools and access levels to ask for. |

Never ask the human to paste the secret or the connect key into the chat.
Tell them which environment variable to set and read it from there.

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_CONNECT_KEY=sk_live_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
ONE_PERMISSION_SET=...        # optional
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
  connectKey: process.env.ONE_CONNECT_KEY!,
  userStore: {
    saveUser: (userId, reference) => /* save the string on the app's user row */,
    loadUser: (userId) => /* read it; null when never connected */,
    clearUser: (userId) => /* set it to null */,
  },
});
```

Use the app's own user id as the key and the database it already has.

`reference` is one short string: the user's permanent One id and the space
they granted from. One text column on the user row is enough. Store it as
given and hand it back unchanged; do not parse or rebuild it. It is an
identifier, not a secret, so it needs no encryption and no lock. The
package writes it in the callback and reads it on every call; the app
never passes it anywhere.

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
// { status, ok, blockedByGrant, data }
```

Do not set any header. The package adds the connect key and the user's id
to every call it makes.

A `403` reply with `blockedByGrant: true` means the call is outside what
the user granted. Do not retry it.

Errors are `OneConnectError` with a `code`. Handle them where the app calls One:

| `code` | Meaning | Do |
|---|---|---|
| `not_connected` | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | One will not act for this user: they revoked access, or the app is deactivated. The stored value is kept. | Ask the user to connect again. |
| `request_failed` | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

```ts
import { OneConnectError } from "@withone/connect/server";

try {
  await oneConnect.runAction(userId, action);
} catch (error) {
  if (
    error instanceof OneConnectError &&
    ["not_connected", "reconnect_required"].includes(error.code)
  ) {
    // show the Connect button again
  } else {
    throw error;
  }
}
```

`isConnected(userId)` says the user has connected before. One confirms the
consent on each call, so a user who revoked is found by the next call
throwing `reconnect_required`.

## 7 - Rules

- Never put the client secret or the connect key in browser code, logs,
  error reports, source files or prompts. Environment variables only.
- Connect keys work in Production only; the human creates the key with
  the dashboard on Production.
- Store the per-user string as given.
- The registered redirect URI and `ONE_REDIRECT_URI` must be identical.
- Do not build a completion page; the callback redirect is the completion.
- Do not write OAuth steps or One request headers by hand; use the package.
- Do not switch an existing app from one mode to the other unless asked.

## 8 - Done when

1. The button leads to One's page; after signing in and authorizing, the user
   lands back in the app and `onSuccess` fires.
2. One string is saved for the user.
3. `listConnections` returns only the granted connections.
4. `runAction` works for an action inside the grant and returns `403` with
   `blockedByGrant: true` for one outside it.
5. After the user revokes the app in their One dashboard, the next call
   fails with `reconnect_required` and the app asks them to connect again.

## 9 - Token mode (only when asked)

The other way to hold the grant: the app stores an access token and a
refresh token per user, as a standard OAuth client. The routes, the button
and the calls are the same. No `ONE_CONNECT_KEY` is needed.

```ts
export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  tokenStore: {
    saveTokens: (userId, tokens) => /* save in the app's database, encrypted */,
    loadTokens: (userId) => /* read; null when never connected */,
    clearTokens: (userId) => /* delete */,
  },
});
```

- Store tokens encrypted, keyed by the app's user.
- If the app runs more than one server process or a background worker, also
  add `withLock: (userId, run) => ...`, which runs `run()` while holding a
  per-user lock all processes share (for example a Postgres advisory lock).
- When the user revokes access, the next refresh throws `refresh_failed`
  (not `reconnect_required`) and the tokens are cleared. Ask them to connect
  again.
- `blockedByGrant` stays `false` in token mode; treat any `403` as outside
  the grant.

Tokens expire, and two things keep them fresh. Only the first is automatic:

| | Who does it | When |
|---|---|---|
| Refresh before a call | the package, on its own | whenever the app calls One and the token is about to expire |
| Refresh for users who have not called in a while | **the app**, with a daily job | once a day, for every connected user |

```ts
// a scheduled job, once a day
for (const userId of /* every user with stored tokens */) {
  await oneConnect.refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 });
}
```

Without the job, a user who stays away for 30 days has to connect again:
the refresh token lives 30 days, and only a live refresh token can renew
the pair. The access token lives as long as the app's Token lifetime says
(30 days unless changed under Advanced when creating the app); keep the
window shorter than that, or every run refreshes. In token mode, "done"
also means the daily job exists and runs for every connected user.

The mode is whichever credential `createOneConnect` is given: `connectKey`
and `userStore` for key mode, `tokenStore` for token mode.
