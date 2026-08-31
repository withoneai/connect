---
name: one-connect-setup-production
description: Wire @withone/connect into an application against One's PRODUCTION environment (api.withone.ai) — the button, the two backend routes, secure token storage/refresh, using the grant, and a go-live checklist. Use when shipping One Connect to real users.
---

# One Connect — production setup

You are wiring **One Connect** into this application for real users: they
grant it scoped, revocable access to their own One-connected tools via
standard OAuth 2.1 (authorization-code + PKCE). All secrets and tokens
live on this app's backend; the frontend gets one button. This skill
targets **production** (`api.withone.ai`) — which is also the SDK's
default when no endpoint env vars are set.

## 0 · Collect from the human first

Created at https://app.withone.ai → Settings → OAuth Apps → New OAuth App
(client type **Confidential**; the secret is shown exactly once):

- `ONE_CLIENT_ID`
- `ONE_CLIENT_SECRET` (`one_secret_…`)
- The **registered redirect URI** — must be `https` in production and must
  EXACTLY equal the callback URL implemented below.
- Access-token lifetime chosen at creation: 7 days / 30 days / 90 days /
  1 year (nothing else is accepted).
- Optional: `ONE_PERMISSION_SET` (uuid) — the curated connector ask the
  consent screen pre-fills; users can only narrow it.

Tell the human up front:
- **Browser support today:** the full cross-site flow works on Chromium
  browsers. Safari and Firefox block third-party cookies and the final
  consent submission does not yet ride the cookieless flow token — users
  on those browsers will fail at the Authorize press until One ships
  that change. Plan messaging accordingly.
- Users can revoke or narrow the grant anytime from their One dashboard;
  the app must treat 401/403 as "prompt to reconnect", never as a bug.

## 1 · Environment

```bash
# .env — server only. NEVER expose the secret to a browser or logs.
ONE_CLIENT_ID=...
ONE_CLIENT_SECRET=one_secret_...
ONE_REDIRECT_URI=https://yourapp.com/api/one/callback   # the registered value
ONE_PERMISSION_SET=...            # optional
# No endpoint vars needed: production (https://api.withone.ai) is the default.
# If the app's config layer wants them explicit:
# ONE_AUTHORIZE_URL=https://api.withone.ai/oauth/authorize
# ONE_TOKEN_URL=https://api.withone.ai/oauth/token
# ONE_API_URL=https://api.withone.ai/v1
```

## 2 · Frontend — one button

```bash
npm install @withone/connect
```

```tsx
"use client";
import { useOneConnect } from "@withone/connect";

export function ConnectWithOne() {
  const { open } = useOneConnect({
    // MUST be absolute — the card runs inside an iframe.
    authorize: { url: `${window.location.origin}/api/one/authorize` },
    appTheme: "light",              // or "dark"
    onSuccess: () => {/* backend already stored the tokens; refresh app state */},
    onError: (error) => console.error(error),
    onClose: () => {},
  });
  return <button onClick={open}>Connect your tools</button>;
}
```

No completion page exists: when the app's callback redirects to any
same-origin URL carrying `?one_connect=success` (or `error` +
`one_connect_message`), the SDK reads it off its frame, shows an
"Access granted" card, and fires `onSuccess`.

## 3 · Backend route 1 — authorize

```ts
// app/api/one/authorize/route.ts   (Next.js App Router; adapt per stack)
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const ONE_AUTHORIZE_URL =
  process.env.ONE_AUTHORIZE_URL ?? "https://api.withone.ai/oauth/authorize";

export async function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const url = new URL(ONE_AUTHORIZE_URL);
  url.searchParams.set("client_id", process.env.ONE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", process.env.ONE_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "user:connections:read user:connections:write");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (process.env.ONE_PERMISSION_SET)
    url.searchParams.set("permission_set", process.env.ONE_PERMISSION_SET);
  const userEmail = null; // ← this app's signed-in user email, if known
  if (userEmail) url.searchParams.set("login_hint", userEmail);

  const res = NextResponse.redirect(url.toString(), 302);
  // One cookie PER flow — the name carries the state. Users open the
  // modal more than once (retries, second tabs); a single shared cookie
  // would be overwritten by each start, so only the LAST-opened flow
  // could ever complete. Expiry reaps the strays.
  res.cookies.set(`one_tx_${state}`, verifier, {
    httpOnly: true,
    secure: true,        // production is https
    // None, not Lax: the callback navigation happens INSIDE the SDK's
    // iframe at the end of a cross-site redirect chain (One -> here).
    // Browsers only exempt TOP-LEVEL navigations from SameSite on
    // cross-site-redirected requests, so a Lax cookie is silently
    // dropped and the state check fails.
    sameSite: "none",
    maxAge: 600,         // matches One's 10-minute single-use code
    // CRITICAL: path must cover the CALLBACK route's path — a narrower
    // path means the browser never sends the cookie to the callback and
    // every exchange fails with a state mismatch.
    path: "/",
  });
  return res;
}
```

## 4 · Backend route 2 — callback

Must live at the EXACT registered redirect URI path.

```ts
// app/api/one/callback/route.ts
import { NextRequest, NextResponse } from "next/server";

const ONE_TOKEN_URL =
  process.env.ONE_TOKEN_URL ?? "https://api.withone.ai/oauth/token";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const err = req.nextUrl.searchParams.get("error");
  // The state that came back selects its own cookie — not finding one
  // IS the CSRF failure (forged or stale state has no cookie).
  const verifier = state ? req.cookies.get(`one_tx_${state}`)?.value : undefined;

  const fail = (message: string) => {
    const r = NextResponse.redirect(
      new URL(`/?one_connect=error&one_connect_message=${encodeURIComponent(message)}`, req.url), 302);
    if (state) r.cookies.delete(`one_tx_${state}`);
    return r;
  };
  if (err === "access_denied") return fail("You cancelled the request.");

  if (!code || !state || !verifier)
    return fail("The sign-in attempt expired or was tampered with.");

  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const tokenRes = await fetch(ONE_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`,
               "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.ONE_REDIRECT_URI!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail("One rejected the code exchange.");

  const t = await tokenRes.json();
  // Persist encrypted, in the app's database, keyed by ITS user:
  // { accessToken: t.access_token, refreshToken: t.refresh_token,
  //   expiresAt: Date.now() + t.expires_in * 1000 }
  await saveOneTokens(/* your storage */);

  const ok = NextResponse.redirect(new URL("/?one_connect=success", req.url), 302);
  ok.cookies.delete(`one_tx_${state}`);
  return ok;
}
```

## 5 · Refresh (Basic-authenticated, rotate BOTH tokens)

Refresh tokens last 30 days and rotate on every use; reusing an old one
revokes the entire token family. The exchange must be Basic-authenticated
— the public-client form (client_id in the body) is rejected with 401.

```ts
const ONE_TOKEN_URL =
  process.env.ONE_TOKEN_URL ?? "https://api.withone.ai/oauth/token";

export async function getOneAccessToken(userId: string): Promise<string> {
  const t = await loadOneTokens(userId);
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;

  const basic = Buffer.from(
    `${process.env.ONE_CLIENT_ID}:${process.env.ONE_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(ONE_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`,
               "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token",
                                refresh_token: t.refreshToken }),
  });
  if (!res.ok) {
    await clearOneTokens(userId);           // dead family — force reconnect
    throw new Error("One refresh failed — user must reconnect");
  }
  const next = await res.json();
  await saveOneTokens(userId, {             // BOTH tokens — rotation!
    accessToken: next.access_token,
    refreshToken: next.refresh_token,
    expiresAt: Date.now() + next.expires_in * 1000,
  });
  return next.access_token;
}
```

Concurrency note: serialize refreshes per user (a lock or single-flight);
two racing refreshes with the same token trip reuse detection and revoke
the family.

## 6 · Using the grant

```ts
const ONE_API_URL = process.env.ONE_API_URL ?? "https://api.withone.ai/v1";
const token = await getOneAccessToken(userId);

// Discover what the user granted (ungranted connections are invisible):
const res = await fetch(`${ONE_API_URL}/connections`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

Execute actions through `/v1/passthrough/*` with the same bearer. One
enforces the user's exact grant (down to per-action rules) on every call;
out-of-grant calls return 403 the app cannot override.

## 7 · Production hardening — non-negotiable

- Secret only in server env/secret manager; never in client bundles,
  logs, or error reports.
- Tokens encrypted at rest, keyed by the app's user; delete on user
  deletion and on refresh-family death.
- 401/403 from One → clear stored tokens and surface a "Reconnect"
  prompt. Users revoke from their One dashboard at any time.
- The callback must validate `state` before touching the code — never
  exchange on a state mismatch.
- Registered redirect URIs: https only, exact match, no wildcards.

## 8 · Go-live checklist — done when ALL pass

1. Full grant on a production account in Chromium: button → card →
   sign-in code (real inbox) → consent → "Access granted".
2. Stored `expires_in` matches the chosen TTL (e.g. 604800 for 7 days).
3. Refresh returns a rotated pair; a deliberately repeated old refresh
   token gets refused and the app's reconnect path engages.
4. `GET /v1/connections` with the bearer returns only granted rows; one
   out-of-grant passthrough call returns 403.
5. Revoking from the user's One dashboard makes the app's next call 401
   and the app shows its reconnect prompt.
6. Safari/Firefox users see a sensible experience (documented limitation
   or Chromium guidance) rather than a silent failure.
