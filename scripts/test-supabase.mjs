/**
 * Sprawdzenie polaczenia z Supabase i wszystkich trzech funkcji z sql/001-emmbotek.sql.
 *
 * Uruchomienie:
 *   node --env-file=.env scripts/test-supabase.mjs
 *
 * Skrypt zapisuje dane testowe (luka o kluczu "__test__", licznik CTA na sciezce
 * "/__test__", okno limitu na kluczu testowym), a na koniec je po sobie sprzata.
 * Klucza service_role nigdzie nie wypisuje.
 */
import config from '../src/config.js';
import { createSupabaseStore, hashKey } from '../src/storage/supabase.js';

const store = createSupabaseStore();

if (!store.skonfigurowany) {
  console.error('Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Uzupelnij .env i uruchom: node --env-file=.env scripts/test-supabase.mjs');
  process.exit(1);
}

console.log(`Projekt: ${config.supabase.url}`);
console.log('Klucz service_role: wczytany ze zmiennej srodowiskowej (nie pokazuje go)');

const KLUCZ_TESTOWY = '__test__ emmbotek sprawdzenie polaczenia';
const IP_TESTOWE = '203.0.113.7';   // adres zarezerwowany na dokumentacje, nie istnieje w sieci
let bledow = 0;

const krok = async (nazwa, praca) => {
  const start = Date.now();
  try {
    const wynik = await praca();
    console.log(`  OK   ${nazwa} (${Date.now() - start} ms)${wynik ? ` -> ${wynik}` : ''}`);
    return true;
  } catch (error) {
    bledow += 1;
    console.log(`  BLAD ${nazwa} -> ${error.message}`);
    return false;
  }
};

console.log('\nSprawdzam funkcje bazy:');

await krok('emmbotek_zapisz_luke', async () => {
  await store.zapiszLuke({ klucz: KLUCZ_TESTOWY, pytanie: 'Pytanie testowe z skryptu sprawdzajacego', intencja: 'GENERAL', wynik: 0.01 });
  return 'luka zapisana';
});

await krok('emmbotek_zapisz_cta', async () => {
  const liczba = await store.zapiszCta([
    { event: 'cta_impression', ctaType: 'VIEW_PRICE', sourceIntent: 'PRICE', conversationStage: 'decyzja', currentPage: '/__test__' },
    { event: 'cta_click', ctaType: 'VIEW_PRICE', sourceIntent: 'PRICE', conversationStage: 'decyzja', currentPage: '/__test__' },
  ]);
  return `zapisanych wierszy: ${liczba}`;
});

await krok('emmbotek_sprawdz_limit (pierwsze zapytanie)', async () => {
  const wynik = await store.sprawdzLimit(IP_TESTOWE, 60000, 3);
  if (!wynik.allowed) throw new Error('pierwsze zapytanie nie powinno byc zablokowane');
  return `dozwolone, pozostalo ${wynik.remaining}`;
});

await krok('emmbotek_sprawdz_limit (przekroczenie okna)', async () => {
  for (let i = 0; i < 3; i += 1) await store.sprawdzLimit(IP_TESTOWE, 60000, 3);
  const wynik = await store.sprawdzLimit(IP_TESTOWE, 60000, 3);
  if (wynik.allowed) throw new Error('limit powinien juz odmowic');
  if (wynik.retryAfterMs <= 0) throw new Error('brak czasu do odblokowania');
  return `zablokowane, ponow za ${Math.round(wynik.retryAfterMs / 1000)} s`;
});

console.log('\nSprzatanie danych testowych:');

const usun = async (tabela, filtr) => {
  const odpowiedz = await fetch(`${config.supabase.url.replace(/\/+$/, '')}/rest/v1/${tabela}?${filtr}`, {
    method: 'DELETE',
    headers: {
      apikey: config.supabase.serviceKey,
      authorization: `Bearer ${config.supabase.serviceKey}`,
      prefer: 'return=minimal',
    },
  });
  if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`);
};

await krok('usuniecie luki testowej', () => usun('emmbotek_luki', `klucz=eq.${encodeURIComponent(KLUCZ_TESTOWY)}`));
await krok('usuniecie licznikow testowych', () => usun('emmbotek_cta', 'sciezka=eq.%2F__test__'));
await krok('usuniecie okna limitu', () => usun('emmbotek_limity', `klucz=eq.${hashKey(IP_TESTOWE)}`));

console.log('');
if (bledow) {
  console.error(`Zakonczone z ${bledow} problemami. Sprawdz, czy sql/001-emmbotek.sql zostal wykonany w tym projekcie.`);
  process.exit(1);
}
console.log('Wszystko dziala: tabele, funkcje i uprawnienia sa na miejscu.');
