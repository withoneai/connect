# The button, in full

Read this for anything past the ready-made React button in section 6 of
`SKILL.md`. Every option here uses the same two routes.

## Props

One prop shape for React, Vue, Svelte, the web component and
`mountConnectButton`.

| Prop | What it does |
|---|---|
| `authorizeUrl` | The app's authorize route. Required. |
| `logos` | Connector slugs to draw as logos, or `{ slug, name, imageUrl }` to override one. The first three draw; the rest fold into a "+N" chip. Decoration only: the permission set decides what One asks for. |
| `connected` | Whether the user has a grant, from the server. When omitted, the button shows Connected only right after a successful return. |
| `variant` | `default`, `accent` (the app's brand colour) or `block` (a card with a `description`). Setting `accent` alone picks `accent`. |
| `accent` / `accentText` | The brand colour (`"#F4A938"`) and the text on it. Leave `accentText` out with a hex `accent` and the button picks white or dark text, whichever reads. |
| `size` | `sm`, `md` (default) or `lg`. |
| `fullWidth` | Fills its container. |
| `theme` | `light` (default), `dark` or `auto`. `connectTheme` (`light` or `dark`) sets One's page. |
| `openApp` | An app's slug. See "One app first". |
| `returnTo` | A path on the app this flow returns to. See "One app first". |
| `label` / `connectedLabel` | "Connect your apps" and "Connected" unless set. |
| `description` | The sub-line on the block variant. |
| `disabled` | Not clickable. |
| `onSuccess` / `onError(message, code)` / `onCancel` | How the flow ended. `message` is fixed text for `code`, safe to show. `onCancel` fires when the user comes back with the Back button. |

Styling. The button lives in a shadow root, so the page's CSS does not reach
it. Set `--one-connect-font` and `--one-connect-radius` on the host, or
style `::part(button)` and `::part(label)`. The host is `one-connect-button`,
or `.one-connect` for the React, Vue and Svelte wrappers (React also takes
`className` and `style` for it). `--one-connect-accent` and
`--one-connect-accent-fg` still work; the props win when both are set. Under
a strict Content Security Policy, allow `https://assets.withone.ai` in
`img-src` for the logos.

## Vue, Svelte, the web component, no framework

```vue
<script setup>
import { ConnectButton } from "@withone/connect/vue";
</script>

<template>
  <ConnectButton authorize-url="/api/one/authorize" :logos="['gmail']" @success="onConnected" @error="(message, code) => showError(message)" />
</template>
```

Vue emits `success`, `error` (with `message` and `code`) and `cancel`.

```svelte
<script>
  import { connectButton } from "@withone/connect/svelte";
</script>

<div use:connectButton={{ authorizeUrl: "/api/one/authorize", logos: ["stripe", "notion"], onSuccess: () => refetch() }} />
```

```html
<one-connect-button authorize-url="/api/one/authorize" logos="gmail, stripe"></one-connect-button>
```

```ts
import "@withone/connect";   // registers the element; import it through the app's bundler
```

- Its attributes are the props in kebab case: `authorize-url`, `logos`,
  `variant`, `size`, `theme`, `connect-theme`, `open-app`, `return-to`,
  `label`, `connected-label`, `description`, `accent`, `accent-text`.
- `connected`, `disabled` and `full-width` are boolean attributes: present
  means true, except the literal `"false"`.
- `logos` is a comma list of slugs, or a JSON array for overrides.
- It fires `success`, `error` (`event.detail` is `{ message, code }`) and
  `cancel`, and also calls `onSuccess`, `onError` and `onCancel` when they
  are set as properties.
- Without `authorize-url` it draws nothing.

No framework and no custom element: `mountConnectButton(element, props)`
from `@withone/connect` puts the button in `element` and returns
`{ update, destroy }`.

## The app's own button, in any framework

`createConnectFlow` from `@withone/connect` is a plain function. Create it
once where the button lives and destroy it when the button goes.

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

In Vue, create it in `onMounted` and destroy it in `onUnmounted`; in Svelte,
in `onMount` and its returned cleanup. `flow.update(options)` swaps the
callbacks without losing the flow. It takes `authorizeUrl`, `connectTheme`,
`openApp`, `returnTo`, `onSuccess`, `onError` and `onCancel`, as does
`useOneConnect`.

## One app first

A chat that says "Connect Gmail" or a settings row needs a single app
connected now, not the whole list. Pass `openApp`, and `returnTo` when the
flow must come back to the page it started on.

```tsx
const { open } = useOneConnect({ authorizeUrl: "/api/one/authorize", openApp: "gmail", returnTo: "/chat/42" });
<Button onClick={open}>Connect Gmail</Button>
```

One's page still signs the user in and asks for the space. Then:

| The user's app | One's page opens |
|---|---|
| Not connected yet | Its connect screen. The list follows with everything the user has connected. |
| Already connected | The list, with that app first and expanded. |

Either way the user confirms the whole grant as always.

- `openApp` is a slug from One's catalog (`gmail`, `google-calendar`). An
  app that asks for everything can open any app in the catalog; an app that
  asks for specific apps can open only one it asks for. A slug outside that
  is ignored and the page opens on the list.
- `connector` is the old name of `openApp`. It still works.
- Pass `returnTo` as a path like `/chat/42`, never a full URL. A full URL
  (`https://yourapp.com/chat/42`), or a path over 512 characters, is ignored
  and the user lands on the server's `returnTo`. The path is joined to the
  site of the redirect URI, so the same value works on localhost and in
  production.

## A Manage button for each app

On a settings page, show one Manage button per app the user granted. Each
opens One's page on that app, where the user changes its access, adds
another account of it, or turns it off. `listConnections` returns one row
per account, so group by `platform`.

```tsx
// server
const connections = await oneConnect.listConnections(userId);
const apps = [...new Map(connections.map((c) => [c.platform, c.title ?? c.platform] as const))];

// client, one per app
const { open, status } = useOneConnect({ authorizeUrl: "/api/one/authorize", openApp: platform, returnTo: "/settings", onSuccess: refetch });
<Button onClick={open} disabled={status === "connecting"}>Manage {title}</Button>
```

After the user finishes, read `listConnections` again for the new access
and any added account. The package saves the user's string again by itself.
Narrower access applies from the next call. Cancelling changes nothing. The
ready-made button works too: `openApp={platform}`, `connected` and
`connectedLabel="Manage"`.

## A plain link, with no SDK in the browser

For server-rendered pages, link to the authorize route.

```html
<a href="/api/one/authorize">Connect your tools</a>
<a href="/api/one/authorize?one_return_to=%2Fchat%2F42#one_open_app=gmail">Connect Gmail</a>
```

The query (`?one_return_to=`) comes before the fragment (`#one_open_app=`).
Add `one_theme=dark` or `one_theme=light` to the fragment to theme One's
page. The user lands back on `returnTo` with the outcome in the query string:

| Query | Meaning |
|---|---|
| `?one_connect=success` | Connected. Refetch from the server. |
| `?one_connect=error&one_connect_error=declined` | The user cancelled on One's page. |
| `?one_connect=error&one_connect_error=expired` | The attempt took too long, or was started elsewhere. |
| `?one_connect=error&one_connect_error=failed` | One could not complete the connection. |

Show the app's own text for each code, never text taken from the URL, since
anyone can craft a link. Remove the parameters after reading them, so a
refresh does not repeat the message.

## Reading the outcome

The outcome belongs to the page load, not to one button. The helpers
(`ConnectButton`, `useOneConnect`, `createConnectFlow`) read it once, fire
`onSuccess` or `onError` on the first flow still mounted when the tab
returns, and clean the address bar themselves. Any other code can read the
same answer with `readConnectReturn()` from `@withone/connect`:
`{ status: "success" }`, `{ status: "error", code, message }`, or null when
this page load did not end a flow.
