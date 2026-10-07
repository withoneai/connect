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
  <a href="https://withone.ai/products/connect"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.withone.ai%2Fv1%2Favailable-connectors%3Flimit%3D1&query=%24.total&label=connectors" alt="Live count of connectors on One"></a>
</p>

One Connect lets your users grant your app **scoped, revocable access to their own tools**: Gmail, Slack, Notion, Stripe and 900+ more. The connections stay in your user's One account. Your app holds only what they granted, and One checks that on every call.

You add three things: a button, two backend routes, and the calls you make with the grant.

```
Browser                    Your server                          One
<ConnectButton>  ──────►   GET /api/one/authorize  ──302──►  hosted page: sign in, pick tools, set access
                           GET /api/one/callback   ◄──302──  ?code&state
                             saves the grant for the user, redirects home
onSuccess()      ◄──────
later:                     oneConnect.runAction(userId, …)  ──►  One, grant enforced
```

## Contents

- [Choose how your server holds the grant](#choose-how-your-server-holds-the-grant)
- [Install](#install)
- [1 · Create your app in One](#1--create-your-app-in-one)
- [2 · The server client](#2--the-server-client)
- [3 · The two routes](#3--the-two-routes)
- [4 · The button](#4--the-button), including [your own button](#your-own-button)
- [5 · Using the grant](#5--using-the-grant)
- [6 · Errors](#6--errors)
- [7 · Token mode](#7--token-mode)
- [Security](#security) · [Troubleshooting](#troubleshooting) · [Supported versions](#supported-versions) · [API reference](#api-reference) · [Support](#support)

## Choose how your server holds the grant

The button, the routes and the calls are the same either way. Only what your server keeps differs.

| | **Key mode** (default, recommended) | **Token mode** |
|---|---|---|
| Your server keeps | One connect key for the app, and one id per user | An access token and a refresh token per user |
| Expires | Nothing | The access token per your app's Token lifetime; the refresh token after 30 days |
| You also run | Nothing | A daily refresh job |
| When a user revokes | The next call throws `reconnect_required` | The next refresh throws `refresh_failed` |
| A call outside the grant | `403` with `blockedByGrant: true` | `403` (`blockedByGrant` stays `false`) |
| Pick it when | You are starting out | You need the bearer token itself, or your app already stores tokens |

The mode is the credential you pass to `createOneConnect`: `connectKey` and `userStore` for key mode, `tokenStore` for token mode. Sections 1 to 6 use key mode; [section 7](#7--token-mode) shows what changes for token mode.

## Install

```bash
npm install @withone/connect
```

Using a coding agent? `npx skills add withoneai/connect` (or `one skills add connect` with the [One CLI](https://github.com/withoneai/cli)) teaches it the whole setup.

## 1 · Create your app in One

1. Dashboard → **Developers → Connect → New app**. Register your callback URL exactly, for example `https://yourapp.com/api/one/callback`.
2. Choose what the app asks for. A **permission set** names the tools and the access level for each; users can narrow it on the consent page, never widen it. Copy its **Permission set ID**. Without one, the consent page lists the user's connections and they choose.
3. Key mode: on the app's page, under **Credentials → Connect keys**, create a key with the dashboard on Production. It is shown once.

```env
ONE_CLIENT_ID=…
ONE_CLIENT_SECRET=one_secret_…                        # server only
ONE_CONNECT_KEY=sk_live_…                             # server only; key mode
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback  # exactly the registered URL
ONE_PERMISSION_SET=…                                  # optional: the Permission set ID
```

## 2 · The server client

Your server holds one **connect key** for the app and saves one id per user who connects. Nothing expires and nothing is refreshed: One checks the user's consent on every call.

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
    saveUser: (userId, reference) => db.users.update(userId, { oneConnect: reference }),
    loadUser: async (userId) => (await db.users.find(userId))?.oneConnect ?? null,
    clearUser: (userId) => db.users.update(userId, { oneConnect: null }),
  },
});
```

`userId` is your app's own id for the user. `reference` is one short string: the user's permanent One id, plus the space they granted from. Save it in one column and hand it back unchanged. It is an identifier, not a secret, and it stays the same if the user disconnects and connects again.

## 3 · The two routes

```ts
// app/api/one/[action]/route.ts   (Next.js; also Remix, SvelteKit, Hono, Bun)
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => (await getSession(request))?.userId ?? null,
  signInUrl: "/login",                                               // optional: where signed-out users go
  loginHintFor: async (request) => (await getSession(request))?.email ?? null, // optional: pre-fills One's sign-in
});
```

`identifyUser` answers one question: which of **your** app's users clicked Connect? Return the id from your own session. One's page then signs the person in to **One** with their email and a code. Those are two different accounts, and the callback joins them:

```
your session   ── identifyUser ──►  "user_123"     which of your users is this?
One's page     ── email + code ──►  Maya on One    whose tools are these?
callback       ── saves Maya's grant on user_123 ──►  later: runAction("user_123", …)
```

`loginHintFor` only pre-fills the email on One's page. Nobody signed in? `identifyUser` returns null and the route sends them to `signInUrl` (or answers `401`).

That file serves `/api/one/authorize` and `/api/one/callback`. For Express, Fastify, Koa or plain Node, `createOneConnectHandlers` from `@withone/connect/node` takes the same options and returns `{ authorize, callback }` to mount on those two paths.

## 4 · The button

```tsx
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  logos={["gmail", "google-calendar", "stripe"]}
  connected={user.hasOneGrant}   // from your server: await oneConnect.isConnected(userId)
  onSuccess={() => refresh()}
  onError={(message) => showError(message)}
/>
```

| Prop | What it does |
|---|---|
| `authorizeUrl` | Your authorize route. Required. |
| `logos` | Connector slugs to draw as logos. Decoration only; your permission set decides what One asks for. |
| `connected` | Whether the user already has a grant, from your server. |
| `variant` | `default`, `accent` (your brand colour, set with `--one-connect-accent` and `--one-connect-accent-fg`), or `block` (a card with a `description`). |
| `size` | `sm`, `md` or `lg`. |
| `fullWidth` | Fills its container. |
| `theme` | `light`, `dark` or `auto`. `connectTheme` sets One's page. |
| `connector` | A connector slug (`gmail`). One's page opens that connector's connect screen first, then the usual list. |
| `returnTo` | Where this flow returns to: a path on your app, such as `/chat/42`. Overrides the server's `returnTo` for this flow only. |
| `label` / `connectedLabel` | Button text, and the text once connected. |
| `disabled` | Not clickable. |
| `onSuccess` / `onError` / `onCancel` | How the flow ended. |

Other frameworks take the same props:

```vue
<ConnectButton authorize-url="/api/one/authorize" :logos="['gmail']" @success="onConnected" />  <!-- @withone/connect/vue -->
```

```html
<one-connect-button authorize-url="/api/one/authorize" logos="gmail, stripe"></one-connect-button>
<script type="module">import "@withone/connect";</script>
```

Svelte: `use:connectButton={{ authorizeUrl, logos }}` from `@withone/connect/svelte`.

To match your design, set `--one-connect-font`, `--one-connect-radius`, `--one-connect-accent` and `--one-connect-accent-fg` on the host, or style `::part(button)`.

### Your own button

The flow is a full-page redirect to your authorize route, so any element can start it. Your routes and your server stay exactly as above. Choose the level that fits:

| | You get | You handle |
|---|---|---|
| **React** · `useOneConnect` | `open`, a `status`, the outcome | Your element |
| **Any framework** · `createConnectFlow` | `open`, the outcome as callbacks | Your element and its states |
| **No SDK in the browser** | Nothing | Reading the outcome off the URL |

**React.** `useOneConnect` from `@withone/connect/react`:

```tsx
import { useOneConnect } from "@withone/connect/react";

const { open, status, error } = useOneConnect({
  authorizeUrl: "/api/one/authorize",
  onSuccess: () => refresh(),
});

<button onClick={open} disabled={status === "connecting"}>Connect your tools</button>
{error && <p role="alert">{error.message}</p>}
```

`status` is `idle`, `connecting`, `connected` or `error`; `connected` and `error` describe how this page load ended a flow.

**Any framework.** `createConnectFlow` from `@withone/connect` is a plain function, so it works in Vue, Svelte, Angular or no framework at all. Create it once where your button lives and destroy it when the button goes:

```ts
import { createConnectFlow } from "@withone/connect";

const flow = createConnectFlow({
  authorizeUrl: "/api/one/authorize",
  onSuccess: () => refresh(),
  onError: (message, code) => showError(message),
  onCancel: () => resetButton(),         // the user came back with the Back button
});

button.addEventListener("click", () => flow.open());
// later, when the button is removed: flow.destroy()
```

In Vue, create it in `onMounted` and destroy it in `onUnmounted`; in Svelte, in `onMount` and its returned cleanup. `flow.update(options)` swaps the callbacks without losing the flow. Both helpers read the outcome once per page load, deliver it to the first flow still mounted, and clean the address bar so a refresh does not repeat it.

**No SDK in the browser.** Link to your authorize route:

```html
<a href="/api/one/authorize">Connect your tools</a>
```

The user lands back on your `returnTo` page (`/` unless you set it) with the outcome in the query string:

| Query | Meaning |
|---|---|
| `?one_connect=success` | Connected. Refetch from your server. |
| `?one_connect=error&one_connect_error=declined` | The user cancelled on One's page. |
| `?one_connect=error&one_connect_error=expired` | The attempt took too long, or was started elsewhere. |
| `?one_connect=error&one_connect_error=failed` | One could not complete the connection. |

Show your own text for each code and never text taken from the URL, since anyone can craft a link. Remove the parameters after reading them so a refresh does not repeat the message. To theme One's page, add `#one_theme=dark` or `#one_theme=light` to the link.

### One connector first

A chat or a settings page often needs a single tool connected now, not the whole list. Pass `connector`, and `returnTo` when the flow must come back to the page it started on:

```tsx
const { open } = useOneConnect({
  authorizeUrl: "/api/one/authorize",
  connector: "gmail",
  returnTo: "/chat/42",
});

<button onClick={open}>Connect Gmail</button>
```

One's page still signs the user in and asks for the space. Then, instead of the list, it opens Gmail's connect screen straight away. The list follows with everything the user has connected, so they confirm the whole grant as always.

- `connector` is a slug from One's catalog (`gmail`, `google-calendar`, `stripe`). A slug your permission set does not offer, or one the user already connected in that space, is ignored and the page opens on the list.
- `returnTo` must be a path on your app. Anything else is ignored and the server's `returnTo` applies.
- Both work the same on `ConnectButton`, `createConnectFlow` and a plain link: `<a href="/api/one/authorize?one_return_to=%2Fchat%2F42#one_connector=gmail">`.

## 5 · Using the grant

Work the way the One CLI does: find the action, read its knowledge, run it.

```ts
// 1. what the user granted, with the connection key per tool
const connections = await oneConnect.listConnections(userId);
const stripe = connections.find((c) => c.platform === "stripe");

// 2. the actions that fit what you want to do, best first
const [action] = await oneConnect.searchActions(userId, "stripe", "list invoice items");

// 3. the action's guide: what it does, every field it takes, what it answers
const guide = await oneConnect.getActionKnowledge(userId, action._id);
console.log(guide.knowledge);   // Markdown

// 4. run it: the method and path come from the action; you pass the input
const reply = await oneConnect.runAction(userId, {
  connectionKey: stripe.key,
  actionId: action._id,
  body: { limit: 10 },
});
// { status, ok, blockedByGrant, data }
```

Each connection carries its `access`: `{ policy: "full" }`, `{ policy: "methods", methods }` or `{ policy: "actions", actions }`. Plan from it before you call.

`runAction` does what the guide asks for: it fills `{{placeholders}}` in the path from `pathParams`, puts the connection key in the body of an action One serves itself, and sends the body the way the provider reads it.

```ts
await oneConnect.runAction(userId, {
  connectionKey: calendar.key,
  actionId: action._id,
  pathParams: { calendarId: "primary" },          // for a path like /calendars/{{calendarId}}/events
  query: { maxResults: "10" },
  body: { summary: "Call" },
  encoding: "form",                               // when the guide says x-www-form-urlencoded; "multipart" for uploads
  headers: { "Notion-Version": "2022-06-28" },    // when the guide names a header
});
```

`listActions(userId, platform)` lists everything a platform can do, and `runAction` takes `method` and `path` from it if you'd rather pass them yourself. `oneConnect.fetch(userId, path, init)` sends any other request to One's `/v1` API with the headers handled.

You never set an auth header: the client adds the connect key and the user's id to every call it makes.

## 6 · Errors

A `403` with `blockedByGrant: true` means the call is outside what the user granted. The provider was never called; don't retry it.

Everything else is a `OneConnectError` with a `code`:

| `code` | What it means | What to do |
|---|---|---|
| `not_connected` | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | Key mode: One will not act for this user. They revoked access, or the app is deactivated. Your stored value is kept. | Ask the user to connect again. |
| `refresh_failed` | Token mode: the grant is gone (revoked or expired). The tokens are cleared. | Ask the user to connect again. |
| `request_failed` | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

```ts
import { OneConnectError } from "@withone/connect/server";

try {
  await oneConnect.runAction(userId, input);
} catch (error) {
  if (error instanceof OneConnectError && ["not_connected", "reconnect_required", "refresh_failed"].includes(error.code)) {
    // show the Connect button again
  } else {
    throw error;
  }
}
```

`isConnected(userId)` says whether the user has connected before. One confirms the consent on each call, so a user who revoked is found by the next call. `disconnect(userId)` drops your app's copy; the user revokes the grant itself from their One dashboard.

## 7 · Token mode

Your server stores an access token and a refresh token per user, as a standard OAuth client. The button, the routes and the calls stay the same, and no `ONE_CONNECT_KEY` is needed. An app that passes only a `tokenStore` keeps running in token mode with no change.

```ts
export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  tokenStore: {
    saveTokens: (userId, tokens) => db.oneTokens.upsert(userId, tokens),
    loadTokens: (userId) => db.oneTokens.find(userId),
    clearTokens: (userId) => db.oneTokens.delete(userId),
  },
});

const accessToken = await oneConnect.getAccessToken(userId);   // a live bearer token, refreshed first if it is about to expire
```

- Store the tokens in your database, encrypted, keyed by your user id.
- Running more than one server or a background worker? Add `withLock(userId, run)` to your token store, for example a Postgres advisory lock. Two servers refreshing at once would otherwise disconnect the user.
- `getTokens(userId)` reads the stored pair; `refreshTokens(userId)` refreshes now.

**Keeping users connected.** Tokens expire, and two things keep them fresh. One is automatic. The other is yours to run.

| | Who does it | When |
|---|---|---|
| Refresh before a call | the client, on its own | whenever you call One and the token is about to expire |
| Refresh for users who have not called in a while | **you**, with a daily job | once a day, for every connected user |

```ts
// run once a day
for (const userId of await db.oneTokens.allUserIds()) {
  await oneConnect.refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 });
}
```

The job renews both tokens when either is within 3 days of expiring. Without it, a user who stays away for 30 days has to connect again: the refresh token lives 30 days, and only a live refresh token can renew the pair. The access token lives as long as your app's **Token lifetime** says (30 days unless you changed it under **Advanced**); keep the job's window shorter than that, or every run refreshes.

## Security

- **Secrets stay on the server.** The client secret and the connect key live in environment variables, never in browser code, logs, error reports or source control.
- **A connect key is bound to your app** and does nothing without a user's id. Connect keys work in Production only. Lost or leaked one? Create another on the app's page, move your servers to it, then revoke the old one there.
- **The per-user reference is not a secret.** In token mode the tokens are, so store them encrypted.
- **The callback is protected for you.** Each attempt carries a fresh `state` and a PKCE verifier in an HttpOnly cookie scoped to your routes; a callback without them is refused as `expired`, and the code is never exchanged.
- **Failure text is never taken from the URL.** The browser shows fixed text for `declined`, `expired` and `failed`.
- **Users stay in control.** They narrow or revoke from their One dashboard at any time, and One applies it on the next call.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Signed-out users see "Sign in to your account before connecting One." | `identifyUser` returned null. Set `signInUrl` to send them to your sign-in page. |
| Every attempt ends with `expired` | The state cookie did not reach the callback. Serve both routes from the same directory (`/api/one/authorize` and `/api/one/callback`) on the origin of `ONE_REDIRECT_URI`. An attempt also expires after 30 minutes. |
| One answers `invalid redirect_uri` instead of showing its page | `ONE_REDIRECT_URI` is not registered on the app character for character (scheme, host, port, path). Register it, or fix the variable. |
| Every attempt ends with `failed` | One refused the code exchange, most often because the client secret is wrong or was rotated. Log `result.message` with `onComplete` on the routes to see the reason. |
| Every call fails with `request_failed`: "One did not accept the connect key" | The key is not this app's, or it was revoked. Create a key on the app's page and update `ONE_CONNECT_KEY`. |
| Every user's calls throw `reconnect_required` | The app is deactivated. Check that it is active in the dashboard. |
| A call returns `403` with `blockedByGrant: true` | The action is outside what the user granted. Ask for it in your permission set; users see new tools the next time they connect. |

## Supported versions

| | |
|---|---|
| Node.js | 18 or later |
| React | 17 or later (optional peer dependency) |
| Vue | 3 or later (optional peer dependency) |
| Svelte | 3 or later (the `use:` action); no peer dependency |
| `@withone/connect/next` | Any server with web `Request` and `Response`: Next.js App Router, Remix, SvelteKit, Hono, Bun |
| `@withone/connect/node` | Node's `http` request and response: Express, Fastify (`reply.raw`), Koa (`ctx.req`/`ctx.res`), plain Node |
| Browsers | Any browser with Shadow DOM and custom elements; the build targets `> 0.25%, not dead` |

**Versioning.** Until 1.0, a minor version may remove an API that an earlier minor deprecated; every deprecation is marked in the types and in the [release notes](CHANGELOG.md), and stays for at least one minor. Patch versions only fix bugs or docs.

## API reference

### `createOneConnect(config)` · `@withone/connect/server`

| Option | |
|---|---|
| `clientId`, `clientSecret`, `redirectUri` | From your app. Required. |
| `connectKey` + `userStore` | Key mode. `userStore` is `{ saveUser, loadUser, clearUser }`. |
| `tokenStore` | Token mode: `{ saveTokens, loadTokens, clearTokens, withLock? }`. |
| `mode` | `"key"` or `"token"`, to state the mode explicitly. |
| `permissionSet` | The Permission set ID to ask for. |
| `returnTo` | Where the callback sends the browser afterwards. `/` by default. |
| `scopes` | OAuth scopes. All three spaces (personal, organization, project) by default, so the user may grant from any. |
| `oneApiUrl` | One's API origin. Production by default. |

| Method | Mode | |
|---|---|---|
| `listConnections(userId)` | both | The connections the grant reaches, each with its `access`. |
| `searchActions(userId, platform, query, { limit?, mode? })` | both | Best matches first, 5 by default. `mode` is `"execute"` or `"knowledge"`. |
| `getActionKnowledge(userId, actionId)` | both | The action's guide, input shape, method and path. |
| `listActions(userId, platform)` | both | Every action of a platform. |
| `runAction(userId, input)` | both | Runs an action with the grant. |
| `fetch(userId, path, init?)` | both | Any request to One's `/v1` API, headers handled. |
| `isConnected(userId)` / `disconnect(userId)` | both | Whether something is stored; drop it. |
| `startAuthorization` / `completeAuthorization` | both | The two legs, for servers that don't use the route adapters. |
| `getConnectUserId(userId)` | key | The user's One id (`cu_…`), or null. |
| `getAccessToken` / `getTokens` / `refreshTokens` / `refreshIfExpiring` | token | Tokens, kept fresh. |
| `mode` | both | `"key"` or `"token"`. |

### Routes · `@withone/connect/next` and `@withone/connect/node`

`createOneConnectRoutes(oneConnect, options)` returns `{ GET }`; `createOneConnectHandlers(oneConnect, options)` returns `{ authorize, callback }`.

| Option | |
|---|---|
| `identifyUser(request)` | Your signed-in user's id, or null. Required. |
| `signInUrl` | Where signed-out users go. Answers `401` when omitted. |
| `loginHintFor(request)` | Pre-fills the email on One's sign-in. |
| `onComplete({ userId, result })` | Called after every callback with `result.outcome` and, on failure, `result.code` and `result.message`. For logs; never show the message to users. |

### Browser · `@withone/connect`, `/react`, `/vue`, `/svelte`

| Export | |
|---|---|
| `ConnectButton` (React, Vue), `connectButton` (Svelte), `<one-connect-button>` | The button. |
| `mountConnectButton(element, props)` | The button without a framework; returns `{ update, destroy }`. |
| `useOneConnect(options)` · `/react` | Your own button in React. |
| `createConnectFlow(options)` | Your own button anywhere. |
| `readConnectReturn()` | How this page load ended a flow, or null. |

`useOneConnect` and `createConnectFlow` take `authorizeUrl`, `connectTheme`, `connector`, `returnTo`, `onSuccess`, `onError` and `onCancel`.

## Support

- Bugs and questions: [GitHub issues](https://github.com/withoneai/connect/issues).
- Security issues: see [SECURITY.md](SECURITY.md). Please don't open a public issue.
- Everything else: hello@withone.ai.

## License

GPL-3.0. See [LICENSE](LICENSE).
