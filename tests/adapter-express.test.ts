import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRoute, PROBLEM_CONTENT_TYPE, RouteError } from '../src/adapters/express';

type User = { id: string };

function makeApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('routerplate/express (integration, real express + supertest)', () => {
  it('serves a full resource from a single app.all() line', async () => {
    const { route, get, post, del } = createRoute();
    const items = [{ id: '1', name: 'First' }];
    const app = makeApp();

    app.all(
      '/items',
      route({
        GET: get({
          response: z.array(z.object({ id: z.string(), name: z.string() })),
          handler: async () => items,
        }),
        POST: post({
          body: z.object({ name: z.string().min(1) }),
          handler: async ({ body }) => {
            const item = { id: String(items.length + 1), name: body.name };
            items.push(item);
            return item;
          },
        }),
      }),
    );
    app.all(
      '/items/:id',
      route({
        GET: get({
          params: z.object({ id: z.string() }),
          handler: async ({ params }) => {
            const item = items.find((candidate) => candidate.id === params.id);
            if (!item) throw RouteError.notFound('Item not found');
            return item;
          },
        }),
        DELETE: del({
          params: z.object({ id: z.string() }),
          handler: async ({ params }) => {
            items.splice(
              items.findIndex((candidate) => candidate.id === params.id),
              1,
            );
            return null;
          },
        }),
      }),
    );

    const list = await request(app).get('/items');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id: '1', name: 'First' }]);

    const created = await request(app).post('/items').send({ name: 'Second' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: '2', name: 'Second' });

    const one = await request(app).get('/items/2');
    expect(one.body).toEqual({ id: '2', name: 'Second' });

    const gone = await request(app).delete('/items/2');
    expect(gone.status).toBe(204);
    expect(gone.body).toEqual({});

    const missing = await request(app).get('/items/99');
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(missing.body).toEqual({
      title: 'Not Found',
      status: 404,
      detail: 'Item not found',
      instance: '/items/99',
      code: 'NOT_FOUND',
    });
  });

  it('405 with an Allow header listing configured methods', async () => {
    const { route, get, post } = createRoute();
    const app = makeApp();
    app.all(
      '/thing',
      route({
        GET: get({ handler: async () => ({}) }),
        POST: post({ body: z.object({}).passthrough(), handler: async () => ({}) }),
      }),
    );
    const res = await request(app).put('/thing').send({});
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, POST');
    expect(res.body).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('HEAD works wherever GET does; OPTIONS answers with Allow', async () => {
    const { route, get } = createRoute();
    const app = makeApp();
    app.all('/thing', route({ GET: get({ handler: async () => ({ ok: true }) }) }));

    const head = await request(app).head('/thing');
    expect(head.status).toBe(200);
    expect(head.text).toBeUndefined();

    const options = await request(app).options('/thing');
    expect(options.status).toBe(204);
    expect(options.headers.allow).toBe('GET');
  });

  it('validates params → 400 "Invalid path parameters"', async () => {
    const { route, get } = createRoute();
    const app = makeApp();
    app.all(
      '/u/:id',
      route({
        GET: get({
          params: z.object({ id: z.string().uuid() }),
          handler: async ({ params }) => params,
        }),
      }),
    );
    const res = await request(app).get('/u/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      detail: 'Invalid path parameters',
      code: 'VALIDATION_ERROR',
      errors: [{ pointer: '/id', detail: expect.any(String) }],
    });
  });

  it('authentication via injected authenticate + extend', async () => {
    const { route, get } = createRoute<User, { db: string }>({
      authenticate: async (req) =>
        req.headers.authorization === 'Bearer ok' ? { id: 'u1' } : null,
      extend: async ({ user }) => ({ db: `scoped:${user?.id ?? 'anon'}` }),
    });
    const app = makeApp();
    app.all('/me', route({ GET: get({ handler: async ({ user, db }) => ({ id: user.id, db }) }) }));

    const denied = await request(app).get('/me');
    expect(denied.status).toBe(401);

    const allowed = await request(app).get('/me').set('authorization', 'Bearer ok');
    expect(allowed.body).toEqual({ id: 'u1', db: 'scoped:u1' });
  });

  it('headersSent → next(error): express error middleware takes over', async () => {
    const seen = vi.fn();
    const { route, get } = createRoute();
    const app = makeApp();
    app.all(
      '/leaky',
      route({
        GET: get({
          handler: async ({ res }) => {
            res.status(200).json({ manual: true }); // breaks the rules; runtime still copes
            throw new Error('too late');
          },
        }),
      }),
    );
    app.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
      seen(error.message);
      if (res.headersSent) return next(error);
      res.status(500).end();
    });

    const res = await request(app).get('/leaky');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ manual: true });
    expect(seen).toHaveBeenCalledWith('too late');
  });

  it('forwardUnhandledToNext hands 500s to app middleware; 4xx stays local', async () => {
    const { route, get } = createRoute({ forwardUnhandledToNext: true });
    const app = makeApp();
    app.all(
      '/fails',
      route({
        GET: get({
          handler: async ({ query }) => {
            if ((query as Record<string, unknown>).kind === 'known') {
              throw RouteError.notFound('Known');
            }
            throw new Error('unknown failure');
          },
        }),
      }),
    );
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ handledBy: 'app middleware', message: error.message });
    });

    const forwarded = await request(app).get('/fails');
    expect(forwarded.status).toBe(500);
    expect(forwarded.body).toEqual({ handledBy: 'app middleware', message: 'unknown failure' });

    const local = await request(app).get('/fails?kind=known');
    expect(local.status).toBe(404);
    expect(local.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('without forwardUnhandledToNext, 500s are answered locally', async () => {
    const { route, get } = createRoute({ hooks: { log: vi.fn() } });
    const app = makeApp();
    app.all(
      '/boom',
      route({
        GET: get({
          handler: async () => {
            throw new Error('boom');
          },
        }),
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      title: 'Internal Server Error',
      status: 500,
      detail: 'Internal server error',
      instance: '/boom',
      code: 'INTERNAL_ERROR',
    });
  });

  it('the docs/errors.md middleware turns body-parser rejections into problem+json', async () => {
    const { route, post } = createRoute();
    const app = express();
    app.use(express.json({ limit: '100b' }));
    app.all('/items', route({ POST: post({ body: z.object({}), handler: async () => ({}) }) }));
    // The middleware from docs/errors.md → "Before routerplate runs" (param typed for lint).
    app.use(
      (
        error: { status?: number; expose?: boolean; type?: string; message: string },
        req: Request,
        res: Response,
        next: NextFunction,
      ) => {
        if (typeof error.status !== 'number' || !error.expose) return next(error);
        const code = String(error.type ?? 'bad_request')
          .toUpperCase()
          .replace(/\./g, '_');
        const problem = new RouteError(error.message, error.status, code).toProblem(req.path);
        res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
      },
    );

    const malformed = await request(app)
      .post('/items')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(malformed.status).toBe(400);
    expect(malformed.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(malformed.body).toMatchObject({
      title: 'Bad Request',
      status: 400,
      instance: '/items',
      code: 'ENTITY_PARSE_FAILED',
    });

    const huge = await request(app)
      .post('/items')
      .send({ pad: 'x'.repeat(200) });
    expect(huge.status).toBe(413);
    expect(huge.body).toMatchObject({ title: 'Content Too Large', code: 'ENTITY_TOO_LARGE' });
  });

  it('rejects hand-written configs and schemaless mutations at route-construction time', () => {
    const { route, endpoint } = createRoute();
    expect(() =>
      route({
        // @ts-expect-error plain objects are not accepted
        PATCH: { handler: async () => ({}) },
      }),
    ).toThrow(/PATCH must be built with patch\(\)/);
    expect(() => route({ PATCH: endpoint({ handler: async () => ({}) }) })).toThrow(
      /PATCH is missing a `body` schema/,
    );
  });
});
