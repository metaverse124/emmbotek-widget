/**
 * Rate limiting po IP (sekcja 36 briefu).
 *
 * Dwa warianty o tym samym interfejsie `consume(klucz)`:
 *   - w pamieci procesu (domyslny, wystarcza lokalnie i na VPS),
 *   - wspoldzielony przez Supabase (produkcja serverless, gdzie instancji jest wiele).
 *
 * Wariant wspoldzielony ma zabezpieczenie: gdy baza nie odpowiada, schodzi na limiter
 * w pamieci zamiast przepuszczac wszystko. Awaria bazy nie moze otworzyc bramy na osciez,
 * ale tez nie moze zablokowac rozmowy - kazde zapytanie kosztuje wywolanie Gemini.
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

/**
 * Limiter wspoldzielony miedzy instancjami. Okno liczy Postgres jednym zapytaniem
 * (`emmbotek_sprawdz_limit`), wiec rownolegle instancje nie licza kazda swojego.
 *
 * @param {object} deps
 * @param {object} deps.store     magazyn z metoda `sprawdzLimit`
 * @param {object} deps.fallback  limiter uzywany, gdy baza nie odpowiada
 * @param {Function} deps.onError wolane przy bledzie bazy (diagnostyka)
 */
export function createSharedRateLimiter({
  store,
  fallback = createRateLimiter(),
  windowMs = config.security.rateLimit.windowMs,
  max = config.security.rateLimit.max,
  onError = () => {},
} = {}) {
  return {
    async consume(key) {
      if (!store?.skonfigurowany) return fallback.consume(key);
      try {
        return await store.sprawdzLimit(key, windowMs, max);
      } catch (error) {
        // Baza padla - liczymy dalej lokalnie. Limit bedzie luzniejszy niz zakladamy
        // (kazda instancja ma swoj), ale nadal istnieje.
        onError(error);
        return fallback.consume(key);
      }
    },
    reset() { fallback.reset(); },
  };
}
