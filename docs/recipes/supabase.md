# Recipe: Supabase

With Supabase, auth and the database are the same client: a client built
with the caller's JWT both resolves the user and runs every query under
Row Level Security. Return `authContext(user, { db })` from
`authenticate` so one client serves both: no second construction in
`extend`, no stashing on `req`.

```typescript
// lib/api/route.ts (Express; the Next.js pages-API adapter is identical apart from the import)
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { authContext, createRoute } from 'routerplate/express';

export const { route, endpoint, get, post, patch, put, del } = createRoute<
  User,
  { db: SupabaseClient }
>({
  authenticate: async (req) => {
    // Forwarding the caller's bearer token means every ctx.db query
    // runs as the caller, under your RLS policies.
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: req.headers.authorization ?? '' } },
      auth: { persistSession: false },
    });
    const { data } = await db.auth.getUser();
    return authContext(data.user, { db });
  },
});
```

A handler then never touches auth or scoping:

```typescript
GET: get({
  response: ItemsSchema,
  handler: async ({ db }) => (await db.from('items').select('*').throwOnError()).data,
}),
```

Notes:

- `authContext(null, { db })` is what an anonymous caller gets: methods
  stay 401 by default, and methods with `requireAuth: false` receive the
  anon client, still constrained by your RLS policies for `anon`.
- Cookie-based sessions (`@supabase/ssr`): build the client with
  `createServerClient` instead; `authenticate(req, res)` receives `res`
  so the cookie `setAll` can write refreshed tokens.
