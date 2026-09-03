import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { RouteError } from '../src/index';
import { createRoute } from '../src/adapters/next';
import { asNextRes, mockRes, nextReq } from './helpers';

class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

describe('error handling', () => {
  it('RouteError thrown from a handler carries its status/code/details', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({
        handler: async () => {
          throw new RouteError('Item not found', 404, 'NOT_FOUND', { id: 'x' });
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toEqual({
      error: 'Item not found',
      code: 'NOT_FOUND',
      details: { id: 'x' },
    });
  });

  it('factories: notFound / forbidden / conflict', async () => {
    const { route, get } = createRoute();
    const cases = [
      [RouteError.notFound(), 404, 'NOT_FOUND', 'Not found'],
      [RouteError.forbidden('No'), 403, 'FORBIDDEN', 'No'],
      [RouteError.conflict('Taken', { field: 'email' }), 409, 'CONFLICT', 'Taken'],
    ] as const;
    for (const [error, status, code, message] of cases) {
      const handler = route({
        GET: get({
          handler: async () => {
            throw error;
          },
        }),
      });
      const res = mockRes();
      await handler(nextReq({ method: 'GET' }), asNextRes(res));
      expect(res.statusCode).toBe(status);
      expect(res.jsonBody).toMatchObject({ error: message, code });
    }
  });

  it('errorToResponse takes precedence over the built-ins (even for RouteError)', async () => {
    const { route, get } = createRoute({
      errorToResponse: (error) =>
        error instanceof RouteError
          ? { status: 418, body: { error: 'mapped', code: 'MAPPED' } }
          : undefined,
    });
    const handler = route({
      GET: get({
        handler: async () => {
          throw new RouteError('original', 404, 'NOT_FOUND');
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(418);
    expect(res.jsonBody).toEqual({ error: 'mapped', code: 'MAPPED' });
  });

  it('errorToResponse maps app error classes; undefined falls through', async () => {
    const { route, get } = createRoute({
      hooks: { log: vi.fn() },
      errorToResponse: (error) =>
        error instanceof AppError
          ? { status: 409, body: { error: error.message, code: error.code } }
          : undefined,
    });
    const handler = route({
      GET: get({
        handler: async ({ query }) => {
          if ((query as Record<string, unknown>).kind === 'app')
            throw new AppError('conflict', 'CONFLICT');
          throw new Error('boom');
        },
      }),
    });

    const mapped = mockRes();
    await handler(nextReq({ method: 'GET', query: { kind: 'app' } }), asNextRes(mapped));
    expect(mapped.statusCode).toBe(409);
    expect(mapped.jsonBody).toEqual({ error: 'conflict', code: 'CONFLICT' });

    const unmapped = mockRes();
    await handler(nextReq({ method: 'GET', query: {} }), asNextRes(unmapped));
    expect(unmapped.statusCode).toBe(500);
    expect(unmapped.jsonBody).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  it('a validator error thrown inside a handler is a server bug → 500, nothing leaked', async () => {
    const { route, get } = createRoute({ hooks: { log: vi.fn() } });
    const handler = route({
      GET: get({
        handler: async () => {
          // Input is already validated before the handler runs, so this
          // is parsing internal data. Its failure is ours, not the client's.
          z.object({ id: z.string() }).parse({ id: 5 });
          return {};
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  it('unexpected errors → 500 INTERNAL_ERROR and the default log', async () => {
    const log = vi.fn();
    const { route, get } = createRoute({ hooks: { log } });
    const handler = route({
      GET: get({
        handler: async () => {
          throw new Error('kaboom');
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(500);
    expect(log).toHaveBeenCalledWith('Unhandled API error:', expect.any(Error));
  });

  it('logs 5xx RouteErrors, stays quiet for 4xx', async () => {
    const log = vi.fn();
    const { route, get } = createRoute({ hooks: { log } });
    const handler = route({
      GET: get({
        handler: async ({ query }) => {
          if ((query as Record<string, unknown>).kind === 'client') throw RouteError.notFound();
          throw new RouteError('Upstream down', 503, 'UPSTREAM_UNAVAILABLE');
        },
      }),
    });

    await handler(nextReq({ method: 'GET', query: { kind: 'client' } }), asNextRes(mockRes()));
    expect(log).not.toHaveBeenCalled();

    await handler(nextReq({ method: 'GET', query: {} }), asNextRes(mockRes()));
    expect(log).toHaveBeenCalledWith(
      'API Error:',
      expect.objectContaining({ statusCode: 503, code: 'UPSTREAM_UNAVAILABLE' }),
    );
  });

  it('onError fires for every error branch with the resolved statusCode', async () => {
    const onError = vi.fn();
    const { route, get, post } = createRoute<{ id: string }>({
      authenticate: async () => null,
      hooks: { onError, log: vi.fn() },
      errorToResponse: (error) =>
        error instanceof AppError ? { status: 422, body: { error: 'e', code: 'C' } } : undefined,
    });

    const handler = route({
      GET: get({
        handler: async () => {
          throw new Error('boom');
        },
      }),
      POST: post({ body: z.object({ n: z.number() }), handler: async () => ({}) }),
    });

    const statuses = async (req: ReturnType<typeof nextReq>) => {
      const res = mockRes();
      await handler(req, asNextRes(res));
      return res.statusCode;
    };

    expect(await statuses(nextReq({ method: 'GET' }))).toBe(401);
    expect(await statuses(nextReq({ method: 'PATCH' }))).toBe(405);

    const codes = onError.mock.calls.map(
      ([, context]) => (context as { statusCode: number }).statusCode,
    );
    expect(codes).toEqual([401, 405]);

    const openRoute = createRoute({ hooks: { onError } });
    const open = openRoute.route({
      POST: openRoute.post({ body: z.object({ n: z.number() }), handler: async () => ({}) }),
      GET: openRoute.get({
        handler: async () => {
          throw new AppError('x', 'C');
        },
      }),
    });
    const bodyRes = mockRes();
    await open(nextReq({ method: 'POST', body: {} }), asNextRes(bodyRes));
    expect(bodyRes.statusCode).toBe(400);
    expect(onError.mock.lastCall?.[1]).toMatchObject({ statusCode: 400, method: 'POST' });
  });

  it('hook context carries the request and the path without its query string', async () => {
    const onError = vi.fn();
    const { route, get } = createRoute({ hooks: { onError } });
    const handler = route({
      GET: get({
        handler: async () => {
          throw RouteError.notFound();
        },
      }),
    });
    const req = nextReq({ method: 'GET', url: '/api/items/1?token=secret' });
    await handler(req, asNextRes(mockRes()));
    expect(onError.mock.calls[0]?.[1]).toMatchObject({
      req,
      path: '/api/items/1',
      statusCode: 404,
    });
  });

  it('onError receives the mapped status from errorToResponse', async () => {
    const onError = vi.fn();
    const { route, get } = createRoute({
      hooks: { onError },
      errorToResponse: () => ({ status: 422, body: { error: 'e', code: 'C' } }),
    });
    const handler = route({
      GET: get({
        handler: async () => {
          throw new Error('anything');
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(422);
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ statusCode: 422 });
  });
});
