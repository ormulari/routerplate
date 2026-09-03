# API reference

Two entry points do the work: `routerplate/express` and `routerplate/next`. Both export the same names; only the framework types differ. The root `routerplate` entry exports the shared types and the low-level runtime for writing your own adapter.

## `createRoute<User, Extras>(options)`

Builds `route()` and the method helpers for your app. Call it once, in the adapter file.

- `User`: your authenticated-user type. Whatever `authenticate` resolves.
- `Extras`: an object type merged into every handler's `ctx`, e.g. `{ db: Db }`. Defaults to nothing.

Returns `{ route, get, post, patch, put, del, endpoint }`.

When `options.authenticate` is omitted, the return type is bound to `User = null`: `ctx.user` is `null` in every handler and no method ever answers 401. This is an overload, not a runtime flag, so a scaffolded project cannot read `user.id` before auth exists.

### Options

| Option                          | Type                                        | Default         | Notes                                                                                                                                                        |
| ------------------------------- | ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authenticate`                  | `(req, res) => User \| null \| AuthContext` | none            | `null` = anonymous → 401 unless the method has `requireAuth: false`. A throw is a 500. Return `authContext(user, extras)` to contribute context in one call. |
| `extend`                        | `({ req, res, user }) => Extras`            | none            | Runs after auth, before validation. On key conflicts with `authContext` extras, `extend` wins.                                                               |
| `mapError`                      | `(error) => RouteError \| undefined`        | none            | Runs first in the error path. Return a `RouteError` to answer with it; `undefined` falls through.                                                            |
| `hooks.onError`                 | `(error, ctx) => void`                      | none            | Every error response. `ctx` has `req`, `method`, `path` (no query string), `statusCode`, `user`.                                                             |
| `hooks.onBodyValidationFailure` | `(failure, ctx) => void`                    | none            | Only body failures. `failure` has the raw Standard Schema `issues` and the `errors` sent to the client.                                                      |
| `hooks.log`                     | `(message, payload?) => void`               | `console.error` | 5xx diagnostics and hook failures.                                                                                                                           |
| `validateResponses`             | `boolean`                                   | `true`          | Validate handler results against `response`. Turning it off removes the over-exposure guard.                                                                 |
| `forwardUnhandledToNext`        | `boolean`                                   | `false`         | Express only. 500s go to `next(error)` instead of being answered.                                                                                            |

Hooks are observability only. A throwing hook is logged and the response is unaffected.

## `route(definition)`

Takes an object with any of `GET`, `POST`, `PATCH`, `PUT`, `DELETE`, each a helper-built `MethodConfig`. On Express it returns a `RequestHandler`; mount it with `app.all(path, route({ ... }))`. On Next it returns a `NextApiHandler`; `export default` it.

`route()` throws when it is called, not on the first request, if:

- a method value was not built by a helper (a plain object or a bare function);
- `POST`, `PATCH` or `PUT` has no `body` schema.

## Method helpers

`get`, `post`, `patch`, `put`, `del` and `endpoint` take one config object and return an opaque `MethodConfig`. The generics stay on the helper call, where they type `ctx`; `route()` never sees them.

| Helper                   | `query` | `params` (Express) | `body`   | `response` | Handler returns |
| ------------------------ | ------- | ------------------ | -------- | ---------- | --------------- |
| `get`                    | ✓       | ✓                  |          | ✓          | the body        |
| `post` / `patch` / `put` | ✓       | ✓                  | required | ✓          | the body        |
| `del`                    | ✓       | ✓                  |          |            | `null`          |
| `endpoint`               | ✓       | ✓                  | ✓        | ✓          | the body        |

`endpoint` is the escape hatch with every slot optional. It still hits the boot check for a body on mutating methods, and the `require-response-schema` lint rule.

### Config fields

| Field         | Type                             | Effect                                                                                                                               |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `query`       | Standard Schema                  | Validates the query string. `ctx.query` is the schema's output type. Without it, `ctx.query` is the framework's raw query type.      |
| `params`      | Standard Schema                  | Express only. Validates path params. Next merges dynamic segments into `req.query`; put them in `query`.                             |
| `body`        | Standard Schema                  | Validates the parsed body. `ctx.body` is the output type. Validated on any method that declares it.                                  |
| `response`    | Standard Schema                  | The handler must return the schema's _input_ type; the validated output is sent. Unknown keys are stripped by validators that strip. |
| `requireAuth` | `boolean`, default `true`        | `false` skips the 401 and types `ctx.user` as `User \| null`.                                                                        |
| `authorize`   | `(ctx) => boolean \| Promise`    | Runs after validation, before the handler, with the handler's exact `ctx`. `false` → 403 `FORBIDDEN`.                                |
| `handler`     | `(ctx) => body \| Promise<body>` | Your logic.                                                                                                                          |

### `ctx`

```typescript
{
  req;      // framework request
  res;      // framework response; don't write to it
  user;     // User, or User | null with requireAuth: false, or null without authenticate
  body;     // output of `body`; never on get/del
  query;    // output of `query`, or the raw framework query
  params;   // Express only: output of `params`, or the raw params
  ...extras // from authContext() and extend()
}
```

## `RouteError`

```typescript
new RouteError(detail: string, status: number, code = 'ERROR', extensions?: Record<string, unknown>)
RouteError.notFound(detail = 'Not found', extensions?)   // 404 NOT_FOUND
RouteError.forbidden(detail = 'Forbidden', extensions?)  // 403 FORBIDDEN
RouteError.conflict(detail = 'Conflict', extensions?)    // 409 CONFLICT
error.toProblem(instance: string): Problem
```

`extensions` are extra top-level members of the problem body. They may set `type` and `title`; `status`, `detail`, `instance` and `code` always come from the error itself.

`ErrorCode` is the union of codes routerplate emits: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`. `code` accepts any string, the union is for autocomplete.

`Problem` and `ProblemError` are the response types; `PROBLEM_CONTENT_TYPE` is `'application/problem+json'`. See [errors.md](./errors.md).

## `authContext(user, extras)`

Return this from `authenticate` when one object yields both the user and request context, like a Supabase client that resolves the caller and is the RLS-scoped database. The result is branded with `Symbol.for('routerplate.authContext')`, so a plain user object with a `user` key is never mistaken for it. `extend` runs afterwards and wins on key conflicts.

## Building an adapter

`routerplate` (the root entry) exports `createRouteRuntime(transport, deps)`. A `Transport<Req, Res>` tells the runtime how to read and write your framework:

| Member                                         | Purpose                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `method(req)`                                  | HTTP method. Compared case-insensitively.                                 |
| `path(req)`                                    | Request path. The runtime strips the query string.                        |
| `body(req)`, `query(req)`, `params?(req)`      | Raw inputs. Omit `params` if the framework merges them into the query.    |
| `setHeader(res, name, value)`                  | Used for `Allow`.                                                         |
| `responseEnded(res)`                           | True once something finished the response; the runtime then stays silent. |
| `headersSent?(res)`                            | True once headers are on the wire; errors can then only be forwarded.     |
| `sendJson(res, status, payload, contentType?)` | Serialize JSON. `contentType` is set for problem responses.               |
| `sendEmpty(res, status)`                       | End with no body.                                                         |

The returned runtime takes a route definition and returns `(req, res, forward?) => Promise<void>`. `forward` is Express's `next`; pass it if your framework has an equivalent. The Express and Next adapters in `src/adapters/` are the reference implementations, about 60 lines each after the types.

Also exported for adapters: `isStandardSchema`, `validateSchema`, `toProblemErrors`, `brandMethodConfig`, `isMethodConfig`.

## ESLint plugin

`routerplate/eslint-plugin` exports a flat-config plugin with `configs.recommended`, which turns on every rule as an error. Scope it with `files`; the rules don't check paths.

| Rule                      | Flags                                                                                                                                                                                | Options                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `require-route-wrapper`   | A default export that is not a `route()` call. For Next route files.                                                                                                                 | `routeNames` (default `['route']`) |
| `no-bare-router-handler`  | `app.get('/x', fn)` and friends: an inline function registered on a path literal. For Express.                                                                                       | none                               |
| `no-manual-response`      | `res.json()`, `res.send()`, `res.status()`, `res.end()`, `res.write*()`, `res.setHeader()`, `res.cookie()`, `res.redirect()`, `res.sendStatus()`, `res.sendFile()` inside `route()`. | `routeNames`, `forbiddenMembers`   |
| `require-body-schema`     | `POST`/`PATCH`/`PUT` without `body`, or given a bare function.                                                                                                                       | `routeNames`, `helperNames`        |
| `require-response-schema` | Any method but `DELETE` without `response`.                                                                                                                                          | `routeNames`, `helperNames`        |

The rules read object literals and helper calls. A config passed as an identifier or built by a function they don't know is opaque and skipped. See [limitations.md](./limitations.md).

## CLI

```
npx routerplate init [options]
  --framework next|express          default: detected from package.json
  --validator zod|valibot|arktype   default: detected from package.json
  --dir <path>                      adapter directory, default lib/api
  --eslint / --no-eslint            wire routerplate/eslint-plugin, default yes
  --eslint-glob <glob>              files the rules apply to
  --yes, -y                         accept defaults, no prompts
  --force                           overwrite existing files

npx routerplate doctor [--dir <path>]
```

`init` prompts for anything not given when run in a terminal, and uses defaults otherwise. It writes the adapter file, one example route (`pages/api/example.ts` or `src/routes/items.ts`), and an `eslint.config.mjs` if none exists; with an existing config it prints the block to add. It never installs packages and never overwrites without `--force`. Re-runs are idempotent.

`doctor` checks that routerplate and a supported validator are installed, that an adapter file calls `createRoute`, that a flat ESLint config references the plugin, and that peer versions meet the minimums. Exit code 1 on any failure.
