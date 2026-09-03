# Recipe: Auth.js (NextAuth)

`getServerSession` wants both `req` and `res` (it may refresh the
session cookie); `authenticate` receives both.

```typescript
// lib/api/route.ts (Next.js pages API)
import { getServerSession, type Session } from 'next-auth';
import { authOptions } from '../auth'; // your existing NextAuth options
import { createRoute } from 'routerplate/next';

export const { route, endpoint, get, post, patch, put, del } = createRoute<
  NonNullable<Session['user']>
>({
  authenticate: async (req, res) => {
    const session = await getServerSession(req, res, authOptions);
    return session?.user ?? null;
  },
});
```

If you only need the JWT claims (JWT session strategy), skip the
session lookup and use `getToken({ req })` from `next-auth/jwt`, which
reads the cookie without touching your adapter or database.
