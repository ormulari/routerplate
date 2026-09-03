import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AuthContext } from './auth-context.js';
import type { ErrorBody } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type MaybePromise<T> = T | Promise<T>;

/** Any Standard Schema, the only thing routerplate requires of a validator. */
export type SchemaLike = StandardSchemaV1;

/**
 * Resolve the static type produced by an (optional) Standard Schema.
 * - Schema provided → its output type (transforms count)
 * - Schema omitted  → the fallback (raw query/params object, unknown body)
 */
export type InferSchema<S, Fallback> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S>
  : Fallback;

/**
 * What a handler must return. With a `response` schema that is the
 * schema's *input* type: routerplate validates it and sends the output.
 * Without one, anything goes.
 */
export type ResponsePayload<RS> = RS extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<RS>
  : unknown;

/** `ctx.user`: nullable only when the method opted out of auth. */
export type CtxUser<User, RequireAuth extends boolean> = RequireAuth extends false
  ? User | null
  : User;

/** The slots every method config shares once its `ctx` type is known. */
export interface HandlerSlots<Ctx, Result, RequireAuth extends boolean> {
  /**
   * `false` lets anonymous callers through; `ctx.user` is then `User | null`.
   * @default true
   */
  requireAuth?: RequireAuth;
  /**
   * Runs after validation, before the handler, with the same `ctx`.
   * Return `false` to answer 403 FORBIDDEN.
   */
  authorize?: (ctx: Ctx) => MaybePromise<boolean>;
  handler: (ctx: Ctx) => MaybePromise<Result>;
}

/** Context handed to observability hooks. */
export interface ErrorHookContext<Req = unknown> {
  req: Req;
  method: string;
  /** Request path without the query string. */
  path: string;
  statusCode: number;
  /** The authenticated user, if authentication succeeded before the error. */
  user: unknown;
}

/** What `hooks.onBodyValidationFailure` receives (validator-agnostic). */
export interface BodyValidationFailure {
  /** Raw Standard Schema issues from the failing schema. */
  issues: readonly StandardSchemaV1.Issue[];
  /** The `details` sent to the client (formatter-enriched when available). */
  details: unknown;
  /** The schema's `~standard.vendor` string (`zod`, `valibot`, `arktype`, …). */
  vendor?: string;
}

export interface RouteHooks<Req = unknown> {
  /**
   * A request body that fails its schema was built by a client, not
   * typed by a person, so it is usually a client bug worth reporting.
   * The 400 is unchanged; this only adds the report. Query/params
   * failures are not reported: those are a hand-edited URL.
   */
  onBodyValidationFailure?: (
    failure: BodyValidationFailure,
    context: ErrorHookContext<Req>,
  ) => void;
  /** Called for every error response with the resolved status code. */
  onError?: (error: unknown, context: ErrorHookContext<Req>) => void;
  /** Where 5xx diagnostics go. Defaults to `console.error`. */
  log?: (message: string, payload?: unknown) => void;
}

/**
 * Injection points shared by every adapter. `Req`/`Res` are the
 * framework's request/response types.
 */
export interface RouteDeps<Req, Res, User, Extras extends object> {
  /**
   * Resolve the requester. Return `null` for anonymous.
   * Omit it for apps without authentication: `ctx.user` is then typed
   * `null` and no route ever answers 401.
   *
   * When one call yields both the user and request context (a Supabase
   * client that resolves the user AND is the RLS-scoped db), return
   * `authContext(user, { db })`. `res` is there for providers that
   * need it (Auth.js `getServerSession`, cookie refresh).
   */
  authenticate?: (
    req: Req,
    res: Res,
  ) => MaybePromise<User | null | AuthContext<User | null, Partial<Extras>>>;

  /**
   * Build app-specific context merged into every handler's `ctx`
   * (e.g. a per-request, tenant-scoped database client). Runs after
   * authentication, before validation.
   */
  extend?: (args: { req: Req; res: Res; user: User | null }) => MaybePromise<Extras>;

  /**
   * Map a thrown value to an HTTP response, e.g. to translate your
   * app's own error classes. Return `undefined` to fall through to the
   * built-in handling (RouteError → its status, anything else → 500).
   */
  errorToResponse?: (error: unknown) => { status: number; body: ErrorBody } | undefined;

  hooks?: RouteHooks<Req>;

  /**
   * Validate handler results against their `response` schema. This is
   * what keeps fields you did not declare off the wire, so it is on
   * everywhere by default; the cost is one parse per response.
   * @default true
   */
  validateResponses?: boolean;
}
