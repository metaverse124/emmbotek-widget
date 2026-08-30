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
import { loadFeed } from './feed.js';
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
  feedUrl = config.site.feed,
  maxPages = config.crawler.maxPages,
  delayMs = config.crawler.politenessDelayMs,
  minContentChars = 60,
  maxDurationMs = config.crawler.maxDurationMs,
  now = new Date().toISOString(),
  onProgress = () => {},
} = {}) {
  const startedAt = Date.now();
  const deadline = maxDurationMs ? startedAt + maxDurationMs : Infinity;

  // Kanal wiedzy ma pierwszenstwo: strona renderuje sie w przegladarce, wiec crawl HTML
  // zwraca puste szkielety. Gdy kanal nie odpowiada albo jest pusty, schodzimy na crawl -
  // to zapasowa droga na wypadek, gdyby wdrozenie strony poszlo bez kroku eksportu.
  let feedError = null;
  if (feedUrl) {
    try {
      const feed = await loadFeed(feedUrl, fetchText, { minContentChars, siteUrl: config.site.url });
      onProgress({ phase: 'feed', total: feed.documents.length, url: feedUrl });

      if (feed.documents.length) {
        const { base: merged, report } = mergeDocuments(base, feed.documents, {
          now,
          archiveMissing: true,
          knownUrls: feed.knownUrls,
        });
        merged.ctaMap = buildCtaMap(merged, { now: Date.parse(now) });
        merged.generatedAt = merged.generatedAt ?? now;

        return {
          base: merged,
          report: {
            ...report,
            source: 'feed',
            feedUrl,
            feedGeneratedAt: feed.generatedAt,
            crawled: feed.documents.length,
            failed: feed.skipped,
            ctaTargets: Object.keys(merged.ctaMap).length,
            timedOut: false,
            blindRun: false,
            remaining: 0,
            durationMs: Date.now() - startedAt,
          },
        };
      }
      feedError = 'kanal wiedzy nie zawiera zadnego uzytecznego dokumentu';
    } catch (error) {
      feedError = error.message;
    }
    onProgress({ phase: 'feed-failed', reason: feedError, url: feedUrl });
  }

  const entries = (await collectUrls(sitemapUrl, fetchText)).slice(0, maxPages);
  onProgress({ phase: 'sitemap', total: entries.length });

  const pages = [];
  const failures = [];
  let timedOut = false;

  for (const [index, entry] of entries.entries()) {
    // Funkcja serverless ma twardy limit czasu - konczymy wczesniej i zapisujemy dorobek,
    // zamiast zostac ubitym przed zapisem.
    if (Date.now() >= deadline) {
      timedOut = true;
      onProgress({ phase: 'timeout', done: index, total: entries.length });
      break;
    }

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
    if (delayMs && Date.now() + delayMs < deadline) await sleep(delayMs);
  }

  const cleaned = removeBoilerplate(pages);
  const documents = cleaned.map((page) => pageToDocument(page, { lastmod: page.lastmod }));

  const knownUrls = new Set(entries.map((entry) => entry.url));

  // Przebieg, ktory nie wyciagnal tresci z ZADNEJ strony, jest przebiegiem zepsutym,
  // a nie dowodem, ze strona zniknela. Tak wyglada blokada WAF, awaria hostingu albo
  // strona renderowana w przegladarce (SPA) - archiwizacja skasowalaby wtedy cala wiedze.
  const blindRun = documents.length === 0 && failures.length > 0;

  const { base: merged, report } = mergeDocuments(base, documents, {
    now,
    archiveMissing: !timedOut && !blindRun,
    knownUrls,
  });
  merged.ctaMap = buildCtaMap(merged, { now: Date.parse(now) });
  merged.generatedAt = merged.generatedAt ?? now;

  return {
    base: merged,
    report: {
      ...report,
      source: 'crawl',
      feedError,
      crawled: pages.length,
      failed: failures,
      ctaTargets: Object.keys(merged.ctaMap).length,
      timedOut,
      blindRun,
      remaining: timedOut ? entries.length - pages.length - failures.length : 0,
      durationMs: Date.now() - startedAt,
    },
  };
}
