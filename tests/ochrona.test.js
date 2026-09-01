import test from 'node:test';
import assert from 'node:assert/strict';

import { wystawToken, sprawdzToken, tokenWymagany } from '../src/server/token.js';
import { createTokenHandler } from '../src/server/handlers/token.js';
import { createChatHandler } from '../src/server/handlers/chat.js';
import { makeReq, makeRes } from './helpers/http.js';
import { emptyBase, makeDocument, mergeDocuments } from '../src/knowledge/store.js';

const SEKRET = 'sekret-testowy-do-podpisow';
const DOMENA = 'https://emmastudio.pl';

/* ------------------------------------------------------------------- token */

test('bez sekretu ochrona jest wylaczona i nic nie blokuje', () => {
  assert.equal(tokenWymagany(''), false);
  assert.equal(sprawdzToken('cokolwiek', { sekret: '' }).ok, true);
});

test('token przechodzi tylko z ta domena, dla ktorej zostal wystawiony', () => {
  const { token } = wystawToken({ origin: DOMENA, sekret: SEKRET });
  assert.equal(sprawdzToken(token, { origin: DOMENA, sekret: SEKRET }).ok, true);

  const obca = sprawdzToken(token, { origin: 'https://obca.example', sekret: SEKRET });
  assert.equal(obca.ok, false);
  assert.match(obca.powod, /innej domeny/);
});

test('adres domeny z kropkami nie rozbija odczytu tokenu', () => {
  // Tresc tokenu to "znacznikCzasu.domena", a domena sama zawiera kropki -
  // dzielenie po wszystkich kropkach gubilo koncowke adresu.
  for (const origin of ['https://emmastudio.pl', 'https://www.emmastudio.pl', '']) {
    const { token } = wystawToken({ origin, sekret: SEKRET });
    assert.equal(sprawdzToken(token, { origin, sekret: SEKRET }).ok, true, origin || '(pusty)');
  }
});

test('podrobiony podpis i obcy sekret sa odrzucane', () => {
  const { token } = wystawToken({ origin: DOMENA, sekret: SEKRET });
  const [tresc] = token.split('.');

  assert.equal(sprawdzToken(`${tresc}.${'x'.repeat(43)}`, { origin: DOMENA, sekret: SEKRET }).ok, false);
  assert.equal(sprawdzToken(token, { origin: DOMENA, sekret: 'inny-sekret-zupelnie' }).ok, false);
  assert.equal(sprawdzToken('abc', { origin: DOMENA, sekret: SEKRET }).ok, false);
  assert.equal(sprawdzToken('', { origin: DOMENA, sekret: SEKRET }).ok, false);
});

test('token wygasa, a token z przyszlosci jest odrzucany', () => {
  const teraz = Date.UTC(2026, 8, 1, 12, 0, 0);
  const { token } = wystawToken({ origin: DOMENA, sekret: SEKRET, now: teraz, ttlMs: 60_000 });

  assert.equal(sprawdzToken(token, { origin: DOMENA, sekret: SEKRET, now: teraz + 59_000, ttlMs: 60_000 }).ok, true);

  const stary = sprawdzToken(token, { origin: DOMENA, sekret: SEKRET, now: teraz + 61_000, ttlMs: 60_000 });
  assert.equal(stary.ok, false);
  assert.match(stary.powod, /wygasl/);

  const zPrzyszlosci = sprawdzToken(token, { origin: DOMENA, sekret: SEKRET, now: teraz - 120_000, ttlMs: 60_000 });
  assert.equal(zPrzyszlosci.ok, false);
});

/* -------------------------------------------------------------- endpoint */

const zadanie = (opcje = {}) => makeReq({ method: 'GET', headers: { origin: DOMENA }, ...opcje });

test('endpoint tokenu wystawia podpis tylko domenom z allowlisty', async () => {
  const handler = createTokenHandler({
    issue: ({ origin }) => wystawToken({ origin, sekret: SEKRET }),
  });

  const res = makeRes();
  await handler(zadanie(), res);
  assert.equal(res.statusCode, 200);

  const obcy = makeRes();
  await handler(makeReq({ method: 'GET', headers: { origin: 'https://obca.example' } }), obcy);
  assert.equal(obcy.statusCode, 403);
});

/* --------------------------------------------------------- dzienny budzet */

const bazaZWiedza = async () => {
  const { base } = mergeDocuments(emptyBase(), [makeDocument({
    sourceUrl: 'https://emmastudio.pl/oferta',
    sourceTitle: 'Oferta',
    sourceType: 'COURSE',
    content: 'Kurs angielskiego w grupie 4-8 osob kosztuje 35 zl za 60 minut od osoby.',
    chunks: [{ text: 'Kurs angielskiego w grupie 4-8 osob kosztuje 35 zl za 60 minut od osoby.' }],
  })]);
  return base;
};

const pytanie = () => makeReq({
  body: { message: 'Ile kosztuje kurs w grupie?', history: [] },
  headers: { origin: DOMENA },
});

test('po wyczerpaniu dziennego budzetu Emmbotek odsyla do sekretariatu, nie do modelu', async () => {
  let wywolanModel = false;
  const handler = createChatHandler({
    loadKnowledge: bazaZWiedza,
    generateFn: async () => { wywolanModel = true; return { text: '{"message":"nie powinno paść"}' }; },
    // magazyn, ktory od razu melduje przekroczenie budzetu
    budgetStore: { skonfigurowany: true, sprawdzLimit: async () => ({ allowed: false, remaining: 0, retryAfterMs: 1000 }) },
  });

  const res = makeRes();
  await handler(pytanie(), res);
  const dane = JSON.parse(res.body);

  assert.equal(res.statusCode, 200, 'uzytkownik dostaje odpowiedz, nie blad');
  assert.equal(wywolanModel, false, 'model NIE moze zostac wywolany po przekroczeniu budzetu');
  assert.match(dane.message, /sekretariatu/);
  assert.equal(dane.meta.budzetWyczerpany, true);
  assert.deepEqual(dane.cta, []);
});

test('awaria bazy nie odcina rozmowy - budzet schodzi na licznik lokalny', async () => {
  let wywolan = 0;
  const handler = createChatHandler({
    loadKnowledge: bazaZWiedza,
    generateFn: async () => { wywolan += 1; return { text: '{"message":"[SMILE] Kurs kosztuje 35 zl."}' }; },
    budgetStore: { skonfigurowany: true, sprawdzLimit: async () => { throw new Error('baza padla'); } },
  });

  const res = makeRes();
  await handler(pytanie(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(wywolan, 1, 'rozmowa idzie dalej mimo awarii bazy');
});
