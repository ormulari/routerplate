import { type } from 'arktype';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  isStandardSchema,
  toProblemErrors,
  validateSchema,
} from '../src/validators/standard-schema';

describe('isStandardSchema', () => {
  it('recognizes zod, valibot, and arktype schemas', () => {
    expect(isStandardSchema(z.object({}))).toBe(true);
    expect(isStandardSchema(v.object({}))).toBe(true);
    expect(isStandardSchema(type({ a: 'string' }))).toBe(true);
  });

  it('rejects non-schemas', () => {
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema(undefined)).toBe(false);
    expect(isStandardSchema(42)).toBe(false);
    expect(isStandardSchema({})).toBe(false);
    expect(isStandardSchema({ '~standard': {} })).toBe(false);
    expect(isStandardSchema({ '~standard': { validate: 'nope' } })).toBe(false);
  });
});

describe('validateSchema', () => {
  it('returns the parsed value on success and the issues on failure', async () => {
    const schema = z.object({ n: z.coerce.number() });
    const ok = await validateSchema(schema, { n: '5' });
    expect(ok).toEqual({ success: true, value: { n: 5 } });

    const bad = await validateSchema(schema, { n: 'x' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues.length).toBeGreaterThan(0);
  });
});

describe('toProblemErrors', () => {
  it('turns issue paths into JSON Pointers', () => {
    expect(
      toProblemErrors([
        { message: 'root', path: [] },
        { message: 'no path' },
        { message: 'nested', path: ['a', 0, 'b'] },
        { message: 'keyed', path: [{ key: 'x' }, { key: 1 }] },
      ]),
    ).toEqual([
      { pointer: '', detail: 'root' },
      { pointer: '', detail: 'no path' },
      { pointer: '/a/0/b', detail: 'nested' },
      { pointer: '/x/1', detail: 'keyed' },
    ]);
  });

  it('escapes ~ and / per RFC 6901', () => {
    expect(toProblemErrors([{ message: 'm', path: ['a/b', 'c~d'] }])).toEqual([
      { pointer: '/a~1b/c~0d', detail: 'm' },
    ]);
  });
});
