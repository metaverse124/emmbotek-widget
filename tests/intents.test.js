import test from 'node:test';
import assert from 'node:assert/strict';

import { detectIntent } from '../src/agent/intents.js';

test('pytanie o cene rozpoznaje intencje PRICE', () => {
  assert.equal(detectIntent('Ile kosztuje kurs dla doroslych?').intent, 'PRICE');
});

test('pytanie jezykowe nie jest traktowane jako sprzedazowe', () => {
  assert.equal(detectIntent('Co znaczy nevertheless?').intent, 'LANGUAGE_QUESTION');
});

test('rodzic szukajacy kursu dla dziecka', () => {
  assert.equal(detectIntent('Szukam angielskiego dla corki, ma 9 lat.').intent, 'CHILD');
});

test('krotkie pytanie kontekstowe dziedziczy temat z historii', () => {
  const history = [{ role: 'user', text: 'Kurs dla dziecka', intent: 'CHILD' }];
  const { intent } = detectIntent('A ile to kosztuje?', { history });
  assert.ok(['PRICE', 'CHILD'].includes(intent));
});

test('kontekst podstrony podbija powiazana intencje', () => {
  const bez = detectIntent('Jak to wyglada?').intent;
  const zKontekstem = detectIntent('Jak to wyglada?', { currentPageType: 'PRICE' }).intent;
  assert.equal(bez, 'GENERAL');
  assert.equal(zKontekstem, 'PRICE');
});
