import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRoute } from '../src/adapters/next';
import { shimServer } from './helpers';

describe('routerplate/next (integration through an apiResolver-style shim)', () => {
  const { route, get, post, del } = createRoute<{ id: string }>({
    authenticate: async (req) => (req.headers.authorization === 'Bearer ok' ? { id: 'u1' } : null),
  });

  const handler = route({
    GET: get({
      query: z.object({ q: z.string().optional() }),
      handler: async ({ query, user }) => [{ hit: query.q ?? null, by: user.id }],
    }),
    POST: post({
      body: z.object({ name: z.string().min(1) }),
      response: z.object({ name: z.string() }),
      handler: async ({ body }) => ({ name: body.name }),
    }),
    DELETE: del({ handler: async () => null }),
  });

  it('GET → 200 with { data, count } for arrays', async () => {
    const res = await request(shimServer(handler))
      .get('/api/items?q=x')
      .set('authorization', 'Bearer ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ hit: 'x', by: 'u1' }], count: 1 });
  });

  it('POST → 201 with { data }', async () => {
    const res = await request(shimServer(handler))
      .post('/api/items')
      .set('authorization', 'Bearer ok')
      .send({ name: 'thing' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { name: 'thing' } });
  });

  it('invalid body → 400 VALIDATION_ERROR', async () => {
    const res = await request(shimServer(handler))
      .post('/api/items')
      .set('authorization', 'Bearer ok')
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
  });

  it('unauthenticated → 401', async () => {
    const res = await request(shimServer(handler)).get('/api/items');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('DELETE → 204, unknown method → 405', async () => {
    const deleted = await request(shimServer(handler))
      .delete('/api/items')
      .set('authorization', 'Bearer ok');
    expect(deleted.status).toBe(204);

    const notAllowed = await request(shimServer(handler)).patch('/api/items').send({});
    expect(notAllowed.status).toBe(405);
  });
});
