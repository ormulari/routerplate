# Roadmap: V2 candidates

V1 deliberately ships without these. Notes on what each would take, for
whenever there's appetite.

---

## OpenAPI follow-ups

`routerplate/openapi` covers what the runtime enforces
([openapi.md](./openapi.md)). What it does not cover yet:

- **A CLI.** `routerplate openapi` that finds routes itself needs a TypeScript
  loader (route files import extensionless `.ts` paths, which Node cannot
  resolve without tsx or a bundler) and, on Express, a source of paths, which
  live in `app.all()` calls and not in the config. A Next-only version could
  derive paths from `pages/api/**` when tsx is installed.
- **Handler-declared errors.** `RouteError.notFound()` and `mapError` results
  are invisible statically. A method slot such as `errors: [404, 409]` would
  document them, at the cost of widening the config the types and lint rules
  are built around.
- **Operation metadata.** `operationId`, `summary`, `tags`, `security`. Client
  generators want `operationId` at least. Same trade as above, or a documented
  post-processing step on the returned object.
- **Shared schemas as components.** Schemas are inlined per operation. Standard
  Schema carries no name, so `$ref`s need a `components: { Item: ItemSchema }`
  option matched by identity.
- **Zod and Valibot without `toJsonSchema`.** Neither ships
  `~standard.jsonSchema` today, so the scaffold's default validator needs the
  option on the first call. Nothing to build: once they ship it, the option
  becomes unnecessary.
- **The Express template.** It mounts `route()` inline on a `Router`, so
  nothing is exported and the full path is not known in the file. Exporting
  the handlers and mounting them by name would make the scaffold documentable
  as written.
- **Express path patterns** beyond `:id` (regex, optional, wildcard) are not
  converted to `{id}`.

---

## Typed client codegen

Since types flow from schemas, a thin generated client (`api.items.get(id)`)
could share them end to end. Needs a design for locating route files per
framework.

---

## Next.js app-router adapter (`routerplate/next-app`)

App-router route handlers are `(request: Request, ctx) => Response` per-method
exports, a natural fit (no method dispatch needed, but the envelope, auth,
validation, and error contract all apply). The ESLint rules already work with
any glob; the runtime needs a Web-Request/Response transport.

---

## Fastify adapter (`routerplate/fastify`)

Fastify has its own schema story (fast-json-stringify); the adapter should NOT
fight it; the proposal is envelope + errors + auth only, with Standard Schema
validation optional. Needs benchmarks to prove we don't wreck Fastify's
serialization win.

---

## Auth presets

V1 ships auth as recipes (docs/recipes/: Supabase, Clerk, Auth.js) plus the
`authContext()` seam, never as SDK integrations. If one recipe proves
dominant, graduate it in two steps: first an `init --auth <provider>` flag
that writes the recipe into the scaffolded adapter file (opinionation in
scaffolding, zero runtime cost), and only then, maybe, a
`routerplate/auth-<provider>` entry point: a thin factory returning
`{ authenticate }`. Criteria for that last step: the provider is resolvable
from `req`/`res` alone, the SDK is stable, and the peer-dep cost is worth it.

---

## Hono adapter (`routerplate/hono`)

Hono runs on edge runtimes where dynamic `import()` of formatters may be
restricted; the graceful-fallback path already handles that, but it needs
real testing on Workers/Deno. Web-standard Request/Response transport shared
with the app-router adapter.
