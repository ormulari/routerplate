# Recipe: Clerk

Clerk resolves the session in its middleware; `authenticate` just reads
the result. No `authContext` needed; return the user (or `null`)
directly.

```typescript
// lib/api/route.ts (Next.js pages API; requires clerkMiddleware() in middleware.ts)
import { getAuth } from '@clerk/nextjs/server';
import { createRoute } from 'routerplate/next';

export const { route, endpoint, get, post, patch, put, del } = createRoute<{
  userId: string;
}>({
  authenticate: (req) => {
    const { userId } = getAuth(req);
    return userId ? { userId } : null;
  },
});
```

Need the full Clerk user object in `ctx.user`? Fetch it here
(`clerkClient.users.getUser(userId)`) and return that instead; the cost
is one Clerk API call per request, so most apps keep `ctx.user` to the
token claims and load profiles in handlers that need them.
