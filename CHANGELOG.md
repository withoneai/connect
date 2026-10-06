# Changelog

Every release of `@withone/connect`. Until 1.0, a minor version may remove APIs an earlier minor deprecated; patch versions only fix bugs or docs.

## 0.16.1 · 2026-10-06

Docs only; no code changes.

- README and skill explain what `identifyUser` is: your app's own signed-in user, not the email One's page asks for.
- Troubleshooting: a redirect URI that is not registered makes One answer `invalid redirect_uri` before its page; `failed` most often means a wrong or rotated client secret.
- New Supported versions (Node, React, Vue, Svelte, server runtimes, browsers, versioning policy) and Support sections.
- New SECURITY.md and this changelog.

## 0.16.0 · 2026-10-06

### Docs
- **Choose your mode first.** Key mode and token mode are compared side by side, near the top of the README and the skill.
- **Your own button**, in the button section:
  - React: `useOneConnect`
  - any framework: `createConnectFlow`
  - no SDK in the browser: a plain link + the `?one_connect=` return params
- New **Security**, **Troubleshooting** and **API reference** sections. Every public option and method is now documented.
- Permission set is described as the dashboard's **Permission set ID**.
- Live connector-count badge.

### Fixes
- **Node adapter (`@withone/connect/node`):** concurrent `/authorize` requests could pre-fill one user's email on another user's One sign-in page when `loginHintFor` was set. Each request now keeps its own context.

### New
- `onComplete({ userId, result })` on `createOneConnectRoutes` and `createOneConnectHandlers`: log why a connection failed. The browser only ever gets a code.

### Breaking (deprecated since 0.12)
- Removed the root-entry aliases `useOneConnect`, `OneConnectOptions` and `OneConnectHandle`. Use `createConnectFlow` / `OneConnectFlowOptions` / `OneConnectFlow`. `useOneConnect` from `@withone/connect/react` is unchanged.

## 0.15.0 · 2026-10-01

### The button's props, trimmed

- **`logos` replaces `platforms`.** The list only ever drew logos on the button; the old name read as if it chose which tools One asks for. What One asks for comes from your app's permission set. `platforms` still works in this release, marked deprecated, and is removed in the next minor. The types `ConnectButtonLogoInput` and `ConnectButtonLogo` replace the `…Platform…` names, which remain as deprecated aliases.
- **`accentColor` is removed.** The accent variant takes its colours from two CSS variables on the host, which already existed: `--one-connect-accent` (the fill) and `--one-connect-accent-fg` (the text). One way to style it, not two.
- **`appTheme` is removed.** It was deprecated in 0.12; use `connectTheme`.

The same applies to Vue, Svelte and `<one-connect-button>` (`logos` attribute; `app-theme` and `accent-color` are no longer read).

### Upgrading

```diff
- <ConnectButton platforms={["gmail"]} variant="accent" accentColor="#1B2A5C" appTheme="dark" />
+ <ConnectButton logos={["gmail"]} variant="accent" connectTheme="dark" style={{ "--one-connect-accent": "#1B2A5C", "--one-connect-accent-fg": "#fff" }} />
```

Removing `accentColor` and `appTheme` is the breaking change behind the minor bump. If your coding agent installed the skill, refresh it with `npx skills add withoneai/connect`.

## 0.14.0 · 2026-10-01

### Actions: find, read, run, the way the One CLI does

Works the same in key mode and token mode.

- **`searchActions(userId, platform, query, { limit, mode })`**: the actions that fit a request in words, best first, five by default. `listActions` still lists a whole catalog.
- **`getActionKnowledge(userId, actionId)`**: the action's guide (Markdown), its input schema, method, path and tags. Read it before running an action for the first time. Cached per client.
- **`runAction` finishes the request for you.** Pass `actionId` and the input; the method and path come from the action, `{{placeholders}}` are filled from `pathParams`, an action One serves itself gets the connection key in its body, and the body goes as `json`, `form` (bracket notation) or `multipart` per `encoding`. Extra `headers` are carried. Calls that pass `method` and `path` keep working unchanged.

```ts
const [action] = await oneConnect.searchActions(userId, "stripe", "list invoice items");
const guide = await oneConnect.getActionKnowledge(userId, action._id);
const reply = await oneConnect.runAction(userId, { connectionKey, actionId: action._id, body: { limit: 10 } });
```

Also exported: `fillPath`, `formEncode`. New types: `ActionKnowledge`, `SearchActionsOptions`, `ActionBodyEncoding`.

### Known limit

In key mode, `searchActions` is refused by One today (a `request_failed` error with status 403 that says so): One's action search does not yet accept the connect key. `getActionKnowledge` and `runAction` work in both modes. Token mode can search now.

### Upgrading

No breaking changes. If your coding agent installed the skill, refresh it with `npx skills add withoneai/connect`.

## 0.13.2 · 2026-10-01

### Docs

No code change.

- **Key mode is the default.** Your server holds one connect key for the app and saves one id per user; nothing expires and nothing is refreshed. One's action catalog now accepts the connect key, so `listActions` works in key mode.

  ```ts
  createOneConnect({ clientId, clientSecret, redirectUri, connectKey, userStore });
  ```

- **Token mode** remains fully supported, as the alternative: the token store, `withLock`, the daily `refreshIfExpiring` job.

### Upgrading

Nothing changes in the code. If your coding agent installed the skill, refresh it with `npx skills add withoneai/connect`.

## 0.13.1 · 2026-09-30

### Docs

No code change.

- The README and the bundled agent skill (`skills/one-connect`) now lead with **token mode**: your server stores each user's tokens.
- **Keeping users connected** is its own step. The package refreshes a token before a call when it is about to expire. Your app runs a daily job for users who have not called in a while:

  ```ts
  await oneConnect.refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 });
  ```

- **Key mode** has its own short section, with its two limits today: `listActions` does not work in it yet, and it works in Production only.

### Upgrading

Nothing changes in the code. If your coding agent installed the skill, refresh it with `npx skills add withoneai/connect`.

## 0.13.0 · 2026-09-30

### Key mode

Your server can now hold a user's grant with one **connect key** for the app and one permanent id per user. Nothing expires and nothing is refreshed.

```ts
createOneConnect({
  clientId, clientSecret, redirectUri,
  connectKey: process.env.ONE_CONNECT_KEY!,
  userStore: { saveUser, loadUser, clearUser },
});
```

- Create the connect key on your app's page in the dashboard: **Credentials → Connect key**. It is shown once.
- `userStore` saves one short string per user. One column on your user row is enough.
- When a user revokes access, the next call throws `reconnect_required`. Ask them to connect again.
- The button, the two routes and every call are the same as before.

Key mode is the default for new integrations. The README has a "Choose a mode" section with the code for each.

### Token mode

Unchanged, and still fully supported. An app that passes a `tokenStore` keeps running in token mode with no code change.

- Fixed: with a Token lifetime longer than 30 days, a user was asked to reconnect when the refresh token ran out although the access token still worked. The pair is now kept while the access token works.
- Run `refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 })` once a day to keep idle users connected.

### Upgrading

```bash
npm install @withone/connect@0.13.0
```

Nothing to change for existing apps. If your coding agent installed the skill, refresh it with `npx skills add withoneai/connect`.

## 0.12.2 · 2026-09-29

### Docs

- The README and the bundled agent skill (`skills/one-connect`) are rewritten to cover only what you do to integrate Connect: create the app, add the button, add the two routes, call One, and store the tokens.

### Upgrading

Nothing changes in the code. If your coding agent installed the skill, refresh it with `npx skills add withoneai/connect`.

## 0.12.1 · 2026-09-29

### Fixed

- `<one-connect-button>` in a server-rendered React page caused a hydration mismatch warning. The element upgrades before React hydrates, and it wrote `data-variant` and a `style` attribute onto itself. The button now never writes to its host. Accent colours are custom properties on the button inside the shadow root, and the host's layout rules read the element's own `variant` and `full-width` attributes.
- `fullWidth` and the block card did not fill a flex container. The React and Vue components wrapped the button in a `<div>` that shrank to its content. They now render the host themselves, as `<span class="one-connect" data-variant data-full-width>`, so the server and client HTML agree and the host is the flex item. React's `className` and `style` now apply to that host. `mountConnectButton` sets the same attributes on the span it creates.

### Added

- `renderConnectButton(host, props)`, for wrappers that render their own host element.

### Upgrading

Nothing is required. If you styled the old wrapper `<div>` through `className`, those styles now land on the host `<span class="one-connect">`.

## 0.12.0 · 2026-09-29

### Breaking

- `mountConnectButton(el, props)` takes the same flat props as every wrapper. The nested `{ connect: { authorizeUrl, onSuccess, … }, label, … }` shape is gone.
- The handle is `{ update(props), destroy() }`. `setState` is removed; pass `connected` instead.
- No longer exported: `optionsFromProps`, `propsIdentity`, `ConnectButtonCallbacks`, `ConnectButtonOptions`, `normalizePlatform`, `normalizePlatforms`, `parsePlatformsAttribute`. They were plumbing for the wrappers.
- The callback route now returns `?one_connect=error&one_connect_error=declined|expired|failed`. It no longer puts free text on the URL. `onError` receives the SDK's fixed text for the code, and `completeAuthorization().message` is for your logs only.
- "Connected" keeps the button's own colour and shows a tick. It no longer switches to spring green.

### Fixed

- The label rendered at the browser's default 13.33px, weight 400. The `font` shorthand used `inherit` as the family, which is invalid CSS, so the browser dropped the whole declaration. It now renders at 14.5px, weight 500.
- Pressing Back on One's page left the button stuck on "Connecting…" and disabled once the browser restored the page from its back-forward cache. It returns to idle and fires `onCancel`.
- The return was handed to the first button instance only. Under React StrictMode no button ever showed "Connected", and a second button on the page never got `onSuccess`. The outcome is now read once per page load and every button shows it. The callbacks fire once, on the first button still mounted.
- The button lost all styling under a strict Content Security Policy (`style-src 'self'`). It now renders in a shadow root with a constructed stylesheet (`adoptedStyleSheets`) and no style attributes.
- `accentColor` always got black text, which was unreadable on dark brand colours. The text is now black or white, whichever has the higher WCAG contrast.
- Importing `@withone/connect/react` into a Next.js Server Component crashed (`useRef is not a function`). The React bundles now start with `"use client"`.
- The focus ring was 1.65:1 on white. It now uses ink on light pages and lime on dark ones.
- While connecting, the button is busy, not disabled, so it keeps keyboard focus. State changes are announced through a polite live region. The block card is named by its title and described by its sub-line, and forced-colors mode is supported.

### Added

- Props: `connected` (the truth from your server, so the button stays right after a reload), `disabled`, `size` (`sm` · `md` · `lg`), `fullWidth`, `theme="auto"`, `connectTheme`, `onCancel`, and `onError(message, code)`.
- Styling hooks: `--one-connect-font`, `--one-connect-radius`, `::part(button)` and `::part(label)` on `one-connect-button` or `.one-connect`.
- `useOneConnect()` in `@withone/connect/react`, a real hook returning `{ open, status, error }`.
- `createConnectFlow()` and `readConnectReturn()` in the core.
- `handle.update(props)` updates in place and keeps state and focus. React, Vue, Svelte and `<one-connect-button>` now use it instead of remounting.
- The custom element takes `connected`, `disabled`, `size`, `full-width`, `theme="auto"` and `connect-theme`, and dispatches `cancel`. The `error` event's detail is `{ message, code }`.
- Chip names use each brand's own spelling (`hubspot` → HubSpot).

### Deprecated

Each of these still works and will be removed in the next minor:

- `useOneConnect` from `@withone/connect` → `createConnectFlow`
- `appTheme` / `app-theme` → `connectTheme`
- `OneConnectOptions` / `OneConnectHandle` → `OneConnectFlowOptions` / `OneConnectFlow`

### Upgrading

- `mountConnectButton(el, { connect: { authorizeUrl, onSuccess }, label })` becomes `mountConnectButton(el, { authorizeUrl, onSuccess, label })`.
- `handle.setState("connected")` becomes the `connected` prop, or `handle.update({ …props, connected: true })`.
- If you displayed `one_connect_message`, or server text from `onError`, show the `message` argument instead and branch on `code`.
- Pass `connected` from your server. For example: `connected={await oneConnect.isConnected(userId)}`.
- Under a strict CSP, allow `https://assets.withone.ai` in `img-src` for the connector logos.

Code that used only the documented `ConnectButton` props for React, Vue, Svelte or `<one-connect-button>` works unchanged.

## 0.11.0 · 2026-09-29

### Fixed

- Two processes refreshing the same user no longer disconnect them. One rotates the refresh token on every refresh and revokes the whole grant when an old one is spent again; the client only serialised refreshes inside one process. `tokenStore.withLock` now carries that across processes (see Added).
- A failed refresh no longer deletes the tokens unless One says the grant is dead. Only `400 invalid_grant`, or a refresh token whose own `exp` has passed, clears them and throws `refresh_failed`. Network errors, 5xx, 429 and `invalid_client` keep the tokens and throw `request_failed`, so a brief outage no longer forces every user to reconnect.
- A reconnect during a failing refresh no longer wipes the new pair. Before clearing, the client re-reads the store and returns a newer pair when one has landed.
- `refreshTokens` no longer rotates a pair another caller rotated a moment earlier; it returns that pair.

### Added

- `tokenStore.withLock(userId, run)`, optional. Every refresh, and the callback's save, runs under it, and the store is re-read inside it. Required when more than one process can refresh (serverless, several instances, a worker). The README has a Postgres `pg_advisory_xact_lock` version.
- `refreshIfExpiring(userId, { withinMs })` refreshes only when the access token or the refresh token expires within the window. Run it on a schedule to keep access tokens warm, and daily with a window of days so idle users' 30-day refresh tokens renew.
- `clearTokens(userId, failed)` receives the pair that failed, so a store can delete only if that pair is still the stored one. `disconnect` passes no `failed` and always deletes.
- `refreshTokenExpiresAt(refreshToken)` exported from `@withone/connect/server`.
- README §5 "Tokens": lifetimes, schema, the lock, background jobs, the error table, and asking for more tools by editing the permission set.

### Upgrading

Nothing is required: every addition is optional and existing stores keep working. If your app runs more than one process, add `withLock` to your token store.

## 0.10.0 · 2026-09-26

### Breaking

- `moreCount` (and the `more-count` attribute) is removed. The `+N` chip now counts only the platforms passed beyond the first three, so it can never claim a number unrelated to the list beside it: three apps render three logos and no chip, four render three and `+1`, twelve render three and `+9`.

### Fixed

- The block button's "Secured by One" foot drew a placeholder circle next to a hand-typed lowercase "one". It now renders One's real lockup, inlined with every fill set to `currentColor`, so one copy serves the light and dark button and takes the colour the button already sets. Inlined rather than fetched, so the trust mark still draws behind a strict content policy or offline.

### Upgrading

Delete `moreCount` / `more-count` from your button. Nothing else changes.

## 0.9.0 · 2026-09-18

### Server half

- `@withone/connect/server`: `createOneConnect(config)` with a `tokenStore` you own (`saveTokens` / `loadTokens` / `clearTokens`), `startAuthorization`, `completeAuthorization`, `getAccessToken`, `refreshTokens` (single-flight per user), `listConnections`, `listActions`, `runAction` (`blockedByGrant` on grant 403s), `fetch`, `disconnect`.
- `@withone/connect/next`: `createOneConnectRoutes(oneConnect, { identifyUser, loginHintFor?, signInUrl? })` serves `/authorize` and `/callback` from one route file.
- `@withone/connect/node`: `createOneConnectHandlers(oneConnect, …)` returns `{ authorize, callback }` for Express and plain Node.
- `ONE_API_URL` replaces the three endpoint variables.

### Browser half

- `useOneConnect` returns `{ open }`; full-tab redirect, return via `?one_connect=` params.
- `<one-connect-button>` custom element plus React, Vue and Svelte wrappers that share one core copy.
- `platforms` accepts slugs (`"stripe, notion"` or arrays); logos come from `assets.withone.ai`.
- `onClose` / `close()` removed.

### Packaging

- Declarations generated by `tsc`; hand-written `*.d.ts` files removed.
- `scripts/verify-build.js` checks all eight entry points; vitest suites for browser and server.
- Skill `skills/one-connect/SKILL.md` and README rewritten for this API.

## 0.8.3 · 2026-09-03

ConnectButton derives connector logos from platform names when imageUrl is omitted (fallback to first-letter).

## 0.8.2 · 2026-09-02

The +N overflow chip's number is now dark and visible (was white-on-white).

## 0.8.1 · 2026-09-02

Provider chip stack caps at 3 icons + a +N chip, so the ConnectButton stays clean when an app requests many platforms.

## 0.8.0 · 2026-09-01

**Full Changelog**: https://github.com/withoneai/connect/compare/v0.7.1...v0.8.0

## 0.7.1 · 2026-09-01

Redirect-mode return detection now fires onSuccess/onError only (URL still scrubbed) — One's hosted page shows the result screen itself before redirecting, so the arrival overlay double-announced. Modal mode keeps the overlay.

## 0.7.0 · 2026-09-01

`open()` and the ConnectButton now navigate the same tab to One's hosted connect page by default — first-party cookies, so the flow works in every browser (Safari/Firefox/incognito included). The SDK detects the return (`?one_connect=…`) on the next load, scrubs the URL, fires callbacks and paints the result card. `mode: "modal"` keeps the legacy in-page iframe.

## 0.6.2 · 2026-08-31

Result overlay padding now matches event-link-frontend's success screen (20px horizontal, was 48px) — the Close button and copy span the card the same way authkit's do.

## 0.6.1 · 2026-08-31

The result overlay (Access granted / Connection failed) now survives the trigger button unmounting — hosts that conditionally render the button on connect state no longer wipe the confirmation a few hundred ms after it appears.

## 0.6.0 · 2026-08-31

Errors now render in the SDK's own overlay (red ✕, 'Connection failed', message, close-only) exactly like the success card — result states live in the widget surface, with onError still firing for the host. Docs: one_tx cookies must be SameSite=None+Secure (iframe callback rides a cross-site redirect chain; Lax gets dropped).

## 0.5.0 · 2026-08-31

`import { ConnectButton } from "@withone/connect/vue"` (Vue 3 component, @success/@error/@close emits) and `import { connectButton } from "@withone/connect/svelte"` (a Svelte action: `<div use:connectButton={…} />`). Same flat props as the React subpath; core stays zero-dependency.

## 0.4.0 · 2026-08-31

New subpath export: `import { ConnectButton } from "@withone/connect/react"` — a real React component with idiomatic props over the same core. react is an optional peer dependency of the subpath only; the zero-dependency core and `<one-connect-button>` element are unchanged for every other framework.

## 0.3.1 · 2026-08-31

authorize.url / authorize-url may now be a relative path ("/api/one/authorize") — resolved against the host page origin.

## 0.3.0 · 2026-08-31

The optional pre-built button is now a custom element: `<one-connect-button authorize-url=… />` works identically in React/Next/Vue/Svelte/plain HTML. Auto-registered on import, SSR-safe, CustomEvents + function props, card-matching Secured-by-one foot. `mountConnectButton` remains for programmatic control.

## 0.2.0 · 2026-08-31

Adds `mountConnectButton` — an optional, framework-agnostic pre-built trigger (default/accent/block variants, provider chip stack with hover fan, self-managed Connect→Connecting→Connected states). Zero new dependencies, zero One URLs; bring-your-own-button via `useOneConnect` unchanged.

## 0.1.2 · 2026-08-28

Close button spans the card's full padded width.

## 0.1.1 · 2026-08-28

Success card matches the flow's 520×520 geometry with the secured-by strip; dismissal floors (Escape, scrim click) and focus management.
