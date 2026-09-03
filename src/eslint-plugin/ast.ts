/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal structural types for ESLint rule authoring. Kept local so the
 * published types don't depend on `@types/eslint`.
 */
export type AstNode = any;

export interface RuleContext {
  options: any[];
  report(descriptor: { node: AstNode; messageId: string; data?: Record<string, string> }): void;
}

export interface RuleModule {
  meta: Record<string, unknown>;
  create(context: RuleContext): Record<string, (node: AstNode) => void>;
}

export const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT']);
export const HTTP_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

/** Default names accepted as the wrapper. Override per-rule via options. */
export const DEFAULT_ROUTE_NAMES = ['route'];

/** Default typed-helper names the rules look inside. */
export const DEFAULT_HELPER_NAMES = ['get', 'post', 'patch', 'put', 'del', 'endpoint'];

/** Is this call expression `route({...})` (any configured name)? */
export function isRouteCall(node: AstNode, routeNames: string[]): boolean {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    routeNames.includes(node.callee.name)
  );
}

/** Find the enclosing `route({...})` call for a node, if any. */
export function findEnclosingRouteCall(node: AstNode, routeNames: string[]): AstNode | null {
  for (let n = node.parent; n; n = n.parent) {
    if (isRouteCall(n, routeNames)) return n;
  }
  return null;
}

/**
 * Given the value of a `GET:`/`POST:`/… property inside `route({...})`,
 * return the config object to inspect: the literal itself, or the first
 * argument of a typed-helper call like `post({...})`. Anything else
 * (identifiers, unknown calls) is opaque and yields `undefined`.
 */
export function methodConfigObject(value: AstNode, helperNames: string[]): AstNode | undefined {
  if (value.type === 'ObjectExpression') return value;
  if (
    value.type === 'CallExpression' &&
    value.callee.type === 'Identifier' &&
    helperNames.includes(value.callee.name) &&
    value.arguments[0] &&
    value.arguments[0].type === 'ObjectExpression'
  ) {
    return value.arguments[0];
  }
  return undefined;
}

export function hasProperty(objectExpression: AstNode, name: string): boolean {
  return objectExpression.properties.some(
    (p: AstNode) =>
      p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === name,
  );
}

/** Iterate the `GET:`/`POST:`/… properties of a `route({...})` call. */
export function methodProperties(routeCall: AstNode): { method: string; value: AstNode }[] {
  const arg = routeCall.arguments[0];
  if (!arg || arg.type !== 'ObjectExpression') return [];
  const found: { method: string; value: AstNode }[] = [];
  for (const prop of arg.properties) {
    if (
      prop.type === 'Property' &&
      !prop.computed &&
      prop.key.type === 'Identifier' &&
      HTTP_METHODS.has(prop.key.name)
    ) {
      found.push({ method: prop.key.name, value: prop.value });
    }
  }
  return found;
}

/** Read the shared `routeNames` option. */
export function routeNamesFrom(context: RuleContext): string[] {
  return (context.options[0] && context.options[0].routeNames) || DEFAULT_ROUTE_NAMES;
}

export function helperNamesFrom(context: RuleContext): string[] {
  return (context.options[0] && context.options[0].helperNames) || DEFAULT_HELPER_NAMES;
}

export const routeNamesSchema = {
  type: 'object',
  properties: {
    routeNames: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
  additionalProperties: false,
} as const;

export const routeAndHelperNamesSchema = {
  type: 'object',
  properties: {
    routeNames: routeNamesSchema.properties.routeNames,
    helperNames: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const;
