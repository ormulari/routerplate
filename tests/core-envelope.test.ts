import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRoute } from '../src/adapters/next';
import { asNextRes, mockRes, nextReq } from './helpers';

const { route, get, post, patch, put, del } = createRoute();

describe('envelope wrapping', () => {
  it('wraps objects as { data }', async () => {
    const handler = route({ GET: get({ handler: async () => ({ id: '1' }) }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ data: { id: '1' } });
  });

  it('wraps arrays as { data, count }', async () => {
    const handler = route({ GET: get({ handler: async () => [1, 2, 3] }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: [1, 2, 3], count: 3 });
  });

  it('wraps primitives as { data }', async () => {
    const handler = route({ GET: get({ handler: async () => 'hello' }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: 'hello' });
  });

  it('turns null into 204 with no body on a 200-method', async () => {
    const handler = route({ GET: get({ handler: async () => null }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(204);
    expect(res.jsonBody).toBeUndefined();
    expect(res.ended).toBe(true);
  });

  it('turns undefined into 204 as well', async () => {
    const handler = route({ GET: get({ handler: async () => undefined as unknown as null }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(204);
  });

  it('does not touch the response if the handler already ended it', async () => {
    const handler = route({
      GET: get({
        handler: async ({ res }) => {
          (res as unknown as ReturnType<typeof mockRes>).status(299).json({ raw: true });
          return { ignored: true };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(299);
    expect(res.jsonBody).toEqual({ raw: true });
  });
});

describe('status map', () => {
  it('GET → 200', async () => {
    const handler = route({ GET: get({ handler: async () => ({}) }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(200);
  });

  it('POST → 201', async () => {
    const schema = z.object({}).passthrough();
    const handler = route({ POST: post({ body: schema, handler: async () => ({ ok: 1 }) }) });
    const res = mockRes();
    await handler(nextReq({ method: 'POST', body: {} }), asNextRes(res));
    expect(res.statusCode).toBe(201);
  });

  it('PATCH → 200 and PUT → 200', async () => {
    const body = z.object({}).passthrough();
    for (const [method, cfg] of [
      ['PATCH', patch({ body, handler: async () => ({ ok: 1 }) })],
      ['PUT', put({ body, handler: async () => ({ ok: 1 }) })],
    ] as const) {
      const handler = route({ [method]: cfg });
      const res = mockRes();
      await handler(nextReq({ method, body: {} }), asNextRes(res));
      expect(res.statusCode).toBe(200);
    }
  });

  it('DELETE → 204 with empty body', async () => {
    const handler = route({ DELETE: del({ handler: async () => null }) });
    const res = mockRes();
    await handler(nextReq({ method: 'DELETE' }), asNextRes(res));
    expect(res.statusCode).toBe(204);
    expect(res.jsonBody).toBeUndefined();
  });

  it('unknown method → 405 METHOD_NOT_ALLOWED with an Allow header', async () => {
    const handler = route({
      GET: get({ handler: async () => ({}) }),
      DELETE: del({ handler: async () => null }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'PUT' }), asNextRes(res));
    expect(res.statusCode).toBe(405);
    expect(res.jsonBody).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
    expect(res.headers.allow).toBe('GET, DELETE');
  });

  it('HEAD runs the GET handler and sends no body', async () => {
    let ran = false;
    const handler = route({
      GET: get({
        handler: async () => {
          ran = true;
          return { secret: 'body' };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'HEAD' }), asNextRes(res));
    expect(ran).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toBeUndefined();
    expect(res.ended).toBe(true);
  });

  it('HEAD on a route without GET → 405', async () => {
    const handler = route({ DELETE: del({ handler: async () => null }) });
    const res = mockRes();
    await handler(nextReq({ method: 'HEAD' }), asNextRes(res));
    expect(res.statusCode).toBe(405);
  });

  it('OPTIONS → 204 with Allow, without touching auth', async () => {
    const { route: authed, get: authedGet } = createRoute<{ id: string }>({
      authenticate: async () => null,
    });
    const handler = authed({ GET: authedGet({ handler: async () => ({}) }) });
    const res = mockRes();
    await handler(nextReq({ method: 'OPTIONS' }), asNextRes(res));
    expect(res.statusCode).toBe(204);
    expect(res.headers.allow).toBe('GET');
    expect(res.jsonBody).toBeUndefined();
  });
});
