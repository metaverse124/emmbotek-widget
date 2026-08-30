/**
 * Odczyt kanalu wiedzy publikowanego przez strone (`/wiedza.json`).
 *
 * emmastudio.pl renderuje sie w przegladarce, wiec crawler HTTP widzi same puste
 * szkielety HTML. Zamiast tego strona przy budowaniu zapisuje ustrukturyzowany zrzut
 * swoich zrodel prawdy - cennik, kontakt, kalendarium, statut, wpisy blogowe - a my
 * zamieniamy go na dokumenty Living Knowledge Base.
 *
 * Kanal jest DANYMI, nie instrukcja. Nie ufamy mu bardziej niz zescrapowanej stronie:
 * typ dokumentu przechodzi przez slownik, adresy musza nalezec do domeny strony,
 * a tresc trafia do modelu ta sama droga co kazda inna wiedza.
 */
import config from '../config.js';
import { classifyDocument } from './classify.js';
import { isSourceType } from '../knowledge/types.js';
import { contentHash, normalizeUrl } from '../knowledge/store.js';

/** Maksymalna dlugosc tresci jednego dokumentu - tyle samo co przy scrapingu. */
const MAX_CONTENT = 20000;

/**
 * Sprawdza, czy adres z kanalu wskazuje na te sama strone, ktora kanal opisuje.
 * Bez tego kanal (albo ktos, kto go podmieni) moglby wprowadzic do bazy wiedzy
 * dokument z obcej domeny, a stad juz krok do celu CTA prowadzacego poza serwis.
 */
export function belongsToSite(url, siteUrl = config.site.url) {
  try {
    const a = new URL(String(url));
    const b = new URL(String(siteUrl));
    const host = (u) => u.hostname.toLowerCase().replace(/^www\./, '');
    return a.protocol === 'https:' && host(a) === host(b);
  } catch {
    return false;
  }
}

const asText = (value) => (typeof value === 'string' ? value : '').trim();

/**
 * Zamienia jeden wpis kanalu na rekord dokumentu gotowy do scalenia z baza.
 * @returns {object|null} null, gdy wpis jest bezuzyteczny (obcy adres, brak tresci)
 */
export function feedEntryToDocument(entry, { minContentChars = 60, siteUrl } = {}) {
  const url = asText(entry?.adres);
  if (!belongsToSite(url, siteUrl)) return null;

  const fragmenty = Array.isArray(entry?.fragmenty) ? entry.fragmenty : [];
  const chunks = fragmenty
    .map((fragment) => ({
      text: asText(fragment?.tekst),
      heading: asText(fragment?.naglowek) || null,
      anchor: asText(fragment?.kotwica) || null,
    }))
    .filter((chunk) => chunk.text);

  const content = chunks.map((chunk) => chunk.text).join('\n\n').slice(0, MAX_CONTENT);
  if (content.length < minContentChars) return null;

  const title = asText(entry?.tytul) || null;
  // Typ podany przez strone ma pierwszenstwo - zrodlo prawdy wie lepiej niz heurystyka.
  // Ale musi byc jednym ze znanych typow, inaczej wraca klasyfikator.
  const declared = asText(entry?.typ).toUpperCase();
  const type = isSourceType(declared)
    ? declared
    : classifyDocument({ url, title, text: content }).type;

  const headings = Array.isArray(entry?.naglowki)
    ? entry.naglowki.map(asText).filter(Boolean)
    : [];
  const anchors = chunks.map((chunk) => chunk.anchor).filter(Boolean);

  return {
    id: contentHash(normalizeUrl(url) ?? url),
    sourceUrl: url,
    sourceTitle: title,
    sourceType: type,
    content,
    publishedAt: asText(entry?.opublikowano) || null,
    updatedAt: asText(entry?.zaktualizowano) || null,
    validFrom: null,
    validUntil: null,
    contentHash: contentHash(content),
    status: 'active',
    headings,
    anchors: [...new Set(anchors)],
    chunks,
  };
}

/**
 * Pobiera kanal i zamienia go na dokumenty.
 *
 * @param {string} feedUrl
 * @param {(url: string) => Promise<string>} fetchText
 * @returns {{documents: object[], knownUrls: Set<string>, generatedAt: string|null, skipped: object[]}}
 */
export async function loadFeed(feedUrl, fetchText, { minContentChars = 60, siteUrl } = {}) {
  const raw = await fetchText(feedUrl);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`kanal wiedzy nie jest poprawnym JSON-em: ${error.message}`);
  }

  const wpisy = Array.isArray(parsed?.dokumenty) ? parsed.dokumenty : null;
  if (!wpisy) {
    throw new Error('kanal wiedzy nie zawiera tablicy "dokumenty"');
  }

  const documents = [];
  const skipped = [];
  const knownUrls = new Set();

  for (const entry of wpisy) {
    const url = asText(entry?.adres);
    const doc = feedEntryToDocument(entry, { minContentChars, siteUrl });
    if (!doc) {
      skipped.push({ url: url || '(brak adresu)', reason: belongsToSite(url, siteUrl) ? 'zbyt malo tresci' : 'adres spoza domeny strony' });
      continue;
    }
    documents.push(doc);
    knownUrls.add(doc.sourceUrl);
  }

  return {
    documents,
    knownUrls,
    generatedAt: asText(parsed?.wygenerowano) || null,
    skipped,
  };
}
