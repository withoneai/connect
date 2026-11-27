---
name: one-connect
description: Add One Connect (`@withone/connect`) to an application, or work on one that already has it. One Connect lets an app's users grant it scoped, revocable access to their own One-connected tools (Gmail, Slack, Notion, Stripe and the rest of 1,000+ platforms). Use when wiring or changing any part of it - creating or updating the Connect app from `one.connect.ts` with `one connect create`, choosing key or token mode, `createOneConnect`, the two backend routes, `ConnectButton` or the app's own button (`useOneConnect`, `createConnectFlow`), `openApp` and a Manage button per app, calling One with the grant (`listConnections`, `searchActions`, `runAction`), a flow that ends `declined`, `expired` or `failed`, `blockedByGrant`, `reconnect_required` or `refresh_failed`, rate limits, the token refresh job, or giving the app's own AI agent One's remote MCP server (`getMcpToken`) or the One CLI for a connected user.
---

# One Connect

You are adding One Connect to this application, or changing an app that
already has it. Its users grant the app scoped, revocable access to their own
tools. The package does the OAuth work; you wire three things: a button, two
routes, and the calls made with the grant.

```
Browser                    Your backend                          One
<ConnectButton>  ------>   GET /api/one/authorize   ---302--->  hosted page: sign in, pick tools, set access
                           GET /api/one/callback    <--302----  ?code&state
                             saves the grant for the user, redirects home
                 <------   onSuccess fires
Later:                     oneConnect.runAction(userId, ...) -> One, grant enforced
Or, for the app's agent:   oneConnect.getMcpToken(userId)    -> a bearer for One's MCP server
                           or the One CLI with the connect key and the user's stored string
```

The client secret and the connect key stay on the server.

Reference files sit beside this one. Read each only when its case comes up:

- `references/routes.md`: the server is not the Next.js App Router.
- `references/button.md`: anything past the ready-made React button.
- `references/agent-tools.md`: the app's own AI agent should use a user's
  grant, through One's MCP server or the One CLI.
- `references/token-mode.md`: the app uses token mode (section 1).
- `references/troubleshooting.md`: a flow ends `declined`, `expired` or
  `failed`, a call throws, or `one connect create` stops.

## 0 - Before you start

- The package needs Node.js 22 or later. React 17 and Vue 3 are optional
  peer dependencies, for `@withone/connect/react` and `/vue` only.
- This skill ships inside `@withone/connect`. If the project's package is
  newer than this copy, refresh it: `one skills add connect`, or
  `npx skills add withoneai/connect`.

**Which way in.** Check what the human gave you.

- They pasted a prompt from the One dashboard. It starts
  `Set up One Connect for "<name>".` and carries `client_id:`,
  `redirect_uri:` and sometimes `permission_set:`. The app already exists:
  skip section 2. Put those values in the env file as `ONE_CLIENT_ID`,
  `ONE_REDIRECT_URI` and `ONE_PERMISSION_SET` (section 3), and ask the human
  to add `ONE_CLIENT_SECRET` there themselves, and `ONE_CONNECT_KEY` in key
  mode. Use the mode the prompt names.
- Nothing exists yet. Create the app from code with the One CLI (section 2),
  which must be installed and signed in, below. If the human would rather
  not install it, they create the app in the dashboard.

**If the One CLI is not set up.** Work through these in order.

1. Run `one --version`. If the answer is `command not found`, run
   `npm install -g @withone/cli` and check again. The package is
   `@withone/cli`. The npm package named `one` is an unrelated project, never
   install that. It needs Node.js 22.23.4+, 24.22.1+ or 26.12.1+. If the
   global install fails with a permissions error, do not use sudo: run every
   command as `npx @withone/cli@latest <command>` instead.
2. If a command answers ``Not configured. Run `one init` first.``, tell the
   human a browser window is about to open, then run
   `one --agent init --auth browser`. Give the command a timeout over 5
   minutes, because it waits that long for the human to sign in. If the
   browser does not open, the login link is on stderr: pass it on. Never run
   plain `one init` or `one login` here. Both are interactive and refuse
   `--agent`.

The CLI's key is the developer's own. Never put it in the app's env file;
the app never needs it.

## 1 - Choose the mode

The routes, the button and the calls are the same in both modes. Only what
the server keeps differs.

| | Key mode (default) | Token mode |
|---|---|---|
| Server keeps | one connect key for the app, one string per user | an access and a refresh token per user |
| Expires | nothing | yes; the app runs a daily refresh job |
| User revoked | next call throws `reconnect_required` | next refresh throws `refresh_failed` |
| Call outside the grant | `403`, `blockedByGrant: true` | the same |
| The app's agent on One's MCP server | `getMcpToken` mints a 15-minute bearer | `getMcpToken` returns the user's access token |
| The app's agent on the One CLI | `ONE_SECRET` and `ONE_CONNECT_USER_ID` | not available |

Use **key mode** unless the human asks for token mode, the app needs the
bearer token itself, or the app already passes a `tokenStore`. Do not switch
an existing app from one mode to the other unless asked: its users would have
to connect again. Sections 2 to 9 are key mode. For token mode, read
`references/token-mode.md` before section 4.

## 2 - Create the Connect app

**From code**, with the One CLI 2.11.0 or later and `@withone/connect` 0.20.0
or later.

1. Install the SDK first, because the config file imports it:
   `npm install @withone/connect`.
2. Find the tool slugs: `one --agent platforms`.
3. Write `one.connect.ts` at the project root.

```ts
import { defineConnectApp } from "@withone/connect/config";

export default defineConnectApp({
  name: "Acme Assistant",                                // shown on the connect card
  redirectUris: ["http://localhost:3000/api/one/callback"], // every callback URL, exact; the first becomes ONE_REDIRECT_URI
  reason: "Acme Assistant reads your mail and plans your week", // optional, at most 200 characters
  description: "Your inbox and calendar, planned",       // optional
  logoUrl: "https://acme.app/logo.png",                  // optional, square, public https
  homepageUrl: "https://acme.app",                       // optional
  branding: { panelColor: "#0A0C0B", buttonColor: "#0A0C0B", cobrandEmail: false }, // optional; both colours, as #RRGGBB
  ask: {                                                 // required: these tools, or "everything"
    gmail: { access: "read-write" },
    "google-calendar": { access: "full-access" },
    notion: { access: "read-only" },
  },
});
```

Each tool in `ask` is keyed by its slug and takes `access`: `read-only`,
`read-write` (no deletes), `full-access`, or `custom` with `actions`. Users
see exactly that list and can only narrow it.

For an agent or CLI that works across whatever its users have, write
`ask: "everything"` instead: users see every connection they have, at full
access, can connect any other app, and can narrow any of them. The CLI then
writes no `ONE_PERMISSION_SET` and removes one already in the env file.

4. Only for `custom`: get the action names before you write them.
   `one --agent connect types` writes `one-connect-env.d.ts` beside the
   config and returns `actions`, the names for each tool the config's `ask`
   lists. So list the tool with a level first, run it, then change that tool
   to `{ access: "custom", actions: ["sendEmail", "listAndViewEmailThreads"] }`
   with names from the result. A config that does not validate (for example
   `custom` with no actions) gets slugs only, and no error. An action's id
   (`conn_mod_def::…`) works in place of a name:
   `one --agent actions find gmail "send an email" --no-knowledge` prints it.
   A name that two actions share is left out, so use the id for those. A
   wrong name stops `connect create` before anything is made.
5. Run `one --agent connect create`. It opens a page in the human's browser
   and waits up to 10 minutes, so run it in the background or with a timeout
   over 10 minutes. The link goes to stderr at once: pass it on if no
   browser opened. The page reports back to `127.0.0.1` on the machine that
   runs the CLI, so the browser must be on that machine. In a remote shell
   or a container the command times out and writes nothing. The human sees
   the app as their users will, and approves it. For a new app that page
   makes `ONE_CLIENT_SECRET` and `ONE_CONNECT_KEY` and shows them once.

The result is `{ outcome, clientId, permissionSetId, asksForEverything, redirectUris, envFile }`.
`outcome` is `created`, `updated` or `unchanged`. The CLI writes
`ONE_CLIENT_ID`, `ONE_REDIRECT_URI` and, for a list of tools,
`ONE_PERMISSION_SET` to `envFile`: `.env.local` when the project has one,
else `.env` (`--env-file <file>` picks another). For a new app it also adds
empty `ONE_CLIENT_SECRET=` and `ONE_CONNECT_KEY=` lines. Tell the human to
paste the two values from the browser page into that file. Do not edit the
env file while the command waits: it reads the file before the browser opens
and writes from that copy. Other flags: `--config <file>`, `--no-open`.

**To change the app later,** edit `one.connect.ts` and run
`one --agent connect create` again. The human approves the new version in
the browser; the secrets stay as they are. It updates the same app only
while the env file still holds `ONE_CLIENT_ID`. Without it the CLI starts a
new app.

**In the dashboard instead:** the human creates it under Developers ->
Connect -> New app and sets the values in section 3.

## 3 - Environment (server only)

```bash
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...                       # shown once
ONE_CONNECT_KEY=sk_live_...                            # key mode; shown once; also mints MCP tokens
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback  # the registered callback URL, character for character
ONE_PERMISSION_SET=...                                 # optional: the app's Permission set ID
```

The connect key comes from the app's page: Credentials -> Connect keys ->
Create key, with the dashboard on Production. Without `ONE_PERMISSION_SET`
the consent page lists the user's connections and they choose.

Never ask the human to paste the secret or the connect key into the chat.
Tell them which environment variable to set and read it from there.

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
identifier, not a secret, so it needs no encryption and no lock. The package
writes it in the callback and reads it on every call. `saveUser` runs on
every completed flow, and the string changes when the user grants from
another space, so always save what it is given. The app passes the string on
in one case only: to the One CLI, read back with its own `loadUser`
(`references/agent-tools.md`).

Optional settings: `returnTo` (where the callback sends the browser, `/` by
default), `scopes` (leave the default: it covers who connected and the
connections of all three spaces), `mode` (`"key"` or `"token"`, to state it),
`oneApiUrl` and `oneMcpUrl` (One's API and MCP origins, production by
default).

Also on the client: `isConnected(userId)`, `disconnect(userId)` (drops the
app's copy; the user revokes the grant itself from their One dashboard),
`getConnectUserId(userId)` (key mode: the bare `cu_…` id, or null) and
`mode`.

## 5 - The two routes

Next.js App Router:

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

That file serves `/api/one/authorize` and `/api/one/callback`. Three rules
hold in every framework:

- The route goes by the last path segment, which must be `authorize` or
  `callback`. Anything else answers `404`.
- Both routes share one folder: the state cookie is scoped to it.
- The callback calls `identifyUser` again, so the same user must still be
  signed in when they come back.

Any other server (Hono, SvelteKit, Remix, Bun, Express, Fastify, Koa, plain
Node, or one that needs the two legs by hand): read `references/routes.md`.

## 6 - The button

Pick by what the app already has. Each option uses the routes above.

**The ready-made button** (default):

```tsx
import { ConnectButton } from "@withone/connect/react";

<ConnectButton
  authorizeUrl="/api/one/authorize"
  logos={["gmail", "stripe"]}       // app slugs, decoration only
  connected={hasGrant}              // from the server: await oneConnect.isConnected(userId)
  onSuccess={() => { /* refetch app state */ }}
  onError={(message) => { /* show message */ }}
/>
```

The React entry ships with `"use client"`. In the Next.js App Router, a file
that passes it callbacks must itself be a client component.

Optional props: `variant`, `size`, `fullWidth`, `theme`, `connectTheme`,
`label`, `connectedLabel`, `description`, `disabled`, `onCancel`, `accent`
and `accentText` (the brand colour, e.g. `accent="#F4A938"`), `openApp` and
`returnTo`. Vue: `@withone/connect/vue`, same props. Svelte:
`use:connectButton` from `@withone/connect/svelte`. Anything else:
`<one-connect-button authorize-url="/api/one/authorize" logos="gmail, stripe">`.

**The app's own button.** When the app has its own design system button,
keep it and wire the flow to it instead of adding a second style. In React:

```tsx
import { useOneConnect } from "@withone/connect/react";

const { open, status, error } = useOneConnect({ authorizeUrl: "/api/one/authorize", onSuccess: refetch });
<Button onClick={open} disabled={status === "connecting"}>Connect your tools</Button>
```

`status` is `idle`, `connecting`, `connected` or `error`; the last two say
how this page load ended a flow. `error` is `{ message, code }` or null.
In any other framework, or none, use `createConnectFlow` from
`@withone/connect`.

Read `references/button.md` before any of these: what each prop does and
the styling hooks; the Vue, Svelte and web component forms;
`createConnectFlow`; one app first with `openApp` and `returnTo` (a chat
that says "Connect Gmail"); a Manage button for each app the user granted;
a plain link with no SDK in the browser.

The outcome belongs to the page load, not to one button: `onSuccess` and
`onError` fire once, on the first flow still mounted when the tab returns.
Treat `onSuccess` as a hint to refetch from the server. Do not build a
completion page; the callback redirect is the completion.

## 7 - Calling One with the grant

The same four steps the One CLI takes: list, find the action, read its
knowledge, run it. Always read the knowledge before running an action for
the first time; it names the required fields, the encoding and any header.

```ts
const connections = await oneConnect.listConnections(userId);                 // [{ key, platform, access }]
const stripe = connections.find((c) => c.platform === "stripe");
if (!stripe) throw new Error("This user has not granted Stripe");
const [action] = await oneConnect.searchActions(userId, "stripe", "create an invoice");  // best first, 5 by default
const guide = await oneConnect.getActionKnowledge(userId, action._id);        // { knowledge (Markdown), ioSchema, method, path, tags, access }

const reply = await oneConnect.runAction(userId, {
  connectionKey: stripe.key,
  actionId: action._id,
  body: { customer: "cus_123" },              // the fields the guide asks for
  encoding: "form",                           // "json" when omitted; "form" or "multipart" when the guide says so
  // pathParams: { calendarId: "primary" },   // values for {{placeholders}} in the path
  // query: { limit: "10" },
  // headers: { "Notion-Version": "2022-06-28" },   // only when the guide names one
});
// { status, ok, blockedByGrant, refusal, rateLimit, data }
```

`rateLimit` is `{ limit, remaining, resetsIn, retryAfter }` for that user
(calls per minute, seconds), or `null` when One sent none. Each value can be
`null` on its own, `retryAfter` included, so read it with a fallback:
`reply.rateLimit?.retryAfter ?? 5`. Slow down as `remaining` nears 0.

Each connection's `access` is `{ policy: "full" }`, `{ policy: "methods",
methods, access }` or `{ policy: "actions", actions }`; plan from it before
calling. One judges an action by its level, never its HTTP method: every
action has `access` (`read`, `write` or `delete`), and a `methods` grant
lists the levels it allows in `access`. `{ methods: ["GET"], access:
["read"] }` runs a search sent as a POST and refuses a GET that writes, so
compare the action's `access`, not its `method`.

`runAction` takes the method and path from the action, fills the path's
placeholders, puts the connection key in the body of an action One serves
itself (tag `custom`), and encodes the body as `encoding` says (JSON unless
you pass one). Pass `actionId` and let it look the rest up: when you pass
`method` and `path` yourself it skips that lookup and the connection key is
not added.

`searchActions` takes `{ limit, mode }`; `mode: "knowledge"` ranks for
writing code against an action instead of running it now. `listConnections`
returns every connection up to 3,000, or one page with `{ page, limit }`
(`limit` up to 150). `listActions(userId, platform)` lists a platform's
catalog, up to 2,000 actions, for when search is not enough. If
`searchActions` throws `request_failed` with status `403` and a message
saying One's action search does not accept the connect key, use
`listActions` and pick by title. `oneConnect.fetch(userId, path, init)`
reaches any other `/v1` endpoint.

**Who connected.** The app can also read the user's name and email on One,
for example to show which One account is connected:
`oneConnect.fetch(userId, "/users/whoami")` returns
`{ user: { id, name, email }, organization, project }`. A user who connected
before 0.18.0 gets `403` until they connect again. Mention this to the human
as something available; whether and where to show it is their choice.

Do not set any auth header. The package adds the connect key and the
user's id to every call it makes.

**The app's own agent.** When the app runs its own LLM agent, the agent can
use the user's grant itself instead of `runAction`: through One's remote MCP
server (`oneConnect.getMcpToken(userId)`, both modes) or by running the One
CLI as the user (key mode). Read `references/agent-tools.md` first.

## 8 - Errors

`refusal` says why One itself turned a call down:

- `"grant"` (`403`, `blockedByGrant: true`): outside what the user granted.
  Do not retry it.
- `"plan_limit"` (`402`): the app's One plan is at its monthly limit, which
  is counted across all of the app's users. It is not the grant and not
  this user. Stop calling rather than retrying, and tell the app's owner:
  an upgrade or the next billing period lifts it. Do not ask the user to
  reconnect.
- `"rate_limit"` (`429`): too many calls. Wait `rateLimit.retryAfter`
  seconds when it is set, and retry.
- `"one_error"` (any other error from One, e.g. `5xx`): retry with a backoff.
- `null`: not One's refusal; the provider's own answer, or a success.

Only One's own `403` means "outside the grant", and `blockedByGrant: true`
is how you tell. A provider's own `403` comes back with `blockedByGrant:
false` and `refusal: null`. Never treat a `402`, `429` or `5xx` as a missing
permission.

Errors are `OneConnectError` with a `code` and, when One answered, a
`status`. Handle them where the app calls One:

| `code` | Meaning | Do |
|---|---|---|
| `not_connected` | Nothing is stored for this user. | Show the Connect button. |
| `reconnect_required` | Key mode: One will not act for this user; they revoked access, or the app is deactivated. The stored value is kept. | Ask the user to connect again. |
| `refresh_failed` | Token mode: the grant is gone. The tokens are cleared. | Ask the user to connect again. |
| `request_failed` | One answered with an error or could not be reached. Nothing stored changed. It also covers what a retry cannot fix: a path placeholder with no value in `pathParams`, an action id One does not have (`status` `404`), a connect key One does not accept (`status` `401`). | Read `error.message` and `error.status`, then retry later or fix the call. |

```ts
import { OneConnectError } from "@withone/connect/server";

const RECONNECT = ["not_connected", "reconnect_required", "refresh_failed"];
try {
  await oneConnect.runAction(userId, input);
} catch (error) {
  if (error instanceof OneConnectError && RECONNECT.includes(error.code)) {
    // show the Connect button again
  } else throw error;
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
- Store the per-user string as given, every time `saveUser` is called.
- The registered redirect URI and `ONE_REDIRECT_URI` must be identical;
  otherwise One answers `invalid redirect_uri` and never shows its page.
- A flow that ends with `failed` is usually a wrong or rotated client
  secret; log `result.message` from `onComplete` to see why.
- Do not write OAuth steps or One request headers by hand; use the package
  (its two legs, in `references/routes.md`, when no adapter fits).
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
6. If the app's agent uses One's MCP server or the One CLI: the checks at
   the end of `references/agent-tools.md` pass.
7. In token mode: the checks at the end of `references/token-mode.md` pass.
