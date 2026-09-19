import { type } from 'arktype';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { z as z4 } from 'zod/v4';
import { createRoute as createExpressRoute } from '../src/adapters/express';
import { createRoute as createNextRoute } from '../src/adapters/next';
import { routeDescription } from '../src/core/engine';
import { openapi, type OpenApiOptions } from '../src/openapi/index';

type User = { id: string };

const info = { title: 'Items', version: '1.0.0' };

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});

/** Zod 4 has no `~standard.jsonSchema` yet; its converter plugs in here. */
const zodToJsonSchema: OpenApiOptions['toJsonSchema'] = (schema, use) =>
  z4.toJSONSchema(schema as z4.ZodType, { io: use, target: 'draft-2020-12' });

describe('openapi(): the document', () => {
  it('describes a Next resource with zod schemas through toJsonSchema', () => {
    const { route, get, post } = createNextRoute<User>({ authenticate: async () => ({ id: 'u' }) });
    const Item = z4.object({ id: z4.string(), name: z4.string() });
    const items = route({
      GET: get({
        // Next merges dynamic segments into the query; `id` is in the template, so it is a path param.
        query: z4.object({ id: z4.string(), expand: z4.enum(['owner']).optional() }),
        response: Item,
        handler: async () => ({ id: '1', name: 'First' }),
      }),
      POST: post({
        requireAuth: false,
        body: z4.object({ name: z4.string().min(1) }),
        response: Item,
        authorize: () => true,
        handler: async ({ body }) => ({ id: '2', name: body.name }),
      }),
    });

    const doc = openapi({
      info,
      servers: [{ url: 'https://api.example.com' }],
      paths: { '/api/items/{id}': items },
      toJsonSchema: zodToJsonSchema,
    });

    const itemSchema = {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    };
    expect(doc).toEqual({
      openapi: '3.1.0',
      info,
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/api/items/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              {
                name: 'expand',
                in: 'query',
                required: false,
                schema: { type: 'string', enum: ['owner'] },
              },
            ],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: itemSchema } } },
              '400': problem('Validation failed'),
              '401': problem('Authentication required'),
              '500': problem('Internal server error'),
            },
          },
          post: {
            // The template variable is declared on every method, schema or not.
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string', minLength: 1 } },
                    required: ['name'],
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: itemSchema } },
              },
              '400': problem('Validation failed'),
              '403': problem('Forbidden'),
              '500': problem('Internal server error'),
            },
          },
        },
      },
      components: {
        schemas: {
          Problem: expect.objectContaining({
            type: 'object',
            required: ['title', 'status', 'detail', 'instance', 'code'],
          }),
          ProblemError: expect.objectContaining({ required: ['pointer', 'detail'] }),
        },
      },
    });
    // No per-schema `$schema`: the document's dialect already is 2020-12.
    expect(JSON.stringify(doc)).not.toContain('$schema');
  });

  it('describes an Express resource with arktype schemas (Standard JSON Schema built in)', () => {
    const { route, get, patch, del } = createExpressRoute();
    const IdParams = type({ id: 'string' });
    const Item = type({ id: 'string', name: 'string' });
    const item = route({
      GET: get({ params: IdParams, response: Item, handler: async () => ({ id: '1', name: 'x' }) }),
      PATCH: patch({
        params: IdParams,
        body: type({ name: 'string' }),
        response: Item,
        handler: async () => ({ id: '1', name: 'x' }),
      }),
      DELETE: del({ params: IdParams, handler: async () => null }),
    });

    const doc = openapi({ info, paths: { '/items/:id': item } });

    expect(doc.servers).toBeUndefined();
    expect(Object.keys(doc.paths)).toEqual(['/items/{id}']);
    const operations = doc.paths['/items/{id}'];
    expect(Object.keys(operations ?? {})).toEqual(['get', 'patch', 'delete']);

    const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
    expect(operations?.get?.parameters).toEqual([idParam]);
    expect(operations?.get?.responses[200]?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
    });
    expect(operations?.patch?.requestBody?.content['application/json']?.schema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
    // No authenticate → no method can answer 401.
    expect(Object.keys(operations?.get?.responses ?? {})).toEqual(['200', '400', '500']);
    // DELETE → 204 with no content.
    expect(operations?.delete?.responses).toEqual({
      '204': { description: 'No Content' },
      '400': problem('Validation failed'),
      '500': problem('Internal server error'),
    });
  });

  it('uses the input schema for what the client sends and the output schema for the response', () => {
    const { route, put } = createNextRoute();
    // `n` is optional on the way in and always present on the way out.
    const schema = z4.object({ n: z4.number().default(1) });
    const handler = route({
      PUT: put({ body: schema, response: schema, handler: async ({ body }) => body }),
    });
    const toJsonSchema = vi.fn(zodToJsonSchema);

    const doc = openapi({ info, paths: { '/x': handler }, toJsonSchema });

    const put_ = doc.paths['/x']?.put;
    expect(put_?.requestBody?.content['application/json']?.schema?.required).toBeUndefined();
    expect(put_?.responses[200]?.content?.['application/json']?.schema).toMatchObject({
      required: ['n'],
    });
    expect(toJsonSchema.mock.calls.map(([, use]) => use)).toEqual(['input', 'output']);
  });

  it('declares template variables no schema mentions as string path parameters', () => {
    const { route, get } = createExpressRoute();
    const handler = route({ GET: get({ handler: async () => ({}) }) });

    const doc = openapi({ info, paths: { '/orgs/{org}/repos/:repo': handler } });

    expect(doc.paths['/orgs/{org}/repos/{repo}']?.get).toEqual({
      parameters: [
        { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': { description: 'OK' }, '500': problem('Internal server error') },
    });
  });

  it('adds 401 to every method that requires auth when the adapter authenticates', () => {
    const { route, get, del } = createExpressRoute<User>({ authenticate: async () => null });
    const handler = route({
      GET: get({ handler: async () => ({}) }),
      DELETE: del({ requireAuth: false, handler: async () => null }),
    });

    const doc = openapi({ info, paths: { '/x': handler } });

    expect(Object.keys(doc.paths['/x']?.get?.responses ?? {})).toEqual(['200', '401', '500']);
    expect(Object.keys(doc.paths['/x']?.delete?.responses ?? {})).toEqual(['204', '500']);
  });
});

describe('openapi(): what it refuses', () => {
  const { route, get } = createExpressRoute();

  it('anything that is not a route() result', () => {
    expect(() => openapi({ info, paths: { '/x': () => undefined } })).toThrow(
      /"\/x" is not a route\(\) result/,
    );
  });

  it('a schema without Standard JSON Schema when toJsonSchema is not given', () => {
    const handler = route({ GET: get({ response: z.object({}), handler: async () => ({}) }) });
    expect(() => openapi({ info, paths: { '/x': handler } })).toThrow(
      /response schema for GET \/x \(zod\) does not implement Standard JSON Schema; pass `toJsonSchema`/,
    );
  });

  it('a query or params schema that is not an object', () => {
    const handler = route({ GET: get({ query: type('string'), handler: async () => ({}) }) });
    expect(() => openapi({ info, paths: { '/x': handler } })).toThrow(
      /query schema for GET \/x must describe an object/,
    );
  });

  it('a params property missing from the path template', () => {
    const handler = route({
      GET: get({ params: type({ id: 'string' }), handler: async () => ({}) }),
    });
    expect(() => openapi({ info, paths: { '/items': handler } })).toThrow(
      /GET \/items declares path parameter "id" but the path template has no \{id\}/,
    );
  });
});

describe('routeDescription()', () => {
  it('is carried by what route() returns, on both adapters', () => {
    const express = createExpressRoute<User>({ authenticate: async () => ({ id: 'u' }) });
    const next = createNextRoute();
    const config = { GET: express.get({ handler: async () => ({}) }) };

    expect(routeDescription(express.route(config))).toEqual({ config, authenticates: true });
    expect(routeDescription(next.route({ GET: next.get({ handler: async () => ({}) }) }))).toEqual({
      config: expect.any(Object),
      authenticates: false,
    });
  });

  it('is undefined for anything else', () => {
    expect(routeDescription(() => undefined)).toBeUndefined();
    expect(routeDescription({})).toBeUndefined();
    expect(routeDescription(null)).toBeUndefined();
    expect(routeDescription('route')).toBeUndefined();
  });
});
