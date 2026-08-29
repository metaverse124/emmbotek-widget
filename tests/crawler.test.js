import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSitemap, isSitemapIndex, collectUrls } from '../src/crawler/sitemap.js';
import { extractContent, removeBoilerplate, decodeEntities } from '../src/crawler/extract.js';
import { classifyDocument } from '../src/crawler/classify.js';
import { chunkBlocks } from '../src/crawler/chunk.js';
import { syncKnowledge, pageToDocument } from '../src/crawler/run.js';
import { emptyBase } from '../src/knowledge/store.js';

const STRONA = (tresc, dodatki = '') => `<!doctype html><html lang="pl"><head>
<title>eMMa - kursy</title><meta name="description" content="Opis">${dodatki}</head>
<body><nav><a href="/">Menu</a><a href="/kontakt/">Kontakt</a></nav>
<main>${tresc}</main><footer>eMMa 1992-2026. Wszelkie prawa zastrzezone.</footer>
<script>console.log('analytics')</script></body></html>`;

test('sitemap: wyciaganie adresow i dat', () => {
  const xml = `<urlset><url><loc>https://emmastudio.pl/</loc><lastmod>2026-08-01</lastmod></url>
  <url><loc>https://emmastudio.pl/cennik/</loc></url></urlset>`;
  const entries = parseSitemap(xml);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].lastmod, '2026-08-01');
  assert.equal(isSitemapIndex(xml), false);
});

test('sitemap index jest rozwijany rekurencyjnie', async () => {
  const strony = {
    'https://emmastudio.pl/sitemap.xml': '<sitemapindex><sitemap><loc>https://emmastudio.pl/sitemap-1.xml</loc></sitemap></sitemapindex>',
    'https://emmastudio.pl/sitemap-1.xml': '<urlset><url><loc>https://emmastudio.pl/blog/wpis/</loc></url></urlset>',
  };
  const urls = await collectUrls('https://emmastudio.pl/sitemap.xml', async (url) => strony[url]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].url, 'https://emmastudio.pl/blog/wpis/');
});

test('ekstrakcja usuwa skrypty, menu i stopke', () => {
  const page = extractContent(STRONA('<h1>Kursy</h1><p>Angielski dla dzieci w grupach 4-8 osob.</p>'));
  assert.match(page.text, /Angielski dla dzieci/);
  assert.ok(!page.text.includes('analytics'));
  assert.ok(!page.text.includes('Menu'));
  assert.ok(!page.text.includes('Wszelkie prawa'));
  assert.equal(page.title, 'eMMa - kursy');
  assert.equal(page.lang, 'pl');
});

test('ekstrakcja czyta daty publikacji i aktualizacji', () => {
  const page = extractContent(STRONA('<p>Nowa grupa.</p>',
    '<meta property="article:published_time" content="2026-05-01T10:00:00Z"><meta property="article:modified_time" content="2026-08-20T09:00:00Z"'
    + '>'));
  assert.equal(page.publishedAt, '2026-05-01T10:00:00Z');
  assert.equal(page.updatedAt, '2026-08-20T09:00:00Z');
});

test('kotwice naglowkow sa zachowane dla CTA do sekcji', () => {
  const page = extractContent(STRONA('<h2 id="dorosli">Dorosli</h2><p>Kursy wieczorowe.</p>'));
  assert.deepEqual(page.anchors, [{ id: 'dorosli', text: 'Dorosli' }]);
});

test('encje HTML sa dekodowane', () => {
  assert.equal(decodeEntities('4&nbsp;-&nbsp;8 os&oacute;b').replace(/\s+/g, ' ').trim(), '4 - 8 osób');
});

test('powtarzalne bloki sa usuwane jako boilerplate', () => {
  const strony = [1, 2, 3, 4].map((i) => ({
    blocks: [
      { type: 'text', text: 'Zapisz sie do newslettera eMMy!' },
      { type: 'text', text: `Unikalna tresc podstrony ${i}` },
    ],
  }));
  const czyste = removeBoilerplate(strony);
  assert.ok(czyste.every((page) => !page.blocks.some((block) => block.text.includes('newslettera'))));
  assert.ok(czyste[0].blocks.some((block) => block.text.includes('Unikalna')));
});

test('klasyfikacja rozpoznaje typ dokumentu', () => {
  assert.equal(classifyDocument({ url: 'https://emmastudio.pl/cennik/', title: 'Cennik', text: 'cennik kursow' }).type, 'PRICE');
  assert.equal(classifyDocument({ url: 'https://emmastudio.pl/blog/phrasal/', title: 'Phrasal verbs', text: 'artykul' }).type, 'BLOG');
  assert.equal(classifyDocument({ url: 'https://emmastudio.pl/', title: 'eMMa', text: 'szkola jezykowa' }).type, 'LANDING_PAGE');
  assert.equal(classifyDocument({ url: 'https://emmastudio.pl/kursy-dla-dzieci/', title: 'Dla dzieci', text: 'kurs grupa poziom' }).type, 'COURSE');
});

test('chunking nie gubi tresci i zachowuje naglowki', () => {
  const blocks = [
    { type: 'heading', level: 2, text: 'Dla dzieci', anchor: 'dzieci' },
    { type: 'text', text: 'Zajecia w grupach 4-8 osob.' },
    { type: 'heading', level: 2, text: 'Dla doroslych', anchor: 'dorosli' },
    { type: 'text', text: 'Kursy wieczorowe i online.' },
  ];
  const chunks = chunkBlocks(blocks, { maxChars: 60, minChars: 10 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.some((chunk) => chunk.anchor === 'dorosli'));
  const razem = chunks.map((chunk) => chunk.text).join(' ');
  assert.match(razem, /4-8 osob/);
  assert.match(razem, /wieczorowe/);
});

test('pelna synchronizacja wykrywa nowa podstrone przy kolejnym przebiegu', async () => {
  let strony = {
    'https://emmastudio.pl/sitemap.xml': '<urlset><url><loc>https://emmastudio.pl/cennik/</loc></url></urlset>',
    'https://emmastudio.pl/cennik/': STRONA('<h1>Cennik kursow</h1><p>Kurs grupowy dla doroslych kosztuje 1200 zl za semestr, a zajecia indywidualne wyceniamy osobno.</p>'),
  };
  const fetchText = async (url) => {
    if (!strony[url]) throw new Error(`404 ${url}`);
    return strony[url];
  };

  const pierwszy = await syncKnowledge(emptyBase(), { fetchText, delayMs: 0 });
  assert.equal(pierwszy.report.added.length, 1);
  assert.equal(pierwszy.base.documents[0].sourceType, 'PRICE');
  assert.equal(pierwszy.base.ctaMap.PRICE.url, 'https://emmastudio.pl/cennik/');

  // szkola publikuje aktualnosc o nowej grupie
  strony = {
    ...strony,
    'https://emmastudio.pl/sitemap.xml': '<urlset><url><loc>https://emmastudio.pl/cennik/</loc></url><url><loc>https://emmastudio.pl/aktualnosci/nowa-grupa/</loc></url></urlset>',
    'https://emmastudio.pl/aktualnosci/nowa-grupa/': STRONA('<h1>Nowa grupa angielskiego dla dzieci 8-10 lat</h1><p>Zapisy trwaja, a zajecia startuja we wrzesniu w kameralnej grupie.</p>'),
  };

  const drugi = await syncKnowledge(pierwszy.base, { fetchText, delayMs: 0 });
  assert.equal(drugi.report.added.length, 1);
  assert.equal(drugi.report.unchanged.length, 1);
  assert.equal(drugi.base.stats.documents, 2);
  assert.ok(drugi.base.ctaMap.NEWS, 'nowa aktualnosc powinna trafic do mapy CTA');
});

test('niedostepna podstrona nie przerywa synchronizacji', async () => {
  const fetchText = async (url) => {
    if (url.includes('sitemap')) return '<urlset><url><loc>https://emmastudio.pl/ok/</loc></url><url><loc>https://emmastudio.pl/blad/</loc></url></urlset>';
    if (url.includes('blad')) throw new Error('HTTP 500');
    return STRONA('<h1>Kursy jezykowe</h1><p>Angielski i hiszpanski dla doroslych w Poznaniu, w grupach i indywidualnie.</p>');
  };
  const { base, report } = await syncKnowledge(emptyBase(), { fetchText, delayMs: 0 });
  assert.equal(report.failed.length, 1);
  assert.equal(base.stats.documents, 1);
});

test('dokument dostaje contentHash i metadane', () => {
  const page = extractContent(STRONA('<h1>Kontakt</h1><p>Sekretariat eMMy jest czynny od 9 do 17 i odpowiada na pytania o zapisy.</p>'), { url: 'https://emmastudio.pl/kontakt/' });
  const doc = pageToDocument(page);
  assert.equal(doc.sourceType, 'CONTACT');
  assert.ok(doc.contentHash.length > 10);
  assert.ok(doc.chunks.length >= 1);
});
