/**
 * /api/analytics - anonimowa telemetria CTA i luk wiedzy (sekcje 33 i 40 briefu).
 *
 * Nie przyjmujemy i nie zapisujemy: IP, sessionId, tresci rozmowy, danych kontaktowych.
 * Zapisujemy wylacznie zagregowane liczniki.
 */
import { json, checkOrigin, applyCors, readJsonBody } from '../http.js';
import { CTA_TYPES } from '../../agent/ctaEngine.js';
import { INTENTS } from '../../knowledge/types.js';

const EVENTS = new Set(['cta_impression', 'cta_click', 'ocena']);
const STAGES = new Set(['eksploracja', 'dopasowanie', 'decyzja', 'kontakt']);

/** Sprowadza zdarzenie do bezpiecznego, zanonimizowanego ksztaltu. */
export function normalizeEvent(input) {
  const event = String(input?.event ?? '');
  if (!EVENTS.has(event)) return null;

  /*
    Ocena rozmowy ma inny ksztalt niz zdarzenie CTA: zamiast typu przycisku niesie
    stopien w skali 1-5. Zapisujemy ja tym samym kanalem, zeby nie mnozyc tabel -
    stopien laduje w kolumnie etapu, ktora przy ocenie i tak nie ma innego znaczenia.
  */
  if (event === 'ocena') {
    const stopien = Number(input?.rating);
    if (!Number.isInteger(stopien) || stopien < 1 || stopien > 5) return null;
    let page = null;
    const rawPage = typeof input?.currentPage === 'string' ? input.currentPage : '';
    if (rawPage) {
      try { page = new URL(rawPage, 'https://placeholder.local').pathname.slice(0, 120); }
      catch { page = null; }
    }
    return {
      event,
      ctaType: 'OCENA',
      sourceIntent: 'GENERAL',
      conversationStage: String(stopien),
      currentPage: page,
    };
  }

  const ctaType = String(input?.ctaType ?? '').toUpperCase();
  if (!CTA_TYPES.includes(ctaType)) return null;

  const intent = String(input?.sourceIntent ?? '').toUpperCase();
  const stage = String(input?.conversationStage ?? '');

  // z adresu zostawiamy wylacznie sciezke - bez query stringa i bez fragmentu
  let page = null;
  const raw = typeof input?.currentPage === 'string' ? input.currentPage : '';
  if (raw) {
    try {
      page = new URL(raw, 'https://placeholder.local').pathname.slice(0, 120);
    } catch { page = null; }
  }

  return {
    event,
    ctaType,
    sourceIntent: INTENTS.includes(intent) ? intent : 'GENERAL',
    conversationStage: STAGES.has(stage) ? stage : null,
    currentPage: page,
  };
}

/** Agreguje zdarzenie w liczniku (bez zapisu pojedynczych zdarzen). */
export function aggregate(store, event) {
  const key = [event.event, event.ctaType, event.sourceIntent, event.conversationStage ?? '-', event.currentPage ?? '-'].join('|');
  const next = { ...store };
  next[key] = (next[key] ?? 0) + 1;
  return next;
}

/**
 * @param {object} deps
 * @param {Function} deps.record  zapis paczki zdarzen wprost do magazynu (Supabase).
 *   Gdy podany, ma pierwszenstwo nad read/write - baza sama agreguje liczniki, wiec
 *   rownolegle instancje nie nadpisuja sobie wzajemnie odczytanego stanu.
 * @param {Function} deps.read    odczyt zagregowanego stanu (wariant plikowy)
 * @param {Function} deps.write   zapis zagregowanego stanu (wariant plikowy)
 */
export function createAnalyticsHandler({
  record = null,
  read = async () => ({}),
  write = async () => {},
} = {}) {
  return async function analyticsHandler(req, res) {
    const { ok: originOk, origin } = checkOrigin(req);
    applyCors(res, originOk ? origin : null);

    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'POST') return json(res, 405, { error: 'Dozwolona jest wylacznie metoda POST.' });
    if (!originOk) return json(res, 403, { error: 'Niedozwolone zrodlo zadania.' });

    let body;
    try { body = await readJsonBody(req, { limitBytes: 8 * 1024 }); }
    catch { return json(res, 400, { error: 'Nieprawidlowe zadanie.' }); }

    const events = Array.isArray(body?.events) ? body.events : [body];
    const accepted = events.map(normalizeEvent).filter(Boolean).slice(0, 20);
    if (!accepted.length) return json(res, 202, { accepted: 0 });

    try {
      if (record) {
        await record(accepted);
      } else {
        let store = await read();
        for (const event of accepted) store = aggregate(store, event);
        await write(store);
      }
    } catch { /* telemetria nigdy nie psuje UX */ }

    return json(res, 202, { accepted: accepted.length });
  };
}

export default createAnalyticsHandler;
