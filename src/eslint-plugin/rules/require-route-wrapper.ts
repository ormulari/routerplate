import { isRouteCall, routeNamesFrom, routeNamesSchema, type RuleModule } from '../ast.js';

export const requireRouteWrapper: RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'API route files must default-export a route({...}) call, never a bare handler.',
    },
    schema: [routeNamesSchema],
    messages: {
      notRouteCall:
        'Default export must be a call to `{{names}}({...})`. Bare handlers bypass auth, validation, and the response envelope.',
    },
  },
  create(context) {
    const routeNames = routeNamesFrom(context);
    return {
      ExportDefaultDeclaration(node) {
        let decl = node.declaration;
        // Allow `export default route({...}) satisfies X` / `as X`
        while (decl && (decl.type === 'TSSatisfiesExpression' || decl.type === 'TSAsExpression')) {
          decl = decl.expression;
        }
        if (!isRouteCall(decl, routeNames)) {
          context.report({
            node,
            messageId: 'notRouteCall',
            data: { names: routeNames.join('/') },
          });
        }
      },
    };
  },
};
