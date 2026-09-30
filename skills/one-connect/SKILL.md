---
name: one-connect
description: Add One Connect to an application so its users can grant the app scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and 500 more). Use when wiring @withone/connect into an app - the button, the two backend routes, storing and refreshing the grant, and calling One with it.
---

# One Connect

You are adding One Connect to this application. Its users will grant the app
scoped, revocable access to their own tools. The package does the OAuth work;
you wire four things: a button, two routes, a daily refresh job, and the calls
made with the grant.

```
Browser                    Your backend                          One
<ConnectButton>  ------>   GET /api/one/authorize   ---302--->  hosted page: sign in, pick tools, set access
                           GET /api/one/callback    <--302----  ?code&state
                             stores the tokens, redirects home
                 <------   onSuccess fires
Later:                     oneConnect.runAction(userId, ...) -> One, grant enforced
Daily:                     oneConnect.refreshIfExpiring(userId, ...) for every connected user
```

Use **token mode**, described in sections 1 to 8. Key mode (section 9) is a
second way to hold the grant; use it only when the human asks for it.

Secrets and tokens stay on the server.

## 1 - Ask the human for these

They create the app in the One dashboard: Developers -> Connect -> New app.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | From the app. |
| `ONE_CLIENT_SECRET` | Starts with `one_secret_`. Shown once. |
| Redirect URI | Registered on the app. Must match the callback route exactly, e.g. `http://localhost:3000/api/one/callback`. |
| `ONE_PERMISSION_SET` | Optional. The tools and access levels to ask for. |

Never ask the human to paste the secret into the chat. Tell them which
environment variable to set and read it from there.

## 2 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
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

## 6 - Keeping users connected

Tokens expire. Two things keep them fresh, and only the first is automatic.

| | Who does it | When |
|---|---|---|
| Refresh before a call | the package, on its own | whenever the app calls One and the token is about to expire |
| Refresh for users who have not called in a while | **the app**, with a daily job | once a day, for every connected user |

You must add the daily job. Without it, a user who stays away for 30 days
has to connect again: the refresh token lives 30 days, and only a live
refresh token can renew the pair.

```ts
// a scheduled job, once a day
for (const userId of /* every user with stored tokens */) {
  await oneConnect.refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 });
}
```

It renews both tokens when either is within 3 days of expiring, and does
nothing otherwise. The access token lives as long as the app's Token lifetime
says (30 days unless changed under Advanced when creating the app); keep the
window shorter than that, or every run refreshes. Use the scheduler the app
already has (a cron route, a queue, a worker).

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
// { status, ok, data }
```

Do not set any header. The package adds the user's credential to every call
it makes, and refreshes it first when it is about to expire.

A `403` reply means the call is outside what the user granted. Do not retry it.

Errors are `OneConnectError` with a `code`. Handle them where the app calls One:

| `code` | Meaning | Do |
|---|---|---|
| `not_connected` | Nothing is stored for this user. | Show the Connect button. |
| `refresh_failed` | The grant ended. The tokens were cleared. | Ask the user to connect again. |
| `request_failed` | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

```ts
import { OneConnectError } from "@withone/connect/server";

try {
  await oneConnect.runAction(userId, action);
} catch (error) {
  if (
    error instanceof OneConnectError &&
    ["not_connected", "refresh_failed"].includes(error.code)
  ) {
    // show the Connect button again
  } else {
    throw error;
  }
}
```

## 8 - Rules

- Never put the client secret in browser code, logs, error reports, source
  files or prompts. Environment variables only.
- Store tokens encrypted, keyed by the app's user.
- Add the daily refresh job. It is part of the integration, not an extra.
- The registered redirect URI and `ONE_REDIRECT_URI` must be identical.
- Do not build a completion page; the callback redirect is the completion.
- Do not write OAuth steps or One request headers by hand; use the package.
- Do not switch an existing app from one mode to the other unless asked.

## 9 - Key mode (only when asked)

A second way to hold the grant: one connect key for the app and one permanent
id per user, with nothing to refresh. The routes, the button and the calls are
the same. Two limits today:

- `listActions` does not work in key mode yet. The app has to know the
  actions it runs.
- It works in Production only. The human creates the key with the dashboard
  on Production.

The human creates the key on the app's page: Credentials -> Connect key ->
Create key. It is shown once. They set it as `ONE_CONNECT_KEY`; never ask
them to paste it into the chat.

```ts
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

- `reference` is one short string. Store it as given and hand it back
  unchanged; do not parse or rebuild it. It is an identifier, not a secret.
- There is no daily refresh job in key mode.
- When the user revokes access, the next call throws `reconnect_required`
  (not `refresh_failed`). Ask them to connect again. The stored value is kept.
- A `403` reply carries `blockedByGrant: true` when the call is outside what
  the user granted.
- The mode is whichever credential `createOneConnect` is given: `tokenStore`
  for token mode, `connectKey` and `userStore` for key mode.

## 10 - Done when

1. The button leads to One's page; after signing in and authorizing, the user
   lands back in the app and `onSuccess` fires.
2. The tokens are saved for the user.
3. `listConnections` returns only the granted connections.
4. `runAction` works for an action inside the grant and returns `403` for
   one outside it.
5. The daily refresh job exists and runs for every connected user.
6. After the user revokes the app in their One dashboard, the app asks them
   to connect again.
