import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatHandler } from '../src/server/handlers/chat.js';
import { chceStrumienia } from '../src/server/sse.js';
import { emptyBase, mergeDocuments, makeDocument } from '../src/knowledge/store.js';
import { makeReq, makeRes } from './helpers/http.js';

/**
 * Atrapa odpowiedzi rozszerzona o `writeHead` i `write` - strumien SSE pisze
 * kawalkami, a nie jednym `end()`, wiec wspoldzielona atrapa mu nie wystarcza.
 */
function makeResSSE() {
  const res = makeRes();
  res.zapisane = '';
  res.writeHead = function (status, headers) {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers || {})) this.headers[k.toLowerCase()] = v;
  };
  res.write = function (chunk) { this.zapisane += chunk; return true; };
  const koniec = res.end.bind(res);
  res.end = function (chunk) { if (chunk) this.zapisane += chunk; koniec(chunk); };
  return res;
}

const zadanie = (body, headers = {}) =>
  makeReq({ body, headers: { origin: 'https://emmastudio.pl', ...headers } });

/** Rozbiera strumien SSE na pary [nazwa zdarzenia, ladunek]. */
function zdarzenia(tekst) {
  const out = [];
  for (const blok of tekst.split('\n\n')) {
    let nazwa = null;
    let dane = null;
    for (const linia of blok.split('\n')) {
      if (linia.startsWith('event:')) nazwa = linia.slice(6).trim();
      else if (linia.startsWith('data:')) {
        try { dane = JSON.parse(linia.slice(5).trim()); } catch { dane = null; }
      }
    }
    if (nazwa) out.push([nazwa, dane]);
  }
  return out;
}

function testowaBaza() {
  const { base } = mergeDocuments(emptyBase(), [
    makeDocument({
      sourceUrl: 'https://emmastudio.pl/oferta/', sourceTitle: 'Oferta', sourceType: 'COURSE',
      content: 'Kurs angielskiego w grupie kosztuje 35 zl za 60 minut.',
      updatedAt: new Date().toISOString(),
      chunks: [{ text: 'Kurs angielskiego w grupie kosztuje 35 zl za 60 minut.' }],
    }),
  ]);
  return base;
}

const ODPOWIEDZ = JSON.stringify({
  message: '[SMILE] Kurs w grupie kosztuje 35 zł za 60 minut.',
  cta: [],
  podpowiedzi: ['Ile trwa lekcja?'],
  profil: {},
  intent: 'PRICE',
});

test('naglowek Accept decyduje o trybie strumieniowym', () => {
  assert.equal(chceStrumienia({ headers: { accept: 'text/event-stream, application/json' } }), true);
  assert.equal(chceStrumienia({ headers: { accept: 'application/json' } }), false);
  assert.equal(chceStrumienia({ headers: {} }), false);
});

test('przy Accept: text/event-stream odpowiedz leci zdarzeniami', async () => {
  // Model "pisze" po kawalku - handler ma po kazdym kawalku wyslac narastajaca tresc.
  const generateFn = async ({ onFragment }) => {
    assert.ok(onFragment, 'handler musi poprosic o strumien');
    const kroki = [
      '{"message":"[SMILE] Kurs w grupie',
      '{"message":"[SMILE] Kurs w grupie kosztuje 35 zł',
      ODPOWIEDZ,
    ];
    for (const krok of kroki) onFragment(krok);
    return { text: ODPOWIEDZ, model: 'atrapa', usage: null };
  };

  const handler = createChatHandler({
    limiter: { consume: async () => ({ allowed: true }) },
    loadKnowledge: async () => testowaBaza(),
    generateFn,
  });

  const res = makeResSSE();
  await handler(zadanie({ message: 'Ile kosztuje kurs?', history: [] }, { accept: 'text/event-stream' }), res);

  assert.match(String(res.headers['content-type']), /text\/event-stream/);
  assert.equal(res.ended, true);

  const lista = zdarzenia(res.zapisane);
  const nazwy = lista.map(([n]) => n);
  assert.ok(nazwy.includes('emocja'), 'emocja ma poleciec, zanim przyjdzie cala tresc');
  assert.ok(nazwy.filter((n) => n === 'tekst').length >= 2, 'tresc ma narastac w kilku krokach');
  assert.equal(nazwy[nazwy.length - 1], 'koniec');

  const teksty = lista.filter(([n]) => n === 'tekst').map(([, d]) => d.message);
  assert.equal(teksty[0], 'Kurs w grupie', 'pierwszy kawalek bez tagu emocji');
  assert.ok(teksty[teksty.length - 1].length > teksty[0].length, 'tresc ma rosnac');
  for (const tekst of teksty) assert.doesNotMatch(tekst, /\[SMILE\]/, 'tag emocji nie moze trafic do tresci');

  const [, koniec] = lista[lista.length - 1];
  assert.equal(koniec.message, 'Kurs w grupie kosztuje 35 zł za 60 minut.');
  assert.deepEqual(koniec.podpowiedzi, ['Ile trwa lekcja?']);
  assert.equal(koniec.emotion, 'SMILE');
});

test('bez naglowka Accept odpowiedz jest zwyklym JSON-em', async () => {
  const generateFn = async ({ onFragment }) => {
    assert.equal(onFragment, null, 'bez strumienia handler nie prosi o kawalki');
    return { text: ODPOWIEDZ, model: 'atrapa', usage: null };
  };

  const handler = createChatHandler({
    limiter: { consume: async () => ({ allowed: true }) },
    loadKnowledge: async () => testowaBaza(),
    generateFn,
  });

  const res = makeResSSE();
  await handler(zadanie({ message: 'Ile kosztuje kurs?', history: [] }), res);

  assert.doesNotMatch(String(res.headers['content-type'] ?? ''), /event-stream/);
  const dane = res.json;
  assert.equal(dane.message, 'Kurs w grupie kosztuje 35 zł za 60 minut.');
  assert.equal(dane.emotion, 'SMILE');
});

test('odmowa przed wolaniem modelu nie otwiera strumienia', async () => {
  const handler = createChatHandler({
    limiter: { consume: async () => ({ allowed: false, retryAfterMs: 1000 }) },
    loadKnowledge: async () => testowaBaza(),
    generateFn: async () => { throw new Error('model nie powinien byc wolany'); },
  });

  const res = makeResSSE();
  await handler(zadanie({ message: 'Ile kosztuje kurs?', history: [] }, { accept: 'text/event-stream' }), res);

  // Limit zapytan musi zostac zwyklym kodem 429, a nie zdarzeniem w strumieniu -
  // po wyslaniu naglowkow SSE nie da sie juz oddac kodu bledu.
  assert.equal(res.statusCode, 429);
  assert.doesNotMatch(String(res.headers['content-type'] ?? ''), /event-stream/);
});
