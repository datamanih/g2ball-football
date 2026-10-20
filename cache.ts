// Tiny in-memory cache with TTL and request de-duplication. Keeps polling cheap on Bluetooth and on rate-limited APIs.
const store = new Map<string, { at: number; ttl: number; p: Promise<any> }>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
  const p = fn();
  store.set(key, { at: Date.now(), ttl: ttlMs, p });
  p.catch(() => store.delete(key));      // never cache failures
  return p;
}

export function invalidate(prefix = '') { for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k); }
