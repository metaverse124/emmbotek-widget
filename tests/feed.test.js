import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFeed, feedEntryToDocument, belongsToSite } from '../src/crawler/feed.js';
import { syncKnowledge } from '../src/crawler/run.js';
import { emptyBase, activeDocuments } from '../src/knowledge/store.js';
import { retrieve } from '../src/knowledge/retrieval.js';

const WPIS = (over = {}) => ({
  adres: 'https://emmastudio.pl/oferta',
  tytul: 'Oferta i cennik',
  typ: 'COURSE',
  naglowki: ['Oferta i cennik'],
  fragmenty: [
    {
      naglowek: 'Cennik 2026/2027',
      kotwica: 'cennik',
      tekst: 'Angielski z polskim lektorem, stacjonarnie i online: zajecia indywidualne 89 zl za 60 minut, grupa 4-8 osob 35 zl za 60 minut od osoby.',
    },
  ],
  ...over,
});

const KANAL = (dokumenty) => JSON.stringify({
  wersja: 1,
  domena: 'https://emmastudio.pl',
  wygenerowano: '2026-08-30T16:00:00.000Z',
  dokumenty,
});

test('wpis kanalu staje sie dokumentem z fragmentami, kotwicami i typem', () => {
  const doc = feedEntryToDocument(WPIS());
  assert.equal(doc.sourceUrl, 'https://emmastudio.pl/oferta');
  assert.equal(doc.sourceType, 'COURSE');
  assert.equal(doc.chunks.length, 1);
  assert.equal(doc.chunks[0].anchor, 'cennik');
  assert.ok(doc.content.includes('89 zl'));
  assert.ok(doc.contentHash);
});

test('nieznany typ z kanalu nie przechodzi - wraca klasyfikator', () => {
  const doc = feedEntryToDocument(WPIS({ typ: 'WYMYSLONY_TYP' }));
  assert.equal(doc.sourceType, 'COURSE', 'klasyfikator rozpoznaje /oferta jako kurs');
});

test('kanal nie moze wprowadzic dokumentu spoza domeny strony', () => {
  assert.equal(belongsToSite('https://emmastudio.pl/oferta'), true);
  assert.equal(belongsToSite('https://www.emmastudio.pl/oferta'), true);
  assert.equal(belongsToSite('https://emmastudio.pl.zlosliwa.example/oferta'), false);
  assert.equal(belongsToSite('http://emmastudio.pl/oferta'), false, 'tylko https');
  assert.equal(feedEntryToDocument(WPIS({ adres: 'https://zlosliwa.example/promocja' })), null);
});

test('wpis bez tresci jest pomijany, a nie zapisywany jako pusty dokument', () => {
  assert.equal(feedEntryToDocument(WPIS({ fragmenty: [] })), null);
  assert.equal(feedEntryToDocument(WPIS({ fragmenty: [{ tekst: 'krotko' }] })), null);
});

test('loadFeed melduje pominiete wpisy zamiast je przemilczec', async () => {
  const kanal = KANAL([
    WPIS(),
    WPIS({ adres: 'https://zlosliwa.example/promocja' }),
    WPIS({ adres: 'https://emmastudio.pl/pusta', fragmenty: [] }),
  ]);
  const { documents, skipped, generatedAt } = await loadFeed('https://emmastudio.pl/wiedza.json', async () => kanal);
  assert.equal(documents.length, 1);
  assert.equal(skipped.length, 2);
  assert.equal(skipped[0].reason, 'adres spoza domeny strony');
  assert.equal(skipped[1].reason, 'zbyt malo tresci');
  assert.equal(generatedAt, '2026-08-30T16:00:00.000Z');
});

test('uszkodzony kanal konczy sie bledem, a nie cicha pustka', async () => {
  await assert.rejects(
    () => loadFeed('https://emmastudio.pl/wiedza.json', async () => 'to nie jest JSON'),
    /nie jest poprawnym JSON-em/,
  );
  await assert.rejects(
    () => loadFeed('https://emmastudio.pl/wiedza.json', async () => '{"wersja":1}'),
    /nie zawiera tablicy/,
  );
});

test('synchronizacja bierze wiedze z kanalu i buduje z niej mape CTA', async () => {
  const fetchText = async (url) => {
    if (url.endsWith('/wiedza.json')) {
      return KANAL([
        WPIS(),
        WPIS({
          adres: 'https://emmastudio.pl/kontakt',
          tytul: 'Kontakt',
          typ: 'CONTACT',
          naglowki: ['Kontakt'],
          fragmenty: [{ naglowek: 'Dane kontaktowe', kotwica: 'dane', tekst: 'Adres: os. Pod Lipami 2E, 61-628 Poznan. Telefon: 725 133 002.' }],
        }),
      ]);
    }
    throw new Error('crawl HTML nie powinien byc potrzebny');
  };

  const { base, report } = await syncKnowledge(emptyBase(), { fetchText, delayMs: 0 });
  assert.equal(report.source, 'feed');
  assert.equal(report.added.length, 2);
  assert.equal(activeDocuments(base).length, 2);
  assert.ok(base.ctaMap.CONTACT, 'kontakt powinien trafic do mapy CTA');

  const wyniki = retrieve(base, 'angielski grupa cennik', { intent: 'PRICE' });
  assert.ok(wyniki.length, 'wiedza z kanalu musi byc wyszukiwalna');
  assert.ok(wyniki[0].text.includes('35 zl'));
});

test('gdy kanalu nie ma, synchronizacja schodzi na crawl HTML', async () => {
  const STRONA = `<!doctype html><html lang="pl"><head><title>Oferta</title></head>
<body><main><h1>Oferta</h1><p>Angielski i hiszpanski dla doroslych w Poznaniu, w grupach i indywidualnie.</p></main></body></html>`;
  const fetchText = async (url) => {
    if (url.endsWith('/wiedza.json')) throw new Error('HTTP 404');
    if (url.includes('sitemap')) return '<urlset><url><loc>https://emmastudio.pl/oferta</loc></url></urlset>';
    return STRONA;
  };

  const { base, report } = await syncKnowledge(emptyBase(), { fetchText, delayMs: 0 });
  assert.equal(report.source, 'crawl');
  assert.match(report.feedError, /404/);
  assert.equal(activeDocuments(base).length, 1);
});

test('kanal bez uzytecznych dokumentow tez uruchamia zapasowy crawl', async () => {
  const fetchText = async (url) => {
    if (url.endsWith('/wiedza.json')) return KANAL([]);
    if (url.includes('sitemap')) return '<urlset><url><loc>https://emmastudio.pl/oferta</loc></url></urlset>';
    return `<!doctype html><html lang="pl"><head><title>Oferta</title></head><body><main><h1>Oferta</h1>
<p>Angielski i hiszpanski dla doroslych w Poznaniu, w grupach i indywidualnie.</p></main></body></html>`;
  };
  const { report } = await syncKnowledge(emptyBase(), { fetchText, delayMs: 0 });
  assert.equal(report.source, 'crawl');
  assert.match(report.feedError, /zadnego uzytecznego dokumentu/);
});

test('podstrona usunieta z kanalu trafia do archiwum, reszta zostaje', async () => {
  const dwie = KANAL([WPIS(), WPIS({
    adres: 'https://emmastudio.pl/promocja',
    tytul: 'Promocja wrzesniowa',
    typ: 'NEWS',
    fragmenty: [{ naglowek: 'Promocja', tekst: 'Wrzesniowa promocja na kursy grupowe trwa do konca miesiaca.' }],
  })]);
  const jedna = KANAL([WPIS()]);

  let kanal = dwie;
  const fetchText = async (url) => {
    if (url.endsWith('/wiedza.json')) return kanal;
    throw new Error('crawl HTML nie powinien byc potrzebny');
  };

  const pierwszy = await syncKnowledge(emptyBase(), { fetchText, delayMs: 0 });
  assert.equal(activeDocuments(pierwszy.base).length, 2);

  kanal = jedna;
  const drugi = await syncKnowledge(pierwszy.base, { fetchText, delayMs: 0 });
  assert.equal(drugi.report.archived.length, 1);
  assert.equal(activeDocuments(drugi.base).length, 1);
});
