# The app's own agent, acting as a user

Read this when the app runs its own LLM agent and the agent should use a
connected user's grant itself, instead of the app calling `runAction`. The
agent then lists the user's connections, finds actions and runs them, and
One holds every call to that user's grant.

| | One's MCP server | The One CLI |
|---|---|---|
| Modes | key and token | key only |
| The agent gets | a bearer for one user | `one` commands, run as the user |
| Pick it when | the agent has an MCP client, or needs a raw shell | the agent calls tools as commands |

## One's MCP server

```ts
const { accessToken, expiresAt, url } = await oneConnect.getMcpToken(userId);
// the agent's MCP client: Streamable HTTP at `url` (https://mcp.withone.ai/mcp),
// header  Authorization: Bearer <accessToken>
```

- Call it at the start of each agent run, per user. In key mode the
  bearer lasts 15 minutes with no refresh token. The client keeps one
  bearer per user, in memory, and mints another a minute before it runs
  out, so two runs for the same user may get the same bearer. In token
  mode it is the user's access token, refreshed first when it is about to
  expire.
- It reaches exactly what the user granted, at the same levels.
- One bearer per user. Never give one user's bearer to another user's
  agent.
- On the server only. One's MCP server refuses browser requests (any
  `Origin` header). Never log the bearer or send it to a page.
- When the MCP server answers `401`, call
  `getMcpToken(userId, { fresh: true })` and retry once.
- `getMcpToken` throws the codes of section 8 in `SKILL.md`:
  `not_connected` (nothing is stored for the user), `reconnect_required`
  (key mode: the user revoked, or the app is paused), `refresh_failed`
  (token mode: the grant is gone), `request_failed` (the key was not
  accepted, or One could not mint).
- If `reconnect_required` comes with a message about the connections
  scope, the client's `scopes` option leaves the connections scopes out.
  Remove the option and ask the user to connect again.
- The user revoking, the app being paused or, in key mode, the key that
  minted it being deleted ends the bearer on its next call.
- `oneMcpUrl` points it at another environment, like `oneApiUrl`.

## The One CLI

Key mode only. When the app's agent calls tools as commands, the app can
give it a tool that runs the One CLI as the user: the same `list`,
`actions find` and `actions execute` a developer uses, held to the user's
grant.

**On the server.** Install the CLI where the tool runs:
`npm install -g @withone/cli`, version 2.18.0 or later. The package is
`@withone/cli`; the npm package named `one` is an unrelated project. It
needs Node.js 22.23.4+, 24.22.1+ or 26.12.1+. On an older Node every run
exits 1 with `"code": "NODE_UPGRADE_REQUIRED"`.

**The user's string.** `ONE_CONNECT_USER_ID` takes the whole string
`saveUser` stored for the user, unchanged. Read it with the app's own
`loadUser`, the function passed to `createOneConnect`. `getConnectUserId`
returns only the bare `cu_…` id, which lands in the user's personal space.

```ts
import { execFile } from "node:child_process";

// the only commands the model may run
const ALLOWED = [["whoami"], ["list"], ["actions", "find"], ["actions", "load"], ["actions", "execute"]];
const allowed = (args: string[]) =>
  ALLOWED.some((command) => command.every((word, i) => args[i] === word)) &&
  !args.some((arg) => arg.startsWith("--output"));

const reference = await loadUser(userId);   // the string saveUser stored, unchanged
if (!reference) throw new Error("This user is not connected");
if (!allowed(args)) throw new Error("not an allowed one command");

execFile("one", ["--agent", ...args], {
  env: {
    PATH: process.env.PATH,
    ONE_SECRET: process.env.ONE_CONNECT_KEY,  // the connect key
    ONE_CONNECT_USER_ID: reference,           // the whole string, with any ;org=…;project=…
    ONE_HOME: `/srv/one/${userId}`,           // a folder per user
    ONE_NO_AUTO_UPDATE: "1",
  },
});
```

- Let the model run only those commands, never `--output`. `one flow`
  runs bash and code steps on the server and hands a flow the CLI's
  environment, connect key included; `--output` writes a file wherever
  the process can.
- Give the process only these variables, never the app's whole
  environment or the client secret. `ONE_HOME` keeps each user's CLI
  state apart and leaves no `~/.one` key to fall back on.
- `one --agent whoami` names the user; `list` shows only the granted
  connections and the access on each; `actions find` offers only actions
  inside the grant. Plan from those two: `actions load` reads an action's
  docs by id whether or not the grant reaches it. In agent mode `list`
  returns 20 connections unless `--limit <n>` asks for more.
- `actions execute` refuses an action outside the grant: it prints
  `{"error": "Error: One refused this for the Connect user: …"}` and exits
  1. Do not retry it. When `list` is refused the same way, the user has no
  live grant (revoked, or the app is paused): ask them to connect again.
- In agent mode `actions execute` asks for `--confirm-write` on any action
  whose method is not GET, HEAD or OPTIONS, a read sent as a POST
  included. Without it the run prints `"status": "confirmation_required"`
  and exits 1. Tell the model to add the flag only for a change the user
  asked for. The flag checks nothing itself; the grant still decides.
- Adding connections and relays need an ordinary key; under a grant the
  user adds tools through the Connect button.
- The process holds the connect key, which acts for any of the app's
  users given their id. The model picks the arguments; the app's code
  picks the program and its environment. Never put these variables in a
  shell the model controls. An agent that needs a raw shell should use
  One's MCP server: its bearer reaches one user for 15 minutes.
- A connect key without `ONE_CONNECT_USER_ID` is refused, and so is
  `ONE_CONNECT_USER_ID` beside an ordinary key.
- The CLI's telemetry is on by default. `ONE_NO_TELEMETRY: "1"` in `env`
  turns it off.

## Done when

- MCP: `getMcpToken` returns a bearer, the agent's `tools/list` at `url`
  answers, and after the user revokes, `getMcpToken(userId, { fresh: true })`
  throws `reconnect_required` (`refresh_failed` in token mode).
- CLI: with the variables above, `one --agent whoami` names the user,
  `one --agent list` shows only the granted connections, and
  `actions execute` refuses an action outside the grant.
