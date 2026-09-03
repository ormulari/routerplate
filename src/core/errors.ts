/**
 * Codes routerplate emits itself, plus the ones handlers reach for most.
 * Your own codes are fine too; this list exists so nobody invents three
 * spellings of NOT_FOUND.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

/** Media type of every error response (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** One validation failure: a JSON Pointer (RFC 6901) to the field and a message. */
export interface ProblemError {
  pointer: string;
  detail: string;
}

/**
 * Every error response routerplate writes: RFC 9457 Problem Details, plus
 * a machine-readable `code` and, for validation failures, `errors`.
 */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: ProblemError[];
  [extension: string]: unknown;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * The one error type routerplate knows how to answer. Throw it from
 * handlers, or map your own error classes to it via `mapError`.
 */
export class RouteError extends Error {
  constructor(
    /** Becomes the problem's `detail`. */
    message: string,
    public readonly status: number,
    public readonly code: ErrorCode | (string & Record<never, never>) = 'ERROR',
    /** Extra top-level members for the problem body, e.g. a custom `type` or `errors`. */
    public readonly extensions?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RouteError';
  }

  static forbidden(detail = 'Forbidden', extensions?: Record<string, unknown>): RouteError {
    return new RouteError(detail, 403, 'FORBIDDEN', extensions);
  }

  static notFound(detail = 'Not found', extensions?: Record<string, unknown>): RouteError {
    return new RouteError(detail, 404, 'NOT_FOUND', extensions);
  }

  static conflict(detail = 'Conflict', extensions?: Record<string, unknown>): RouteError {
    return new RouteError(detail, 409, 'CONFLICT', extensions);
  }

  /** The RFC 9457 body for this error. `instance` is the request path. */
  toProblem(instance: string): Problem {
    return {
      title: TITLES[this.status] ?? 'Error',
      ...this.extensions,
      status: this.status,
      detail: this.message,
      instance,
      code: this.code,
    };
  }
}
