import type { IssueFormatter } from '../registry.js';

/**
 * Zod formatter, loaded lazily on the first zod validation failure.
 * Zod's Standard Schema issues ARE ZodIssues (message + path plus zod
 * extras), so we can rebuild a ZodError and use its `format()` tree.
 */
export async function createFormatter(): Promise<IssueFormatter | undefined> {
  const { ZodError } = await import('zod');
  return (issues) => {
    try {
      return new ZodError(issues as never).format();
    } catch {
      return undefined;
    }
  };
}
