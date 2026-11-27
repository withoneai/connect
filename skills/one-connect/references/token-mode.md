# Token mode

Read this only when token mode was chosen in section 1 of `SKILL.md`: the
human asked for it, the app needs the bearer token itself, or the app
already passes a `tokenStore`.

The app stores an access token and a refresh token per user, as a standard
OAuth client. No `ONE_CONNECT_KEY` is needed. The routes, the button and
the calls in `SKILL.md` stay the same; only the client's credential differs.

```ts
// lib/one.ts  (server only)
import { createOneConnect } from "@withone/connect/server";

export const oneConnect = createOneConnect({
  clientId: process.env.ONE_CLIENT_ID!,
  clientSecret: process.env.ONE_CLIENT_SECRET!,
  redirectUri: process.env.ONE_REDIRECT_URI!,
  permissionSet: process.env.ONE_PERMISSION_SET,
  tokenStore: {
    saveTokens: async (userId, tokens) => { /* save in the app's database, encrypted */ },
    loadTokens: async (userId) => /* read; null when never connected */,
    clearTokens: async (userId, failed) => { /* delete; see below */ },
  },
});

const accessToken = await oneConnect.getAccessToken(userId); // when the app needs the bearer token itself
```

- `tokens` is `{ accessToken, refreshToken, expiresAt }`, with `expiresAt`
  in epoch milliseconds. Store it encrypted, keyed by the app's user.
- `clearTokens(userId, failed)`: when `failed` is set, One declared that
  pair dead. Delete only if the stored refresh token is still
  `failed.refreshToken`, so a newer pair saved in the meantime survives.
  `failed` is undefined for `disconnect`, which always deletes.
- If the app runs more than one server process or a background worker,
  also add `withLock: (userId, run) => ...`, which runs `run()` while
  holding a per-user lock all processes share (for example a Postgres
  advisory lock), held for at least 60 seconds before any timeout. One
  rotates the refresh token on every use and revokes the grant when an old
  one is used again, so two processes refreshing the same user at once
  disconnect that user.
- `getTokens(userId)` reads the stored pair; `refreshTokens(userId)`
  refreshes now.

## What differs from key mode

- When the user revokes access, the next refresh throws `refresh_failed`
  (not `reconnect_required`) and the tokens are cleared. Ask them to
  connect again.
- A call outside the grant comes back as in key mode: `403`,
  `blockedByGrant: true`, `refusal: "grant"`.
- `getMcpToken` returns the user's access token. After the user revokes,
  `getMcpToken(userId, { fresh: true })` throws `refresh_failed`.
- The One CLI route in `references/agent-tools.md` is not available.
- Who connected: `oneConnect.fetch(userId, "/users/me")` returns
  `{ firstName, lastName, email, … }`.

## Keeping users connected

Tokens expire, and two things keep them fresh. Only the first is automatic:

| | Who does it | When |
|---|---|---|
| Refresh before a call | the package, on its own | whenever the app calls One and the token is within a minute of expiring |
| Refresh for users who have not called in a while | **the app**, with a daily job | once a day, for every connected user |

```ts
// a scheduled job, once a day
for (const userId of /* every user with stored tokens */) {
  try {
    await oneConnect.refreshIfExpiring(userId, { withinMs: 3 * 24 * 3_600_000 });
  } catch (error) {
    // refresh_failed: the grant is gone and the tokens were cleared.
    // request_failed: One could not be reached; the tokens were kept, the next run retries.
    // Log it and go on to the next user.
  }
}
```

The try/catch is per user: without it the first user whose grant is gone
stops the job for everyone after them. The job needs a way to list every
user with stored tokens. Without `withinMs` the window is one minute.

The refresh token lives 30 days, and only a live refresh token can renew
the pair. Without the job, a user who stays away that long has to connect
again once their access token ends too. The access token lives as long as
the app's Token lifetime says (30 days unless changed under Advanced, when
creating or editing the app); keep the job's window shorter than that, or
every run refreshes.

## Done when

Everything in "Done when" in `SKILL.md`, reading `refresh_failed` for
`reconnect_required`, and the daily job exists and runs for every connected
user.
