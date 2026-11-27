# When something fails

Read this when a connect flow does not finish, a call throws, or
`one connect create` stops. Log `result.message` from the routes'
`onComplete` first: it says why a flow failed. Never show it to users.

## A flow that does not finish

A flow ends without a grant in one of three ways. The browser gets only the
code; the package shows fixed text for it.

| What you see | Cause and fix |
|---|---|
| One answers `invalid redirect_uri` instead of showing its page | `ONE_REDIRECT_URI` is not registered on the app character for character (scheme, host, port, path). Register it, or fix the variable. |
| Signed-out users see "Sign in to your account before connecting One." | `identifyUser` returned null, and the route answered `401`. Set `signInUrl` to send them to the app's sign-in page. |
| The flow ends `declined` | The user cancelled on One's page. Nothing to fix. |
| Every attempt ends `expired` | The state cookie did not reach the callback. Serve both routes from the same folder (`/api/one/authorize` and `/api/one/callback`) on the origin of `ONE_REDIRECT_URI`. The cookie lasts 30 minutes, and one browser keeps five unfinished flows: a sixth expires the oldest. |
| Every attempt ends `failed` | One refused the code exchange, most often because the client secret is wrong or was rotated. It also ends `failed` when the app's own `saveUser` or `saveTokens` throws, and the logged message then reads "One could not be reached to complete the connection." Check the store before the network. |
| The user connected but `onSuccess` never fired | The callbacks fire on the page the user lands on (`returnTo`), on the first button or hook mounted there. A page with none gets nothing: mount one, or read `readConnectReturn()` or `?one_connect=success`. |
| The grant was saved under the wrong user | The callback calls `identifyUser` again. The same user must still be signed in when they come back. |

## A call that fails

| What you see | Cause and fix |
|---|---|
| `not_connected` for a user who did connect | `loadUser` returned null, or a value the package did not write. Store the string exactly as `saveUser` received it. |
| One user's calls throw `reconnect_required` | They revoked the app. Ask them to connect again. The stored string is kept, and the package saves it again when they do. |
| Every user's calls throw `reconnect_required` | The app is deactivated, or the connect key is for another environment. Check that the app is active in the dashboard and that the key is this environment's. |
| Every call throws `request_failed`: "One did not accept the connect key" | The key is not this app's, or it was revoked. The human creates a key on the app's page and updates `ONE_CONNECT_KEY`. |
| A call returns `403` with `blockedByGrant: true` | The action is outside what the user granted. Ask for it in `one.connect.ts` (or the permission set); users see new tools the next time they connect. |
| A call returns `403` with `blockedByGrant: false` | The provider's own answer, not One's. Read `reply.data`. |
| A call returns `402` with `refusal: "plan_limit"` | The app's One plan is at its monthly limit, counted across all of its users. It is not about this user or their grant. The human upgrades the plan in the dashboard, or calls work again in the next billing period. Do not ask users to reconnect. |
| A call returns `429` with `refusal: "rate_limit"` | Wait `rateLimit.retryAfter` seconds when it is set, then retry. |
| `request_failed`: the path "needs a value for {{…}}" | Pass that value in `pathParams`. |
| `request_failed` with status `404`: "One has no action with the id" | The action id is wrong. Find the action again. |
| `searchActions` throws `request_failed` with status `403`, and the message says the action search does not accept the credential | Use `listActions(userId, platform)` and pick by title. |
| `/users/whoami` answers `403` | The user connected with a version before 0.18.0 and did not grant it. It works after they connect again. |
| The app's agent gets `401` from One's MCP server | The bearer was revoked or ran out. Call `getMcpToken(userId, { fresh: true })` and retry once. |
| `getMcpToken` throws `reconnect_required` and the message names the connections scope | The client's `scopes` option leaves out the connections scopes. Use the default scopes and ask the user to connect again. |
| Token mode: users are disconnected after about a month | The daily refresh job is missing, or two processes refreshed one user at once without `withLock`. See `references/token-mode.md`. |

## `one connect create` stops

| The CLI says | Fix |
|---|---|
| ``Not configured. Run `one init` first.`` | Sign the CLI in. Section 0 of `SKILL.md`. |
| `No one.connect.ts here.` | Run it in the folder that holds the file, or pass `--config <file>`. |
| `it imports @withone/connect, which isn't installed in this project` | `npm install @withone/connect` first. |
| `@withone/connect is older than 0.19.0` | `npm install @withone/connect@latest`. |
| `` `ask` is required `` | Name the tools the app asks for, or write `ask: "everything"`. |
| `Not in One's catalog: …` | A slug is wrong. `one --agent platforms` lists them. |
| `<slug> has no action named …` | Take the name from `one --agent connect types`, or use the action's id. |
| `… is too big to hand to the browser` | Give tools with long `custom` lists an access level instead. |
| `Cancelled in the browser. Nothing was changed.` | The human cancelled. Run it again when they are ready. |
| `Timed out waiting for the browser.` | Nobody approved within 10 minutes, or the browser is on another machine than the CLI. The env file was not changed. Run it again where the browser can reach the CLI. |
