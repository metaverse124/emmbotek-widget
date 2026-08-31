import test from 'node:test';
import assert from 'node:assert/strict';

import { createKnowledgeProvider } from '../src/knowledge/provider.js';
import { emptyBase, makeDocument, mergeDocuments, activeDocuments } from '../src/knowledge/store.js';

const WPIS = (over = {}) => ({
  adres: 'https://emmastudio.pl/oferta',
  tytul: 'Oferta i cennik',
  typ: 'COURSE',
  naglowki: ['Oferta i cennik'],
  fragmenty: [{ naglowek: 'Cennik', kotwica: 'cennik', tekst: 'Kurs angielskiego w grupie 4-8 osob kosztuje 35 zl za 60 minut od osoby, a zajecia indywidualne 89 zl.' }],
  ...over,
});

const KANAL = (dokumenty) => JSON.stringify({ wersja: 1, domena: 'https://emmastudio.pl', dokumenty });

/** Zapasowa baza "z paczki" - jeden dokument o innej tresci, zeby bylo widac, ktora zadziala. */
const zPliku = async () => {
  const { base } = mergeDocuments(emptyBase(), [makeDocument({
    sourceUrl: 'https://emmastudio.pl/oferta',
    sourceTitle: 'Oferta (kopia z paczki)',
    sourceType: 'COURSE',
    content: 'Kopia zapasowa wgrana razem z aplikacja - tresc zastepcza na wypadek awarii strony.',
    chunks: [{ text: 'Kopia zapasowa wgrana razem z aplikacja - tresc zastepcza na wypadek awarii strony.' }],
  })]);
  return base;
};

test('wiedza pochodzi z kanalu strony, razem z mapa CTA', async () => {
  const provider = createKnowledgeProvider({
    fetchText: async () => KANAL([WPIS()]),
    loadFallback: zPliku,
  });
  const base = await provider.get();
  assert.equal(activeDocuments(base).length, 1);
  assert.ok(Object.keys(base.ctaMap).length > 0, 'mapa CTA buduje sie z kanalu');
  assert.equal(provider.status().source, 'kanal');
});

test('drugie zapytanie nie odpytuje strony ponownie', async () => {
  let pobran = 0;
  const provider = createKnowledgeProvider({
    fetchText: async () => { pobran += 1; return KANAL([WPIS()]); },
    loadFallback: zPliku,
    ttlMs: 60_000,
  });
  await provider.get();
  await provider.get();
  await provider.get();
  assert.equal(pobran, 1, 'kanal pobierany raz na okres waznosci');
});

test('rownolegle zapytania dziela jedno pobranie', async () => {
  let pobran = 0;
  const provider = createKnowledgeProvider({
    fetchText: async () => {
      pobran += 1;
      await new Promise((r) => setTimeout(r, 10));
      return KANAL([WPIS()]);
    },
    loadFallback: zPliku,
  });
  await Promise.all([provider.get(), provider.get(), provider.get(), provider.get()]);
  assert.equal(pobran, 1, 'nie dobijamy sie do strony czterema zapytaniami naraz');
});

test('gdy strona nie odpowiada, zostaje ostatnia dobra wiedza', async () => {
  let dzialaj = true;
  let zegar = 0;
  const provider = createKnowledgeProvider({
    fetchText: async () => {
      if (!dzialaj) throw new Error('HTTP 503');
      return KANAL([WPIS()]);
    },
    loadFallback: zPliku,
    ttlMs: 1000,
    now: () => zegar,
  });

  const pierwsza = await provider.get();
  assert.equal(activeDocuments(pierwsza)[0].sourceTitle, 'Oferta i cennik');

  dzialaj = false;
  zegar += 5000;                       // wiedza sie przeterminowala
  const druga = await provider.get();
  assert.equal(activeDocuments(druga)[0].sourceTitle, 'Oferta i cennik',
    'stara cena jest lepsza niz brak odpowiedzi');
  assert.match(provider.status().lastError, /503/);
});

test('gdy strona nie odpowiada przy pierwszym zapytaniu, ratuje kopia z paczki', async () => {
  const provider = createKnowledgeProvider({
    fetchText: async () => { throw new Error('HTTP 404'); },
    loadFallback: zPliku,
  });
  const base = await provider.get();
  assert.equal(activeDocuments(base)[0].sourceTitle, 'Oferta (kopia z paczki)');
  assert.equal(provider.status().source, 'plik');
});

test('pusty kanal traktujemy jak awarie, a nie jak pusta strone', async () => {
  const provider = createKnowledgeProvider({
    fetchText: async () => KANAL([]),
    loadFallback: zPliku,
  });
  const base = await provider.get();
  assert.equal(activeDocuments(base)[0].sourceTitle, 'Oferta (kopia z paczki)');
  assert.match(provider.status().lastError, /zadnego uzytecznego dokumentu/);
});

test('po nieudanej probie nie dobijamy sie do strony przy kazdym zapytaniu', async () => {
  let prob = 0;
  let zegar = 0;
  const provider = createKnowledgeProvider({
    fetchText: async () => { prob += 1; throw new Error('HTTP 503'); },
    loadFallback: zPliku,
    ttlMs: 1000,
    now: () => zegar,
  });

  await provider.get();
  zegar += 1000;
  await provider.get();
  assert.equal(prob, 1, 'kolejna proba dopiero po odczekaniu');

  zegar += 60_000;
  await provider.get();
  assert.equal(prob, 2);
});
