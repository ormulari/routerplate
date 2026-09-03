import type { RuleModule } from './ast.js';
import { noBareRouterHandler } from './rules/no-bare-router-handler.js';
import { noManualResponse } from './rules/no-manual-response.js';
import { requireBodySchema } from './rules/require-body-schema.js';
import { requireResponseSchema } from './rules/require-response-schema.js';
import { requireRouteWrapper } from './rules/require-route-wrapper.js';

/**
 * routerplate/eslint-plugin: one rule per rule of the pattern.
 *
 *   routerplate/require-route-wrapper    default export must be `route({...})` (Next)
 *   routerplate/no-bare-router-handler   no `app.get(path, fn)`; mount `route()` (Express)
 *   routerplate/no-manual-response       handlers never call res.json/send/status/…
 *   routerplate/require-body-schema      POST/PATCH/PUT declare a `body` schema
 *   routerplate/require-response-schema  GET/POST/PATCH/PUT declare a `response` schema
 *
 * Usage (flat config, eslint.config.js). Scope via `files` globs; the
 * rules themselves don't check paths:
 *
 * ```js
 * import routerplate from 'routerplate/eslint-plugin';
 *
 * export default [
 *   {
 *     files: ['pages/api/**\/*.ts'],
 *     ...routerplate.configs.recommended,
 *   },
 * ];
 * ```
 */

interface FlatConfig {
  name: string;
  plugins: Record<string, unknown>;
  rules: Record<string, string>;
}

interface Plugin {
  meta: { name: string; version: string };
  rules: Record<string, RuleModule>;
  configs: { recommended: FlatConfig };
}

const plugin: Plugin = {
  meta: { name: 'routerplate', version: '1.0.0' },
  rules: {
    'require-route-wrapper': requireRouteWrapper,
    'no-bare-router-handler': noBareRouterHandler,
    'no-manual-response': noManualResponse,
    'require-body-schema': requireBodySchema,
    'require-response-schema': requireResponseSchema,
  },
  configs: {} as Plugin['configs'],
};

plugin.configs.recommended = {
  name: 'routerplate/recommended',
  plugins: { routerplate: plugin },
  rules: {
    'routerplate/require-route-wrapper': 'error',
    'routerplate/no-bare-router-handler': 'error',
    'routerplate/no-manual-response': 'error',
    'routerplate/require-body-schema': 'error',
    'routerplate/require-response-schema': 'error',
  },
};

export default plugin;
