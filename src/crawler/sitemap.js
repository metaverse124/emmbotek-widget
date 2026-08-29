/** Parsowanie sitemap.xml (takze indeksow sitemap) - bez zewnetrznych zaleznosci. */
import config from '../config.js';

const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
const LASTMOD = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i;

const decode = (value) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** @returns {{url: string, lastmod: string|null}[]} */
export function parseSitemap(xml) {
  const entries = [];
  const blocks = xml.split(/<\/(?:url|sitemap)>/i);
  for (const block of blocks) {
    LOC.lastIndex = 0;
    const loc = LOC.exec(block);
    if (!loc) continue;
    const lastmod = LASTMOD.exec(block);
    entries.push({ url: decode(loc[1]), lastmod: lastmod ? lastmod[1].trim() : null });
  }
  return entries;
}

export const isSitemapIndex = (xml) => /<sitemapindex[\s>]/i.test(xml);

/**
 * Pobiera sitemap i rekurencyjnie rozwija indeksy sitemap.
 * @param {(url: string) => Promise<string>} fetchText wstrzykiwany pobieracz (ulatwia testy)
 */
export async function collectUrls(sitemapUrl, fetchText, { seen = new Set(), depth = 0 } = {}) {
  if (depth > 3 || seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  const xml = await fetchText(sitemapUrl);
  const entries = parseSitemap(xml);

  if (isSitemapIndex(xml)) {
    const nested = [];
    for (const entry of entries) {
      nested.push(...(await collectUrls(entry.url, fetchText, { seen, depth: depth + 1 })));
    }
    return nested;
  }

  return entries
    .filter((entry) => entry.url.startsWith('http'))
    .slice(0, config.crawler.maxPages);
}
