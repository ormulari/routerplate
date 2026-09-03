import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRoute } from '../src/adapters/next';
import { asNextRes, mockRes, nextReq } from './helpers';

describe('response validation (on by default, in every environment)', () => {
  it('only declared fields reach the wire', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({
        response: z.object({ id: z.string() }),
        // A db row with more columns than the contract declares.
        handler: async () => ({ id: '1', passwordHash: 'sekrit' }) as { id: string },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ data: { id: '1' } });
  });

  it('rejects a drifting response with 500 INTERNAL_ERROR and logs it', async () => {
    const log = vi.fn();
    const { route, get } = createRoute({ hooks: { log } });
    const handler = route({
      GET: get({
        response: z.object({ id: z.string() }),
        handler: async () => ({ id: 42 }) as unknown as { id: string },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toMatchObject({
      error: 'Response validation failed',
      code: 'INTERNAL_ERROR',
    });
    expect(log).toHaveBeenCalledWith('Response validation failed:', expect.anything());
    expect(log).toHaveBeenCalledWith('Actual response:', expect.stringContaining('42'));
  });

  it('the handler returns the schema input; the schema output is what ships', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({
        response: z.object({ n: z.string().transform(Number) }),
        handler: async () => ({ n: '5' }),
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: { n: 5 } });
  });

  it('a payload that happens to contain a `data` key wraps like any other object', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({ handler: async () => ({ data: [1, 2], meta: 'chart' }) }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ data: { data: [1, 2], meta: 'chart' } });
  });

  it('validateResponses: false skips response schema validation', async () => {
    const { route, get } = createRoute({ validateResponses: false });
    const handler = route({
      GET: get({
        response: z.object({ id: z.string() }),
        handler: async () => ({ id: 42 }) as unknown as { id: string },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ data: { id: 42 } });
  });
});
