import { type } from 'arktype';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isStandardSchema, validateSchema } from '../src/validators/standard-schema';

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
  it('returns the parsed value on success and vendor-tagged issues on failure', async () => {
    const schema = z.object({ n: z.coerce.number() });
    const ok = await validateSchema(schema, { n: '5' });
    expect(ok).toEqual({ success: true, value: { n: 5 } });

    const bad = await validateSchema(schema, { n: 'x' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.vendor).toBe('zod');
      expect(bad.issues.length).toBeGreaterThan(0);
    }
  });
});
