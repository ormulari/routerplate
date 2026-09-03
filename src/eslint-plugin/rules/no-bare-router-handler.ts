import { type AstNode, type RuleModule } from '../ast.js';

const REGISTRATION_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

function isPathLiteral(node: AstNode): boolean {
  if (!node) return false;
  if (node.type === 'Literal') {
    return (
      (typeof node.value === 'string' && node.value.startsWith('/')) || node.regex !== undefined
    );
  }
  if (node.type === 'TemplateLiteral') {
    const first = node.quasis[0];
    return Boolean(first && first.value.cooked.startsWith('/'));
  }
  return false;
}

/**
 * Express: `app.get('/x', (req, res) => …)` registers a handler that
 * never passes through `route()`. Flag any HTTP-method registration on
 * a path literal whose arguments include an inline function.
 * Identifiers are opaque (documented limitation).
 */
export const noBareRouterHandler: RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Mount routes as `.all(path, route({...}))`; inline handlers bypass auth, validation, and error handling.',
    },
    schema: [],
    messages: {
      bareRouterHandler:
        'Inline handler on `.{{method}}()`. Mount the resource with `.all(path, route({...}))` so auth, validation, and error handling apply.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !REGISTRATION_METHODS.has(callee.property.name) ||
          node.arguments.length < 2 ||
          !isPathLiteral(node.arguments[0])
        ) {
          return;
        }
        const inline = node.arguments
          .slice(1)
          .find(
            (arg: AstNode) =>
              arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression',
          );
        if (!inline) return;
        context.report({
          node: inline,
          messageId: 'bareRouterHandler',
          data: { method: callee.property.name },
        });
      },
    };
  },
};
