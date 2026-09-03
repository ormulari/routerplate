import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createRoute as createExpressRoute } from '../src/adapters/express';
import { createRoute as createNextRoute } from '../src/adapters/next';

type User = { id: string };

describe('types flow from schemas, no hand annotations', () => {
  it('express: query, params, body, user, and extras are all inferred', () => {
    const { route, patch, get, del, endpoint } = createExpressRoute<User, { db: { name: string } }>(
      {
        authenticate: async () => ({ id: 'u' }),
        extend: async () => ({ db: { name: 'main' } }),
      },
    );

    const patchConfig = patch({
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ dryRun: z.coerce.boolean() }),
      body: z.object({ name: z.string(), tags: z.array(z.string()) }),
      response: z.object({ id: z.string(), name: z.string() }),
      handler: async ({ params, query, body, user, db }) => {
        expectTypeOf(params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(query).toEqualTypeOf<{ dryRun: boolean }>();
        expectTypeOf(body).toEqualTypeOf<{ name: string; tags: string[] }>();
        expectTypeOf(user).toEqualTypeOf<User>();
        expectTypeOf(db).toEqualTypeOf<{ name: string }>();
        return { id: params.id, name: body.name };
      },
    });

    const getConfig = get({
      handler: async ({ query, body }) => {
        // no query schema → the raw framework query type; no body on GET
        expectTypeOf(body).toEqualTypeOf<never>();
        return { raw: query };
      },
    });

    const delConfig = del({
      params: z.object({ id: z.string() }),
      handler: async ({ params }) => {
        expectTypeOf(params).toEqualTypeOf<{ id: string }>();
        return null;
      },
    });

    const endpointConfig = endpoint({
      body: z.object({ n: z.number() }),
      handler: async ({ body }) => {
        expectTypeOf(body).toEqualTypeOf<{ n: number }>();
        return { doubled: body.n * 2 };
      },
    });

    const handler = route({
      PATCH: patchConfig,
      GET: getConfig,
      DELETE: delConfig,
      PUT: endpointConfig,
    });
    expect(typeof handler).toBe('function');
  });

  it('next: helpers are pre-bound to the factory User/Extras', () => {
    const { route, post } = createNextRoute<User>({ authenticate: async () => ({ id: 'u' }) });
    const config = post({
      body: z.object({ email: z.string().email() }),
      handler: async ({ body, user }) => {
        expectTypeOf(body).toEqualTypeOf<{ email: string }>();
        expectTypeOf(user).toEqualTypeOf<User>();
        return { email: body.email };
      },
    });
    expect(typeof route({ POST: config })).toBe('function');
  });
});

describe('the holes are closed', () => {
  it('route() rejects a hand-written config: no `any` ctx', () => {
    const { route } = createExpressRoute<User>({ authenticate: async () => ({ id: 'u' }) });
    expect(() =>
      route({
        // @ts-expect-error not built by a helper, so no brand
        GET: { handler: async (ctx) => ctx.anything },
      }),
    ).toThrow();
  });

  it('requireAuth: false makes ctx.user nullable; the default keeps it non-null', () => {
    const { get } = createNextRoute<User>({ authenticate: async () => ({ id: 'u' }) });
    get({
      requireAuth: false,
      handler: async ({ user }) => {
        expectTypeOf(user).toEqualTypeOf<User | null>();
        return {};
      },
    });
    get({
      handler: async ({ user }) => {
        expectTypeOf(user).toEqualTypeOf<User>();
        return {};
      },
    });
  });

  it('no authenticate → ctx.user is null, even with an explicit User generic', () => {
    const { get } = createExpressRoute<User>();
    get({
      handler: async ({ user }) => {
        expectTypeOf(user).toEqualTypeOf<null>();
        return {};
      },
    });
  });

  it('authorize gets the same typed ctx as the handler', () => {
    const { post } = createNextRoute<User>({ authenticate: async () => ({ id: 'u' }) });
    post({
      body: z.object({ ownerId: z.string() }),
      authorize: ({ body, user }) => {
        expectTypeOf(body).toEqualTypeOf<{ ownerId: string }>();
        return body.ownerId === user.id;
      },
      handler: async () => ({}),
    });
  });

  it('handlers return the response schema input, not its output', () => {
    const { get } = createNextRoute();
    const schema = z.object({ n: z.string().transform(Number) });
    get({ response: schema, handler: async () => ({ n: '5' }) });
    get({
      response: schema,
      // @ts-expect-error `n` must be the input type (string)
      handler: async () => ({ n: 5 }),
    });
  });
});
