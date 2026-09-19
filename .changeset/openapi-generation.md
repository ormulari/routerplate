---
'routerplate': minor
---

Add `routerplate/openapi`: `openapi({ info, paths })` builds an OpenAPI 3.1 document from `route()` results, with parameters, request bodies, success responses and the problem+json error responses read from the same configs the runtime enforces. Schemas convert through Standard JSON Schema (`~standard.jsonSchema`) or a `toJsonSchema` option. `route()` results now carry their config under `ROUTE_DESCRIPTION`, and their type says so, which is what `paths` accepts; a plain handler is a type error there. Custom adapters that wrap the handler copy it with `describeRoute()`.
