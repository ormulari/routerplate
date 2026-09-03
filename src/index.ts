/**
 * routerplate: schema-validated route handlers for the framework you
 * already have.
 *
 * This root entry is framework-free and validator-free. Applications
 * normally import an adapter instead:
 *
 * - `routerplate/next` for the Next.js pages API
 * - `routerplate/express` for Express
 *
 * The exports here are the shared contract (errors, types) plus the
 * low-level runtime for building custom adapters.
 */

export { authContext, isAuthContext, type AuthContext } from './core/auth-context.js';
export { RouteError, type ErrorBody, type ErrorCode } from './core/errors.js';
export {
  brandMethodConfig,
  isMethodConfig,
  METHOD_CONFIG,
  type MethodConfigBrand,
} from './core/method-config.js';
export type {
  BodyValidationFailure,
  CtxUser,
  ErrorHookContext,
  HandlerSlots,
  HttpMethod,
  InferSchema,
  MaybePromise,
  ResponsePayload,
  RouteDeps,
  RouteHooks,
  SchemaLike,
} from './core/types.js';
export {
  createRouteRuntime,
  type EngineDeps,
  type ErasedMethodConfig,
  type ErasedRouteConfig,
  type RouteHandler,
  type RouteRuntime,
  type Transport,
} from './core/engine.js';
export {
  isStandardSchema,
  normalizeIssues,
  validateSchema,
  type NormalizedIssue,
  type ValidationResult,
} from './validators/standard-schema.js';
export { formatIssues, loadFormatter, type IssueFormatter } from './validators/registry.js';
