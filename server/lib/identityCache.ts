/**
 * Caches the Clerk user id -> verified email lookup so we don't call Clerk's API on every request.
 *
 * Safety: the key is the user id taken from the session token that Clerk middleware has already verified,
 * so one user's entry can never be served to another. Only a verified email is cached; "no verified email"
 * is never cached, so a newly verified address works on the next request. An email change in Clerk is
 * picked up when the entry expires (TTL below). Concurrent requests for the same user share one lookup.
 */
export const IDENTITY_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 5000;

type Entry = { email: string; expires: number };

export function createIdentityCache(lookup: (userId: string) => Promise<string | null>, opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttl = opts.ttlMs ?? IDENTITY_TTL_MS, now = opts.now ?? Date.now;
  const hits = new Map<string, Entry>();
  const inflight = new Map<string, Promise<string | null>>();
  return {
    async get(userId: string): Promise<string | null> {
      const hit = hits.get(userId);
      if (hit && hit.expires > now()) return hit.email;
      if (hit) hits.delete(userId);
      const pending = inflight.get(userId);
      if (pending) return pending;
      const p = lookup(userId).then((email) => {
        if (email) {
          if (hits.size >= MAX_ENTRIES) hits.delete(hits.keys().next().value!); // drop the oldest
          hits.set(userId, { email, expires: now() + ttl });
        }
        return email;
      }).finally(() => inflight.delete(userId));
      inflight.set(userId, p);
      return p;
    },
    /** Forget one user (or everyone), e.g. after an admin changes a login email. */
    forget(userId?: string) { if (userId) hits.delete(userId); else hits.clear(); },
    size: () => hits.size,
  };
}
