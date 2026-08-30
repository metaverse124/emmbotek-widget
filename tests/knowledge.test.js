import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBase, mergeDocuments, makeDocument, contentHash, normalizeUrl } from '../src/knowledge/store.js';
import { retrieve, hasUsableKnowledge } from '../src/knowledge/retrieval.js';
import { isCurrentlyValid, isStale, resolveConflict, freshnessLabel } from '../src/knowledge/freshness.js';
import { buildCtaMap, ctaUrl } from '../src/knowledge/ctaMap.js';

const doc = (over = {}) => makeDocument({
  sourceUrl: 'https://emmastudio.pl/cennik/',
  sourceTitle: 'Cennik',
  sourceType: 'PRICE',
  content: 'Kurs grupowy dla doroslych kosztuje 1200 zl za semestr.',
  updatedAt: new Date().toISOString(),
  chunks: [{ text: 'Kurs grupowy dla doroslych kosztuje 1200 zl za semestr.' }],
  ...over,
});

test('nowy dokument trafia do bazy jako "added"', () => {
  const { base, report } = mergeDocuments(emptyBase(), [doc()]);
  assert.equal(report.added.length, 1);
  assert.equal(base.stats.documents, 1);
});

test('zmiana ceny podnosi rewizje, a nie tworzy duplikatu', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  const zmieniony = doc({ content: 'Kurs grupowy dla doroslych kosztuje 1350 zl za semestr.',
    chunks: [{ text: 'Kurs grupowy dla doroslych kosztuje 1350 zl za semestr.' }] });

  const { base: after, report } = mergeDocuments(base, [zmieniony]);
  assert.equal(report.updated.length, 1);
  assert.equal(after.documents.length, 1);
  assert.equal(after.documents[0].revision, 2);
  assert.match(after.documents[0].content, /1350/);
});

test('tresc bez zmian nie generuje nowej rewizji', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  const { report } = mergeDocuments(base, [doc()]);
  assert.equal(report.unchanged.length, 1);
  assert.equal(report.updated.length, 0);
});

test('usunieta podstrona jest archiwizowana, nie kasowana', () => {
  const { base } = mergeDocuments(emptyBase(), [doc(), doc({ sourceUrl: 'https://emmastudio.pl/stara/', sourceType: 'NEWS' })]);
  const { base: after, report } = mergeDocuments(base, [doc()]);
  assert.equal(report.archived.length, 1);
  const archived = after.documents.find((item) => item.sourceUrl.includes('stara'));
  assert.equal(archived.status, 'archived');
  assert.equal(after.stats.documents, 1);
});

test('archiwalny dokument nie wraca w wynikach retrievalu', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  const { base: after } = mergeDocuments(base, []);
  assert.equal(retrieve(after, 'ile kosztuje kurs').length, 0);
});

test('retrieval znajduje aktualna cene', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  const results = retrieve(base, 'ile kosztuje kurs dla doroslych', { intent: 'PRICE' });
  assert.ok(results.length > 0);
  assert.equal(results[0].sourceType, 'PRICE');
  assert.equal(results[0].freshness, 'AKTUALNE');
  assert.ok(hasUsableKnowledge(results));
});

test('brak wiedzy = brak uzytecznych wynikow (luka wiedzy)', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  const results = retrieve(base, 'czy macie parking dla rowerow towarowych');
  assert.equal(hasUsableKnowledge(results), false);
});

test('stara promocja jest oznaczona jako nieaktualna', () => {
  const wygasla = doc({
    sourceUrl: 'https://emmastudio.pl/promocja/',
    sourceType: 'NEWS',
    validUntil: '2020-01-01T00:00:00.000Z',
    content: 'Promocja wrzesniowa -20%.',
    chunks: [{ text: 'Promocja wrzesniowa -20%.' }],
  });
  assert.equal(isCurrentlyValid(wygasla), false);
  assert.equal(freshnessLabel(wygasla), 'NIEAKTUALNE');
});

test('stara aktualnosc wymaga weryfikacji', () => {
  const stara = doc({ sourceType: 'NEWS', updatedAt: '2019-03-01T00:00:00.000Z' });
  assert.equal(isStale(stara), true);
  assert.equal(freshnessLabel(stara), 'WYMAGA_WERYFIKACJI');
});

test('konflikt zrodel: nowsza oficjalna podstrona wygrywa z blogiem', () => {
  const oficjalna = doc({ sourceType: 'COURSE', updatedAt: '2026-01-01T00:00:00.000Z' });
  const blog = doc({ sourceUrl: 'https://emmastudio.pl/blog/ceny/', sourceType: 'BLOG', updatedAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(resolveConflict(oficjalna, blog).sourceType, 'COURSE');
});

test('konflikt nierozstrzygalny zwraca null (eMMa nie zgaduje)', () => {
  const a = doc({ sourceUrl: 'https://emmastudio.pl/a/', updatedAt: null, indexedAt: null, publishedAt: null });
  const b = doc({ sourceUrl: 'https://emmastudio.pl/b/', updatedAt: null, indexedAt: null, publishedAt: null });
  assert.equal(resolveConflict({ ...a, indexedAt: null }, { ...b, indexedAt: null }), null);
});

test('mapa CTA aktualizuje sie, gdy zmieni sie adres na stronie', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  base.ctaMap = buildCtaMap(base);
  assert.equal(ctaUrl(base.ctaMap, 'PRICE'), 'https://emmastudio.pl/cennik/');

  const przeniesiony = doc({ sourceUrl: 'https://emmastudio.pl/oplaty/' });
  const { base: after } = mergeDocuments(base, [przeniesiony]);
  after.ctaMap = buildCtaMap(after);
  assert.equal(ctaUrl(after.ctaMap, 'PRICE'), 'https://emmastudio.pl/oplaty/');
});

test('nowy wpis blogowy staje sie czescia wiedzy', () => {
  const { base } = mergeDocuments(emptyBase(), [doc()]);
  const wpis = makeDocument({
    sourceUrl: 'https://emmastudio.pl/blog/phrasal-verbs/',
    sourceTitle: 'Phrasal verbs bez bolu',
    sourceType: 'BLOG',
    content: 'Phrasal verbs najlatwiej zapamietac w kontekscie zdania.',
    updatedAt: new Date().toISOString(),
    chunks: [{ text: 'Phrasal verbs najlatwiej zapamietac w kontekscie zdania.' }],
  });
  const { base: after, report } = mergeDocuments(base, [doc(), wpis]);
  assert.equal(report.added.length, 1);
  const results = retrieve(after, 'phrasal verbs', { intent: 'BLOG' });
  assert.equal(results[0].sourceType, 'BLOG');
});

test('hash tresci wykrywa nawet drobna zmiane', () => {
  assert.notEqual(contentHash('1200 zl'), contentHash('1350 zl'));
  assert.equal(contentHash(' 1200 zl '), contentHash('1200 zl'));
});

test('normalizacja adresu sprowadza warianty tego samego adresu do jednej postaci', () => {
  const wzorzec = 'https://emmastudio.pl/oferta';
  assert.equal(normalizeUrl('https://emmastudio.pl/oferta/'), wzorzec);
  assert.equal(normalizeUrl('https://WWW.emmastudio.pl/oferta'), wzorzec);
  assert.equal(normalizeUrl('https://emmastudio.pl/oferta#cennik'), wzorzec);
  assert.equal(normalizeUrl('https://emmastudio.pl/oferta?utm_source=fb'), wzorzec);
  // korzen zachowuje ukosnik, bo bez niego adres przestaje byc adresem
  assert.equal(normalizeUrl('https://emmastudio.pl/'), 'https://emmastudio.pl/');
  assert.equal(normalizeUrl(''), null);
});

test('adres z ukosnikiem i bez to ten sam dokument, a nie dwa', () => {
  const { base } = mergeDocuments(emptyBase(), [doc({ sourceUrl: 'https://emmastudio.pl/cennik/' })]);
  const { base: after, report } = mergeDocuments(base, [
    doc({ sourceUrl: 'https://emmastudio.pl/cennik', content: 'Kurs grupowy dla doroslych kosztuje 1350 zl za semestr.' }),
  ]);
  assert.equal(report.added.length, 0, 'to nie jest nowa podstrona');
  assert.equal(report.updated.length, 1);
  assert.equal(after.stats.documents, 1);
});

test('zywa podstrona nie znika z bazy przez sam ukosnik w sitemap', () => {
  // Rekord zalozony recznie ma ukosnik, sitemap emmastudio.pl go nie ma.
  const { base } = mergeDocuments(emptyBase(), [doc({ sourceUrl: 'https://emmastudio.pl/oferta/' })]);
  const { base: after, report } = mergeDocuments(base, [], {
    archiveMissing: true,
    knownUrls: new Set(['https://emmastudio.pl/oferta']),
  });
  assert.equal(report.archived.length, 0);
  assert.equal(after.documents[0].status, 'active');
});

test('premia za biezaca podstrone dziala mimo ukosnika w pasku adresu', () => {
  const { base } = mergeDocuments(emptyBase(), [
    doc({ sourceUrl: 'https://emmastudio.pl/cennik' }),
    doc({
      sourceUrl: 'https://emmastudio.pl/o-nas',
      sourceTitle: 'O nas',
      sourceType: 'GENERAL',
      content: 'Kurs grupowy dla doroslych kosztuje 1200 zl za semestr.',
      chunks: [{ text: 'Kurs grupowy dla doroslych kosztuje 1200 zl za semestr.' }],
    }),
  ]);
  const wyniki = retrieve(base, 'ile kosztuje kurs grupowy', {
    currentUrl: 'https://emmastudio.pl/cennik/?utm_source=fb#tabela',
  });
  assert.equal(wyniki[0].sourceUrl, 'https://emmastudio.pl/cennik');
});
