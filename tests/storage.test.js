import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseStore, hashKey, SupabaseError } from '../src/storage/supabase.js';
import { createSharedRateLimiter, createRateLimiter } from '../src/server/rateLimit.js';
import { createAnalyticsHandler } from '../src/server/handlers/analytics.js';
import { makeReq, makeRes } from './helpers/http.js';

const URL_TESTOWY = 'https://projekt.supabase.co';
const KLUCZ = 'service-role-testowy';

/** Atrapa fetcha: zapisuje wywolania i oddaje ustawiona odpowiedz. */
function atrapaFetcha(odpowiedz = { ok: true, status: 200, body: 'null' }) {
  const wywolania = [];
  const impl = async (adres, opcje) => {
    wywolania.push({ adres, opcje, body: JSON.parse(opcje.body) });
    if (typeof odpowiedz === 'function') return odpowiedz(adres, opcje);
    return {
      ok: odpowiedz.ok,
      status: odpowiedz.status,
      text: async () => odpowiedz.body,
    };
  };
  impl.wywolania = wywolania;
  return impl;
}

const sklep = (fetchImpl, over = {}) => createSupabaseStore({
  url: URL_TESTOWY, serviceKey: KLUCZ, fetchImpl, ...over,
});

test('bez konfiguracji magazyn zglasza sie jako nieskonfigurowany', () => {
  const store = createSupabaseStore({ url: '', serviceKey: '' });
  assert.equal(store.skonfigurowany, false);
});

test('luka wiedzy idzie do funkcji bazy, a nie do zwyklej tabeli', async () => {
  const fetchImpl = atrapaFetcha();
  await sklep(fetchImpl).zapiszLuke({ klucz: 'ile kosztuje przedszkole', pytanie: 'Ile kosztuje przedszkole?', intencja: 'PRICE', wynik: 0.12 });

  const [wywolanie] = fetchImpl.wywolania;
  assert.match(wywolanie.adres, /\/rest\/v1\/rpc\/emmbotek_zapisz_luke$/);
  assert.equal(wywolanie.body.p_intencja, 'PRICE');
  assert.equal(wywolanie.body.p_pytanie, 'Ile kosztuje przedszkole?');
});

test('klucz service_role idzie w naglowkach, nigdy w adresie', async () => {
  const fetchImpl = atrapaFetcha();
  await sklep(fetchImpl).zapiszLuke({ klucz: 'k', pytanie: 'pytanie testowe' });

  const [wywolanie] = fetchImpl.wywolania;
  assert.equal(wywolanie.opcje.headers.apikey, KLUCZ);
  assert.equal(wywolanie.opcje.headers.authorization, `Bearer ${KLUCZ}`);
  assert.ok(!wywolanie.adres.includes(KLUCZ), 'klucz nie moze wyciec do adresu URL');
});

test('zdarzenia CTA ida jedna paczka, a nie po jednym zapytaniu', async () => {
  const fetchImpl = atrapaFetcha({ ok: true, status: 200, body: '3' });
  await sklep(fetchImpl).zapiszCta([
    { event: 'cta_impression', ctaType: 'VIEW_PRICE', sourceIntent: 'PRICE', conversationStage: 'decyzja', currentPage: '/oferta' },
    { event: 'cta_click', ctaType: 'VIEW_PRICE', sourceIntent: 'PRICE', conversationStage: 'decyzja', currentPage: '/oferta' },
    { event: 'cta_click', ctaType: 'CONTACT', sourceIntent: 'CONTACT', conversationStage: null, currentPage: null },
  ]);

  assert.equal(fetchImpl.wywolania.length, 1, 'jedno wywolanie na paczke');
  const paczka = fetchImpl.wywolania[0].body.p_zdarzenia;
  assert.equal(paczka.length, 3);
  assert.equal(paczka[0].cta_typ, 'VIEW_PRICE');
  assert.equal(paczka[2].intencja, 'CONTACT');
});

test('pusta paczka nie generuje zapytania do bazy', async () => {
  const fetchImpl = atrapaFetcha();
  const wynik = await sklep(fetchImpl).zapiszCta([]);
  assert.equal(wynik, 0);
  assert.equal(fetchImpl.wywolania.length, 0);
});

test('adres IP nie trafia do bazy - klucz limitu jest skrotem', async () => {
  const fetchImpl = atrapaFetcha({ ok: true, status: 200, body: '[{"dozwolone":true,"pozostalo":14,"ponow_za_ms":0}]' });
  await sklep(fetchImpl).sprawdzLimit('83.21.44.9', 60000, 15);

  const wyslany = fetchImpl.wywolania[0].body.p_klucz;
  assert.ok(!wyslany.includes('83.21.44.9'), 'adres IP nie moze opuscic serwera');
  assert.equal(wyslany, hashKey('83.21.44.9'));
  assert.equal(wyslany.length, 32);
});

test('odpowiedz limitu jest tlumaczona na kontrakt limitera', async () => {
  const fetchImpl = atrapaFetcha({ ok: true, status: 200, body: '[{"dozwolone":false,"pozostalo":0,"ponow_za_ms":41000}]' });
  const wynik = await sklep(fetchImpl).sprawdzLimit('ip', 60000, 15);
  assert.deepEqual(wynik, { allowed: false, remaining: 0, retryAfterMs: 41000 });
});

test('blad bazy jest opisany, a nie polkniety', async () => {
  const fetchImpl = atrapaFetcha({ ok: false, status: 401, body: '{"message":"Invalid API key"}' });
  await assert.rejects(
    () => sklep(fetchImpl).zapiszLuke({ klucz: 'k', pytanie: 'pytanie testowe' }),
    (error) => error instanceof SupabaseError && error.status === 401,
  );
});

test('przekroczony czas oczekiwania konczy sie bledem, a nie zawieszeniem', async () => {
  const fetchImpl = async (_adres, opcje) => new Promise((_, reject) => {
    opcje.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  await assert.rejects(
    () => sklep(fetchImpl, { timeoutMs: 20 }).zapiszLuke({ klucz: 'k', pytanie: 'pytanie testowe' }),
    /przekroczono 20 ms/,
  );
});

/* --------------------------------------------------------------- limit zapytan */

test('limit wspoldzielony pyta baze, gdy jest skonfigurowana', async () => {
  const store = {
    skonfigurowany: true,
    sprawdzLimit: async () => ({ allowed: true, remaining: 7, retryAfterMs: 0 }),
  };
  const limiter = createSharedRateLimiter({ store });
  assert.deepEqual(await limiter.consume('ip'), { allowed: true, remaining: 7, retryAfterMs: 0 });
});

test('awaria bazy nie otwiera bramy na oscież - limit schodzi do pamieci', async () => {
  const store = {
    skonfigurowany: true,
    sprawdzLimit: async () => { throw new SupabaseError('baza padla'); },
  };
  let zgloszonych = 0;
  const limiter = createSharedRateLimiter({
    store,
    fallback: createRateLimiter({ windowMs: 60000, max: 2 }),
    onError: () => { zgloszonych += 1; },
  });

  assert.equal((await limiter.consume('ip')).allowed, true);
  assert.equal((await limiter.consume('ip')).allowed, true);
  const trzecie = await limiter.consume('ip');
  assert.equal(trzecie.allowed, false, 'limiter zapasowy nadal liczy');
  assert.equal(zgloszonych, 3, 'kazda nieudana proba jest zgloszona do diagnostyki');
});

test('bez konfiguracji Supabase limit dziala w pamieci i nie dotyka sieci', async () => {
  const store = { skonfigurowany: false, sprawdzLimit: async () => { throw new Error('nie wolno'); } };
  const limiter = createSharedRateLimiter({ store, fallback: createRateLimiter({ max: 1 }) });
  assert.equal((await limiter.consume('ip')).allowed, true);
  assert.equal((await limiter.consume('ip')).allowed, false);
});

/* ------------------------------------------------------- wpiecie do endpointu */

const zadanieCta = () => makeReq({
  body: { events: [{ event: 'cta_click', ctaType: 'VIEW_PRICE', sourceIntent: 'PRICE', currentPage: 'https://emmastudio.pl/oferta?utm=x#kotwica' }] },
  headers: { origin: 'https://emmastudio.pl' },
});

test('z magazynem liczniki ida do bazy, a plik nie jest ruszany', async () => {
  let doBazy = null;
  let plikRuszony = false;
  const handler = createAnalyticsHandler({
    record: async (zdarzenia) => { doBazy = zdarzenia; },
    read: async () => { plikRuszony = true; return {}; },
    write: async () => { plikRuszony = true; },
  });

  const res = makeRes();
  await handler(zadanieCta(), res);

  assert.equal(res.statusCode, 202);
  assert.equal(doBazy.length, 1);
  assert.equal(doBazy[0].ctaType, 'VIEW_PRICE');
  assert.equal(doBazy[0].currentPage, '/oferta', 'z adresu zostaje sama sciezka');
  assert.equal(plikRuszony, false, 'przy bazie nie dotykamy pliku');
});

test('awaria bazy nie psuje odpowiedzi dla widgetu', async () => {
  const handler = createAnalyticsHandler({
    record: async () => { throw new Error('baza padla'); },
  });
  const res = makeRes();
  await handler(zadanieCta(), res);
  assert.equal(res.statusCode, 202, 'telemetria nigdy nie psuje UX');
});
