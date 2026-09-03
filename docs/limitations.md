# Limits and gaps

What routerplate deliberately leaves to you, and where its checks stop.

## Out of scope

CORS, CSRF, rate limiting, body-size limits, security headers, token verification, compression. These belong in framework middleware and run before routerplate does. On Express, mount `express.json({ limit: '100kb' })` and your CORS middleware yourself. routerplate answers `OPTIONS` with an `Allow` header but sets no CORS headers; if your CORS middleware handles preflight first, routerplate never sees it.

## Before routerplate runs

Malformed JSON and oversized bodies are rejected by the body parser in the framework's own error shape. On Express an error middleware fixes that; on Next it cannot be changed. Details and the snippet are in [errors.md](./errors.md#before-routerplate-runs).

If `express.json()` is not mounted at all, `req.body` is `undefined` and every `POST` answers 400 with `errors` about missing fields, which points at the client when the fault is server configuration. `routerplate doctor` cannot detect this; the scaffolded route file says so in a comment.

## What the types and boot checks cover

- Only helper-built configs enter `route()`. A hand-written object or bare function fails to typecheck and throws at boot.
- A `post`, `patch` or `put` without `body` fails to typecheck; an `endpoint()` on a mutating method without `body` throws at boot.
- `ctx.user` is `User | null` on `requireAuth: false` methods and `null` when `createRoute` has no `authenticate`.
- The handler's return type is the `response` schema's input type.

They do not cover a missing `response` schema (lint only), or routes registered without `route()` at all (lint only, see next section).

## What the lint cannot see

The ESLint rules are static and read what a file says, not what runs.

- **Identifiers and spreads are opaque.** `route({ POST: sharedConfig })` and `route({ ...configs })` are skipped. The boot check still applies to what is actually passed.
- **Unknown helpers are opaque.** A wrapper like `myPost({...})` is skipped unless you list it in `helperNames`.
- **`res` aliases are not tracked.** `const r = ctx.res; r.json()` passes `no-manual-response`.
- **Registration through variables is not flagged.** `no-bare-router-handler` flags an inline function on a path literal; `app.get('/x', handler)` is skipped, and so is `app.get(path, ...)` with a variable path.
- **Files outside the glob are not linted.** The rules apply to the `files` you give them, so a route registered from a file elsewhere is not checked.

There is no runtime audit of what is mounted. The types and boot checks cover everything that passes through `route()`; the lint covers the ways to avoid it that appear in source. A route mounted from an identifier in a file outside the glob would slip through all three. That was a deliberate trade: an Express router walk at boot would close it, and it was judged not worth the added machinery.

## Framework specifics

- **Next pages API has no `params` slot.** Dynamic segments arrive merged into `req.query`; put them in the `query` schema.
- **Next app router, Fastify and Hono** are not supported yet. See [roadmap.md](./roadmap.md).
- **`HEAD`** runs the `GET` handler and discards the body. There is no way to make `HEAD` cheaper than `GET`.
- **Express 4 vs 5** differ in what `req.body` is when nothing parsed it (`{}` vs `undefined`); both end up as a 400 from the body schema.

## Runtime knobs that weaken the contract

- `validateResponses: false` removes the only guard against sending fields the `response` schema does not declare. Measure before turning it off.
- `endpoint()` makes every slot optional. It still hits the boot check for a body on mutating methods and the `require-response-schema` lint rule, but nothing forces `query` or `params` schemas on it.
- `requireAuth: false` is the one way to run a handler without a user. It is greppable; grep for it in review.
