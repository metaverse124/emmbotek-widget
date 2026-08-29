/**
 * /api/sync - synchronizacja Living Knowledge Base.
 * Uruchamiana: przy deployu, cyklicznie (cron) oraz opcjonalnie webhookiem CMS po publikacji tresci.
 * Chroniona tokenem (naglowek x-sync-token lub Bearer).
 */
import config from '../../config.js';
import { json } from '../http.js';
import { loadBase, saveBase } from '../../knowledge/store.js';
import { syncKnowledge } from '../../crawler/run.js';

const tokenFrom = (req) => {
  const header = req.headers?.['x-sync-token'];
  if (header) return String(header);
  const auth = String(req.headers?.authorization ?? '');
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
};

export function createSyncHandler({ sync = syncKnowledge, load = loadBase, save = saveBase } = {}) {
  return async function syncHandler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return json(res, 405, { error: 'Dozwolone metody: GET, POST.' });
    }
    if (!config.security.syncToken) {
      return json(res, 500, { error: 'Brak SYNC_TOKEN po stronie serwera.' });
    }
    if (tokenFrom(req) !== config.security.syncToken) {
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
      return json(res, 500, { ok: false, error: error.message });
    }
  };
}

export default createSyncHandler;
