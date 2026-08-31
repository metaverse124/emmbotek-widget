/**
 * Skad handler /api/chat bierze wiedze w czasie odpowiadania.
 *
 * DLACZEGO NIE BAZA DANYCH
 * Strona sama publikuje caly swoj stan jako `/wiedza.json` - 132 kB, 42 kB po
 * kompresji, pobranie ponizej pol sekundy. Przy takich rozmiarach nie ma po co
 * budowac magazynu: instancja pobiera kanal i trzyma go w pamieci przez kilka minut.
 *
 * Wychodzi lepiej niz z magazynem i cronem:
 *   - wiedza jest swiezsza (minuty zamiast doby),
 *   - nie ma crona, ktory moze przestac chodzic po cichu,
 *   - nie ma stanu, ktory moze sie rozjechac z trescia strony.
 *
 * TRZY POZIOMY ZABEZPIECZENIA
 * 1. swiezy kanal ze strony,
 * 2. ostatni udany kanal z pamieci - podawany dalej, nawet gdy jest przeterminowany,
 *    bo stara cena jest lepsza niz zadna odpowiedz,
 * 3. kopia `data/knowledge.json` wgrana razem z aplikacja - ratuje pierwsza rozmowe
 *    po starcie instancji, gdyby strona akurat nie odpowiadala.
 *
 * Emmbotek nigdy nie zostaje bez wiedzy - moze zostac tylko z wiedza starsza.
 */
import config from '../config.js';
import { loadFeed } from '../crawler/feed.js';
import { defaultFetchText } from '../crawler/run.js';
import { emptyBase, loadBase, mergeDocuments } from './store.js';
import { buildCtaMap } from './ctaMap.js';

/** Po nieudanym odswiezeniu nie dobijamy sie do strony przy kazdym zapytaniu. */
const RETRY_AFTER_MS = 30_000;

/** Sklada baze wiedzy z dokumentow kanalu - bez historii, bo kanal jest pelnym stanem strony. */
export function baseFromFeedDocuments(documents, { now = new Date().toISOString() } = {}) {
  const { base } = mergeDocuments(emptyBase(), documents, { now, archiveMissing: false });
  base.ctaMap = buildCtaMap(base, { now: Date.parse(now) });
  base.generatedAt = now;
  return base;
}

/**
 * @param {object} opcje
 * @param {string} opcje.feedUrl        adres kanalu wiedzy strony
 * @param {Function} opcje.fetchText    wstrzykiwalny pobieracz (testy)
 * @param {number} opcje.ttlMs          jak dlugo kanal jest uznawany za swiezy
 * @param {Function} opcje.loadFallback zapasowa baza z pliku wgranego z aplikacja
 * @returns {{get: Function, status: Function, reset: Function}}
 */
export function createKnowledgeProvider({
  feedUrl = config.site.feed,
  fetchText = defaultFetchText,
  ttlMs = config.knowledge.cacheTtlMs,
  loadFallback = loadBase,
  now = () => Date.now(),
} = {}) {
  let cached = null;         // ostatnia udana baza
  let cachedAt = 0;
  let source = null;         // 'kanal' | 'plik'
  let lastError = null;
  let wTrakcie = null;       // wspoldzielona obietnica - rownolegle zapytania nie mnoza pobran

  async function refresh() {
    const feed = await loadFeed(feedUrl, fetchText, { siteUrl: config.site.url });
    if (!feed.documents.length) {
      throw new Error('kanal wiedzy nie zawiera zadnego uzytecznego dokumentu');
    }
    return baseFromFeedDocuments(feed.documents);
  }

  async function get() {
    const teraz = now();
    if (cached && teraz - cachedAt < ttlMs) return cached;

    // Rownolegle zapytania czekaja na to samo pobranie zamiast uderzac w strone naraz.
    if (!wTrakcie) {
      wTrakcie = (async () => {
        try {
          const base = await refresh();
          cached = base;
          cachedAt = now();
          source = 'kanal';
          lastError = null;
        } catch (error) {
          lastError = error.message;
          if (cached) {
            // Zostawiamy stara wiedze w obiegu i probujemy ponownie za chwile,
            // zamiast dobijac sie do strony przy kazdym zapytaniu.
            cachedAt = now() - ttlMs + RETRY_AFTER_MS;
          } else if (feedUrl) {
            // Pierwsze zapytanie po starcie instancji - ratuje kopia z paczki.
            cached = await loadFallback();
            cachedAt = now() - ttlMs + RETRY_AFTER_MS;
            source = 'plik';
          } else {
            cached = await loadFallback();
            cachedAt = now();
            source = 'plik';
          }
        } finally {
          wTrakcie = null;
        }
      })();
    }

    await wTrakcie;
    return cached ?? emptyBase();
  }

  return {
    get,
    /** Diagnostyka dla /api/sync i testow - bez tresci, sama metryka. */
    status: () => ({
      source,
      lastError,
      documents: cached ? cached.documents.filter((d) => d.status === 'active').length : 0,
      ageMs: cached ? now() - cachedAt : null,
      ttlMs,
      feedUrl,
    }),
    reset: () => { cached = null; cachedAt = 0; source = null; lastError = null; },
  };
}

/** Domyslny dostawca uzywany przez handlery produkcyjne. */
export const knowledgeProvider = createKnowledgeProvider();
