# Security

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue.

Email **hello@withone.ai** with the subject `Security: @withone/connect`, and include:

- the version of `@withone/connect`, and the entry point involved (`/server`, `/next`, `/node`, `/react`, `/vue`, `/svelte` or the browser bundle)
- what an attacker can do, and the steps to reproduce it
- any proof of concept, logs or screenshots

Fixes ship in a new release of the latest version and are listed in the [changelog](CHANGELOG.md). Upgrade to the latest version to receive them.

## How the SDK protects your users

- The client secret and the connect key are read on your server only; the browser entry points never see them.
- Every connect attempt carries a fresh `state` and a PKCE verifier in an HttpOnly cookie scoped to your routes. A callback without them is refused and its code is never exchanged.
- The browser shows fixed text for a failed flow (`declined`, `expired`, `failed`), never text taken from the URL.
- One checks the user's grant on every call; the user can narrow or revoke it from their One dashboard at any time.
