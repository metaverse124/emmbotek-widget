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
export function checkOrigin(req, allowed = config.security.allowedOrigins) {
  const origin = req.headers?.origin;
  if (!origin) return { ok: true, origin: null }; // np. curl / server-to-server
  const ok = allowed.includes(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin));
  return { ok, origin };
}

export function applyCors(res, origin) {
  if (!origin) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
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
