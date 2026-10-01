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

Then, on the app's page, under **Credentials → Connect keys**, create a key with your dashboard on Production. It is shown once.

```env
ONE_CLIENT_ID=…
ONE_CLIENT_SECRET=one_secret_…                        # server only
ONE_CONNECT_KEY=sk_live_…                             # server only
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback  # exactly the registered URL
ONE_PERMISSION_SET=…                                  # optional: the tools you ask for
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

## 3 · The server client

Your server holds one **connect key** for the app and saves one id per user who connects. Nothing expires and nothing is refreshed: One checks the user's consent on every call. This is **key mode**, the default.

```ts
// lib/one.ts
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

`reference` is one short string: the user's permanent One id, plus the space they granted from. Save it in one column and hand it back unchanged. It is an identifier, not a secret, and it stays the same if the user disconnects and connects again.

## 4 · The two routes

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

You never set a header: the client adds the connect key and the user's id to every call it makes.

A `403` with `blockedByGrant: true` means the call is outside what the user granted. Don't retry it.

Errors are `OneConnectError` with a `code`:

| `code` | What it means | What to do |
|---|---|---|
| `not_connected` | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | One will not act for this user: they revoked access, or the app is deactivated. Your stored value is kept. | Ask the user to connect again. |
| `request_failed` | One answered with an error or could not be reached. Nothing stored changed. | Retry later. |

## 6 · Key mode notes

- Keep the connect key on the server, in an environment variable. It is bound to your app and does nothing without a user's id.
- Connect keys work in Production only. Create the key with your dashboard on Production.
- `isConnected(userId)` says whether the user has connected before. One confirms the consent on each call, so a user who revoked is found by the next call throwing `reconnect_required`.
- `oneConnect.getConnectUserId(userId)` returns the user's One id (`cu_…`) if you want it for your own records.
- Lost or leaked a key? Create another on the app's page, move your servers to it, then revoke the old one there.

To ask for more tools later, edit your app's tools in the dashboard. Users see only the new ones the next time they connect.

## 7 · Token mode

The other way to hold a grant: your server stores an access token and a refresh token per user, as a standard OAuth client. The button, the routes and the calls stay the same. Use it when you need bearer tokens, or when the app already has them; an app that passes only a `tokenStore` keeps running in token mode with no change.

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
```

- Store the tokens in your database, encrypted, keyed by your user id.
- Running more than one server or a background worker? Add `withLock(userId, run)` to your token store, for example a Postgres advisory lock. Two servers refreshing at once would otherwise disconnect the user.
- When a user revokes access, the next refresh throws `refresh_failed` and the tokens are cleared. Ask them to connect again.
- A `403` means the call is outside what the user granted; `blockedByGrant` stays `false` in token mode.

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

The mode is whichever credential you pass: `connectKey` and `userStore` for key mode, `tokenStore` for token mode. `oneConnect.mode` tells you which one is running.

## License

GPL-3.0. See [LICENSE](LICENSE).
