import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ProblemError } from '../core/errors.js';

/**
 * Runtime support for Standard Schema (https://standardschema.dev).
 *
 * Any schema implementing the `~standard` interface validates here with
 * no validator import at all; the schema instance carries its own logic.
 * Zod ≥3.24, Valibot ≥1.0, and ArkType ≥2.0 all qualify.
 */

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = (value as Record<string, unknown>)['~standard'];
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as Record<string, unknown>).validate === 'function'
  );
}

function pointerSegment(segment: PropertyKey | { key: PropertyKey }): string {
  const key = typeof segment === 'object' && segment !== null ? segment.key : segment;
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Standard Schema issues → RFC 9457-style `errors`, one JSON Pointer each. */
export function toProblemErrors(issues: readonly StandardSchemaV1.Issue[]): ProblemError[] {
  return issues.map((issue) => ({
    pointer: (issue.path ?? []).map((segment) => `/${pointerSegment(segment)}`).join(''),
    detail: issue.message,
  }));
}

export type ValidationResult<T> =
  { success: true; value: T } | { success: false; issues: readonly StandardSchemaV1.Issue[] };

/** Validate through `~standard.validate`, handling sync and async results. */
export async function validateSchema<T>(
  schema: StandardSchemaV1<unknown, T>,
  input: unknown,
): Promise<ValidationResult<T>> {
  let result = schema['~standard'].validate(input);
  if (result instanceof Promise) result = await result;
  if (result.issues) return { success: false, issues: result.issues };
  return { success: true, value: result.value };
}
