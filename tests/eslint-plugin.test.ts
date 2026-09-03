import tsParser from '@typescript-eslint/parser';
import { Linter, RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import plugin from '../src/eslint-plugin/index';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});

const rules = plugin.rules;

tester.run('require-route-wrapper', rules['require-route-wrapper'] as never, {
  valid: [
    'export default route({ GET: get({ handler: async () => ({}) }) });',
    'export default route({}) satisfies Handler;',
    'export default route({}) as Handler;',
    { code: 'export default endpoint({});', options: [{ routeNames: ['endpoint'] }] },
    // Named exports are not default exports, so out of scope for this rule
    'export const itemsRouter = Router();',
  ],
  invalid: [
    {
      code: 'export default async (req, res) => { res.json({}); };',
      errors: [{ messageId: 'notRouteCall' }],
    },
    { code: 'export default handler;', errors: [{ messageId: 'notRouteCall' }] },
    {
      code: 'export default makeRoute({});',
      errors: [{ messageId: 'notRouteCall' }],
    },
  ],
});

tester.run('no-bare-router-handler', rules['no-bare-router-handler'] as never, {
  valid: [
    "app.all('/items', route({}));",
    "router.all('/items/:id', route({ GET: get({ handler: async () => ({}) }) }));",
    // Identifiers are opaque
    "router.get('/x', handler);",
    // Not a path: a cache lookup, an HTTP client
    "cache.get('key', () => compute());",
    "axios.get('/x', { params });",
    // Too few args to be a registration
    "map.get('/x');",
  ],
  invalid: [
    {
      code: "app.get('/health', (req, res) => res.json({ ok: true }));",
      errors: [{ messageId: 'bareRouterHandler' }],
    },
    {
      code: "router.post('/x', requireAuth, async (req, res) => { res.status(201).end(); });",
      errors: [{ messageId: 'bareRouterHandler' }],
    },
    {
      code: 'app.delete(`/v${n}/x`, function (req, res) { res.end(); });',
      errors: [{ messageId: 'bareRouterHandler' }],
    },
    {
      code: "app.all('/x', (req, res) => res.end());",
      errors: [{ messageId: 'bareRouterHandler' }],
    },
  ],
});

tester.run('no-manual-response', rules['no-manual-response'] as never, {
  valid: [
    // outside a route() call; other files may write responses
    'res.json({});',
    'route({ GET: get({ handler: async ({ res }) => ({ ok: true }) }) });',
    // a non-res object
    'route({ GET: get({ handler: async () => { response.json({}); } }) });',
  ],
  invalid: [
    {
      code: 'route({ GET: get({ handler: async ({ res }) => { res.json({}); } }) });',
      errors: [{ messageId: 'manualResponse' }],
    },
    {
      code: 'route({ GET: get({ handler: async (ctx) => { ctx.res.status(200); } }) });',
      errors: [{ messageId: 'manualResponse' }],
    },
    {
      code: 'route({ GET: get({ handler: async ({ res }) => { res.redirect("/"); } }) });',
      errors: [{ messageId: 'manualResponse' }],
    },
    {
      code: 'route({ GET: get({ handler: async ({ res }) => { res.setHeader("x", "y"); } }) });',
      errors: [{ messageId: 'manualResponse' }],
    },
    {
      code: 'route({ GET: get({ handler: async ({ res }) => { res.writeHead(200); res.write("x"); } }) });',
      errors: [{ messageId: 'manualResponse' }, { messageId: 'manualResponse' }],
    },
  ],
});

tester.run('require-body-schema', rules['require-body-schema'] as never, {
  valid: [
    'route({ POST: post({ body: CreateSchema, handler: async () => ({}) }) });',
    'route({ POST: { body: CreateSchema, handler: async () => ({}) } });',
    'route({ GET: get({ handler: async () => ({}) }) });',
    // Identifier configs are opaque to static analysis; skipped (documented limitation)
    'route({ POST: sharedConfig });',
    // Unknown helper callees are opaque too
    'route({ POST: makeConfig() });',
  ],
  invalid: [
    {
      code: 'route({ POST: post({ handler: async () => ({}) }) });',
      errors: [{ messageId: 'missingBody' }],
    },
    {
      code: 'route({ POST: { handler: async () => ({}) } });',
      errors: [{ messageId: 'missingBody' }],
    },
    {
      code: 'route({ PATCH: async () => ({}) });',
      errors: [{ messageId: 'bareHandler' }],
    },
    {
      code: 'route({ PUT: endpoint({ query: QuerySchema, handler: async () => ({}) }) });',
      errors: [{ messageId: 'missingBody' }],
    },
  ],
});

tester.run('require-response-schema', rules['require-response-schema'] as never, {
  valid: [
    'route({ GET: get({ response: ItemSchema, handler: async () => item }) });',
    'route({ POST: post({ body: CreateSchema, response: ItemSchema, handler: async () => item }) });',
    // DELETE returns nothing
    'route({ DELETE: del({ handler: async () => null }) });',
    'route({ GET: sharedConfig });',
  ],
  invalid: [
    {
      code: 'route({ GET: get({ handler: async () => item }) });',
      errors: [{ messageId: 'missingResponse' }],
    },
    {
      code: 'route({ POST: post({ body: CreateSchema, handler: async () => item }) });',
      errors: [{ messageId: 'missingResponse' }],
    },
    {
      code: 'route({ PUT: endpoint({ body: B, handler: async () => item }) });',
      errors: [{ messageId: 'missingResponse' }],
    },
  ],
});

describe('recommended flat config', () => {
  const linter = new Linter({ configType: 'flat' });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tsParser as never,
        ecmaVersion: 2022 as const,
        sourceType: 'module' as const,
      },
      plugins: { routerplate: plugin as never },
      rules: plugin.configs.recommended.rules as never,
    },
  ];

  function lint(code: string) {
    return linter.verify(code, config as never, 'pages/api/example.ts');
  }

  it('flags every rule violation', () => {
    const messages = lint(`
      export default route({
        GET: get({
          handler: async ({ res }) => {
            res.json({});
            return { ok: true };
          },
        }),
        POST: post({ handler: async () => ({}) }),
      });
      app.get('/health', (req, res) => res.end());
    `);
    const ruleIds = new Set(messages.map((message) => message.ruleId));
    expect(ruleIds).toEqual(
      new Set([
        'routerplate/no-manual-response',
        'routerplate/require-body-schema',
        'routerplate/require-response-schema',
        'routerplate/no-bare-router-handler',
      ]),
    );
  });

  it('flags a bare default-export handler', () => {
    const messages = lint('export default async (req, res) => ({});');
    expect(messages.map((message) => message.ruleId)).toContain(
      'routerplate/require-route-wrapper',
    );
  });

  it('passes a clean helper-style route file', () => {
    const messages = lint(`
      import { del, get, post, route } from '../../lib/api/route';
      export default route({
        GET: get({ response: ItemListSchema, handler: async () => items }),
        POST: post({ body: CreateSchema, response: ItemSchema, handler: async ({ body }) => body }),
        DELETE: del({ handler: async () => null }),
      });
    `);
    expect(messages).toEqual([]);
  });
});
