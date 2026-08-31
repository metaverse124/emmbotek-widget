/**
 * /api/sync - wymuszenie odswiezenia wiedzy i podglad jej stanu.
 *
 * Wiedza pochodzi z kanalu `/wiedza.json` publikowanego przez strone i jest trzymana
 * w pamieci instancji przez kilka minut (knowledge/provider.js). Ten endpoint nie
 * indeksuje wiec juz niczego i nie zapisuje na dysk - kasuje pamiec podreczna, pobiera
 * kanal od nowa i oddaje raport. Przydaje sie w dwoch sytuacjach:
 *
 *   1. webhook po publikacji tresci w CMS - zeby nie czekac na wygasniecie pamieci,
 *   2. diagnostyka po wdrozeniu - widac, czy strona oddaje kanal i ile z niego weszlo.
 *
 * Cron nie jest potrzebny: pamiec i tak wygasa sama, a instancja bez ruchu i tak umiera.
 *
 * Chroniony sekretem w naglowku `x-sync-token` albo `Authorization: Bearer`.
 * Akceptujemy SYNC_TOKEN oraz CRON_SECRET.
 */
import { timingSafeEqual } from 'node:crypto';

import config from '../../config.js';
import { json } from '../http.js';
import { knowledgeProvider } from '../../knowledge/provider.js';
import { activeDocuments } from '../../knowledge/store.js';

/** Porownanie odporne na atak czasowy. */
const secretsMatch = (a, b) => {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

const tokenFrom = (req) => {
  const header = req.headers?.['x-sync-token'];
  if (header) return String(header);
  const auth = String(req.headers?.authorization ?? '');
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
};

/**
 * @param {object} deps
 * @param {object} deps.provider        dostawca wiedzy (wstrzykiwalny na potrzeby testow)
 * @param {() => string[]} deps.secrets akceptowane sekrety; domyslnie czytane z konfiguracji
 *   przy kazdym zadaniu (wstrzykiwalne na potrzeby testow)
 */
export function createSyncHandler({
  provider = knowledgeProvider,
  secrets = () => [config.security.syncToken, config.security.cronSecret],
} = {}) {
  return async function syncHandler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return json(res, 405, { error: 'Dozwolone metody: GET, POST.' });
    }
    const accepted = secrets().filter(Boolean);
    if (!accepted.length) {
      return json(res, 500, { error: 'Brak SYNC_TOKEN (lub CRON_SECRET) po stronie serwera.' });
    }

    const presented = tokenFrom(req);
    if (!accepted.some((secret) => secretsMatch(presented, secret))) {
      return json(res, 401, { error: 'Nieprawidlowy token synchronizacji.' });
    }

    const started = Date.now();
    try {
      provider.reset();
      const base = await provider.get();
      const status = provider.status();
      const aktywne = activeDocuments(base);

      return json(res, 200, {
        ok: status.source === 'kanal',
        durationMs: Date.now() - started,
        source: status.source,
        feedUrl: status.feedUrl,
        documents: aktywne.length,
        chunks: aktywne.reduce((suma, doc) => suma + doc.chunks.length, 0),
        ctaTargets: Object.keys(base.ctaMap ?? {}).length,
        // Kopia z paczki znaczy, ze strona nie oddala kanalu - mowimy to wprost,
        // zamiast raportowac sukces na starej wiedzy.
        error: status.lastError,
      });
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message });
    }
  };
}

export default createSyncHandler;
