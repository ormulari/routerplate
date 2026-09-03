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
    expect(res.jsonBody).toEqual({ name: 'a', n: 2 });
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
    expect(res.jsonBody).toEqual({ name: 'b' });
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
    expect(res.jsonBody).toEqual({ name: 'c' });
  });

  it('an invalid body → 400 VALIDATION_ERROR with the same `errors` shape for every validator', async () => {
    const schemas = [
      z.object({ name: z.string() }),
      v.object({ name: v.string() }),
      type({ name: 'string' }),
    ];
    for (const body of schemas) {
      const handler = route({ POST: post({ body, handler: async () => ({}) }) });
      const res = mockRes();
      await handler(nextReq({ method: 'POST', body: { name: 42 } }), asNextRes(res));
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.jsonBody).toEqual({
        title: 'Bad Request',
        status: 400,
        detail: 'Validation failed',
        instance: '/api/test',
        code: 'VALIDATION_ERROR',
        errors: [{ pointer: '/name', detail: expect.any(String) }],
      });
    }
  });

  it('pointers follow nesting and array indexes', async () => {
    const handler = route({
      POST: post({
        body: z.object({ a: z.object({ b: z.string() }), tags: z.array(z.string()) }),
        handler: async () => ({}),
      }),
    });
    const res = mockRes();
    await handler(
      nextReq({ method: 'POST', body: { a: { b: 1 }, tags: ['ok', 2] } }),
      asNextRes(res),
    );
    const { errors } = res.jsonBody as { errors: { pointer: string }[] };
    expect(errors.map((e) => e.pointer)).toEqual(['/a/b', '/tags/1']);
  });

  it('fires onBodyValidationFailure with issues + errors (but not for query failures)', async () => {
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
      { issues: unknown[]; errors: unknown },
      { req: unknown; method: string; path: string; statusCode: number },
    ];
    expect(failure.issues.length).toBeGreaterThan(0);
    expect(failure.errors).toEqual((postRes.jsonBody as { errors: unknown }).errors);
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
    expect(res.jsonBody).toEqual({ page: 3 });
  });

  it('invalid query → 400 "Invalid query parameters"', async () => {
    const handler = route({
      GET: get({ query: z.object({ page: z.coerce.number() }), handler: async () => ({}) }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET', query: { page: 'x' } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toMatchObject({
      detail: 'Invalid query parameters',
      code: 'VALIDATION_ERROR',
      errors: [{ pointer: '/page' }],
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
    expect(res.jsonBody).toEqual({ ok: true });
  });

  it('any vendor gets the same `errors`', async () => {
    const handler = route({
      POST: post({ body: asyncSchema, handler: async ({ body }) => body }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: { ok: false } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { errors: unknown }).errors).toEqual([
      { pointer: '/ok', detail: 'must be ok' },
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
