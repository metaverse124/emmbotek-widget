import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCtas, sanitizeModelCtas, wantsAction } from '../src/agent/ctaEngine.js';

const ctaMap = {
  OFFER: { url: 'https://emmastudio.pl/oferta/', anchors: [] },
  PRICE: { url: 'https://emmastudio.pl/cennik/', anchors: [{ id: 'dorosli', text: 'Dorosli' }] },
  COURSE_CHILDREN: { url: 'https://emmastudio.pl/kursy-dla-dzieci/', anchors: [] },
  CONTACT: { url: 'https://emmastudio.pl/kontakt/', anchors: [{ id: 'lekcja-probna', text: 'Lekcja probna' }] },
  BLOG: { url: 'https://emmastudio.pl/blog/', anchors: [] },
};

test('pytanie o cene daje jedno trafne CTA', () => {
  const cta = buildCtas({ message: 'Ile kosztuje kurs?', intent: 'PRICE', ctaMap });
  assert.equal(cta.length, 1);
  assert.equal(cta[0].type, 'VIEW_PRICE');
  assert.equal(cta[0].target, 'https://emmastudio.pl/cennik/');
});

test('pytanie czysto jezykowe nie generuje CTA sprzedazowego', () => {
  assert.deepEqual(buildCtas({ message: 'Co znaczy nevertheless?', intent: 'LANGUAGE_QUESTION', ctaMap }), []);
});

test('nigdy wiecej niz 2 CTA na wiadomosc', () => {
  const cta = buildCtas({
    message: 'Chce sie zapisac, ile kosztuje i kiedy sa zajecia?',
    intent: 'TRIAL_LESSON',
    profile: { dlaKogo: 'dziecko', jezyk: 'angielski', poziom: 'poczatkujacy', cel: 'szkola', tryb: 'grupa' },
    ctaMap,
  });
  assert.ok(cta.length <= 2, `oczekiwano max 2 CTA, otrzymano ${cta.length}`);
});

test('brak aktualnego celu = brak CTA (bramka 4)', () => {
  const cta = buildCtas({ message: 'Ile kosztuje kurs?', intent: 'PRICE', ctaMap: {} });
  assert.deepEqual(cta, []);
});

test('CTA nie prowadzi na strone, na ktorej uzytkownik juz jest', () => {
  const cta = buildCtas({
    message: 'Ile kosztuje?', intent: 'PRICE', ctaMap,
    currentUrl: 'https://emmastudio.pl/cennik/',
  });
  assert.ok(cta.every((item) => !item.target.startsWith('https://emmastudio.pl/cennik/')));
});

test('CTA do bloga wskazuje konkretny artykul uzyty w odpowiedzi', () => {
  const cta = buildCtas({
    message: 'Chce przeczytac wiecej o phrasal verbs, zapisac sie',
    intent: 'BLOG',
    ctaMap,
    knowledge: [{ sourceType: 'BLOG', sourceUrl: 'https://emmastudio.pl/blog/phrasal-verbs/', anchor: null }],
  });
  assert.equal(cta[0].type, 'VIEW_BLOG');
  assert.equal(cta[0].target, 'https://emmastudio.pl/blog/phrasal-verbs/');
});

test('nowa aktualnosc daje CTA "Zobacz nowa grupe"', () => {
  const cta = buildCtas({
    message: 'Czy sa zapisy do nowej grupy?',
    intent: 'NEWS',
    ctaMap: { ...ctaMap, NEWS: { url: 'https://emmastudio.pl/aktualnosci/nowa-grupa-8-10/', anchors: [] } },
    knowledge: [{ sourceType: 'NEWS', sourceUrl: 'https://emmastudio.pl/aktualnosci/nowa-grupa-8-10/' }],
  });
  assert.equal(cta[0].type, 'VIEW_NEWS');
  assert.match(cta[0].target, /nowa-grupa/);
});

test('lekcja probna spada na kontakt z kotwica do sekcji', () => {
  const cta = buildCtas({ message: 'Chce umowic lekcje probna', intent: 'TRIAL_LESSON', ctaMap });
  assert.equal(cta[0].type, 'TRIAL_LESSON');
  assert.equal(cta[0].target, 'https://emmastudio.pl/kontakt/#lekcja-probna');
});

test('na etapie eksploracji bez sygnalu dzialania nie ma CTA', () => {
  assert.equal(wantsAction('Dzien dobry', 'GENERAL', 'eksploracja'), false);
  assert.deepEqual(buildCtas({ message: 'Dzien dobry', intent: 'GENERAL', ctaMap }), []);
});

test('CTA od modelu z lewym adresem jest podmieniane na adres z mapy', () => {
  const cta = sanitizeModelCtas(
    [{ type: 'VIEW_PRICE', label: 'Cennik', target: 'javascript:alert(1)' }],
    { ctaMap },
  );
  assert.equal(cta.length, 1);
  assert.equal(cta[0].target, 'https://emmastudio.pl/cennik/');
});

test('adres spoza mapy CTA nie przechodzi, nawet gdy jest poprawnym https', () => {
  // Blad modelu albo udana prompt injection nie moga zamienic zaufanego CTA w link phishingowy.
  const cta = sanitizeModelCtas(
    [{ type: 'VIEW_PRICE', label: 'Cennik', target: 'https://attacker.example/phish' }],
    { ctaMap },
  );
  assert.equal(cta.length, 1);
  assert.equal(cta[0].target, 'https://emmastudio.pl/cennik/', 'adres powinien zostac podmieniony na zaindeksowany');
});

test('wymyslona podstrona wlasnej domeny tez jest odrzucana', () => {
  const cta = sanitizeModelCtas(
    [{ type: 'VIEW_PRICE', label: 'Cennik', target: 'https://emmastudio.pl/promocja-ktorej-nie-ma/' }],
    { ctaMap },
  );
  assert.equal(cta[0].target, 'https://emmastudio.pl/cennik/');
});

test('gdy nie ma zadnego zaindeksowanego celu, CTA w ogole nie powstaje', () => {
  assert.deepEqual(
    sanitizeModelCtas([{ type: 'VIEW_PRICE', target: 'https://attacker.example/phish' }], { ctaMap: {} }),
    [],
  );
});

test('zaindeksowany adres z kotwica do sekcji przechodzi bez zmian', () => {
  const cta = sanitizeModelCtas(
    [{ type: 'VIEW_PRICE', label: 'Cennik', target: 'https://emmastudio.pl/cennik/#dorosli' }],
    { ctaMap },
  );
  assert.equal(cta[0].target, 'https://emmastudio.pl/cennik/#dorosli');
});

test('sciezka wzgledna znanego celu jest akceptowana', () => {
  const cta = sanitizeModelCtas([{ type: 'VIEW_PRICE', target: '/cennik/' }], { ctaMap });
  assert.equal(cta[0].target, '/cennik/');
});

test('CTA nieznanego typu jest odrzucane', () => {
  assert.deepEqual(sanitizeModelCtas([{ type: 'KUP_TERAZ', target: '/promo/' }], { ctaMap }), []);
});

test('model nie moze przemycic wiecej niz 2 CTA', () => {
  const cta = sanitizeModelCtas(
    ['VIEW_PRICE', 'CONTACT', 'VIEW_FULL_OFFER', 'LEVEL_TEST'].map((type) => ({ type, target: '/x/' })),
    { ctaMap },
  );
  assert.equal(cta.length, 2);
});
