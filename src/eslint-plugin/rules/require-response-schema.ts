import {
  hasProperty,
  helperNamesFrom,
  isRouteCall,
  methodConfigObject,
  methodProperties,
  routeAndHelperNamesSchema,
  routeNamesFrom,
  type RuleModule,
} from '../ast.js';

export const requireResponseSchema: RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'GET/POST/PATCH/PUT must declare a `response` schema; it is what keeps undeclared fields off the wire.',
    },
    schema: [routeAndHelperNamesSchema],
    messages: {
      missingResponse:
        '{{method}} config is missing a `response` schema. Declare what this endpoint returns; only those fields are sent.',
    },
  },
  create(context) {
    const routeNames = routeNamesFrom(context);
    const helperNames = helperNamesFrom(context);

    return {
      CallExpression(node) {
        if (!isRouteCall(node, routeNames)) return;
        for (const { method, value } of methodProperties(node)) {
          if (method === 'DELETE') continue;
          const config = methodConfigObject(value, helperNames);
          if (config && !hasProperty(config, 'response')) {
            context.report({ node: config, messageId: 'missingResponse', data: { method } });
          }
        }
      },
    };
  },
};
