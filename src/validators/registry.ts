import type { StandardSchemaV1 } from '@standard-schema/spec';
import { normalizeIssues } from './standard-schema.js';

/**
 * Lazy, per-vendor error formatters.
 *
 * Rich, validator-specific `details` (Zod's `format()` tree, Valibot's
 * flatten, ArkType's summary) load via `await import()` on the FIRST
 * validation failure, keyed by the schema's `~standard.vendor` string.
 * If the import rejects (validator uninstalled, edge-runtime restriction),
 * we fall back to the normalized issues array: never crash, never require
 * the import to succeed. The result (or the failure) is cached per vendor.
 */

/** Turns Standard Schema issues into vendor-rich `details`, or `undefined` to fall back. */
export type IssueFormatter = (issues: readonly StandardSchemaV1.Issue[]) => unknown;

type FormatterLoader = () => Promise<IssueFormatter | undefined>;

const defaultLoaders: Record<string, FormatterLoader> = {
  zod: () => import('./formatters/zod.js').then((m) => m.createFormatter()),
  valibot: () => import('./formatters/valibot.js').then((m) => m.createFormatter()),
  arktype: () => import('./formatters/arktype.js').then((m) => m.createFormatter()),
};

let loaders = defaultLoaders;
const cache = new Map<string, Promise<IssueFormatter | undefined>>();

export function loadFormatter(vendor: string | undefined): Promise<IssueFormatter | undefined> {
  if (!vendor || !Object.prototype.hasOwnProperty.call(loaders, vendor)) {
    return Promise.resolve(undefined);
  }
  let pending = cache.get(vendor);
  if (!pending) {
    const loader = loaders[vendor];
    pending = (loader ? loader() : Promise.resolve(undefined)).catch(() => undefined);
    cache.set(vendor, pending);
  }
  return pending;
}

/** Build error `details` for a validation failure: rich when a formatter loads, normalized otherwise. */
export async function formatIssues(
  vendor: string | undefined,
  issues: readonly StandardSchemaV1.Issue[],
): Promise<unknown> {
  const formatter = await loadFormatter(vendor);
  if (formatter) {
    try {
      const rich = formatter(issues);
      if (rich !== undefined) return rich;
    } catch {
      // fall through to the normalized shape
    }
  }
  return normalizeIssues(issues);
}

/** @internal test hook: swap the loader table (pass `undefined` to restore defaults). */
export function __setFormatterLoaders(next?: Record<string, FormatterLoader>): void {
  loaders = next ?? defaultLoaders;
  cache.clear();
}

/** @internal test hook: drop cached formatters. */
export function __clearFormatterCache(): void {
  cache.clear();
}
