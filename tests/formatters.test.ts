import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __clearFormatterCache,
  __setFormatterLoaders,
  formatIssues,
  loadFormatter,
} from '../src/validators/registry';
import { normalizeIssues } from '../src/validators/standard-schema';

const ISSUES = [{ message: 'bad name', path: ['name'] }, { message: 'root problem' }] as const;

afterEach(() => {
  __setFormatterLoaders(); // restore defaults, clear cache
});

describe('normalizeIssues', () => {
  it('joins paths and handles path-segment objects and missing paths', () => {
    expect(
      normalizeIssues([
        { message: 'a', path: ['user', 0, 'name'] },
        { message: 'b', path: [{ key: 'nested' }] },
        { message: 'c' },
      ]),
    ).toEqual([
      { path: 'user.0.name', message: 'a' },
      { path: 'nested', message: 'b' },
      { path: '', message: 'c' },
    ]);
  });
});

describe('lazy formatter loading', () => {
  it('uses the loaded formatter when the dynamic import succeeds', async () => {
    const loader = vi.fn(async () => (issues: readonly { message: string }[]) => ({
      rich: issues.length,
    }));
    __setFormatterLoaders({ zod: loader });
    expect(await formatIssues('zod', ISSUES)).toEqual({ rich: 2 });
    expect(loader).toHaveBeenCalledOnce();
  });

  it('caches the formatter per vendor: a second failure does not re-import', async () => {
    const loader = vi.fn(async () => () => 'rich');
    __setFormatterLoaders({ zod: loader });
    await formatIssues('zod', ISSUES);
    await formatIssues('zod', ISSUES);
    await loadFormatter('zod');
    expect(loader).toHaveBeenCalledOnce();
  });

  it('falls back to normalized issues when the import rejects, and never throws', async () => {
    const loader = vi.fn(async () => {
      throw new Error("Cannot find module 'zod'");
    });
    __setFormatterLoaders({ zod: loader });
    expect(await formatIssues('zod', ISSUES)).toEqual([
      { path: 'name', message: 'bad name' },
      { path: '', message: 'root problem' },
    ]);
    // rejection is cached too
    await formatIssues('zod', ISSUES);
    expect(loader).toHaveBeenCalledOnce();
  });

  it('falls back when the formatter itself throws or returns undefined', async () => {
    __setFormatterLoaders({
      zod: async () => () => {
        throw new Error('formatter bug');
      },
      valibot: async () => () => undefined,
    });
    expect(await formatIssues('zod', ISSUES)).toEqual(normalizeIssues(ISSUES));
    expect(await formatIssues('valibot', ISSUES)).toEqual(normalizeIssues(ISSUES));
  });

  it('unknown vendors skip loading entirely', async () => {
    expect(await loadFormatter('not-a-validator')).toBeUndefined();
    expect(await loadFormatter(undefined)).toBeUndefined();
    expect(await formatIssues('not-a-validator', ISSUES)).toEqual(normalizeIssues(ISSUES));
  });

  it('real formatters load for all three vendors', async () => {
    __clearFormatterCache();
    expect(await loadFormatter('zod')).toBeTypeOf('function');
    expect(await loadFormatter('valibot')).toBeTypeOf('function');
    expect(await loadFormatter('arktype')).toBeTypeOf('function');
  });
});
