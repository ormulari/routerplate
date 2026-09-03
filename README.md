# routerplate

Schema-validated route handlers for the framework you already have.

[![CI](https://github.com/ormulari/routerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/ormulari/routerplate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/routerplate.svg)](https://www.npmjs.com/package/routerplate)
[![coverage](https://img.shields.io/badge/coverage-%E2%89%A590%25-brightgreen)](https://github.com/ormulari/routerplate/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

You write the handler. routerplate does auth, validation, the response envelope, status codes and errors, and your build goes red when a route tries to skip any of it. Works with Next.js (pages API) and Express, and with any validator that speaks [Standard Schema](https://standardschema.dev): Zod, Valibot, ArkType.

## What it looks like

```typescript
// lib/api/route.ts: built once. The only file that imports your services.
import { createRoute } from 'routerplate/express';

export const { route, get, post, patch, del } = createRoute<User, { db: Db }>({
  authenticate: (req) => getUser(req),
  extend: ({ req }) => ({ db: scopedDb(req) }),
});
```

```typescript
// src/routes/items.ts: one resource, one .all() line
app.all(
  '/items/:id',
  route({
    GET: get({
      params: z.object({ id: z.string().uuid() }),
      response: ItemSchema,
      handler: async ({ db, params }) => {
        const item = await db.items.find(params.id);
        if (!item) throw RouteError.notFound();
        return item; // 200 { data: item }
      },
    }),
    PATCH: patch({
      params: z.object({ id: z.string().uuid() }),
      body: UpdateItemSchema,
      response: ItemSchema,
      handler: async ({ db, params, body }) => db.items.update(params.id, body),
    }),
    DELETE: del({
      params: z.object({ id: z.string().uuid() }),
      handler: async ({ db, params }) => {
        await db.items.delete(params.id);
        return null; // 204
      },
    }),
  }),
);
```

No `res.json()`. No status codes. No try/catch. No hand-written types.

## The rules

- A route file exports one thing: `route({ ... })`.
- Every method is built with a helper: `get`, `post`, `patch`, `put`, `del` or `endpoint`. `route()` accepts nothing else.
- `body`, `query` and `params` are validated before the handler runs. Their types come from the schemas. Don't annotate `ctx` by hand.
- `POST`, `PATCH` and `PUT` declare a `body` schema. Everything but `DELETE` declares a `response` schema, and only the fields in it leave the server.
- Handlers return plain values. Object → `{ data }`. Array → `{ data, count }`. `null` → 204.
- Handlers never touch `res`. To fail, throw.
- Auth is on by default. Opting out is per method and greppable: `requireAuth: false`. For permissions, add `authorize(ctx)`.

## Where each rule is checked

- **Types.** `route()` only takes helper output, so `ctx` is always typed from the schemas. A `post()` without `body` doesn't compile. Without `authenticate`, `ctx.user` is `null`, so no route can pretend a user exists.
- **Boot.** A hand-written config, a bare function or a body-less `POST` throws when the route is built, not on the first request.
- **Lint.** Five ESLint rules catch the same things in review, plus `res.*` calls and inline Express handlers.
- **Runtime.** Every response is validated against its `response` schema, in every environment. Undeclared fields never ship.

That's what makes it safe to let an AI agent write endpoints: skipping validation or inventing an error shape isn't a subtle bug, it's a red build. The whole pattern is seven bullets, which means it fits in a prompt.

## Install

The core has no dependencies. Add your framework and validator; all are optional peers.

| You use           | Install                     | Import from           |
| ----------------- | --------------------------- | --------------------- |
| Next.js pages API | `npm i routerplate next`    | `routerplate/next`    |
| Express           | `npm i routerplate express` | `routerplate/express` |
| Zod ≥3.24         | `npm i zod`                 | just works            |
| Valibot ≥1.0      | `npm i valibot`             | just works            |
| ArkType ≥2.0      | `npm i arktype`             | just works            |

Node ≥ 18.17. Then:

```bash
npx routerplate init   # writes the adapter file, an example route and the ESLint wiring
```

## Wiring

Everything app-specific goes into `createRoute()` once. All optional.

| Option                          | What it does                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `authenticate(req, res)`        | Resolve the caller; `null` means anonymous. Omit it and `ctx.user` is typed `null`.                       |
| `extend({ req, res, user })`    | Per-request context merged into `ctx`: a scoped db client, feature flags.                                 |
| `errorToResponse(error)`        | Map your own error classes to `{ status, body }`. Return `undefined` to fall through.                     |
| `hooks.onBodyValidationFailure` | A failing body is usually a client bug. Report it here; the 400 is unchanged.                             |
| `hooks.onError`                 | Every error response, with the resolved status code and the request.                                      |
| `hooks.log`                     | Where 5xx diagnostics go. Defaults to `console.error`.                                                    |
| `validateResponses`             | Validate handler results against `response` schemas. Default `true`; turn it off only if you've measured. |
| `forwardUnhandledToNext`        | Express only. Hand 500s to `next(error)` so your error middleware owns them.                              |

Per method: `requireAuth: false` skips the 401 and makes `ctx.user` nullable. `authorize(ctx)` runs after validation with the same `ctx` as the handler; return `false` for a 403.

When auth and context come from one object (a Supabase client carrying the caller's JWT is both), return `authContext(user, { db })` from `authenticate`. Worked adapter files: [Supabase](./docs/recipes/supabase.md) · [Clerk](./docs/recipes/clerk.md) · [Auth.js](./docs/recipes/auth-js.md).

## Errors

Every error response is `{ error, code, details? }`.

| What happened                         | Status | `code`               |
| ------------------------------------- | ------ | -------------------- |
| GET / PATCH / PUT ok                  | 200    |                      |
| POST ok                               | 201    |                      |
| DELETE ok, or handler returned `null` | 204    |                      |
| Body, query or params rejected        | 400    | `VALIDATION_ERROR`   |
| Not authenticated                     | 401    | `UNAUTHORIZED`       |
| `authorize` returned `false`          | 403    | `FORBIDDEN`          |
| Method not configured                 | 405    | `METHOD_NOT_ALLOWED` |
| Response failed its schema            | 500    | `INTERNAL_ERROR`     |
| Anything else thrown                  | 500    | `INTERNAL_ERROR`     |

`HEAD` runs the `GET` handler and sends no body. `OPTIONS` answers 204 with an `Allow` header. Every 405 carries `Allow` too.

From a handler, throw `RouteError.notFound()`, `RouteError.forbidden()`, `RouteError.conflict()`, or `new RouteError(message, status, code, details)`. Anything else thrown is a 500 with a generic body; the real error goes to `hooks.onError`. That includes validator errors: by the time a handler runs, input is already valid, so a parse failing inside it is your bug, not the client's.

`details` on a 400 depends on the validator: Zod's `format()` tree, Valibot's `flatten()`, ArkType's summary, loaded lazily when the validator is installed. Otherwise it's `[{ path, message }]`.

## What routerplate doesn't do

CORS, CSRF, rate limiting, body-size limits, security headers, token verification. Those belong in your framework's middleware and run before routerplate does. On Express, mount `express.json({ limit: '100kb' })` yourself.

## ESLint

```js
// eslint.config.js (flat config)
import routerplate from 'routerplate/eslint-plugin';

export default [
  {
    files: ['pages/api/**/*.ts'], // your API glob
    ...routerplate.configs.recommended,
  },
];
```

| Rule                                  | Catches                                      |
| ------------------------------------- | -------------------------------------------- |
| `routerplate/require-route-wrapper`   | a default export that isn't `route()` (Next) |
| `routerplate/no-bare-router-handler`  | `app.get('/x', (req, res) => …)` (Express)   |
| `routerplate/no-manual-response`      | `res.json()`, `res.status()`, … in a handler |
| `routerplate/require-body-schema`     | `POST`/`PATCH`/`PUT` without `body`          |
| `routerplate/require-response-schema` | anything but `DELETE` without `response`     |

## CLI

```bash
npx routerplate init     # detect framework + validator, write the adapter, an example route, ESLint wiring
npx routerplate init --framework express --validator zod --dir lib/api --yes
npx routerplate doctor   # check install, one validator, adapter file, ESLint wiring, peer versions
```

`init` never installs packages and never overwrites without `--force`.

## Why not tRPC / Hono / Fastify / NestJS?

They're frameworks: adopting one means moving your routing, your client, or both. routerplate is a pattern for the framework you already have. It takes the route files you own and makes them stop drifting. Starting fresh and want end-to-end RPC? Use tRPC. Keeping your Next.js or Express app? This.

## Roadmap

V1 is small on purpose. OpenAPI generation, typed clients and more adapters (Next app router, Fastify, Hono) are sketched in [docs/roadmap.md](./docs/roadmap.md).

## Development

```bash
npm install          # Node ≥ 18.17
npm run typecheck && npm run lint && npm test
npm run build        # tsup → dist/ (ESM + CJS + d.ts per entry)
npx changeset        # one per PR; `npx changeset --empty` for docs-only changes
```

Ground rules: the core's `dependencies` stay empty; no static validator or framework imports outside adapters and `src/validators/formatters/`; status codes, the envelope and the error shape are contract, so changing them is a breaking change.

**Security:** report vulnerabilities privately via GitHub (Security tab → Report a vulnerability), not in a public issue.

## License

[MIT](./LICENSE) © routerplate contributors
