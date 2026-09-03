import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  createRouteRuntime,
  type ErasedMethodConfig,
  type ErasedRouteConfig,
  type RouteRuntime,
  type Transport,
} from '../core/engine.js';
import { brandMethodConfig } from '../core/method-config.js';
import type {
  CtxUser,
  HandlerSlots,
  InferSchema,
  ResponsePayload,
  RouteDeps,
  SchemaLike,
} from '../core/types.js';

export { authContext, type AuthContext } from '../core/auth-context.js';
export {
  PROBLEM_CONTENT_TYPE,
  RouteError,
  type ErrorCode,
  type Problem,
  type ProblemError,
} from '../core/errors.js';
export type {
  BodyValidationFailure,
  ErrorHookContext,
  RouteHooks,
  SchemaLike,
} from '../core/types.js';

/**
 * routerplate/express: binds the core runtime to Express.
 *
 * `route()` returns one Express RequestHandler that dispatches on
 * `req.method`, so a resource lives on a single `.all()` line:
 *
 * ```typescript
 * app.all('/items/:id', route({
 *   GET: get({ params: ParamsSchema, response: ItemSchema, handler: async ({ db, params }) => getItem(db, params.id) }),
 *   PATCH: patch({ params: ParamsSchema, body: UpdateSchema, response: ItemSchema, handler: async ({ db, params, body }) => updateItem(db, params.id, body) }),
 *   DELETE: del({ params: ParamsSchema, handler: async ({ db, params }) => { await deleteItem(db, params.id); return null; } }),
 * }));
 * ```
 *
 * Requires `app.use(express.json())` (or equivalent) upstream so
 * `req.body` is parsed before validation.
 */

/** What `ctx.query` / `ctx.params` look like when no schema is supplied. */
type DefaultQuery = Request['query'];
type DefaultParams = Request['params'];

/**
 * Typed context passed to route handlers.
 * @template Q      Query type (inferred from the `query` schema)
 * @template P      Path-params type (inferred from the `params` schema)
 * @template B      Body type (inferred from the `body` schema)
 * @template User   Your authenticated-user type (from `createRoute`)
 * @template Extras App-specific additions, e.g. `{ db }` (from `extend`)
 */
export type RouteContext<
  Q = DefaultQuery,
  P = DefaultParams,
  B = unknown,
  User = unknown,
  Extras = unknown,
> = {
  req: Request;
  res: Response;
  user: User;
  body: B;
  query: Q;
  params: P;
} & Extras;

type OptionalSchema = SchemaLike | undefined;

type Ctx<QS, PS, B, User, RA extends boolean, Extras> = RouteContext<
  InferSchema<QS, DefaultQuery>,
  InferSchema<PS, DefaultParams>,
  B,
  CtxUser<User, RA>,
  Extras
>;

/** `get()`: body-less (query + params + response). */
export interface GetConfig<
  QS extends OptionalSchema,
  PS extends OptionalSchema,
  RS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<Ctx<QS, PS, never, User, RA, Extras>, ResponsePayload<RS>, RA> {
  query?: QS;
  params?: PS;
  response?: RS;
}

/** `post()` / `patch()` / `put()`: the `body` schema is required. */
export interface BodyConfig<
  QS extends OptionalSchema,
  PS extends OptionalSchema,
  BS extends SchemaLike,
  RS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<
  Ctx<QS, PS, InferSchema<BS, unknown>, User, RA, Extras>,
  ResponsePayload<RS>,
  RA
> {
  query?: QS;
  params?: PS;
  body: BS;
  response?: RS;
}

/** `del()`: query + params only; must resolve to nothing (204). */
export interface DeleteConfig<
  QS extends OptionalSchema,
  PS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<Ctx<QS, PS, never, User, RA, Extras>, null | void, RA> {
  query?: QS;
  params?: PS;
}

/** `endpoint()`, the generic escape hatch: every slot optional. */
export interface EndpointConfig<
  QS extends OptionalSchema,
  PS extends OptionalSchema,
  BS extends OptionalSchema,
  RS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<
  Ctx<QS, PS, InferSchema<BS, unknown>, User, RA, Extras>,
  ResponsePayload<RS>,
  RA
> {
  query?: QS;
  params?: PS;
  body?: BS;
  response?: RS;
}

/**
 * What every helper returns. Opaque on purpose: the generics stay on the
 * helper call, where `ctx` is typed, and never leak into `route()`.
 */
export type MethodConfig = ErasedMethodConfig;

/** What `route()` accepts: one helper-built config per method. */
export type RouteDefinition = ErasedRouteConfig;

export interface ExpressRouteDeps<User, Extras extends object> extends RouteDeps<
  Request,
  Response,
  User,
  Extras
> {
  /**
   * When true, errors that would produce a 500 are forwarded to
   * Express's `next(error)` instead of answered here, so your app's
   * error middleware owns the final response. 4xx/mapped errors are
   * always answered locally either way.
   * @default false
   */
  forwardUnhandledToNext?: boolean;
}

const transport: Transport<Request, Response> = {
  method: (req) => req.method,
  path: (req) => req.originalUrl || req.url || 'unknown',
  body: (req) => req.body,
  query: (req) => req.query,
  params: (req) => req.params,
  setHeader: (res, name, value) => void res.setHeader(name, value),
  responseEnded: (res) => res.headersSent || res.writableEnded,
  headersSent: (res) => res.headersSent,
  sendJson: (res, status, payload, contentType) =>
    void (contentType ? res.status(status).type(contentType) : res.status(status)).json(payload),
  sendEmpty: (res, status) => void res.status(status).end(),
};

function buildHelpers<User, Extras extends object>(runtime: RouteRuntime<Request, Response>) {
  /** Dispatching RequestHandler: mount with `app.all(path, route({...}))`. */
  function route(config: RouteDefinition): RequestHandler {
    const handle = runtime(config);
    return (req: Request, res: Response, next: NextFunction) => void handle(req, res, next);
  }

  function get<
    QS extends OptionalSchema = undefined,
    PS extends OptionalSchema = undefined,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: GetConfig<QS, PS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function post<
    QS extends OptionalSchema = undefined,
    PS extends OptionalSchema = undefined,
    BS extends SchemaLike = SchemaLike,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: BodyConfig<QS, PS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function patch<
    QS extends OptionalSchema = undefined,
    PS extends OptionalSchema = undefined,
    BS extends SchemaLike = SchemaLike,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: BodyConfig<QS, PS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function put<
    QS extends OptionalSchema = undefined,
    PS extends OptionalSchema = undefined,
    BS extends SchemaLike = SchemaLike,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: BodyConfig<QS, PS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function del<
    QS extends OptionalSchema = undefined,
    PS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: DeleteConfig<QS, PS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function endpoint<
    QS extends OptionalSchema = undefined,
    PS extends OptionalSchema = undefined,
    BS extends OptionalSchema = undefined,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: EndpointConfig<QS, PS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  return { route, endpoint, get, post, patch, put, del };
}

/** What `createRoute()` returns: `route()` plus the typed method helpers. */
export type RouteHelpers<User, Extras extends object> = ReturnType<
  typeof buildHelpers<User, Extras>
>;

type Authenticated<Deps extends { authenticate?: unknown }> = Deps & {
  authenticate: NonNullable<Deps['authenticate']>;
};

/**
 * Build your app's `route()` function (plus typed method helpers) by
 * injecting its services. A handler's return value is the response
 * body; route() owns status codes and errors.
 *
 * Without `authenticate`, `ctx.user` is typed `null`: no route can
 * pretend a user exists.
 */
export function createRoute<User, Extras extends object = Record<never, never>>(
  deps: Authenticated<ExpressRouteDeps<User, Extras>>,
): RouteHelpers<User, Extras>;
export function createRoute<User = never, Extras extends object = Record<never, never>>(
  deps?: Omit<ExpressRouteDeps<User, Extras>, 'authenticate'>,
): RouteHelpers<null, Extras>;
export function createRoute<User, Extras extends object = Record<never, never>>(
  deps: ExpressRouteDeps<User, Extras> = {},
): RouteHelpers<User, Extras> {
  const runtime = createRouteRuntime<Request, Response, User, Extras>(transport, deps);
  return buildHelpers<User, Extras>(runtime);
}
