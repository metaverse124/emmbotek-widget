/**
 * Sprawdzenie wdrozonego backendu - wszystkie warstwy jednym przebiegiem.
 *
 * Uruchomienie:
 *   node scripts/test-wdrozenia.mjs https://emmbotek-widget.vercel.app
 *
 * Skrypt nie potrzebuje zadnych sekretow poza opcjonalnym SYNC_TOKEN do diagnostyki
 * wiedzy. Sprawdza to, co da sie sprawdzic z zewnatrz - dokladnie tak, jak zrobilby
 * to ktos postronny.
 */
const adres = (process.argv[2] || '').replace(/\/+$/, '');
if (!adres) {
  console.error('Podaj adres wdrozenia, np.:');
  console.error('  node scripts/test-wdrozenia.mjs https://emmbotek-widget.vercel.app');
  process.exit(1);
}

const DOMENA = process.env.SITE_ORIGIN || 'https://emmastudio.pl';
let bledow = 0;
let ostrzezen = 0;

const wynik = (stan, nazwa, szczegol = '') => {
  const znacznik = { ok: 'OK  ', blad: 'BLAD', uwaga: 'UWAGA' }[stan];
  if (stan === 'blad') bledow += 1;
  if (stan === 'uwaga') ostrzezen += 1;
  console.log(`  ${znacznik.padEnd(6)}${nazwa}${szczegol ? ' -> ' + szczegol : ''}`);
};

const pobierz = async (sciezka, opcje = {}) => {
  const start = Date.now();
  const r = await fetch(adres + sciezka, opcje);
  const tekst = await r.text();
  let dane = null;
  try { dane = JSON.parse(tekst); } catch { /* nie JSON - trudno */ }
  return { status: r.status, dane, tekst, ms: Date.now() - start };
};

console.log(`\nSprawdzam ${adres}\n`);

/* --------------------------------------------------------------- 1. strona */
console.log('1. Strona demo');
try {
  const r = await pobierz('/');
  if (r.status === 200 && /Emmbotek/i.test(r.tekst)) wynik('ok', 'adres glowny odpowiada', `${r.ms} ms`);
  else if (r.status === 404) wynik('blad', 'adres glowny daje 404', 'sprawdz outputDirectory w vercel.json');
  else wynik('uwaga', 'adres glowny', `status ${r.status}`);
} catch (e) { wynik('blad', 'adres glowny nieosiagalny', e.message); }

/* ---------------------------------------------------------------- 2. token */
console.log('\n2. Token wstepu');
let token = null;
try {
  const r = await pobierz('/api/token', { headers: { origin: DOMENA } });
  if (r.status !== 200) {
    wynik('blad', 'endpoint tokenu', `status ${r.status}`);
  } else if (r.dane?.wymagany === false) {
    wynik('uwaga', 'ochrona WYLACZONA', 'brak TOKEN_SECRET w zmiennych srodowiskowych');
  } else if (r.dane?.token) {
    token = r.dane.token;
    wynik('ok', 'token wystawiony', `${token.length} znakow, wazny do ${new Date(r.dane.expiresAt).toLocaleTimeString('pl-PL')}`);
  } else {
    wynik('blad', 'endpoint tokenu nie oddal podpisu');
  }
} catch (e) { wynik('blad', 'endpoint tokenu nieosiagalny', e.message); }

/* ------------------------------------------------------------ 3. allowlista */
console.log('\n3. Ochrona przed naduzyciem');
const zapytanie = (naglowki) => pobierz('/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...naglowki },
  body: JSON.stringify({ message: 'Ile kosztuje kurs angielskiego w grupie?', history: [] }),
});

try {
  const bez = await zapytanie({ origin: DOMENA });
  if (bez.status === 401) wynik('ok', 'skrypt bez tokenu odrzucony', '401');
  else if (!token) wynik('uwaga', 'brak tokenu, wiec brak ochrony', `status ${bez.status}`);
  else wynik('blad', 'zapytanie bez tokenu PRZESZLO', `status ${bez.status}`);

  const obca = await zapytanie({ origin: 'https://zlodziej-limitu.example', ...(token ? { 'x-emmbotek-token': token } : {}) });
  if (obca.status === 403 || obca.status === 401) wynik('ok', 'obca domena odrzucona', String(obca.status));
  else wynik('blad', 'obca domena PRZESZLA', `status ${obca.status} - sprawdz ALLOWED_ORIGINS`);
} catch (e) { wynik('blad', 'sprawdzenie ochrony nieudane', e.message); }

/* ----------------------------------------------------------- 4. rozmowa */
console.log('\n4. Prawdziwa rozmowa');
try {
  const r = await zapytanie(token ? { origin: DOMENA, 'x-emmbotek-token': token } : { origin: DOMENA });
  if (r.status !== 200) {
    wynik('blad', 'rozmowa', `status ${r.status} ${r.dane?.error ?? ''}`);
  } else if (r.dane?.meta?.budzetWyczerpany) {
    wynik('uwaga', 'dzienny budzet juz wyczerpany', 'zwieksz DAILY_BUDGET albo poczekaj do jutra');
  } else if (/nie mog|sekretariatu/i.test(r.dane?.message ?? '') && !/\d+\s*z[lł]/i.test(r.dane?.message ?? '')) {
    wynik('blad', 'model nie odpowiedzial', 'najczesciej brak albo zly GEMINI_API_KEY');
  } else {
    const zCena = /\d+\s*z[lł]/i.test(r.dane.message);
    wynik(zCena ? 'ok' : 'uwaga', 'odpowiedz z modelu', `${r.ms} ms${zCena ? ', z cena' : ', BEZ ceny - wiedza nie dotarla'}`);
    console.log(`         "${r.dane.message.slice(0, 110)}..."`);
  }
} catch (e) { wynik('blad', 'rozmowa nieudana', e.message); }

/* -------------------------------------------------------------- 5. wiedza */
console.log('\n5. Zrodlo wiedzy');
const sekret = process.env.SYNC_TOKEN;
if (!sekret) {
  console.log('  (pomijam - ustaw SYNC_TOKEN, zeby sprawdzic)');
} else {
  try {
    const r = await pobierz('/api/sync', { method: 'POST', headers: { 'x-sync-token': sekret } });
    if (r.status !== 200) wynik('blad', 'diagnostyka wiedzy', `status ${r.status}`);
    else if (r.dane.source === 'kanal') wynik('ok', 'wiedza z kanalu strony', `${r.dane.documents} dokumentow, ${r.dane.ctaTargets} celow CTA`);
    else wynik('uwaga', 'wiedza z kopii zapasowej', r.dane.error || 'strona nie oddala /wiedza.json');
  } catch (e) { wynik('blad', 'diagnostyka nieudana', e.message); }
}

console.log('\n' + '='.repeat(60));
if (bledow) console.log(`Bledow: ${bledow}, ostrzezen: ${ostrzezen}. Wdrozenie NIE jest gotowe.`);
else if (ostrzezen) console.log(`Bledow brak, ostrzezen: ${ostrzezen}. Dziala, ale nie w pelni.`);
else console.log('Wszystko dziala. Backend gotowy do wpiecia w strone.');
console.log('');
process.exit(bledow ? 1 : 0);
