/**
 * Przeglad luk wiedzy: o co ludzie pytaja Emmbotka, a czego nie ma na stronie.
 *
 * To jest wlasciwy produkt calej warstwy telemetrii. Sama tabela w Supabase nikomu nie
 * sluzy - dopiero ta lista mowi wlascicielowi szkoly, co dopisac na stronie.
 *
 * Uruchomienie:
 *   node --env-file=.env scripts/luki.mjs              # od 2 wystapien, tylko nowe
 *   node --env-file=.env scripts/luki.mjs --od 1       # wszystko, nawet pojedyncze
 *   node --env-file=.env scripts/luki.mjs --wszystkie  # razem z juz uzupelnionymi
 */
import config from '../src/config.js';

if (!config.supabase.url || !config.supabase.serviceKey) {
  console.error('Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w srodowisku.');
  process.exit(1);
}

const argumenty = process.argv.slice(2);
const wartosc = (nazwa, domyslna) => {
  const i = argumenty.indexOf(nazwa);
  return i === -1 ? domyslna : argumenty[i + 1];
};
const minimum = Number(wartosc('--od', 2));
const wszystkie = argumenty.includes('--wszystkie');

const zapytanie = new URLSearchParams({
  select: 'pytanie,liczba,intencje,najlepszy_wynik,pierwszy_raz,ostatni_raz,status',
  liczba: `gte.${minimum}`,
  order: 'liczba.desc,ostatni_raz.desc',
  limit: '50',
});
if (!wszystkie) zapytanie.set('status', 'eq.nowa');

const odpowiedz = await fetch(
  `${config.supabase.url.replace(/\/+$/, '')}/rest/v1/emmbotek_luki?${zapytanie}`,
  {
    headers: {
      apikey: config.supabase.serviceKey,
      authorization: `Bearer ${config.supabase.serviceKey}`,
    },
  },
);

if (!odpowiedz.ok) {
  console.error(`Nie udalo sie odczytac luk: HTTP ${odpowiedz.status}`);
  console.error(await odpowiedz.text().catch(() => ''));
  console.error('Czy sql/001-emmbotek.sql zostal wykonany w tym projekcie?');
  process.exit(1);
}

const luki = await odpowiedz.json();

if (!luki.length) {
  console.log(`Brak luk o czestotliwosci >= ${minimum}${wszystkie ? '' : ' i statusie "nowa"'}.`);
  console.log('To dobra wiadomosc: strona pokrywa to, o co pytaja ludzie.');
  process.exit(0);
}

const data = (iso) => String(iso ?? '').slice(0, 10);

console.log(`Luki wiedzy (${luki.length}), od ${minimum} wystapien:\n`);
for (const luka of luki) {
  const intencje = (luka.intencje ?? []).join(', ') || 'GENERAL';
  console.log(`${String(luka.liczba).padStart(4)} x  ${luka.pytanie}`);
  console.log(`        intencje: ${intencje} | od ${data(luka.pierwszy_raz)} do ${data(luka.ostatni_raz)} | status: ${luka.status}`);
}

console.log('\nPo uzupelnieniu tresci na stronie oznacz temat jako zamkniety:');
console.log("  update public.emmbotek_luki set status = 'uzupelniona' where klucz = '...';");
