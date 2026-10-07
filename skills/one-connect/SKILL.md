---
name: one-connect
description: Add One Connect to an application so its users can grant the app scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and 900+ more). Use when wiring @withone/connect into an app - choosing key or token mode, the two backend routes, the Connect button or the app's own button, and calling One with the grant.
---

# One Connect

You are adding One Connect to this application. Its users will grant the app
scoped, revocable access to their own tools. The package does the OAuth work;
you wire three things: a button, two routes, and the calls made with the grant.

```
Browser                    Your backend                          One
<ConnectButton>  ------>   GET /api/one/authorize   ---302--->  hosted page: sign in, pick tools, set access
                           GET /api/one/callback    <--302----  ?code&state
                             saves the grant for the user, redirects home
                 <------   onSuccess fires
Later:                     oneConnect.runAction(userId, ...) -> One, grant enforced
```

The client secret and the connect key stay on the server.

## 1 - Choose the mode

The routes, the button and the calls are the same in both modes. Only what
the server keeps differs.

| | Key mode (default) | Token mode |
|---|---|---|
| Server keeps | one connect key for the app, one id per user | an access and a refresh token per user |
| Expires | nothing | yes; the app runs a daily refresh job |
| User revoked | next call throws `reconnect_required` | next refresh throws `refresh_failed` |
| Call outside the grant | `403`, `blockedByGrant: true` | `403`, `blockedByGrant` stays `false` |

Use **key mode** unless the human asks for token mode, the app needs the
bearer token itself, or the app already passes a `tokenStore`. Do not switch
an existing app from one mode to the other unless asked. Sections 2 to 9 are
key mode; section 10 lists what changes for token mode.

## 2 - Ask the human for these

They create the app in the One dashboard: Developers -> Connect -> New app.

| Value | Notes |
|---|---|
| `ONE_CLIENT_ID` | From the app. |
| `ONE_CLIENT_SECRET` | Starts with `one_secret_`. Shown once. |
| `ONE_CONNECT_KEY` | Key mode. On the app's page: Credentials -> Connect keys -> Create key, with the dashboard on Production. Shown once. |
| Redirect URI | Registered on the app. Must match the callback route exactly, e.g. `http://localhost:3000/api/one/callback`. |
| `ONE_PERMISSION_SET` | Optional. The app's Permission set ID: the tools and access levels to ask for. Without it, the consent page lists the user's connections and they choose. |

Never ask the human to paste the secret or the connect key into the chat.
Tell them which environment variable to set and read it from there.

## 3 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_CONNECT_KEY=sk_live_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback
ONE_PERMISSION_SET=...        # optional
```

## 4 - Install and create the client

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
    saveUser: async (userId, reference) => { /* save the string on the app's user row */ },
    loadUser: async (userId) => /* read it; null when never connected */,
    clearUser: async (userId) => { /* set it to null */ },
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

Optional settings: `returnTo` (where the callback sends the browser, `/` by
default) and `oneApiUrl` (One's API origin, production by default).

## 5 - The two routes

Next.js App Router (also Remix, SvelteKit, Hono, Bun):

```ts
// app/api/one/[action]/route.ts
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => /* the signed-in user's id, or null */,
  signInUrl: "/login",                                    // where signed-out users go; 401 when omitted
  loginHintFor: async (request) => /* their email, optional */,
  onComplete: ({ userId, result }) => { /* log result.outcome and, on failure, result.message */ },
});
```

`identifyUser` returns the id of the app's own signed-in user, from the
app's existing session. It is not the email: One's page signs the person
in to One with their email and a code; this id is which of the app's
accounts the grant is saved under, and the `userId` every later call
takes. `loginHintFor` only pre-fills that email. If the app has no
sign-in, ask the human what to use; for a throwaway demo, one fixed id
is fine.

Express, Fastify, Koa or plain Node: `createOneConnectHandlers(oneConnect,
options)` from `@withone/connect/node` takes the same options and returns
`{ authorize, callback }`, mounted at `/api/one/authorize` and
`/api/one/callback`. Both routes must share that directory: the state
cookie is scoped to it.

## 6 - The button

Pick by what the app already has. Each option uses the routes above.

**The ready-made button** (default):

```tsx
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  logos={["gmail", "stripe"]}       // connector slugs, decoration only
  connected={hasGrant}              // from the server: await oneConnect.isConnected(userId)
  onSuccess={() => { /* refetch app state */ }}
  onError={(message) => { /* show message */ }}
/>
```

Optional props: `variant` ("default" | "accent" | "block"), `size` ("sm" |
"md" | "lg"), `fullWidth`, `theme` ("light" | "dark" | "auto"),
`connectTheme` ("light" | "dark", One's page), `connector` (a slug such as
"gmail": One's page opens that connector's connect screen first, then the
usual list), `returnTo` (a path on the app this flow returns to), `label`,
`connectedLabel`, `description`, `disabled`, `onCancel`. The accent variant's colours come
from the host's `--one-connect-accent` and `--one-connect-accent-fg` CSS
variables.

Vue: `@withone/connect/vue`, same props. Svelte: `use:connectButton` from
`@withone/connect/svelte`. Anything else: `import "@withone/connect"` and use
`<one-connect-button authorize-url="/api/one/authorize" logos="gmail, stripe">`.

**The app's own button.** When the app has its own design system button,
keep it and wire the flow to it instead of adding a second style:

- React: `useOneConnect` from `@withone/connect/react`.

  ```tsx
  const { open, status, error } = useOneConnect({ authorizeUrl: "/api/one/authorize", onSuccess: refetch });
  <Button onClick={open} disabled={status === "connecting"}>Connect your tools</Button>
  ```

- Any other framework, or none: `createConnectFlow` from `@withone/connect`.
  Create it once where the button lives (Vue `onMounted`, Svelte `onMount`),
  call `flow.open()` on click, and `flow.destroy()` when the button goes.

  ```ts
  const flow = createConnectFlow({ authorizeUrl: "/api/one/authorize", onSuccess, onError, onCancel });
  button.addEventListener("click", () => flow.open());
  ```

- One connector at a time (a chat that says "Connect Gmail", a settings
  row): `useOneConnect({ authorizeUrl, connector: "gmail", returnTo: "/chat/42" })`.
  One's page still signs the user in and asks for the space, then opens
  Gmail's connect screen instead of the list; the list follows with
  everything connected. `returnTo` must be a path on the app.

- No SDK in the browser (server-rendered pages): a plain link,
  `<a href="/api/one/authorize">` (add `#one_connector=gmail` and
  `?one_return_to=%2Fchat%2F42` for the above). The user returns with
  `?one_connect=success`, or `?one_connect=error&one_connect_error=` with
  `declined`, `expired` or `failed`. Show the app's own text per code, never
  text from the URL, and remove the parameters after reading them.

Do not build a completion page; the callback redirect is the completion.

## 7 - Calling One with the grant

The same four steps the One CLI takes: list, find the action, read its
knowledge, run it. Always read the knowledge before running an action for
the first time; it names the required fields, the encoding and any header.

```ts
const connections = await oneConnect.listConnections(userId);                 // [{ key, platform, access }]
const [action] = await oneConnect.searchActions(userId, "stripe", "create an invoice");  // best first, 5 by default
const guide = await oneConnect.getActionKnowledge(userId, action._id);        // { knowledge (Markdown), ioSchema, method, path, tags }

const reply = await oneConnect.runAction(userId, {
  connectionKey: connection.key,
  actionId: action._id,
  body: payload,                              // what the guide asks for
  pathParams: { calendarId: "primary" },      // values for {{placeholders}} in the path
  query: { limit: "10" },
  encoding: "json",                           // or "form" / "multipart", as the guide says
  headers: {},                                // only when the guide names one
});
// { status, ok, blockedByGrant, data }
```

Each connection's `access` is `{ policy: "full" }`, `{ policy: "methods",
methods }` or `{ policy: "actions", actions }`; plan from it before calling.
`runAction` takes the method and path from the action, fills the path's
placeholders, puts the connection key in the body of an action One serves
itself (tag `custom`), and encodes the body as asked. `listActions(userId,
platform)` lists a whole catalog when search is not enough;
`oneConnect.fetch(userId, path, init)` reaches any other `/v1` endpoint.

Do not set any auth header. The package adds the connect key and the
user's id to every call it makes.

## 8 - Errors

A `403` reply with `blockedByGrant: true` means the call is outside what
the user granted. Do not retry it.

Errors are `OneConnectError` with a `code`. Handle them where the app calls One:

| `code` | Meaning | Do |
|---|---|---|
| `not_connected` | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | Key mode: One will not act for this user; they revoked access, or the app is deactivated. The stored value is kept. | Ask the user to connect again. |
| `refresh_failed` | Token mode: the grant is gone. The tokens are cleared. | Ask the user to connect again. |
| `request_failed` | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

```ts
import { OneConnectError } from "@withone/connect/server";

try {
  await oneConnect.runAction(userId, input);
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

`isConnected(userId)` says the user has connected before. One confirms the
consent on each call, so a user who revoked is found by the next call.

## 9 - Rules and done

Rules:

- Never put the client secret or the connect key in browser code, logs,
  error reports, source files or prompts. Environment variables only.
- Connect keys work in Production only; the human creates the key with
  the dashboard on Production.
- Store the per-user string as given.
- The registered redirect URI and `ONE_REDIRECT_URI` must be identical;
  otherwise One answers `invalid redirect_uri` and never shows its page.
- A flow that ends with `failed` is usually a wrong or rotated client
  secret; log `result.message` from `onComplete` to see why.
- Do not write OAuth steps or One request headers by hand; use the package.
- Never show `result.message` or any URL text to users; log it.

Done when:

1. The button leads to One's page; after signing in and authorizing, the user
   lands back in the app and `onSuccess` fires (or the app reads
   `?one_connect=success`).
2. One string is saved for the user.
3. `listConnections` returns only the granted connections.
4. `runAction` works for an action inside the grant and returns `403` with
   `blockedByGrant: true` for one outside it.
5. After the user revokes the app in their One dashboard, the next call
   fails with `reconnect_required` and the app asks them to connect again.

## 10 - Token mode (only when chosen in section 1)

The app stores an access token and a refresh token per user, as a standard
OAuth client. No `ONE_CONNECT_KEY` is needed; everything else above holds.

```ts
export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  tokenStore: {
    saveTokens: async (userId, tokens) => { /* save in the app's database, encrypted */ },
    loadTokens: async (userId) => /* read; null when never connected */,
    clearTokens: async (userId) => { /* delete */ },
  },
});

const accessToken = await oneConnect.getAccessToken(userId); // when the app needs the bearer token itself
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
