/**
 * Ekstrakcja glownej tresci ze strony HTML (sekcja 4 briefu, kroki 4-5).
 * Bez zaleznosci: usuwamy skrypty/style/nawigacje/stopki, zostawiamy tekst
 * wraz z naglowkami i kotwicami (potrzebnymi do CTA prowadzacych do sekcji).
 */

const DROP_BLOCKS = /<(script|style|noscript|template|svg|iframe|form)\b[^>]*>[\s\S]*?<\/\1>/gi;
const DROP_CHROME = /<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&oacute;': 'ó', '&hellip;': '…', '&ndash;': '–', '&mdash;': '—',
};

export const decodeEntities = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? ' ');

const stripTags = (html) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim();

const attr = (tag, name) => {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return match ? decodeEntities(match[1]).trim() : null;
};

function metaContent(html, keys) {
  for (const key of keys) {
    const pattern = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
    const tag = pattern.exec(html)?.[0];
    const content = tag ? attr(tag, 'content') : null;
    if (content) return content;
  }
  return null;
}

/** Data publikacji/aktualizacji z meta tagow lub JSON-LD. */
export function extractDates(html) {
  const published =
    metaContent(html, ['article:published_time', 'datePublished', 'og:published_time']) ??
    /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ??
    null;
  const updated =
    metaContent(html, ['article:modified_time', 'dateModified', 'og:updated_time']) ??
    /"dateModified"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ??
    null;
  return { publishedAt: published, updatedAt: updated };
}

/** Glowny obszar tresci: <main>, <article>, [role=main] albo <body> jako fallback. */
function mainRegion(html) {
  for (const pattern of [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<div\b[^>]*role\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/div>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ]) {
    const match = pattern.exec(html);
    if (match && stripTags(match[1]).length > 120) return match[1];
  }
  return html;
}

/**
 * @returns {{title, description, headings, anchors, blocks, text, publishedAt, updatedAt, lang}}
 */
export function extractContent(html, { url = null } = {}) {
  const cleaned = String(html ?? '')
    .replace(COMMENTS, ' ')
    .replace(DROP_BLOCKS, ' ');

  const title =
    metaContent(cleaned, ['og:title']) ??
    stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)?.[1] ?? '') ??
    null;
  const description = metaContent(cleaned, ['description', 'og:description']);
  const lang = attr(/<html[^>]*>/i.exec(cleaned)?.[0] ?? '', 'lang');
  const { publishedAt, updatedAt } = extractDates(cleaned);

  const body = mainRegion(cleaned).replace(DROP_CHROME, ' ');

  const headings = [];
  const anchors = [];
  const blocks = [];
  let currentHeading = null;
  let currentAnchor = null;

  const tokenPattern = /<(h[1-6]|p|li|td|dd|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = tokenPattern.exec(body)) !== null) {
    const [, tag, attrs, inner] = match;
    const text = stripTags(inner);
    if (!text || text.length < 2) continue;

    if (/^h[1-6]$/i.test(tag)) {
      const id = attr(`<x ${attrs}>`, 'id');
      currentHeading = text;
      currentAnchor = id;
      headings.push(text);
      if (id) anchors.push({ id, text });
      blocks.push({ type: 'heading', level: Number(tag[1]), text, anchor: id });
    } else {
      blocks.push({ type: 'text', text, heading: currentHeading, anchor: currentAnchor });
    }
  }

  const text = blocks.map((block) => block.text).join('\n');
  return { url, title, description, lang, headings, anchors, blocks, text, publishedAt, updatedAt };
}

/**
 * Usuwa powtarzalne bloki (menu, stopka, cookie bar) wystepujace na wiekszosci podstron.
 * @param {Array<{blocks: Array}>} pages
 */
export function removeBoilerplate(pages, { threshold = 0.6 } = {}) {
  if (pages.length < 3) return pages;
  const counts = new Map();
  for (const page of pages) {
    const unique = new Set(page.blocks.map((block) => block.text));
    for (const text of unique) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const limit = Math.max(2, Math.ceil(pages.length * threshold));
  const boilerplate = new Set(
    [...counts.entries()].filter(([text, count]) => count >= limit && text.length < 400).map(([text]) => text),
  );

  return pages.map((page) => {
    const blocks = page.blocks.filter((block) => !boilerplate.has(block.text));
    return { ...page, blocks, text: blocks.map((block) => block.text).join('\n') };
  });
}
