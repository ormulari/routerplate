import type { StandardSchemaV1 } from '@standard-schema/spec';
import { isAuthContext } from './auth-context.js';
import { RouteError } from './errors.js';
import { isMethodConfig, type MethodConfigBrand } from './method-config.js';
import type { HttpMethod, MaybePromise, RouteDeps } from './types.js';
import { formatIssues } from '../validators/registry.js';
import { validateSchema } from '../validators/standard-schema.js';

/**
 * Framework-free route runtime. Adapters describe their framework
 * through a {@link Transport} and get back a handler builder that owns
 * method dispatch, auth, validation, the response envelope, and errors.
 */

const DEFAULT_STATUS_CODES: Record<HttpMethod, number> = {
  GET: 200,
  POST: 201,
  PATCH: 200,
  PUT: 200,
  DELETE: 204,
};

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const MUTATING_METHODS: readonly HttpMethod[] = ['POST', 'PATCH', 'PUT'];
const HELPER_NAMES: Record<HttpMethod, string> = {
  GET: 'get',
  POST: 'post',
  PATCH: 'patch',
  PUT: 'put',
  DELETE: 'del',
};

/**
 * Erased view of a method config used by the runtime. The typed
 * helpers guarantee call-site safety; at runtime every method reduces
 * to this shape.
 */
export interface ErasedMethodConfig extends MethodConfigBrand {
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
  body?: StandardSchemaV1;
  response?: StandardSchemaV1;
  requireAuth?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authorize?: (ctx: any) => MaybePromise<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (ctx: any) => unknown;
}

export interface ErasedRouteConfig {
  GET?: ErasedMethodConfig;
  POST?: ErasedMethodConfig;
  PATCH?: ErasedMethodConfig;
  PUT?: ErasedMethodConfig;
  DELETE?: ErasedMethodConfig;
}

/** How the runtime reads requests and writes responses for a framework. */
export interface Transport<Req, Res> {
  method(req: Req): string | undefined;
  /** Request path; the query string is stripped before it reaches hooks. */
  path(req: Req): string;
  body(req: Req): unknown;
  query(req: Req): unknown;
  /** Provide only if the framework separates path params from the query string. */
  params?(req: Req): unknown;
  setHeader(res: Res, name: string, value: string): void;
  /** True once the handler (or anything else) already finished the response. */
  responseEnded(res: Res): boolean;
  /** True once headers are on the wire; errors can then only be forwarded. */
  headersSent?(res: Res): boolean;
  sendJson(res: Res, status: number, payload: unknown): void;
  sendEmpty(res: Res, status: number): void;
}

/** Internal deps shape: core deps plus the Express-only escape hatch. */
export interface EngineDeps<Req, Res, User, Extras extends object> extends RouteDeps<
  Req,
  Res,
  User,
  Extras
> {
  /**
   * When true, errors that would produce a 500 are handed to `forward`
   * (Express's `next(error)`) instead of answered here. 4xx/mapped
   * errors are always answered locally either way.
   */
  forwardUnhandledToNext?: boolean;
}

export type RouteHandler<Req, Res> = (
  req: Req,
  res: Res,
  forward?: (error: unknown) => void,
) => Promise<void>;

export type RouteRuntime<Req, Res> = (config: ErasedRouteConfig) => RouteHandler<Req, Res>;

function stripQuery(path: string): string {
  const index = path.indexOf('?');
  return index === -1 ? path : path.slice(0, index);
}

export function createRouteRuntime<Req, Res, User, Extras extends object>(
  transport: Transport<Req, Res>,
  deps: EngineDeps<Req, Res, User, Extras>,
): RouteRuntime<Req, Res> {
  const log =
    deps.hooks?.log ??
    ((message: string, payload?: unknown) =>
      payload === undefined ? console.error(message) : console.error(message, payload));
  const validateResponses = deps.validateResponses ?? true;

  return function buildHandler(config: ErasedRouteConfig) {
    // Fail at boot, not on the first request.
    for (const method of METHODS) {
      const methodConfig = config[method];
      if (methodConfig === undefined) continue;
      if (!isMethodConfig(methodConfig)) {
        throw new Error(
          `routerplate: ${method} must be built with ${HELPER_NAMES[method]}() or endpoint(), ` +
            'not a plain object or function.',
        );
      }
      if (MUTATING_METHODS.includes(method) && !methodConfig.body) {
        throw new Error(
          `routerplate: ${method} is missing a \`body\` schema. Mutating methods must validate ` +
            'their body (use a schema like z.object({}).strict() if the body is intentionally empty).',
        );
      }
    }

    const allow = METHODS.filter((method) => config[method] !== undefined).join(', ');

    return async function handle(req, res, forward) {
      let user: User | null = null;
      try {
        const rawMethod = (transport.method(req) ?? '').toUpperCase();

        // 1. Method dispatch. OPTIONS gets the Allow list; HEAD runs as GET without a body.
        if (rawMethod === 'OPTIONS') {
          transport.setHeader(res, 'Allow', allow);
          transport.sendEmpty(res, 204);
          return;
        }
        const isHead = rawMethod === 'HEAD';
        const method = (isHead ? 'GET' : rawMethod) as HttpMethod;
        const methodConfig = config[method];
        if (!methodConfig) {
          transport.setHeader(res, 'Allow', allow);
          throw new RouteError(`Method ${rawMethod} not allowed`, 405, 'METHOD_NOT_ALLOWED');
        }

        // 2. Authentication. An authContext() return carries auth-derived
        //    ctx extras (e.g. an RLS-scoped Supabase client) with the user.
        let authExtras: Partial<Extras> | undefined;
        if (deps.authenticate) {
          const authResult = await deps.authenticate(req, res);
          if (isAuthContext(authResult)) {
            user = authResult.user as User | null;
            authExtras = authResult.extras as Partial<Extras>;
          } else {
            user = authResult;
          }
        }
        if (methodConfig.requireAuth !== false && deps.authenticate && !user) {
          throw new RouteError('Authentication required', 401, 'UNAUTHORIZED');
        }

        // 3. App-specific context. On key conflicts extend wins over authContext.
        const extras = deps.extend ? await deps.extend({ req, res, user }) : ({} as Extras);

        // 4. Validation: whatever schemas the method declares.
        let body: unknown = transport.body(req);
        if (methodConfig.body) {
          const result = await validateSchema(methodConfig.body, body);
          if (!result.success) {
            const details = await formatIssues(result.vendor, result.issues);
            deps.hooks?.onBodyValidationFailure?.(
              { issues: result.issues, details, vendor: result.vendor },
              { req, method, path: stripQuery(transport.path(req)), statusCode: 400, user },
            );
            throw new RouteError('Validation failed', 400, 'VALIDATION_ERROR', details);
          }
          body = result.value;
        }

        let query: unknown = transport.query(req);
        if (methodConfig.query) {
          const result = await validateSchema(methodConfig.query, query);
          if (!result.success) {
            throw new RouteError(
              'Invalid query parameters',
              400,
              'VALIDATION_ERROR',
              await formatIssues(result.vendor, result.issues),
            );
          }
          query = result.value;
        }

        let params: unknown = transport.params?.(req);
        if (methodConfig.params && transport.params) {
          const result = await validateSchema(methodConfig.params, params);
          if (!result.success) {
            throw new RouteError(
              'Invalid path parameters',
              400,
              'VALIDATION_ERROR',
              await formatIssues(result.vendor, result.issues),
            );
          }
          params = result.value;
        }

        // 5. Authorize, then run the handler.
        const ctx = {
          req,
          res,
          user,
          body,
          query,
          ...(transport.params ? { params } : {}),
          ...authExtras,
          ...extras,
        };
        if (methodConfig.authorize && !(await methodConfig.authorize(ctx))) {
          throw RouteError.forbidden();
        }
        let handlerResult = await methodConfig.handler(ctx);

        // 6. Validate and wrap the response.
        if (transport.responseEnded(res)) return;

        const statusCode = DEFAULT_STATUS_CODES[method];

        if (handlerResult === undefined || handlerResult === null) {
          transport.sendEmpty(res, statusCode === 200 ? 204 : statusCode);
          return;
        }

        if (methodConfig.response && validateResponses) {
          const result = await validateSchema(methodConfig.response, handlerResult);
          if (!result.success) {
            const details = await formatIssues(result.vendor, result.issues);
            log('Response validation failed:', details);
            log('Actual response:', JSON.stringify(handlerResult, null, 2));
            throw new RouteError('Response validation failed', 500, 'INTERNAL_ERROR', details);
          }
          handlerResult = result.value;
        }

        if (isHead) {
          transport.sendEmpty(res, statusCode);
          return;
        }

        transport.sendJson(
          res,
          statusCode,
          Array.isArray(handlerResult)
            ? { data: handlerResult, count: handlerResult.length }
            : { data: handlerResult },
        );
      } catch (error) {
        const path = stripQuery(transport.path(req));
        const method = transport.method(req) ?? 'unknown';

        // If a response is already in flight, only the framework can clean up.
        if (forward && transport.headersSent?.(res)) {
          forward(error);
          return;
        }

        // 1. App-provided mapping first (translate your own error classes).
        const mapped = deps.errorToResponse?.(error);
        if (mapped) {
          deps.hooks?.onError?.(error, { req, method, path, statusCode: mapped.status, user });
          transport.sendJson(res, mapped.status, mapped.body);
          return;
        }

        // 2. RouteError carries its own status. Only 5xx are logged; 4xx are the client's.
        if (error instanceof RouteError) {
          deps.hooks?.onError?.(error, { req, method, path, statusCode: error.status, user });
          if (error.status >= 500) {
            log('API Error:', {
              message: error.message,
              code: error.code,
              details: error.details,
              statusCode: error.status,
            });
          }
          transport.sendJson(res, error.status, {
            error: error.message,
            code: error.code,
            details: error.details,
          });
          return;
        }

        // 3. Anything else is a bug: 500 with a generic body.
        deps.hooks?.onError?.(error, { req, method, path, statusCode: 500, user });

        if (deps.forwardUnhandledToNext && forward) {
          forward(error);
          return;
        }

        log('Unhandled API error:', error);
        transport.sendJson(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    };
  };
}
