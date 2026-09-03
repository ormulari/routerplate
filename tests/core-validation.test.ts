import { type } from 'arktype';
import * as v from 'valibot';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createRoute } from '../src/adapters/next';
import { asNextRes, mockRes, nextReq } from './helpers';

const { route, get, post, endpoint } = createRoute();

describe('body validation through the same post() helper', () => {
  it('zod: valid body is parsed and typed', async () => {
    const handler = route({
      POST: post({
        body: z.object({ name: z.string(), n: z.coerce.number() }),
        handler: async ({ body }) => {
          expectTypeOf(body).toEqualTypeOf<{ name: string; n: number }>();
          return { name: body.name, n: body.n };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { name: 'a', n: '2' } }), asNextRes(res));
    expect(res.statusCode).toBe(201);
    expect(res.jsonBody).toEqual({ data: { name: 'a', n: 2 } });
  });

  it('valibot: valid body is parsed and typed', async () => {
    const handler = route({
      POST: post({
        body: v.object({ name: v.string() }),
        handler: async ({ body }) => {
          expectTypeOf(body).toEqualTypeOf<{ name: string }>();
          return { name: body.name };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { name: 'b' } }), asNextRes(res));
    expect(res.statusCode).toBe(201);
    expect(res.jsonBody).toEqual({ data: { name: 'b' } });
  });

  it('arktype: valid body is parsed and typed', async () => {
    const handler = route({
      POST: post({
        body: type({ name: 'string' }),
        handler: async ({ body }) => {
          expectTypeOf(body).toEqualTypeOf<{ name: string }>();
          return { name: body.name };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { name: 'c' } }), asNextRes(res));
    expect(res.statusCode).toBe(201);
    expect(res.jsonBody).toEqual({ data: { name: 'c' } });
  });

  it('zod: invalid body → 400 VALIDATION_ERROR with zod format() details', async () => {
    const handler = route({
      POST: post({
        body: z.object({ name: z.string() }),
        handler: async () => ({}),
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { name: 42 } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
    const details = (res.jsonBody as { details: { name: { _errors: string[] } } }).details;
    expect(details.name._errors.length).toBeGreaterThan(0);
  });

  it('valibot: invalid body → 400 with flatten() details', async () => {
    const handler = route({
      POST: post({ body: v.object({ name: v.string() }), handler: async () => ({}) }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { name: 42 } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    const details = (res.jsonBody as { details: { nested?: Record<string, string[]> } }).details;
    expect(details.nested?.name?.length).toBeGreaterThan(0);
  });

  it('arktype: invalid body → 400 with summary details', async () => {
    const handler = route({
      POST: post({ body: type({ name: 'string' }), handler: async () => ({}) }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { name: 42 } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    const details = (res.jsonBody as { details: { summary: string } }).details;
    expect(typeof details.summary).toBe('string');
  });

  it('fires onBodyValidationFailure with issues + details (but not for query failures)', async () => {
    const onBodyValidationFailure = vi.fn();
    const {
      route: hookedRoute,
      post: hookedPost,
      get: hookedGet,
    } = createRoute({
      hooks: { onBodyValidationFailure },
    });
    const handler = hookedRoute({
      POST: hookedPost({ body: z.object({ name: z.string() }), handler: async () => ({}) }),
      GET: hookedGet({ query: z.object({ id: z.string() }), handler: async () => ({}) }),
    });

    const postRes = mockRes();
    const req = nextReq({ method: 'POST', body: {}, url: '/api/test?debug=1' });
    await handler(req, asNextRes(postRes));
    expect(onBodyValidationFailure).toHaveBeenCalledOnce();
    const [failure, context] = onBodyValidationFailure.mock.calls[0] as [
      { issues: unknown[]; details: unknown; vendor?: string },
      { req: unknown; method: string; path: string; statusCode: number },
    ];
    expect(failure.vendor).toBe('zod');
    expect(failure.issues.length).toBeGreaterThan(0);
    expect(context).toMatchObject({ req, method: 'POST', path: '/api/test', statusCode: 400 });

    const getRes = mockRes();
    await handler(nextReq({ method: 'GET', query: {} }), asNextRes(getRes));
    expect(getRes.statusCode).toBe(400);
    expect(onBodyValidationFailure).toHaveBeenCalledOnce();
  });
});

describe('query validation', () => {
  it('parses and types the query', async () => {
    const handler = route({
      GET: get({
        query: z.object({ page: z.coerce.number() }),
        handler: async ({ query }) => {
          expectTypeOf(query).toEqualTypeOf<{ page: number }>();
          return { page: query.page };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET', query: { page: '3' } }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: { page: 3 } });
  });

  it('invalid query → 400 with "Invalid query parameters"', async () => {
    const handler = route({
      GET: get({ query: z.object({ page: z.coerce.number() }), handler: async () => ({}) }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET', query: { page: 'x' } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({
      error: 'Invalid query parameters',
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('a declared body schema is validated on any method', () => {
  it('DELETE via endpoint() with a body schema → 400 on a bad body', async () => {
    const handler = route({
      DELETE: endpoint({
        body: z.object({ reason: z.string() }),
        handler: async ({ body }) => ({ got: body }),
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'DELETE', body: { nope: 1 } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('async and custom Standard Schemas', () => {
  const asyncSchema: StandardSchemaV1<unknown, { ok: true }> = {
    '~standard': {
      version: 1,
      vendor: 'custom-test',
      validate: async (input) =>
        typeof input === 'object' && input !== null && (input as { ok?: unknown }).ok === true
          ? { value: { ok: true } }
          : { issues: [{ message: 'must be ok', path: ['ok'] }] },
    },
  };

  it('handles async validate results', async () => {
    const handler = route({
      POST: post({ body: asyncSchema, handler: async ({ body }) => body }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { ok: true } }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: { ok: true } });
  });

  it('unknown vendors fall back to normalized [{ path, message }] details', async () => {
    const handler = route({
      POST: post({ body: asyncSchema, handler: async ({ body }) => body }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { ok: false } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { details: unknown }).details).toEqual([
      { path: 'ok', message: 'must be ok' },
    ]);
  });
});

describe('route() rejects at boot, not on the first request', () => {
  it('a hand-written config object (no helper) is rejected', () => {
    expect(() =>
      route({
        // @ts-expect-error plain objects lack the helper brand
        GET: { handler: async () => ({}) },
      }),
    ).toThrow(/GET must be built with get\(\) or endpoint\(\)/);
  });

  it('a bare function is rejected', () => {
    expect(() =>
      route({
        // @ts-expect-error bare handlers are not accepted
        POST: async () => ({}),
      }),
    ).toThrow(/POST must be built with post\(\) or endpoint\(\)/);
  });

  it('a POST built with endpoint() but without a body schema is rejected', () => {
    expect(() => route({ POST: endpoint({ handler: async () => ({}) }) })).toThrow(
      /POST is missing a `body` schema/,
    );
  });
});
