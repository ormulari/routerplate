# routerplate

Schema-validated route handlers for the framework you already have.

[![CI](https://github.com/ormulari/routerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/ormulari/routerplate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/routerplate.svg)](https://www.npmjs.com/package/routerplate)
[![coverage](https://img.shields.io/badge/coverage-%E2%89%A590%25-brightgreen)](https://github.com/ormulari/routerplate/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Why

Every route file in a REST API repeats the same five things: check who's calling, validate the input, run the logic, pick a status code, shape the error. Each copy drifts a little, and the drift is where the bugs and the leaks live. With AI agents writing more of those files, the drift gets faster.

routerplate moves the repeated parts into one place and makes skipping them fail loudly. You wire your services once in an adapter file. Route files declare schemas and a handler. The runtime does auth, validation, status codes and errors. Types, a boot-time check, an ESLint plugin and runtime response validation each enforce the same short contract, so a route that skips validation or invents its own error shape is a red build, not a production surprise.

It works with Next.js (pages API) and Express, and with any validator that speaks [Standard Schema](https://standardschema.dev): Zod, Valibot, ArkType. The core has no dependencies.

## Quick start

```bash
npm i routerplate zod express    # or next; any Standard Schema validator works
npx routerplate init             # writes the adapter file, an example route and ESLint wiring
```

The adapter file is built once and is the only file that imports your services:

```typescript
// lib/api/route.ts
import { createRoute } from 'routerplate/express';

export const { route, get, post, patch, del } = createRoute<User, { db: Db }>({
  authenticate: (req) => getUser(req),
  extend: ({ req }) => ({ db: scopedDb(req) }),
});
```

Route files import from it and declare each method:

```typescript
// src/routes/items.ts
app.all(
  '/items/:id',
  route({
    GET: get({
      params: z.object({ id: z.string().uuid() }),
      response: ItemSchema,
      handler: async ({ db, params }) => {
        const item = await db.items.find(params.id);
        if (!item) throw RouteError.notFound();
        return item; // 200
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
- The handler's return value is the response body. `null` → 204.
- Handlers never touch `res`. To fail, throw.
- Auth is on by default. Opting out is per method and greppable: `requireAuth: false`. For permissions, add `authorize(ctx)`.

## How the rules are enforced

- **Types.** `route()` only takes helper output, so `ctx` is always typed from the schemas. A `post()` without `body` doesn't compile. Without `authenticate`, `ctx.user` is `null`, so no route can pretend a user exists.
- **Boot.** A hand-written config, a bare function or a body-less `POST` throws when the route is built, not on the first request.
- **Lint.** Five ESLint rules catch the same things in review, plus `res.*` calls and inline Express handlers.
- **Runtime.** Every response is validated against its `response` schema, in every environment. Undeclared fields never ship.

## API

The full reference is in [docs/api.md](./docs/api.md). This is the shape of it.

### `createRoute<User, Extras>(options)`

Import from `routerplate/express` or `routerplate/next`. Returns `route` and the method helpers, bound to your `User` and `Extras` types. Every option is optional.

| Option                       | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `authenticate(req, res)`     | Resolve the caller. `null` means anonymous. Omit it and `ctx.user` is typed `null`.            |
| `extend({ req, res, user })` | Per-request context merged into `ctx`, such as a scoped db client.                             |
| `mapError(error)`            | Translate your own error classes into a `RouteError`.                                          |
| `hooks`                      | `onError`, `onBodyValidationFailure`, `log`. Observability only; they never change a response. |
| `validateResponses`          | Default `true`. The guard against sending undeclared fields.                                   |
| `forwardUnhandledToNext`     | Express only. Hand 500s to `next(error)` so your error middleware owns them.                   |

### Method helpers

`get`, `post`, `patch`, `put`, `del` and `endpoint` each take one config object and return an opaque `MethodConfig` for `route()`.

| Field         | Available on                                       | Effect                                                             |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `query`       | all                                                | Schema for the query string. Typed and validated into `ctx.query`. |
| `params`      | all, Express only                                  | Schema for path params. Next merges them into `query`.             |
| `body`        | `post`/`patch`/`put` required, `endpoint` optional | Schema for the body. Typed and validated into `ctx.body`.          |
| `response`    | all but `del`                                      | What the handler returns. Validated on the way out.                |
| `requireAuth` | all                                                | `false` lets anonymous callers in and makes `ctx.user` nullable.   |
| `authorize`   | all                                                | Runs after validation with the handler's `ctx`. `false` → 403.     |
| `handler`     | all                                                | Your logic. Receives `ctx`, returns the response body.             |

`ctx` is `{ req, res, user, body, query, params, ...extras }`, with every field typed from the schemas and from `createRoute`.

### Responses and errors

Success is the handler's return value with the method's status: 200, 201 for `POST`, 204 for `DELETE` or `null`. Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problems sent as `application/problem+json`:

```json
{
  "title": "Not Found",
  "status": 404,
  "detail": "Item not found",
  "instance": "/items/99",
  "code": "NOT_FOUND"
}
```

Throw `RouteError.notFound()`, `.forbidden()`, `.conflict()` or `new RouteError(detail, status, code)` from a handler. Anything else thrown is a 500 with a generic body, and the real error goes to your hooks. Validation failures add `errors` with one JSON Pointer per issue. Everything about errors, including what happens before routerplate runs, is in [docs/errors.md](./docs/errors.md).

## ESLint

```js
// eslint.config.js
import routerplate from 'routerplate/eslint-plugin';

export default [{ files: ['pages/api/**/*.ts'], ...routerplate.configs.recommended }];
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
npx routerplate init      # detect framework + validator, write the adapter, an example route, ESLint wiring
npx routerplate doctor    # check install, validator, adapter file, ESLint wiring, peer versions
```

`init` never installs packages and never overwrites without `--force`. Flags are in [docs/api.md](./docs/api.md#cli).

## Docs

- [The pattern](./docs/pattern.md): the contract and what happens on a request.
- [API reference](./docs/api.md): every option, helper field, type and CLI flag.
- [Error handling](./docs/errors.md): the problem format, logging, hooks, and the body-parser gap.
- [Limits and gaps](./docs/limitations.md): what routerplate doesn't do and what the lint can't see.
- Recipes: [Supabase](./docs/recipes/supabase.md) · [Clerk](./docs/recipes/clerk.md) · [Auth.js](./docs/recipes/auth-js.md).
- [Roadmap](./docs/roadmap.md).

## Why not tRPC / Hono / Fastify / NestJS?

They're frameworks: adopting one means moving your routing, your client, or both. routerplate is a pattern for the framework you already have. It takes the route files you own and makes them stop drifting. Starting fresh and want end-to-end RPC? Use tRPC. Keeping your Next.js or Express app? This.

## Development

```bash
npm install          # Node ≥ 18.17
npm run typecheck && npm run lint && npm test
npm run build        # tsup → dist/ (ESM + CJS + d.ts per entry)
npx changeset        # one per PR; `npx changeset --empty` for docs-only changes
```

Ground rules: the core's `dependencies` stay empty; no static validator or framework imports outside the adapters; status codes and the problem shape are contract, so changing them is a breaking change.

**Security:** report vulnerabilities privately via GitHub (Security tab → Report a vulnerability), not in a public issue.

## License

[MIT](./LICENSE) © routerplate contributors
