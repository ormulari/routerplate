import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
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
export { RouteError, type ErrorBody, type ErrorCode } from '../core/errors.js';
export type {
  BodyValidationFailure,
  ErrorHookContext,
  RouteHooks,
  SchemaLike,
} from '../core/types.js';

/**
 * routerplate/next: binds the core runtime to Next.js pages API routes.
 *
 * Route files export exactly one thing:
 *
 * ```typescript
 * export default route({
 *   GET: get({ query: QuerySchema, response: ItemSchema, handler: async ({ db, query }) => item }),
 *   POST: post({ body: CreateSchema, response: ItemSchema, handler: async ({ db, body }) => newItem }),
 * });
 * ```
 *
 * Next's pages router merges dynamic path segments into `req.query`,
 * so there is no separate `params` slot here; put those keys in the
 * `query` schema.
 */

/** What `ctx.query` looks like when no query schema is supplied. */
type DefaultQuery = NextApiRequest['query'];

/**
 * Typed context passed to route handlers.
 * @template Q      Query type (inferred from the `query` schema)
 * @template B      Body type (inferred from the `body` schema)
 * @template User   Your authenticated-user type (from `createRoute`)
 * @template Extras App-specific additions, e.g. `{ db }` (from `extend`)
 */
export type RouteContext<Q = DefaultQuery, B = unknown, User = unknown, Extras = unknown> = {
  req: NextApiRequest;
  res: NextApiResponse;
  user: User;
  body: B;
  query: Q;
} & Extras;

type OptionalSchema = SchemaLike | undefined;

type Ctx<QS, B, User, RA extends boolean, Extras> = RouteContext<
  InferSchema<QS, DefaultQuery>,
  B,
  CtxUser<User, RA>,
  Extras
>;

/** `get()`: body-less (query + response). */
export interface GetConfig<
  QS extends OptionalSchema,
  RS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<Ctx<QS, never, User, RA, Extras>, ResponsePayload<RS>, RA> {
  query?: QS;
  response?: RS;
}

/** `post()` / `patch()` / `put()`: the `body` schema is required. */
export interface BodyConfig<
  QS extends OptionalSchema,
  BS extends SchemaLike,
  RS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<
  Ctx<QS, InferSchema<BS, unknown>, User, RA, Extras>,
  ResponsePayload<RS>,
  RA
> {
  query?: QS;
  body: BS;
  response?: RS;
}

/** `del()`: query only; must resolve to nothing (204). */
export interface DeleteConfig<
  QS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<Ctx<QS, never, User, RA, Extras>, null | void, RA> {
  query?: QS;
}

/** `endpoint()`, the generic escape hatch: every slot optional. */
export interface EndpointConfig<
  QS extends OptionalSchema,
  BS extends OptionalSchema,
  RS extends OptionalSchema,
  RA extends boolean,
  User,
  Extras,
> extends HandlerSlots<
  Ctx<QS, InferSchema<BS, unknown>, User, RA, Extras>,
  ResponsePayload<RS>,
  RA
> {
  query?: QS;
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

export type NextRouteDeps<User, Extras extends object> = RouteDeps<
  NextApiRequest,
  NextApiResponse,
  User,
  Extras
>;

const transport: Transport<NextApiRequest, NextApiResponse> = {
  method: (req) => req.method,
  path: (req) => req.url || 'unknown',
  body: (req) => req.body,
  query: (req) => req.query,
  setHeader: (res, name, value) => void res.setHeader(name, value),
  responseEnded: (res) => res.writableEnded,
  sendJson: (res, status, payload) => void res.status(status).json(payload),
  sendEmpty: (res, status) => void res.status(status).end(),
};

function buildHelpers<User, Extras extends object>(
  runtime: RouteRuntime<NextApiRequest, NextApiResponse>,
) {
  /** NextApiHandler: `export default route({...})` from a pages API file. */
  function route(config: RouteDefinition): NextApiHandler {
    const handle = runtime(config);
    return (req: NextApiRequest, res: NextApiResponse) => handle(req, res);
  }

  function get<
    QS extends OptionalSchema = undefined,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: GetConfig<QS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function post<
    QS extends OptionalSchema = undefined,
    BS extends SchemaLike = SchemaLike,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: BodyConfig<QS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function patch<
    QS extends OptionalSchema = undefined,
    BS extends SchemaLike = SchemaLike,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: BodyConfig<QS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function put<
    QS extends OptionalSchema = undefined,
    BS extends SchemaLike = SchemaLike,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: BodyConfig<QS, BS, RS, RA, User, Extras>): MethodConfig {
    return brandMethodConfig(config);
  }

  function del<QS extends OptionalSchema = undefined, RA extends boolean = true>(
    config: DeleteConfig<QS, RA, User, Extras>,
  ): MethodConfig {
    return brandMethodConfig(config);
  }

  function endpoint<
    QS extends OptionalSchema = undefined,
    BS extends OptionalSchema = undefined,
    RS extends OptionalSchema = undefined,
    RA extends boolean = true,
  >(config: EndpointConfig<QS, BS, RS, RA, User, Extras>): MethodConfig {
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
 * injecting its services. Handlers return bare payloads; route() owns
 * the `{ data }` envelope (arrays additionally get `count`).
 *
 * Without `authenticate`, `ctx.user` is typed `null`: no route can
 * pretend a user exists.
 */
export function createRoute<User, Extras extends object = Record<never, never>>(
  deps: Authenticated<NextRouteDeps<User, Extras>>,
): RouteHelpers<User, Extras>;
export function createRoute<User = never, Extras extends object = Record<never, never>>(
  deps?: Omit<NextRouteDeps<User, Extras>, 'authenticate'>,
): RouteHelpers<null, Extras>;
export function createRoute<User, Extras extends object = Record<never, never>>(
  deps: NextRouteDeps<User, Extras> = {},
): RouteHelpers<User, Extras> {
  const runtime = createRouteRuntime<NextApiRequest, NextApiResponse, User, Extras>(
    transport,
    deps,
  );
  return buildHelpers<User, Extras>(runtime);
}
