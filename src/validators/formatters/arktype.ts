import type { IssueFormatter } from '../registry.js';
import { normalizeIssues } from '../standard-schema.js';

/**
 * ArkType formatter, loaded lazily on the first arktype validation
 * failure. ArkType's Standard Schema issues are an `ArkErrors` array
 * subclass carrying a human-readable `summary`; no arktype import is
 * needed to read it.
 */
export async function createFormatter(): Promise<IssueFormatter | undefined> {
  return (issues) => {
    const summary = (issues as { summary?: unknown }).summary;
    if (typeof summary !== 'string') return undefined;
    return { summary, issues: normalizeIssues(issues) };
  };
}
