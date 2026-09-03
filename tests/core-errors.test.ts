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

describe('errors are RFC 9457 problem details', () => {
  it('a RouteError becomes { title, status, detail, instance, code } as application/problem+json', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({
        handler: async () => {
          throw new RouteError('Item not found', 404, 'NOT_FOUND', { id: 'x' });
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET', url: '/api/items/x' }), asNextRes(res));
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(res.jsonBody).toEqual({
      title: 'Not Found',
      status: 404,
      detail: 'Item not found',
      instance: '/api/items/x',
      code: 'NOT_FOUND',
      id: 'x', // extension members ride along at the top level
    });
  });

  it('extensions may set a problem `type` and `title`; status/detail/code cannot be overridden', async () => {
    const { route, get } = createRoute();
    const handler = route({
      GET: get({
        handler: async () => {
          throw new RouteError('You have 3 credits left.', 402, 'OUT_OF_CREDIT', {
            type: 'https://example.com/problems/out-of-credit',
            title: 'Out of credit',
            status: 200,
          });
        },
      }),
    });
    const res = mockRes();
    await handler(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(402);
    expect(res.jsonBody).toEqual({
      type: 'https://example.com/problems/out-of-credit',
      title: 'Out of credit',
      status: 402,
      detail: 'You have 3 credits left.',
      instance: '/api/test',
      code: 'OUT_OF_CREDIT',
    });
  });

  it('factories: notFound / forbidden / conflict', async () => {
    const { route, get } = createRoute();
    const cases = [
      [RouteError.notFound(), 404, 'Not Found', 'NOT_FOUND', 'Not found'],
      [RouteError.forbidden('No'), 403, 'Forbidden', 'FORBIDDEN', 'No'],
      [RouteError.conflict('Taken', { field: 'email' }), 409, 'Conflict', 'CONFLICT', 'Taken'],
    ] as const;
    for (const [error, status, title, code, detail] of cases) {
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
      expect(res.jsonBody).toMatchObject({ title, status, detail, code });
    }
  });

  it('mapError translates app errors into RouteErrors and runs before the built-ins', async () => {
    const { route, get } = createRoute({
      hooks: { log: vi.fn() },
      mapError: (error) => {
        if (error instanceof AppError) return new RouteError(error.message, 409, error.code);
        if (error instanceof RouteError) return new RouteError('remapped', 418, 'TEAPOT');
        return undefined;
      },
    });
    const handler = route({
      GET: get({
        handler: async ({ query }) => {
          const kind = (query as Record<string, unknown>).kind;
          if (kind === 'app') throw new AppError('conflict', 'CONFLICT');
          if (kind === 'route') throw RouteError.notFound();
          throw new Error('boom');
        },
      }),
    });

    const mapped = mockRes();
    await handler(nextReq({ method: 'GET', query: { kind: 'app' } }), asNextRes(mapped));
    expect(mapped.statusCode).toBe(409);
    expect(mapped.jsonBody).toMatchObject({
      title: 'Conflict',
      detail: 'conflict',
      code: 'CONFLICT',
    });

    const remapped = mockRes();
    await handler(nextReq({ method: 'GET', query: { kind: 'route' } }), asNextRes(remapped));
    expect(remapped.statusCode).toBe(418);
    expect(remapped.jsonBody).toMatchObject({ title: 'Error', code: 'TEAPOT' }); // no phrase for 418

    const unmapped = mockRes();
    await handler(nextReq({ method: 'GET', query: {} }), asNextRes(unmapped));
    expect(unmapped.statusCode).toBe(500);
    expect(unmapped.jsonBody).toEqual({
      title: 'Internal Server Error',
      status: 500,
      detail: 'Internal server error',
      instance: '/api/test',
      code: 'INTERNAL_ERROR',
    });
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
    expect(res.jsonBody).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(res.jsonBody).not.toHaveProperty('errors');
  });

  it('unexpected errors → 500 and the default log', async () => {
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

    const res = mockRes();
    await handler(nextReq({ method: 'GET', query: {} }), asNextRes(res));
    expect(res.jsonBody).toMatchObject({ title: 'Service Unavailable', status: 503 });
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
      mapError: (error) => (error instanceof AppError ? new RouteError('e', 422, 'C') : undefined),
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
    const res = mockRes();
    await handler(req, asNextRes(res));
    expect(onError.mock.calls[0]?.[1]).toMatchObject({
      req,
      path: '/api/items/1',
      statusCode: 404,
    });
    // and `instance` in the body is that same path, token excluded
    expect(res.jsonBody).toMatchObject({ instance: '/api/items/1' });
  });

  it('a throw inside authenticate is a 500, not a 401 (return null for a bad token)', async () => {
    const log = vi.fn();
    const { route, get } = createRoute<{ id: string }>({
      authenticate: async () => {
        throw new Error('jwt malformed');
      },
      hooks: { log },
    });
    const res = mockRes();
    await route({ GET: get({ handler: async () => ({}) }) })(
      nextReq({ method: 'GET' }),
      asNextRes(res),
    );
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith('Unhandled API error:', expect.any(Error));
  });

  it('onError receives the mapped status from mapError', async () => {
    const onError = vi.fn();
    const { route, get } = createRoute({
      hooks: { onError },
      mapError: () => new RouteError('e', 422, 'C'),
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
    expect(res.jsonBody).toMatchObject({ title: 'Unprocessable Content', code: 'C' });
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ statusCode: 422 });
  });
});

describe('nothing in the error path can hang the request', () => {
  it('a throwing onError hook is logged; the response still goes out', async () => {
    const log = vi.fn();
    const { route, get } = createRoute({
      hooks: {
        log,
        onError: () => {
          throw new Error('tracker down');
        },
      },
    });
    const res = mockRes();
    await route({
      GET: get({
        handler: async () => {
          throw RouteError.notFound();
        },
      }),
    })(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toMatchObject({ code: 'NOT_FOUND' });
    expect(log).toHaveBeenCalledWith('routerplate: onError threw', expect.any(Error));
  });

  it('a throwing mapError counts as unmapped → 500', async () => {
    const log = vi.fn();
    const { route, get } = createRoute({
      hooks: { log },
      mapError: () => {
        throw new Error('mapper bug');
      },
    });
    const res = mockRes();
    await route({
      GET: get({
        handler: async () => {
          throw new Error('original');
        },
      }),
    })(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith('routerplate: mapError threw', expect.any(Error));
  });

  it('a throwing onBodyValidationFailure hook still yields the 400', async () => {
    const log = vi.fn();
    const { route, post } = createRoute({
      hooks: {
        log,
        onBodyValidationFailure: () => {
          throw new Error('tracker down');
        },
      },
    });
    const res = mockRes();
    await route({ POST: post({ body: z.object({ n: z.number() }), handler: async () => ({}) }) })(
      nextReq({ method: 'POST', body: {} }),
      asNextRes(res),
    );
    expect(res.statusCode).toBe(400);
    expect(log).toHaveBeenCalledWith(
      'routerplate: onBodyValidationFailure threw',
      expect.any(Error),
    );
  });

  it('a throwing log hook falls back to console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { route, get } = createRoute({
      hooks: {
        log: () => {
          throw new Error('logger down');
        },
      },
    });
    const res = mockRes();
    await route({
      GET: get({
        handler: async () => {
          throw new Error('boom');
        },
      }),
    })(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      'Unhandled API error:',
      expect.any(Error),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('a problem body that cannot be serialized falls back to an empty 500', async () => {
    const log = vi.fn();
    const { route, get } = createRoute({ hooks: { log } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const res = mockRes();
    await route({
      GET: get({
        handler: async () => {
          throw new RouteError('Taken', 409, 'CONFLICT', { circular });
        },
      }),
    })(nextReq({ method: 'GET' }), asNextRes(res));
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toBeUndefined();
    expect(res.ended).toBe(true);
    expect(log).toHaveBeenCalledWith(
      'routerplate: could not serialize the error response',
      expect.any(TypeError),
    );
  });
});
