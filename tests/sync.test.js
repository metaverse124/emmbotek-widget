import test from 'node:test';
import assert from 'node:assert/strict';

import { makeReq, makeRes } from './helpers/http.js';
import { emptyBase, mergeDocuments, makeDocument } from '../src/knowledge/store.js';
import { syncKnowledge } from '../src/crawler/run.js';

import { createSyncHandler } from '../src/server/handlers/sync.js';

/** Sekrety wstrzykujemy, zeby nie zalezec od kolejnosci ladowania konfiguracji. */
const handlerWith = ({ syncToken = '', cronSecret = '' } = {}) => createSyncHandler({
  sync: fakeSync,
  load: loadEmpty,
  save: noopSave,
  secrets: () => [syncToken, cronSecret],
});

async function call(handler, { headers = {}, method = 'POST' } = {}) {
  const req = makeReq({ method, headers });
  const res = makeRes();
  await handler(req, res);
  return res;
}

const fakeSync = async (base) => ({ base, report: { added: [], updated: [], unchanged: [], archived: [], failed: [], ctaTargets: 0 } });
const noopSave = async () => {};
const loadEmpty = async () => emptyBase();

test('naglowek x-sync-token z SYNC_TOKEN przechodzi (webhook CMS)', async () => {
  const res = await call(handlerWith({ syncToken: 'tajne-123' }), {
    headers: { 'x-sync-token': 'tajne-123' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.ok, true);
});

test('Vercel Cron wysyla Bearer CRON_SECRET - musi zostac przyjety', async () => {
  const res = await call(handlerWith({ syncToken: 'tajne-123', cronSecret: 'cron-abc' }), {
    headers: { authorization: 'Bearer cron-abc' },
  });
  assert.equal(res.statusCode, 200, 'cron z wlasnym sekretem nie moze dostawac 401');
});

test('obcy sekret dostaje 401', async () => {
  const res = await call(handlerWith({ syncToken: 'tajne-123', cronSecret: 'cron-abc' }), {
    headers: { authorization: 'Bearer nie-ten' },
  });
  assert.equal(res.statusCode, 401);
});

test('brak jakiegokolwiek sekretu po stronie serwera to blad konfiguracji', async () => {
  const res = await call(handlerWith({}), {
    headers: { 'x-sync-token': 'cokolwiek' },
  });
  assert.equal(res.statusCode, 500);
  assert.match(res.json.error, /SYNC_TOKEN/);
});

/* ------------------------------------------------------- budzet czasu crawla */

const SITEMAP = (count) => `<urlset>${Array.from({ length: count }, (_, i) =>
  `<url><loc>http://test.local/strona-${i}/</loc></url>`).join('')}</urlset>`;

const PAGE = (i) => `<!doctype html><html lang="pl"><head><title>Strona ${i}</title></head><body><main>
  <h1>Kurs numer ${i}</h1><p>Opis kursu jezykowego numer ${i} w kameralnej grupie 4-8 osob w Poznaniu.</p>
</main></body></html>`;

test('crawl konczy sie w ramach budzetu czasu i zapisuje to, co zdazyl zebrac', async () => {
  let now = 0;
  const fetchText = async (url) => {
    now += 400; // kazde pobranie "kosztuje" 400 ms
    return url.includes('sitemap') ? SITEMAP(50) : PAGE(url);
  };
  const realNow = Date.now;
  Date.now = () => realNow.call(Date) + now;
  try {
    const { report, base } = await syncKnowledge(emptyBase(), {
      fetchText, delayMs: 0, maxDurationMs: 3000, sitemapUrl: 'http://test.local/sitemap.xml',
    });
    assert.equal(report.timedOut, true, 'przebieg powinien zostac przerwany budzetem');
    assert.ok(base.stats.documents > 0, 'to, co zdazyl pobrac, musi zostac zapisane');
    assert.ok(base.stats.documents < 50, 'nie powinien zdazyc z calym serwisem');
    assert.ok(report.remaining > 0);
  } finally {
    Date.now = realNow;
  }
});

test('przerwany crawl NIE archiwizuje stron, ktorych nie zdazyl odwiedzic', async () => {
  const documents = [1, 2, 3].map((i) => makeDocument({
    sourceUrl: `http://test.local/strona-${i}/`, sourceTitle: `Strona ${i}`, sourceType: 'COURSE',
    content: `Tresc ${i}`, chunks: [{ text: `Tresc ${i}` }],
  }));
  const { base } = mergeDocuments(emptyBase(), documents);
  assert.equal(base.stats.documents, 3);

  let now = 0;
  const fetchText = async (url) => {
    now += 5000;
    return url.includes('sitemap') ? SITEMAP(3) : PAGE(url);
  };
  const realNow = Date.now;
  Date.now = () => realNow.call(Date) + now;
  try {
    const { base: after, report } = await syncKnowledge(base, {
      fetchText, delayMs: 0, maxDurationMs: 1, sitemapUrl: 'http://test.local/sitemap.xml',
    });
    assert.equal(report.timedOut, true);
    assert.equal(report.archived.length, 0, 'timeout nie moze skasowac calej bazy wiedzy');
    assert.equal(after.stats.documents, 3, 'wszystkie dokumenty pozostaja aktywne');
  } finally {
    Date.now = realNow;
  }
});

test('strona chwilowo niedostepna nie znika z bazy, skoro nadal jest w sitemap', async () => {
  const doc = makeDocument({
    sourceUrl: 'http://test.local/strona-0/', sourceTitle: 'Strona 0', sourceType: 'COURSE',
    content: 'Tresc', chunks: [{ text: 'Tresc' }],
  });
  const { base } = mergeDocuments(emptyBase(), [doc]);

  const fetchText = async (url) => {
    if (url.includes('sitemap')) return SITEMAP(1);
    throw new Error('HTTP 503');
  };
  const { base: after, report } = await syncKnowledge(base, {
    fetchText, delayMs: 0, sitemapUrl: 'http://test.local/sitemap.xml',
  });
  assert.equal(report.failed.length, 1);
  assert.equal(report.archived.length, 0, 'blad 503 to nie to samo co usuniecie podstrony');
  assert.equal(after.stats.documents, 1);
});

test('podstrona faktycznie usunieta ze strony jest archiwizowana', async () => {
  const documents = [0, 1].map((i) => makeDocument({
    sourceUrl: `http://test.local/strona-${i}/`, sourceTitle: `Strona ${i}`, sourceType: 'COURSE',
    content: `Tresc ${i}`, chunks: [{ text: `Tresc ${i}` }],
  }));
  const { base } = mergeDocuments(emptyBase(), documents);

  const fetchText = async (url) => (url.includes('sitemap') ? SITEMAP(1) : PAGE(url));
  const { base: after, report } = await syncKnowledge(base, {
    fetchText, delayMs: 0, sitemapUrl: 'http://test.local/sitemap.xml',
  });
  assert.equal(report.archived.length, 1);
  const archived = after.documents.find((item) => item.sourceUrl.endsWith('strona-1/'));
  assert.equal(archived.status, 'archived');
});
