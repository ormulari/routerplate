import {
  hasProperty,
  helperNamesFrom,
  isRouteCall,
  methodConfigObject,
  methodProperties,
  MUTATING_METHODS,
  routeAndHelperNamesSchema,
  routeNamesFrom,
  type RuleModule,
} from '../ast.js';

export const requireBodySchema: RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'POST/PATCH/PUT must declare a `body` schema; unvalidated bodies are forbidden.',
    },
    schema: [routeAndHelperNamesSchema],
    messages: {
      bareHandler:
        '{{method}} must be a config with a `body` schema, not a bare handler; mutating methods always validate their body.',
      missingBody:
        '{{method}} config is missing a `body` schema. Add one (use `z.object({}).strict()` if the body is intentionally empty).',
    },
  },
  create(context) {
    const routeNames = routeNamesFrom(context);
    const helperNames = helperNamesFrom(context);

    return {
      CallExpression(node) {
        if (!isRouteCall(node, routeNames)) return;
        for (const { method, value } of methodProperties(node)) {
          if (!MUTATING_METHODS.has(method)) continue;
          if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
            context.report({ node: value, messageId: 'bareHandler', data: { method } });
            continue;
          }
          const config = methodConfigObject(value, helperNames);
          if (config && !hasProperty(config, 'body')) {
            context.report({ node: config, messageId: 'missingBody', data: { method } });
          }
        }
      },
    };
  },
};
