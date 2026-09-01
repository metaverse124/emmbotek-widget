/**
 * Hybrid Retrieval (sekcja 10 briefu).
 *
 * Etap 1 (ten kod): keyword + metadata + ranking aktualnosci + filtr typu dokumentu.
 * Etap 2 (opcjonalny): embeddings - wystarczy dostarczyc funkcje `embedder`
 * i wektory `chunk.embedding`; wynik semantyczny wchodzi do tej samej formuly wagowej.
 */
import config from '../config.js';
import { INTENT_TYPE_PREFERENCE } from './types.js';
import { activeDocuments, normalizeUrl } from './store.js';
import { authorityOf } from './types.js';
import { freshnessLabel, isCurrentlyValid, recencyScore } from './freshness.js';

const STOP_WORDS = new Set([
  'i', 'oraz', 'w', 'we', 'na', 'do', 'z', 'ze', 'o', 'a', 'ale', 'czy', 'jest', 'sa',
  'to', 'te', 'ten', 'ta', 'jak', 'ile', 'dla', 'od', 'po', 'za', 'sie', 'nie', 'tak',
  'the', 'a', 'of', 'for', 'and', 'is', 'are',
]);

const DIACRITICS = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => DIACRITICS[ch])
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function tokenize(text) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    .map((token) => (token.length > 6 ? token.slice(0, 6) : token)); // lekki stemming dla polskiej fleksji
}

/** @returns {{score: number, coverage: number}} coverage = udzial slow pytania obecnych w tekscie */
function keywordScore(queryTokens, text) {
  if (!queryTokens.length) return { score: 0, coverage: 0 };
  const haystack = tokenize(text);
  if (!haystack.length) return { score: 0, coverage: 0 };
  const counts = new Map();
  for (const token of haystack) counts.set(token, (counts.get(token) ?? 0) + 1);

  let hits = 0;
  let matched = 0;
  for (const token of queryTokens) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      matched += 1;
      hits += 1 + Math.log(count);
    }
  }
  const coverage = matched / queryTokens.length;
  return { score: (hits / (hits + 3)) * (0.4 + 0.6 * coverage), coverage };
}

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/**
 * @param {object} base            Living Knowledge Base
 * @param {string} query           pytanie uzytkownika
 * @param {object} options
 * @param {string} options.intent  rozpoznana intencja
 * @param {string} options.currentUrl  adres podstrony, na ktorej jest uzytkownik
 * @param {number[]} options.queryEmbedding  opcjonalny wektor pytania
 * @returns {Array} posortowane fragmenty z metadanymi i wyjasnieniem rankingu
 */
/**
 * Wiedza zapasowa, gdy dopasowanie po slowach nie zadzialalo.
 *
 * Retrieval opiera sie na slowach kluczowych, a baza wiedzy jest po polsku. Pytanie
 * zadane po hiszpansku czy koreansku nie ma z nia wspolnych slow, wiec wynik jest pusty
 * i Emmbotek odpowiada "nie mam tych danych" - mimo ze cennik ma tuz obok.
 *
 * Zamiast tego podajemy mu przekroj najwazniejszych dokumentow. Model sam przetlumaczy
 * to, co potrzebne. To obejscie, nie rozwiazanie - wlasciwym lekarstwem sa embeddingi,
 * ktore dopasowuja znaczenie zamiast liter.
 */
export function baselineKnowledge(base, { limit = config.limits.maxRetrievedChunks, now = Date.now() } = {}) {
  const wazne = ['PRICE', 'COURSE', 'LANDING_PAGE', 'CONTACT'];
  const wynik = [];

  for (const typ of wazne) {
    for (const doc of activeDocuments(base)) {
      if (doc.sourceType !== typ) continue;
      const chunk = doc.chunks[0];
      if (!chunk) continue;
      wynik.push({
        id: chunk.id,
        text: chunk.text,
        heading: chunk.heading ?? null,
        anchor: chunk.anchor ?? null,
        sourceUrl: doc.sourceUrl,
        sourceTitle: doc.sourceTitle,
        sourceType: doc.sourceType,
        freshness: freshnessLabel(doc, now),
        score: 0.01,
        why: 'przekroj zapasowy - pytanie w innym jezyku niz baza wiedzy',
      });
      if (wynik.length >= limit) return wynik;
    }
  }
  return wynik;
}

export function retrieve(base, query, options = {}) {
  const {
    intent = 'GENERAL',
    currentUrl = null,
    limit = config.limits.maxRetrievedChunks,
    now = Date.now(),
    queryEmbedding = null,
    includeStale = true,
  } = options;

  const queryTokens = tokenize(query);
  const currentKey = normalizeUrl(currentUrl);
  const preferred = INTENT_TYPE_PREFERENCE[intent] ?? INTENT_TYPE_PREFERENCE.GENERAL;
  const results = [];

  for (const doc of activeDocuments(base)) {
    const valid = isCurrentlyValid(doc, now);
    if (!valid && !includeStale) continue;

    const typeRank = preferred.indexOf(doc.sourceType);
    const typeBonus = typeRank === -1 ? 0 : 0.34 - typeRank * 0.08;
    const authorityBonus = (8 - authorityOf(doc.sourceType)) / 40;
    const recency = recencyScore(doc, now);
    // Przegladarka podaje adres tak, jak stoi w pasku (z ukosnikiem, z kotwica, z utm),
    // a baza tak, jak stoi w sitemap. Bez normalizacji premia za biezaca strone nie dziala.
    const sameUrl = currentKey && normalizeUrl(doc.sourceUrl) === currentKey ? 0.22 : 0;
    const title = keywordScore(queryTokens, `${doc.sourceTitle ?? ''} ${doc.headings.join(' ')}`);

    const chunks = doc.chunks.length ? doc.chunks : [{ id: `${doc.id}#0`, text: doc.content, anchor: null, heading: null }];

    for (const chunk of chunks) {
      const lexical = keywordScore(queryTokens, `${chunk.heading ?? ''} ${chunk.text}`);
      const semantic = queryEmbedding && chunk.embedding ? cosine(queryEmbedding, chunk.embedding) : 0;
      const textual = queryEmbedding && chunk.embedding
        ? 0.55 * semantic + 0.45 * lexical.score
        : lexical.score;

      // Trafnosc tekstowa jest warunkiem koniecznym: metadane (typ, autorytet, swiezosc)
      // moga tylko podbic dokument, ktory faktycznie odpowiada na pytanie - nigdy go wprowadzic.
      const relevance = textual + title.score * 0.35;
      if (relevance < 0.08) continue;

      const score =
        relevance +
        typeBonus +
        authorityBonus +
        recency * 0.25 +
        sameUrl -
        (valid ? 0 : 0.5);

      if (score <= 0.06) continue;

      results.push({
        docId: doc.id,
        chunkId: chunk.id,
        text: chunk.text.slice(0, config.limits.maxChunkChars),
        heading: chunk.heading,
        anchor: chunk.anchor,
        sourceUrl: doc.sourceUrl,
        sourceTitle: doc.sourceTitle,
        sourceType: doc.sourceType,
        publishedAt: doc.publishedAt,
        updatedAt: doc.updatedAt,
        freshness: freshnessLabel(doc, now),
        score: Number(score.toFixed(4)),
        coverage: Number(Math.max(lexical.coverage, title.coverage).toFixed(2)),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);

  // dywersyfikacja: maks. 2 fragmenty z jednego dokumentu
  const perDoc = new Map();
  const diversified = [];
  for (const item of results) {
    const used = perDoc.get(item.docId) ?? 0;
    if (used >= 2) continue;
    perDoc.set(item.docId, used + 1);
    diversified.push(item);
    if (diversified.length >= limit) break;
  }
  return diversified;
}

/**
 * Czy retrieval realnie odpowiada na pytanie - inaczej mamy luke wiedzy (sekcja 40).
 * Sam wysoki ranking nie wystarcza: fragment musi tez pokrywac istotna czesc slow pytania,
 * bo inaczej "czy zajecia sa w soboty" zostaloby uznane za odpowiedziane przez dowolna strone
 * ze slowem "zajecia".
 */
export const hasUsableKnowledge = (results, { threshold = 0.35, minCoverage = 0.5 } = {}) =>
  results.length > 0 && results[0].score >= threshold && (results[0].coverage ?? 1) >= minCoverage;
