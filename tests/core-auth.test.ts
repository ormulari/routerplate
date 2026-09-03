import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { authContext, createRoute } from '../src/adapters/next';
import { asNextRes, mockRes, nextReq } from './helpers';

type User = { id: string; name: string };

describe('authentication', () => {
  it('401 UNAUTHORIZED when authenticate returns null and auth is required (the default)', async () => {
    const { route, get } = createRoute<User>({ authenticate: async () => null });
    const handler = route({ GET: get({ handler: async () => ({}) }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toMatchObject({ code: 'UNAUTHORIZED', error: 'Authentication required' });
  });

  it('passes the user into ctx when authenticated', async () => {
    const user: User = { id: 'u1', name: 'Ada' };
    const { route, get } = createRoute<User>({ authenticate: async () => user });
    const handler = route({
      GET: get({
        handler: async (ctx) => {
          expectTypeOf(ctx.user).toEqualTypeOf<User>();
          return { who: ctx.user.name };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: { who: 'Ada' } });
  });

  it('requireAuth: false is per method: anonymous GET, authed POST on one route', async () => {
    const { route, get, post } = createRoute<User>({
      authenticate: async (req) => (req.headers?.authorization ? { id: 'u1', name: 'Ada' } : null),
    });
    const handler = route({
      GET: get({
        requireAuth: false,
        handler: async (ctx) => {
          expectTypeOf(ctx.user).toEqualTypeOf<User | null>();
          return { anonymous: ctx.user === null };
        },
      }),
      POST: post({
        body: z.object({}),
        handler: async (ctx) => {
          expectTypeOf(ctx.user).toEqualTypeOf<User>();
          return { by: ctx.user.id };
        },
      }),
    });

    const anon = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(anon));
    expect(anon.statusCode).toBe(200);
    expect(anon.jsonBody).toEqual({ data: { anonymous: true } });

    const denied = mockRes();
    await handler(nextReq({ method: 'POST', body: {} }), asNextRes(denied));
    expect(denied.statusCode).toBe(401);
  });

  it('no authenticate dep → ctx.user is typed null and no route ever 401s', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({
        handler: async (ctx) => {
          expectTypeOf(ctx.user).toEqualTypeOf<null>();
          return { user: ctx.user };
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ data: { user: null } });
  });
});

describe('authorize', () => {
  const { route, get, patch } = createRoute<User>({
    authenticate: async (req) =>
      req.headers?.authorization === 'admin'
        ? { id: 'admin', name: 'Root' }
        : { id: 'u1', name: 'Ada' },
  });

  it('false → 403 FORBIDDEN, handler never runs', async () => {
    const handlerSpy = vi.fn(async () => ({}));
    const handler = route({
      GET: get({ authorize: ({ user }) => user.id === 'admin', handler: handlerSpy }),
    });

    const denied = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(denied));
    expect(denied.statusCode).toBe(403);
    expect(denied.jsonBody).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
    expect(handlerSpy).not.toHaveBeenCalled();

    const allowed = mockRes();
    const req = nextReq({ method: 'GET' });
    (req as { headers: Record<string, string> }).headers = { authorization: 'admin' };
    await handler(req, asNextRes(allowed));
    expect(allowed.statusCode).toBe(200);
    expect(handlerSpy).toHaveBeenCalledOnce();
  });

  it('sees the validated body and query, typed like the handler', async () => {
    const handler = route({
      PATCH: patch({
        query: z.object({ owner: z.string() }),
        body: z.object({ name: z.string() }),
        authorize: async ({ user, query, body }) => {
          expectTypeOf(query).toEqualTypeOf<{ owner: string }>();
          expectTypeOf(body).toEqualTypeOf<{ name: string }>();
          return query.owner === user.id;
        },
        handler: async ({ body }) => ({ renamed: body.name }),
      }),
    });

    const own = mockRes();
    await handler(
      nextReq({ method: 'PATCH', query: { owner: 'u1' }, body: { name: 'x' } }),
      asNextRes(own),
    );
    expect(own.statusCode).toBe(200);

    const other = mockRes();
    await handler(
      nextReq({ method: 'PATCH', query: { owner: 'u2' }, body: { name: 'x' } }),
      asNextRes(other),
    );
    expect(other.statusCode).toBe(403);
  });

  it('runs after validation: a bad body is 400 before it is 403', async () => {
    const handler = route({
      PATCH: patch({
        body: z.object({ name: z.string() }),
        authorize: () => false,
        handler: async () => ({}),
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'PATCH', body: { name: 1 } }), asNextRes(res));
    expect(res.statusCode).toBe(400);
  });
});

describe('authContext', () => {
  it('merges auth-derived extras into ctx (Supabase-style: one client for auth + db)', async () => {
    const { route, get } = createRoute<User, { db: { scope: string } }>({
      authenticate: async () => authContext({ id: 'u1', name: 'Ada' }, { db: { scope: 'rls:u1' } }),
    });
    const handler = route({
      GET: get({ handler: async ({ user, db }) => ({ who: user.name, scope: db.scope }) }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: { who: 'Ada', scope: 'rls:u1' } });
  });

  it('authContext(null, extras): 401 by default, extras still reach requireAuth: false methods', async () => {
    const { route, get } = createRoute<User, { db: { scope: string } }>({
      authenticate: async () => authContext(null, { db: { scope: 'anon' } }),
    });
    const res401 = mockRes();
    await route({ GET: get({ handler: async () => ({}) }) })(
      nextReq({ method: 'GET' }),
      asNextRes(res401),
    );
    expect(res401.statusCode).toBe(401);

    const resAnon = mockRes();
    await route({
      GET: get({
        requireAuth: false,
        handler: async ({ db, user }) => ({ scope: db.scope, anon: user === null }),
      }),
    })(nextReq({ method: 'GET' }), asNextRes(resAnon));
    expect(resAnon.jsonBody).toEqual({ data: { scope: 'anon', anon: true } });
  });

  it('extend runs after authContext, receives the user, and wins on key conflicts', async () => {
    const extend = vi.fn(async ({ user }: { user: User | null }) => ({
      db: { scope: `extend:${user?.id}` },
    }));
    const { route, get } = createRoute<User, { db: { scope: string } }>({
      authenticate: async () => authContext({ id: 'u1', name: 'Ada' }, { db: { scope: 'auth' } }),
      extend,
    });
    const res = mockRes();
    await route({ GET: get({ handler: async ({ db }) => ({ scope: db.scope }) }) })(
      nextReq({ method: 'GET' }),
      asNextRes(res),
    );
    expect(res.jsonBody).toEqual({ data: { scope: 'extend:u1' } });
    expect(extend.mock.calls[0]?.[0]).toMatchObject({ user: { id: 'u1' } });
  });

  it('authenticate receives the response object (getServerSession, cookie refresh)', async () => {
    const authenticate = vi.fn(async (_req: unknown, _res: unknown) => ({
      id: 'u1',
      name: 'Ada',
    }));
    const { route, get } = createRoute<User>({ authenticate });
    const res = mockRes();
    await route({ GET: get({ handler: async () => ({}) }) })(
      nextReq({ method: 'GET' }),
      asNextRes(res),
    );
    expect(authenticate.mock.calls[0]?.[1]).toBe(res);
  });

  it('recognizes an envelope built by another copy of the module (Symbol.for brand)', async () => {
    const foreignEnvelope = {
      [Symbol.for('routerplate.authContext')]: true,
      user: { id: 'u1', name: 'Ada' },
      extras: { db: { scope: 'foreign' } },
    };
    const { route, get } = createRoute<User, { db: { scope: string } }>({
      authenticate: async () => foreignEnvelope as ReturnType<typeof authContext<User, never>>,
    });
    const res = mockRes();
    await route({ GET: get({ handler: async ({ db }) => ({ scope: db.scope }) }) })(
      nextReq({ method: 'GET' }),
      asNextRes(res),
    );
    expect(res.jsonBody).toEqual({ data: { scope: 'foreign' } });
  });

  it('a plain user object with a `user` key is NOT mistaken for an envelope (brand check)', async () => {
    type Weird = { id: string; user: string };
    const { route, get } = createRoute<Weird>({
      authenticate: async () => ({ id: 'u1', user: 'not-an-envelope' }),
    });
    const res = mockRes();
    await route({ GET: get({ handler: async ({ user }) => ({ id: user.id }) }) })(
      nextReq({ method: 'GET' }),
      asNextRes(res),
    );
    expect(res.jsonBody).toEqual({ data: { id: 'u1' } });
  });
});

describe('extend', () => {
  it('merges extras into ctx after authentication', async () => {
    const extend = vi.fn(async ({ user }: { user: User | null }) => ({
      db: { scope: user?.id ?? 'anon' },
    }));
    const { route, get } = createRoute<User, { db: { scope: string } }>({
      authenticate: async () => ({ id: 'u1', name: 'Ada' }),
      extend,
    });
    const handler = route({ GET: get({ handler: async ({ db }) => ({ scope: db.scope }) }) });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.jsonBody).toEqual({ data: { scope: 'u1' } });
    expect(extend).toHaveBeenCalledOnce();
    expect(extend.mock.calls[0]?.[0]).toMatchObject({ user: { id: 'u1' } });
  });
});
