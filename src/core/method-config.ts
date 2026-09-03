/**
 * Every config the typed helpers (`get()`, `post()`, …) return carries
 * this brand. `route()` accepts nothing else, so a hand-written config
 * object, which would give the handler an untyped `ctx`, is rejected by
 * the types and, for JavaScript callers, at boot.
 *
 * `Symbol.for` keeps the brand stable across the ESM and CJS builds.
 */

export const METHOD_CONFIG: unique symbol = Symbol.for('routerplate.methodConfig');

export interface MethodConfigBrand {
  readonly [METHOD_CONFIG]: true;
}

export function brandMethodConfig<T extends object>(config: T): T & MethodConfigBrand {
  return { ...config, [METHOD_CONFIG]: true as const };
}

export function isMethodConfig(value: unknown): value is MethodConfigBrand {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [METHOD_CONFIG]?: unknown })[METHOD_CONFIG] === true
  );
}
