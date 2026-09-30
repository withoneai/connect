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

One Connect lets your users grant your app **scoped, revocable access to their own tools**: Gmail, Slack, Notion, Stripe and 500 more. The connections stay in your user's One account. Your app holds only what they granted, and One checks that on every call.

You add three things: a button, two backend routes, and the calls you make with the grant.

```
Browser                    Your server                          One
<ConnectButton>  ──────►   GET /api/one/authorize  ──302──►  hosted page: sign in, pick tools, set access
                           GET /api/one/callback   ◄──302──  ?code&state
                             saves one id for the user, redirects home
onSuccess()      ◄──────
later:                     oneConnect.runAction(userId, …)  ──►  One, grant enforced
```

## Install

```bash
npm install @withone/connect
```

Using a coding agent? `npx skills add withoneai/connect` teaches it the whole setup.

## 1 · Create your app in One

Dashboard → **Developers → Connect → New app**. Register your callback URL exactly, for example `https://yourapp.com/api/one/callback`. Optionally choose the tools and access levels to ask for; the consent page lists them in the order you add them.

Then, on the app's page, under **Credentials → Connect key**, create a key. It is shown once, and it is made for the environment your dashboard is on: switch the dashboard to Sandbox to create a Sandbox key.

```env
ONE_CLIENT_ID=…
ONE_CLIENT_SECRET=one_secret_…                        # server only
ONE_CONNECT_KEY=sk_live_…                             # server only: the app's connect key
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback  # exactly the registered URL
ONE_PERMISSION_SET=…                                  # optional: the tools you ask for
ONE_API_URL=https://api.withone.ai                    # optional: production when unset
```

## 2 · The button

```tsx
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  platforms={["gmail", "google-calendar", "stripe"]}
  connected={user.hasOneGrant}   // from your server
  onSuccess={() => refresh()}
  onError={(message) => showError(message)}
/>
```

| Prop | What it does |
|---|---|
| `authorizeUrl` | Your authorize route. Required. |
| `platforms` | Connector slugs to show as logos. |
| `connected` | Whether the user already has a grant, from your server. |
| `variant` | `default`, `accent` (your brand colour via `accentColor`), or `block` (a card with a `description`). |
| `size` | `sm`, `md` or `lg`. |
| `fullWidth` | Fills its container. |
| `theme` | `light`, `dark` or `auto`. `connectTheme` sets One's page. |
| `label` | Button text. |
| `disabled` | Not clickable. |
| `onSuccess` / `onError` / `onCancel` | How the flow ended. |

Other frameworks take the same props:

```vue
<ConnectButton authorize-url="/api/one/authorize" :platforms="['gmail']" @success="onConnected" />  <!-- @withone/connect/vue -->
```

```html
<one-connect-button authorize-url="/api/one/authorize" platforms="gmail, stripe"></one-connect-button>
<script type="module">import "@withone/connect";</script>
```

Svelte: `use:connectButton={{ authorizeUrl, platforms }}` from `@withone/connect/svelte`.

Your own button in React: `const { open, status } = useOneConnect({ authorizeUrl: "/api/one/authorize" })`.

To match your design, set `--one-connect-font` and `--one-connect-radius`, or style `::part(button)`.

## 3 · Choose a mode

Your server holds a user's grant in one of two ways. The button, the two routes and every call are the same in both. **The mode is whichever credential you configure.**

| | Key mode (default) | Token mode |
|---|---|---|
| Your server holds | one connect key for the app | nothing app-wide |
| You store per user | one id, saved once | an access token and a refresh token |
| Expires | nothing expires; One checks the consent on every call | the tokens expire, on the lifetime set on your app |
| Refreshing | none | the SDK does it; several servers need a shared lock |
| Pick it when | you call One from your own server. Start here. | you need a standard OAuth bearer token |

**Key mode**: pass the connect key and a place to save one value per user.

```ts
// lib/one.ts
import { createOneConnect } from "@withone/connect/server";

export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  oneApiUrl: process.env.ONE_API_URL,
  connectKey: process.env.ONE_CONNECT_KEY!,                 // ← this makes it key mode
  userStore: {
    saveUser: (userId, reference) => db.users.update(userId, { oneConnect: reference }),
    loadUser: async (userId) => (await db.users.find(userId))?.oneConnect ?? null,
    clearUser: (userId) => db.users.update(userId, { oneConnect: null }),
  },
});
```

`reference` is one short string: the user's permanent One id, plus the space they granted from. Save it in one column and hand it back. It is an identifier, not a secret, and it stays the same if the user disconnects and connects again.

**Token mode**: pass a token store instead.

```ts
export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  oneApiUrl: process.env.ONE_API_URL,
  tokenStore: {                                             // ← this makes it token mode
    saveTokens: (userId, tokens) => db.oneTokens.upsert(userId, tokens),
    loadTokens: (userId) => db.oneTokens.find(userId),
    clearTokens: (userId) => db.oneTokens.delete(userId),
  },
});
```

To be explicit, add `mode: "key"` or `mode: "token"`. `oneConnect.mode` tells you which one is running. An app written before key mode existed passes only a `tokenStore`, so it keeps running in token mode with no change.

## 4 · The two routes

The same file in both modes:

```ts
// app/api/one/[action]/route.ts   (Next.js; also Remix, SvelteKit, Hono, Bun)
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => (await getSession(request))?.userId ?? null,
});
```

That file serves `/api/one/authorize` and `/api/one/callback`. For Express or plain Node, use `createOneConnectHandlers` from `@withone/connect/node`.

## 5 · Using the grant

The same calls in both modes:

```ts
const connections = await oneConnect.listConnections(userId);   // what the user granted
const actions = await oneConnect.listActions(userId, "gmail");  // what a platform can do

const reply = await oneConnect.runAction(userId, {
  connectionKey: connections[0].key,
  actionId: actions[0]._id,
  method: actions[0].method,
  path: actions[0].path,
});
// { status, ok, blockedByGrant, data }
```

A `403` means the call is outside what the user granted. Don't retry it. In key mode `blockedByGrant` is `true` for those.

Errors are `OneConnectError` with a `code`:

| `code` | Mode | What it means | What to do |
|---|---|---|---|
| `not_connected` | both | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | key | One will not act for this user: they revoked access, or the app is deactivated. | Ask the user to connect again. Your stored value is kept. |
| `refresh_failed` | token | The grant ended (revoked or expired). The tokens were cleared. | Ask the user to connect again. |
| `request_failed` | both | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

## 6 · Key mode notes

- Keep the connect key on the server, in an environment variable. It is bound to your app and does nothing without a user's id.
- A key works in one environment. Use the Production key in production and the Sandbox key in sandbox; the wrong one refuses every user.
- `isConnected(userId)` says whether the user has connected before. One confirms the consent on each call, so a user who revoked is found by the next call throwing `reconnect_required`.
- `oneConnect.getConnectUserId(userId)` returns the user's One id (`cu_…`) if you want it for your own records.
- Lost or leaked a key? Create another on the app's page and delete the old one under **Developers → API keys**.

## 7 · Token mode notes

- Store the tokens in your database, encrypted, keyed by your user id. The SDK refreshes them for you.
- The access token lives as long as your app's **Token lifetime** says: 30 days unless you changed it under **Advanced** when creating or editing the app. The refresh token lives 30 days, and only a live refresh token can renew the pair.
- Running more than one server or a background worker? Add `withLock(userId, run)` to your token store, for example a Postgres advisory lock. Two servers refreshing at once would otherwise disconnect the user.
- Required: once a day, for each connected user, call `oneConnect.refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 })`. It renews both tokens when either is within 3 days of expiring. Without it, users have to connect again when the tokens run out. Keep the window shorter than your Token lifetime, or every run refreshes.
- `getAccessToken`, `getTokens`, `refreshTokens` and `refreshIfExpiring` exist in token mode only.

To ask for more tools later, edit your app's tools in the dashboard. Users see only the new ones the next time they connect.

## License

GPL-3.0. See [LICENSE](LICENSE).
