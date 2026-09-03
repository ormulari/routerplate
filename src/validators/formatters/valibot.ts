import type { IssueFormatter } from '../registry.js';

/**
 * Valibot formatter, loaded lazily on the first valibot validation
 * failure. Valibot's Standard Schema issues are its BaseIssues, which
 * `flatten()` accepts directly.
 */
export async function createFormatter(): Promise<IssueFormatter | undefined> {
  const { flatten } = await import('valibot');
  return (issues) => {
    try {
      return flatten(issues as never);
    } catch {
      return undefined;
    }
  };
}
