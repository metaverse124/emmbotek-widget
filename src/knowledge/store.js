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
 */
export function mergeDocuments(base, incoming, { now = new Date().toISOString() } = {}) {
  const previous = new Map(base.documents.map((doc) => [doc.sourceUrl ?? doc.id, doc]));
  const seen = new Set();
  const report = { added: [], updated: [], unchanged: [], archived: [] };
  const documents = [];

  for (const raw of incoming) {
    const doc = makeDocument(raw);
    const key = doc.sourceUrl ?? doc.id;
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
