import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Runtime support for Standard Schema (https://standardschema.dev).
 *
 * Any schema implementing the `~standard` interface validates here with
 * no validator import at all; the schema instance carries its own logic.
 * Zod ≥3.24, Valibot ≥1.0, and ArkType ≥2.0 all qualify.
 */

/** `details` entry shape when no vendor formatter is available. */
export interface NormalizedIssue {
  path: string;
  message: string;
}

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const candidate = (value as Record<string, unknown>)['~standard'];
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as Record<string, unknown>).validate === 'function'
  );
}

/** Flatten Standard Schema issues to `[{ path, message }]`. */
export function normalizeIssues(issues: readonly StandardSchemaV1.Issue[]): NormalizedIssue[] {
  return issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) =>
        typeof segment === 'object' && segment !== null && 'key' in segment
          ? String(segment.key)
          : String(segment),
      )
      .join('.'),
    message: issue.message,
  }));
}

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: readonly StandardSchemaV1.Issue[]; vendor: string };

/** Validate through `~standard.validate`, handling sync and async results. */
export async function validateSchema<T>(
  schema: StandardSchemaV1<unknown, T>,
  input: unknown,
): Promise<ValidationResult<T>> {
  let result = schema['~standard'].validate(input);
  if (result instanceof Promise) result = await result;
  if (result.issues) {
    return { success: false, issues: result.issues, vendor: schema['~standard'].vendor };
  }
  return { success: true, value: result.value };
}
