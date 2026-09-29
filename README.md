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
                             stores the tokens, redirects home
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

```env
ONE_CLIENT_ID=…
ONE_CLIENT_SECRET=one_secret_…                        # server only
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

## 3 · The two routes

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
    saveTokens: (userId, tokens) => db.oneTokens.upsert(userId, tokens),
    loadTokens: (userId) => db.oneTokens.find(userId),
    clearTokens: (userId) => db.oneTokens.delete(userId),
  },
});
```

```ts
// app/api/one/[action]/route.ts   (Next.js; also Remix, SvelteKit, Hono, Bun)
import { createOneConnectRoutes } from "@withone/connect/next";
import { oneConnect } from "@/lib/one";

export const { GET } = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => (await getSession(request))?.userId ?? null,
});
```

That file serves `/api/one/authorize` and `/api/one/callback`. For Express or plain Node, use `createOneConnectHandlers` from `@withone/connect/node`.

## 4 · Using the grant

```ts
const connections = await oneConnect.listConnections(userId);   // what the user granted
const actions = await oneConnect.listActions(userId, "gmail");  // what a platform can do

const reply = await oneConnect.runAction(userId, {
  connectionKey: connections[0].key,
  actionId: actions[0]._id,
  method: actions[0].method,
  path: actions[0].path,
});
// { status, ok, data }
```

A `403` means the call is outside what the user granted. Don't retry it.

## 5 · Tokens

- Store them in your database, encrypted, keyed by your user id. The SDK refreshes them for you.
- Running more than one server or a background worker? Add `withLock(userId, run)` to your token store, for example a Postgres advisory lock. Two servers refreshing at once would otherwise disconnect the user.
- Keep idle users connected: once a day, call `oneConnect.refreshIfExpiring(userId, { withinMs: 7 * 24 * 3_600_000 })`.
- A `refresh_failed` error means the grant ended (revoked or expired). Ask the user to connect again.

To ask for more tools later, edit your app's tools in the dashboard. Users see only the new ones the next time they connect.

## License

GPL-3.0. See [LICENSE](LICENSE).
