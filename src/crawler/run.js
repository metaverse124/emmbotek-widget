/**
 * Orkiestracja synchronizacji wiedzy (sekcje 4 i 44 briefu):
 * sitemap -> pobranie -> ekstrakcja -> normalizacja -> klasyfikacja -> chunking
 * -> hash + wykrycie zmian -> Living Knowledge Base + mapa CTA.
 */
import config from '../config.js';
import { collectUrls } from './sitemap.js';
import { extractContent, removeBoilerplate } from './extract.js';
import { classifyDocument } from './classify.js';
import { chunkBlocks } from './chunk.js';
import { contentHash, mergeDocuments } from '../knowledge/store.js';
import { buildCtaMap } from '../knowledge/ctaMap.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Domyslny pobieracz HTTP z timeoutem i wlasnym User-Agentem. */
export async function defaultFetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.crawler.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': config.crawler.userAgent, accept: 'text/html,application/xhtml+xml,application/xml' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} dla ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Zamienia surowa strone na rekord dokumentu gotowy do indeksowania. */
export function pageToDocument(page, { lastmod = null } = {}) {
  const { type } = classifyDocument({ url: page.url, title: page.title, text: page.text });
  const chunks = chunkBlocks(page.blocks);
  const content = page.text.slice(0, 20000);

  return {
    id: contentHash(page.url ?? page.title ?? content),
    sourceUrl: page.url,
    sourceTitle: page.title,
    sourceType: type,
    content,
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt ?? lastmod,
    validFrom: null,
    validUntil: null,
    contentHash: contentHash(content),
    status: 'active',
    headings: page.headings,
    anchors: page.anchors,
    chunks,
  };
}

/**
 * @param {object} base  aktualna baza wiedzy
 * @param {object} deps  { fetchText } - wstrzykiwalne na potrzeby testow
 * @returns {{base, report}} nowa baza + raport zmian
 */
export async function syncKnowledge(base, {
  fetchText = defaultFetchText,
  sitemapUrl = config.site.sitemap,
  maxPages = config.crawler.maxPages,
  delayMs = config.crawler.politenessDelayMs,
  minContentChars = 60,
  now = new Date().toISOString(),
  onProgress = () => {},
} = {}) {
  const entries = (await collectUrls(sitemapUrl, fetchText)).slice(0, maxPages);
  onProgress({ phase: 'sitemap', total: entries.length });

  const pages = [];
  const failures = [];

  for (const [index, entry] of entries.entries()) {
    try {
      const html = await fetchText(entry.url);
      const page = extractContent(html, { url: entry.url });
      if (page.text.trim().length < minContentChars) {
        failures.push({ url: entry.url, reason: 'zbyt malo tresci' });
      } else {
        pages.push({ ...page, lastmod: entry.lastmod });
      }
    } catch (error) {
      failures.push({ url: entry.url, reason: error.message });
    }
    onProgress({ phase: 'fetch', done: index + 1, total: entries.length, url: entry.url });
    if (delayMs) await sleep(delayMs);
  }

  const cleaned = removeBoilerplate(pages);
  const documents = cleaned.map((page) => pageToDocument(page, { lastmod: page.lastmod }));

  const { base: merged, report } = mergeDocuments(base, documents, { now });
  merged.ctaMap = buildCtaMap(merged, { now: Date.parse(now) });
  merged.generatedAt = merged.generatedAt ?? now;

  return {
    base: merged,
    report: {
      ...report,
      crawled: pages.length,
      failed: failures,
      ctaTargets: Object.keys(merged.ctaMap).length,
    },
  };
}
