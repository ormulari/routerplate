# Roadmap: V2 candidates

V1 deliberately ships without these. Notes on what each would take, for
whenever there's appetite.

---

## OpenAPI generation from route configs

Route configs already carry everything an OpenAPI path item needs (method,
query/params/body schemas, response schema, status map). Proposal: a
`routerplate openapi` CLI command that statically imports route modules and
emits an OpenAPI 3.1 document. Blockers to discuss: schema→JSON-Schema
conversion is validator-specific (zod-to-json-schema vs @valibot/to-json-schema
vs arktype's built-in), and bare handlers have nothing to describe.

---

## Typed client codegen

Since types flow from schemas, a thin generated client (`api.items.get(id)`)
could share them end to end. Needs a design for locating route files per
framework and for the envelope types (`{ data }`, `{ data, count }`).

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
