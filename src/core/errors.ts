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

/**
 * The one error type routerplate knows how to answer. Throw it from
 * handlers, or map your own error classes to it via `errorToResponse`.
 */
export class RouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ErrorCode | (string & Record<never, never>) = 'ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RouteError';
  }

  static forbidden(message = 'Forbidden', details?: unknown): RouteError {
    return new RouteError(message, 403, 'FORBIDDEN', details);
  }

  static notFound(message = 'Not found', details?: unknown): RouteError {
    return new RouteError(message, 404, 'NOT_FOUND', details);
  }

  static conflict(message = 'Conflict', details?: unknown): RouteError {
    return new RouteError(message, 409, 'CONFLICT', details);
  }
}

/** Shape of every error response routerplate writes. */
export interface ErrorBody {
  error: string;
  code: string;
  details?: unknown;
}
