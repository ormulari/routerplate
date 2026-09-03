# The pattern

A route file exports one `route()` call. Nothing else touches the wire.

```typescript
export default route({
  GET: get({
    query: QuerySchema, // optional; ctx.query is typed from it
    response: ItemSchema, // what leaves the server, and nothing else
    handler: async ({ db, user, query }) => item,
  }),
  POST: post({
    body: CreateSchema, // required on POST/PATCH/PUT
    response: ItemSchema,
    authorize: ({ user, body }) => body.ownerId === user.id, // optional → 403
    handler: async ({ db, user, body }) => newItem,
  }),
  DELETE: del({
    query: QuerySchema,
    handler: async ({ db, query }) => null, // → 204
  }),
});
```

On Express the same config mounts with `app.all(path, route({ ... }))` and
methods get a third schema slot, `params`.

## The rules

- A route file exports one thing: `route({ ... })`.
- Every method is built with `get`, `post`, `patch`, `put`, `del` or `endpoint`.
  `route()` accepts nothing else, so `ctx` is always typed from the schemas.
- `body`, `query` and `params` are validated before the handler runs. Don't
  annotate `ctx` by hand; if a type is wrong, fix the schema.
- `POST`, `PATCH` and `PUT` declare a `body` schema. Everything but `DELETE`
  declares a `response` schema. Only the fields in it are sent.
- The handler's return value is the response body. `null` → 204.
- Handlers never touch `res`. To fail, throw `RouteError.notFound()`,
  `.forbidden()`, `.conflict()` or `new RouteError(detail, status, code)`.
- Auth is on by default. `requireAuth: false` is per method and makes
  `ctx.user` nullable. `authorize(ctx)` returns `false` for a 403.

## What happens on a request

1. Method dispatch. `OPTIONS` → 204 + `Allow`. `HEAD` runs as `GET` without a body. Unknown → 405.
2. `authenticate(req, res)`. No user and `requireAuth` not `false` → 401. A throw → 500.
3. `extend({ req, res, user })` builds the rest of `ctx`.
4. `body`, then `query`, then `params` are validated. Any failure → 400.
5. `authorize(ctx)`, if declared. `false` → 403.
6. `handler(ctx)`.
7. The result is validated against `response` and sent with the method's status.

Anything thrown along the way becomes an RFC 9457 problem; see
[errors.md](./errors.md).

## Status codes

| Method | Success | Notes                           |
| ------ | ------- | ------------------------------- |
| GET    | 200     | 204 if the handler returns null |
| POST   | 201     |                                 |
| PATCH  | 200     |                                 |
| PUT    | 200     |                                 |
| DELETE | 204     | handler returns `null`          |

## Where the services live

One file per app calls `createRoute()` and injects `authenticate`, `extend`,
`mapError` and hooks. It's the only file that imports your auth module,
database client or error tracker. Route files import `route` and the helpers
from it and nothing else. `npx routerplate init` writes it.

Auth stays inside `route()`, not in framework middleware. Nobody can verify
that every route sits behind a middleware, but the wrapper's 401 is per route,
and opting out is a greppable `requireAuth: false`.
