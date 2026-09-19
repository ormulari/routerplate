# OpenAPI

`routerplate/openapi` turns `route()` results into an OpenAPI 3.1 document. The runtime already knows each method's schemas, status code, auth and error shape; this reads the same config.

## Usage

```typescript
import fs from 'node:fs';
import { openapi } from 'routerplate/openapi';
import { itemRoute, itemsRoute } from './routes/items';

const doc = openapi({
  info: { title: 'Items', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/items': itemsRoute,
    '/items/{id}': itemRoute, // Express's '/items/:id' works too
  },
});

fs.writeFileSync('openapi.json', JSON.stringify(doc, null, 2));
```

`paths` maps a path template to what `route()` returned, so the route file has to export it. On Express: `export const itemRoute = route({ ... })`, then `app.all('/items/:id', itemRoute)`. On Next it is the default export already; the template is the file path with `[id]` written as `{id}`. Only `route()` results typecheck as values; a plain handler is rejected by the types, and by a throw for JavaScript callers.

Nothing is written to disk. Run the snippet from a script (`npx tsx scripts/openapi.ts`) and commit the output, or serve it from a route.

## Schemas to JSON Schema

Each schema converts through its own [Standard JSON Schema](https://standardschema.dev) converter, `~standard.jsonSchema`, targeting draft 2020-12. ArkType has one built in. For a validator that does not, pass `toJsonSchema`:

```typescript
import { z } from 'zod'; // Zod 4 ('zod/v4' on 3.25)

openapi({
  // ...
  toJsonSchema: (schema, use) =>
    z.toJSONSchema(schema as z.ZodType, { io: use, target: 'draft-2020-12' }),
});
```

`use` is `'input'` for `body`, `query` and `params`, what the client sends, and `'output'` for `response`, what goes on the wire after transforms and defaults. Zod 3 has `zod-to-json-schema`; Valibot has `@valibot/to-json-schema`.

## What comes out

| Config                                                | OpenAPI                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `params`                                              | One `in: path` parameter per property, all required.                                                                           |
| `query`                                               | One `in: query` parameter per property, `required` from the schema. A property named in the path template is a path parameter. |
| `body`                                                | `requestBody`, `application/json`, required.                                                                                   |
| `response`                                            | The method's success status (200, 201) with `application/json`.                                                                |
| `DELETE`                                              | `204`, no content.                                                                                                             |
| any of `body`, `query`, `params`                      | `400`                                                                                                                          |
| `requireAuth` not `false`, adapter has `authenticate` | `401`                                                                                                                          |
| `authorize`                                           | `403`                                                                                                                          |
| every method                                          | `500`                                                                                                                          |

Error responses are `application/problem+json` and reference `#/components/schemas/Problem`, the RFC 9457 shape from [errors.md](./errors.md). A template variable no schema mentions is declared as a string path parameter, since OpenAPI requires every variable to be declared. The Next rule (a `query` property named in the template becomes a path parameter) is how dynamic segments come out right.

## Limits

- `paths` is listed by hand. Express keeps paths in `app.all()` calls, not in the config, and there is no CLI that imports route files; see [roadmap.md](./roadmap.md).
- Errors a handler throws itself, like `RouteError.notFound()`, are not in the document. Add them to the returned object.
- `HEAD` and `OPTIONS`, which every route answers, are not listed.
- No `security`. Add `components.securitySchemes` and `security` to the returned object.
- Schemas are inlined as the converter emits them. A root `$schema` is removed; `$defs` and `$ref`s inside a schema are left alone.
- `query` and `params` schemas must convert to an object with `properties`. Anything else throws.
