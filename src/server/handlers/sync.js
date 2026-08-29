/**
 * /api/sync - synchronizacja Living Knowledge Base.
 * Uruchamiana: przy deployu, cyklicznie (cron) oraz opcjonalnie webhookiem CMS po publikacji tresci.
 * Chroniona sekretem przekazanym w naglowku `x-sync-token` albo `Authorization: Bearer`.
 * Akceptujemy SYNC_TOKEN (webhook CMS, wywolanie reczne) oraz CRON_SECRET (Vercel Cron,
 * ktory wysyla wlasny sekret w naglowku Authorization).
 */
import { timingSafeEqual } from 'node:crypto';

import config from '../../config.js';
import { json } from '../http.js';
import { loadBase, saveBase } from '../../knowledge/store.js';
import { syncKnowledge } from '../../crawler/run.js';

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
 * @param {() => string[]} deps.secrets  akceptowane sekrety; domyslnie czytane z konfiguracji
 *   przy kazdym zadaniu (wstrzykiwalne na potrzeby testow)
 */
export function createSyncHandler({
  sync = syncKnowledge,
  load = loadBase,
  save = saveBase,
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
      const base = await load();
      const { base: updated, report } = await sync(base);
      await save(updated);
      return json(res, 200, {
        ok: true,
        durationMs: Date.now() - started,
        documents: updated.stats.documents,
        chunks: updated.stats.chunks,
        added: report.added.length,
        updated: report.updated.length,
        unchanged: report.unchanged.length,
        archived: report.archived.length,
        failed: report.failed.length,
        ctaTargets: report.ctaTargets,
      });
    } catch (error) {
      // Na platformach serverless katalog aplikacji jest tylko do odczytu, a /tmp znika
      // razem z instancja. Mowimy to wprost, zamiast zwracac goly blad zapisu.
      if (['EROFS', 'EACCES', 'EPERM'].includes(error.code)) {
        return json(res, 500, {
          ok: false,
          error: 'Nie mozna zapisac bazy wiedzy: system plikow jest tylko do odczytu. '
            + 'Skonfiguruj trwaly magazyn (KV / blob / baza danych) i podmien load/save w api/sync.js.',
          code: error.code,
        });
      }
      return json(res, 500, { ok: false, error: error.message });
    }
  };
}

export default createSyncHandler;
