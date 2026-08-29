/**
 * Rate limiting po IP (sekcja 36 briefu) - sliding window w pamieci procesu.
 * Na produkcji z wieloma instancjami warto podmienic store na Redis/KV;
 * interfejs `consume` pozostaje ten sam.
 */
import config from '../config.js';

export function createRateLimiter({
  windowMs = config.security.rateLimit.windowMs,
  max = config.security.rateLimit.max,
  now = () => Date.now(),
} = {}) {
  const hits = new Map();

  const prune = (timestamp) => {
    for (const [key, list] of hits) {
      const kept = list.filter((item) => timestamp - item < windowMs);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  };

  return {
    /** @returns {{allowed: boolean, remaining: number, retryAfterMs: number}} */
    consume(key) {
      const timestamp = now();
      if (hits.size > 5000) prune(timestamp);

      const list = (hits.get(key) ?? []).filter((item) => timestamp - item < windowMs);
      if (list.length >= max) {
        const retryAfterMs = windowMs - (timestamp - list[0]);
        hits.set(key, list);
        return { allowed: false, remaining: 0, retryAfterMs };
      }
      list.push(timestamp);
      hits.set(key, list);
      return { allowed: true, remaining: max - list.length, retryAfterMs: 0 };
    },
    reset() { hits.clear(); },
    get size() { return hits.size; },
  };
}

export const defaultLimiter = createRateLimiter();
