/**
 * `authContext` lets `authenticate` return request-scoped context
 * alongside the user, for providers where both come from one object
 * (a Supabase client carrying the caller's JWT resolves the user and
 * is the RLS-scoped database client).
 *
 * The result is branded with a symbol so the runtime never misreads a
 * plain user object (even one with a `user` key) as an envelope.
 * `Symbol.for` keeps the brand stable across this package's ESM and
 * CJS builds.
 */

export const AUTH_CONTEXT: unique symbol = Symbol.for('routerplate.authContext');

export interface AuthContext<User, Extras extends object> {
  readonly [AUTH_CONTEXT]: true;
  readonly user: User | null;
  readonly extras: Extras;
}

/**
 * Return this from `authenticate` to contribute context to `ctx` in
 * the same call that resolved the user:
 *
 * ```typescript
 * authenticate: async (req) => {
 *   const db = supabaseFromRequest(req); // carries the caller's JWT
 *   const { data } = await db.auth.getUser();
 *   return authContext(data.user, { db }); // one client: auth + RLS-scoped db
 * },
 * ```
 *
 * `user: null` is allowed (anonymous caller, e.g. an anon Supabase
 * client for `requireAuth: false` routes). `extend` still runs
 * afterwards and receives the user; on key conflicts, `extend` wins.
 */
export function authContext<User, Extras extends object>(
  user: User | null,
  extras: Extras,
): AuthContext<User, Extras> {
  return { [AUTH_CONTEXT]: true, user, extras };
}

export function isAuthContext(value: unknown): value is AuthContext<unknown, object> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [AUTH_CONTEXT]?: unknown })[AUTH_CONTEXT] === true
  );
}
