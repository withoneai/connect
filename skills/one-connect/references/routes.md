# The two routes on other servers

Read this when the app's server is not the Next.js App Router. The rules in
section 5 of `SKILL.md` hold everywhere: the last path segment is
`authorize` or `callback`, both routes share one folder, and the callback
calls `identifyUser` again.

The server client imports `node:crypto` and uses `Buffer`, so the routes
need a runtime that has both.

## Servers that speak the web `Request` and `Response`

`createOneConnectRoutes(oneConnect, options)` from `@withone/connect/next`
returns `{ GET }`. `GET` takes a web `Request` and nothing else, and returns
a `Response`. Hand it the framework's request.

```ts
import { createOneConnectRoutes } from "@withone/connect/next";

const routes = createOneConnectRoutes(oneConnect, {
  identifyUser: async (request) => /* the signed-in user's id, or null */,
  signInUrl: "/login",
});

// Hono
app.get("/api/one/:action", (c) => routes.GET(c.req.raw));

// SvelteKit: src/routes/api/one/[action]/+server.ts
export const GET = ({ request }) => routes.GET(request);
```

Remix and Bun pass their `request` the same way.

## Express, Fastify, Koa and plain Node

`createOneConnectHandlers(oneConnect, options)` from `@withone/connect/node`
returns `{ authorize, callback }`. Each is a `(request, response)` handler on
Node's `IncomingMessage` and `ServerResponse`.

```ts
import { createOneConnectHandlers } from "@withone/connect/node";

const { authorize, callback } = createOneConnectHandlers(oneConnect, {
  identifyUser: (request) => /* the signed-in user's id, or null */,
  signInUrl: "/login",
});

app.get("/api/one/authorize", authorize);   // Express
app.get("/api/one/callback", callback);
```

- The options have the same names as above (`identifyUser`, `loginHintFor`,
  `signInUrl`, `onComplete`), but `identifyUser` and `loginHintFor` receive
  the `IncomingMessage`, not a web `Request`.
- Express's `req` is that object, so `req.session` is there at run time.
  In TypeScript the parameter is typed `IncomingMessage`, so cast it to read
  the session.
- With Fastify call the handlers with `request.raw` and `reply.raw`. With
  Koa call them with `ctx.req` and `ctx.res`.
- The handlers never reject. They answer `400` for a request they cannot
  read and `500` when something inside throws.

## What the route options do

| Option | What it does |
|---|---|
| `identifyUser(request)` | The app's own id for the signed-in user, or null. Required. Called on both routes. |
| `signInUrl` | Where a signed-out visitor is sent. Without it the routes answer `401`. |
| `loginHintFor(request)` | The user's email, to pre-fill One's sign-in. A hint: the user can change it. |
| `onComplete({ userId, result })` | Called after a callback with `result.outcome` (`connected`, `declined` or `failed`) and, on failure, `result.code` and `result.message`. For logs; never show the message to users. Not called when `identifyUser` returned null on the callback. |

## A server neither adapter fits

Use the two legs on the client directly. This is the only case where the
app handles the cookie and the redirects itself.

```ts
// the authorize route
const { redirectUrl, cookie } = oneConnect.startAuthorization({
  loginHint: email,                                                          // optional
  returnTo: new URL(request.url).searchParams.get("one_return_to") ?? undefined,
});
// set the cookie: cookie.name, cookie.value, and cookie.options
// ({ httpOnly, secure, sameSite: "lax", maxAge, path }); then 302 to redirectUrl

// the callback route
const result = await oneConnect.completeAuthorization({
  userId,                           // the app's signed-in user
  url: request.url,                 // the full callback URL, with its query string
  getCookie: (name) => /* that cookie's value from the request, or undefined */,
});
// delete the cookie named result.clearCookieName (on the same path), then 302 to result.redirectUrl
```

- `completeAuthorization` never throws for a failed flow. Read
  `result.outcome` (`connected`, `declined` or `failed`), and on failure
  `result.code` (`declined`, `expired` or `failed`) and `result.message`,
  which is for logs only.
- Return the cookie's value exactly as `cookie.value` was set. If the
  framework encodes cookie values, decode it the same way.
- Only a path on the app is kept as `returnTo`. A full URL, or a path over
  512 characters, is dropped and the configured `returnTo` applies.
- The adapters also keep at most five unfinished flows per browser: when a
  sixth starts they expire the oldest `one_tx_…` cookie. Do the same if
  users can start many flows.
