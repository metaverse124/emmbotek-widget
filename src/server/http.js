/** Wspolne narzedzia HTTP dla handlerow serverless (Vercel / Netlify / Node). */
import config from '../config.js';

export const json = (res, status, payload, headers = {}) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(payload));
};

/** Allowlista Origin (sekcja 36 briefu). */
export function checkOrigin(req, allowed = config.security.allowedOrigins, {
  requireOrigin = config.security.requireOrigin,
  allowLocalhost = process.env.NODE_ENV !== 'production',
} = {}) {
  const origin = req.headers?.origin;

  // Brak naglowka Origin to nie przegladarka - to curl albo skrypt. Przy tresci
  // `application/json` przegladarka ZAWSZE wysyla Origin (wymusza to preflight),
  // wiec odrzucenie takiego zadania nie psuje widgetu, a zamyka droge, ktora
  // omijala allowliste i palila limit Gemini bez zadnej domeny do zablokowania.
  // Lokalnie zostawiamy furtke, zeby dalo sie diagnozowac curl-em.
  if (!origin) return { ok: !requireOrigin, origin: null };

  const ok = allowed.includes(origin)
    || (allowLocalhost && /^http:\/\/localhost(:\d+)?$/.test(origin));
  return { ok, origin };
}

/**
 * Do czego przypiac token wstepu: adres NASZEGO backendu, nie strony pytajacej.
 *
 * Naturalnym wyborem wydaje sie Origin, ale przegladarka wysyla go niekonsekwentnie:
 * przy zapytaniu z tej samej domeny jest przy POST, a nie ma go przy GET. Token
 * wystawiony przez /api/token mial wiec inna wartosc niz sprawdzana na /api/chat
 * i nigdy sie nie zgadzal.
 *
 * Host jest w kazdym zapytaniu HTTP i identyczny dla obu wywolan - i w demo na jednym
 * adresie, i w produkcji, gdzie strona stoi na LH.pl, a backend na Vercelu.
 *
 * Nie tracimy na tym ochrony: tego, KTO pyta, pilnuje osobno allowlista domen
 * (checkOrigin), ktora dziala na obu endpointach. Zadaniem tokenu jest wymusic
 * przejscie przez nasz serwer po podpis, a nie rozpoznanie zadajacego.
 */
export const zrodloZadania = (req) => `host:${String(req.headers?.host ?? '')}`;

export function applyCors(res, origin) {
  if (!origin) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  // x-emmbotek-token MUSI byc na tej liscie. To naglowek niestandardowy, wiec
  // przegladarka wysyla najpierw zapytanie preflight - a gdy nie ma go w odpowiedzi,
  // blokuje wlasciwe zadanie, zanim w ogole dojdzie do serwera. Objaw jest mylacy:
  // widget mowi "nie moge sie polaczyc", a backend testowany curl-em dziala,
  // bo curl preflightu nie robi.
  res.setHeader('access-control-allow-headers', 'content-type, x-emmbotek-token');
  res.setHeader('access-control-max-age', '600');
}

export async function readJsonBody(req, { limitBytes = 64 * 1024 } = {}) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error('Zbyt duze zadanie'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Nieprawidlowy JSON'), { statusCode: 400 });
  }
}

/** Klient identyfikowany po IP wylacznie na potrzeby rate limitu (nie zapisujemy go nigdzie). */
export const clientKey = (req) => {
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded ?? '').split(',')[0].trim();
  return ip || req.socket?.remoteAddress || 'unknown';
};
