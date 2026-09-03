import {
  findEnclosingRouteCall,
  routeNamesFrom,
  routeNamesSchema,
  type RuleModule,
} from '../ast.js';

export const noManualResponse: RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Inside route() handlers, never write the response directly; return a payload or throw.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          routeNames: routeNamesSchema.properties.routeNames,
          forbiddenMembers: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      manualResponse:
        'Do not call `res.{{member}}()` inside a route() handler; return a bare payload (route() wraps it) or throw a RouteError.',
    },
  },
  create(context) {
    const routeNames = routeNamesFrom(context);
    const forbidden = new Set<string>(
      (context.options[0] && context.options[0].forbiddenMembers) || [
        'json',
        'send',
        'sendStatus',
        'sendFile',
        'status',
        'end',
        'write',
        'writeHead',
        'setHeader',
        'cookie',
        'redirect',
      ],
    );
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !forbidden.has(callee.property.name)
        ) {
          return;
        }
        // Match `res.x()` and `ctx.res.x()`
        const obj = callee.object;
        const isRes =
          (obj.type === 'Identifier' && obj.name === 'res') ||
          (obj.type === 'MemberExpression' &&
            !obj.computed &&
            obj.property.type === 'Identifier' &&
            obj.property.name === 'res');
        if (!isRes) return;
        if (!findEnclosingRouteCall(node, routeNames)) return;

        context.report({
          node,
          messageId: 'manualResponse',
          data: { member: callee.property.name },
        });
      },
    };
  },
};
