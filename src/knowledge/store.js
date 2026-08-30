/**
 * Living Knowledge Base - magazyn dokumentow i fragmentow.
 *
 * Plik JSON jest artefaktem (mozna go trzymac w repo i deployowac razem z aplikacja),
 * ale nie jest jedynym zrodlem prawdy - crawler nadpisuje go przy kazdej synchronizacji.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import config from '../config.js';
import { isSourceType } from './types.js';

export const contentHash = (text) =>
  createHash('sha256').update(String(text ?? '').trim()).digest('hex').slice(0, 32);

// Parametry sledzace nie zmieniaja tresci strony - dwa adresy roznice sie nimi
// to ten sam dokument.
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gbraid', 'wbraid', '_ga', 'ref', 'source',
];

/**
 * Sprowadza adres do jednej postaci, zeby ten sam dokument nie trafil do bazy dwa razy
 * ani nie zostal omylkowo zarchiwizowany.
 *
 * Powod: sitemap emmastudio.pl podaje `https://emmastudio.pl/oferta`, a rekordy zalozone
 * recznie mialy `https://emmastudio.pl/oferta/`. Bez normalizacji crawler uznawal jedno
 * za drugie zniknieciem ze strony i archiwizowal zywa podstrone.
 *
 * Ujednolicamy: schemat i host malymi literami, bez `www.`, bez kotwicy, bez parametrow
 * sledzacych, bez konczacego ukosnika (poza korzeniem) i w postaci rozkodowanej -
 * `/blog/tre%C5%9Bc` i `/blog/tresc` z polskim znakiem to jeden adres.
 */
export function normalizeUrl(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  let url;
  try {
    url = new URL(text);
  } catch {
    return text; // adres wzgledny albo smiec - zostaje jak byl, zeby nie zgubic rekordu
  }

  url.hash = '';
  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

  const out = url.toString();
  try {
    return decodeURI(out);
  } catch {
    return out; // niepoprawne kodowanie procentowe - lepiej zostawic surowy adres
  }
}

/** Klucz tozsamosci dokumentu w bazie: znormalizowany adres, a w jego braku identyfikator. */
export const documentKey = (doc) => normalizeUrl(doc?.sourceUrl) ?? doc?.id;

const EMPTY = () => ({
  version: 1,
  site: config.site.url,
  generatedAt: null,
  lastSyncAt: null,
  stats: { documents: 0, chunks: 0 },
  ctaMap: {},
  documents: [],
});

/** Tworzy znormalizowany rekord dokumentu ze wszystkimi metadanymi z sekcji 6 briefu. */
export function makeDocument(input) {
  const now = new Date().toISOString();
  const content = String(input.content ?? '').trim();
  return {
    id: input.id || contentHash(input.sourceUrl || content),
    sourceUrl: input.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? null,
    sourceType: isSourceType(input.sourceType) ? input.sourceType : 'GENERAL',
    content,
    publishedAt: input.publishedAt ?? null,
    updatedAt: input.updatedAt ?? null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    indexedAt: input.indexedAt ?? now,
    contentHash: input.contentHash ?? contentHash(content),
    status: input.status ?? 'active',
    revision: input.revision ?? 1,
    headings: input.headings ?? [],
    anchors: input.anchors ?? [],
    chunks: (input.chunks ?? []).map((chunk, index) => ({
      id: `${input.id || contentHash(input.sourceUrl || content)}#${index}`,
      text: String(chunk.text ?? chunk).trim(),
      anchor: chunk.anchor ?? null,
      heading: chunk.heading ?? null,
    })),
  };
}

export function emptyBase() {
  return EMPTY();
}

export async function loadBase(filePath = config.knowledge.path) {
  try {
    const raw = await readFile(path.resolve(filePath), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY(), ...parsed };
  } catch (error) {
    if (error.code === 'ENOENT') return EMPTY();
    throw error;
  }
}

export async function saveBase(base, filePath = config.knowledge.path) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(base, null, 2)}\n`, 'utf8');
  return target;
}

/**
 * Scala swiezo zescrapowane dokumenty z istniejaca baza.
 * Wykrywa: nowe, zmienione (inny contentHash -> revision + 1), niezmienione i usuniete
 * (status "archived" zamiast twardego kasowania - zachowujemy historie).
 *
 * @param {object} options
 * @param {boolean} options.archiveMissing  false przy niepelnym crawlu (timeout) - inaczej
 *   przerwany przebieg zarchiwizowalby cala strone, ktorej po prostu nie zdazyl odwiedzic.
 * @param {Set<string>|null} options.knownUrls  adresy obecne w sitemap podczas tego przebiegu.
 *   Strona, ktora jest w sitemap, ale chwilowo nie odpowiedziala (blad 500, timeout),
 *   zostaje aktywna - archiwizujemy tylko to, co faktycznie zniknelo ze strony.
 */
export function mergeDocuments(base, incoming, {
  now = new Date().toISOString(),
  archiveMissing = true,
  knownUrls = null,
} = {}) {
  const previous = new Map(base.documents.map((doc) => [documentKey(doc), doc]));
  const seen = new Set();
  const report = { added: [], updated: [], unchanged: [], archived: [] };
  const documents = [];
  // Adresy z sitemap tez normalizujemy - inaczej porownanie kluczy nie ma sensu.
  const known = knownUrls ? new Set([...knownUrls].map((url) => normalizeUrl(url))) : null;

  for (const raw of incoming) {
    const doc = makeDocument(raw);
    const key = documentKey(doc);
    seen.add(key);
    const old = previous.get(key);

    if (!old) {
      report.added.push(key);
      documents.push({ ...doc, indexedAt: now, revision: 1 });
      continue;
    }
    if (old.contentHash === doc.contentHash) {
      report.unchanged.push(key);
      documents.push({ ...old, status: 'active', indexedAt: old.indexedAt, checkedAt: now });
      continue;
    }
    report.updated.push(key);
    documents.push({
      ...doc,
      id: old.id,
      publishedAt: doc.publishedAt ?? old.publishedAt,
      indexedAt: now,
      updatedAt: doc.updatedAt ?? now,
      revision: (old.revision ?? 1) + 1,
      previousHash: old.contentHash,
    });
  }

  for (const [key, old] of previous) {
    if (seen.has(key)) continue;
    const stillOnSite = known ? known.has(key) : false;
    if (!archiveMissing || stillOnSite) {
      documents.push(old);
      continue;
    }
    report.archived.push(key);
    documents.push({ ...old, status: 'archived', archivedAt: old.archivedAt ?? now });
  }

  const merged = {
    ...base,
    generatedAt: base.generatedAt ?? now,
    lastSyncAt: now,
    documents,
    stats: {
      documents: documents.filter((doc) => doc.status === 'active').length,
      chunks: documents
        .filter((doc) => doc.status === 'active')
        .reduce((sum, doc) => sum + doc.chunks.length, 0),
    },
  };

  return { base: merged, report };
}

export const activeDocuments = (base) =>
  base.documents.filter((doc) => doc.status === 'active');
