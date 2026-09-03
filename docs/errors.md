# Error handling

Every error routerplate sends has the same shape and the same media type. Handlers throw; the runtime answers.

## The shape

[RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457), as `application/problem+json`:

```json
{
  "title": "Not Found",
  "status": 404,
  "detail": "Item not found",
  "instance": "/items/99",
  "code": "NOT_FOUND"
}
```

| Member     | Value                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| `title`    | The HTTP reason phrase for `status`, or `"Error"` for a status without a common phrase. |
| `status`   | The HTTP status, repeated in the body per the RFC.                                      |
| `detail`   | The message passed to `RouteError`.                                                     |
| `instance` | The request path, query string removed.                                                 |
| `code`     | Extension member. Machine-readable, stable, what clients switch on.                     |
| `errors`   | Extension member, validation failures only. One `{ pointer, detail }` per issue.        |
| `type`     | Not emitted by default, which the RFC defines as `about:blank`. Set it via extensions.  |

Validation failures look like this, for every validator:

```json
{
  "title": "Bad Request",
  "status": 400,
  "detail": "Validation failed",
  "instance": "/items",
  "code": "VALIDATION_ERROR",
  "errors": [
    { "pointer": "/name", "detail": "Required" },
    { "pointer": "/tags/1", "detail": "Expected string, received number" }
  ]
}
```

`pointer` is an RFC 6901 JSON Pointer into the rejected document. `detail` is the validator's own message, so the wording differs between Zod, Valibot and ArkType; the structure does not.

Why the RFC: it is the only standard for HTTP error bodies, it is what Spring, ASP.NET Core and most OpenAPI tooling already speak, and it is five optional members. A bespoke shape would be no simpler and would need documenting and defending forever.

## Codes

| What happened                                 | Status | `code`               | `detail`                     |
| --------------------------------------------- | ------ | -------------------- | ---------------------------- |
| Body failed its schema                        | 400    | `VALIDATION_ERROR`   | `Validation failed`          |
| Query failed its schema                       | 400    | `VALIDATION_ERROR`   | `Invalid query parameters`   |
| Params failed their schema                    | 400    | `VALIDATION_ERROR`   | `Invalid path parameters`    |
| `authenticate` returned `null`, auth required | 401    | `UNAUTHORIZED`       | `Authentication required`    |
| `authorize` returned `false`                  | 403    | `FORBIDDEN`          | `Forbidden`                  |
| Method not configured                         | 405    | `METHOD_NOT_ALLOWED` | `Method X not allowed`       |
| Response failed its schema                    | 500    | `INTERNAL_ERROR`     | `Response validation failed` |
| Anything else thrown                          | 500    | `INTERNAL_ERROR`     | `Internal server error`      |

Handlers add their own with `RouteError.notFound()` (404), `.forbidden()` (403), `.conflict()` (409), or `new RouteError(detail, status, code, extensions)` for anything else. Codes are free-form strings; the `ErrorCode` union exists so the common ones get autocompleted rather than re-spelled.

## How a throw becomes a response

1. **`mapError(error)`**, if configured, runs first. If it returns a `RouteError`, that is the answer. This is where your own error classes get translated, and it can reclassify a `RouteError` too.
2. **A `RouteError`** answers with its own status, code and extensions.
3. **Anything else is a 500** with the generic body above. The original error goes to `hooks.onError` and `hooks.log`. This covers:
   - a validator error thrown inside a handler. Input was already valid by then, so that parse was on internal data and its failure is a bug, not the client's;
   - a response that fails its `response` schema. The field-level errors go to the log only; the client sees the generic 500, because echoing them would name internal fields;
   - a throw inside `authenticate` or `extend`. A token that does not verify should make `authenticate` return `null`, which is a 401. A throw means the check itself broke.
4. **`forwardUnhandledToNext`** (Express) hands step 3 errors to `next(error)` instead, so your own error middleware answers. 4xx and mapped errors are always answered by routerplate.
5. **If headers were already sent** when the error happened, nothing can be answered; on Express the error is forwarded to `next(error)`, elsewhere it is dropped.

## Logging

- 4xx are the client's problem and are not logged.
- 5xx `RouteError`s are logged as `API Error:` with `{ message, code, statusCode, extensions }`.
- Unknown errors are logged as `Unhandled API error:` with the error itself.
- Response-schema failures log the `errors` and the actual payload before the 500.
- All of it goes through `hooks.log`, default `console.error`.

`hooks.onError` fires for every error response, with the original error and `{ req, method, path, statusCode, user }`. Filter on `statusCode` to decide what reaches your tracker. `hooks.onBodyValidationFailure` fires only for body failures, with the raw issues and the `errors` sent to the client; a body is built by a client, so its failure is usually a client bug worth knowing about. Query and params failures are hand-edited URLs and are not reported.

## The error path cannot fail

Nothing in the error path may throw, or the request would hang with no response.

- A throwing `mapError`, `onError` or `onBodyValidationFailure` is logged as `routerplate: <hook> threw` and otherwise ignored. A throwing `mapError` counts as "unmapped".
- A throwing `log` falls back to `console.error`.
- If the problem body cannot be serialized, for example a circular value in `extensions`, the runtime logs it and sends an empty 500.

## Before routerplate runs

Body parsing happens in the framework, before `route()` is called. Malformed JSON and oversized bodies are rejected there, in the framework's own error shape, and routerplate never sees the request.

On Express, `express.json()` rejects with an `http-errors` error carrying `status`, `type` and `expose: true`. One error middleware after your routes brings those into line:

```typescript
import { PROBLEM_CONTENT_TYPE, RouteError } from 'routerplate/express';

app.use((error, req, res, next) => {
  if (typeof error.status !== 'number' || !error.expose) return next(error);
  const code = String(error.type ?? 'bad_request')
    .toUpperCase()
    .replace(/\./g, '_');
  const problem = new RouteError(error.message, error.status, code).toProblem(req.path);
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
});
```

That yields `ENTITY_PARSE_FAILED` (400) for bad JSON and `ENTITY_TOO_LARGE` (413) for a body over the limit, with the same shape as everything else. The test suite runs this exact middleware against a real `express.json()`.

Next.js parses bodies itself and answers with a plain-text 400 for malformed JSON. There is no hook for it in the pages API.

## Design notes

- **400, not 422, for schema failures.** One code for "the input is wrong" is simpler than two. Spring does the same; Rails and Laravel use 422. Either is defensible.
- **Wrong `Content-Type` on a body** is not a 415. The parser leaves the body empty and the schema reports the missing fields as a normal 400.
- **`application/problem+json`** is parsed as JSON by fetch, axios, superagent and Node's clients. A proxy or test helper that checks for exactly `application/json` will not treat it as JSON; serving problems as plain `application/json` is a one-line change in the adapter's `sendJson` if that ever matters.
