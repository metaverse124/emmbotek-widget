/**
 * Buduje paczke plikow widgetu do wgrania na wlasny serwer strony.
 *
 * DLACZEGO NIE SERWUJEMY TEGO Z VERCELA
 * Wystarczyloby wskazac skrypty na adres backendu i nie byloby czego kopiowac. Ale wtedy
 * KAZDY odwiedzajacy emmastudio.pl - takze ten, ktory nigdy nie otworzy czatu - wysylalby
 * swoj adres IP do zewnetrznej firmy przy samym wejsciu na strone. Strona celowo hostuje
 * u siebie nawet fonty, zeby tego uniknac (patrz komentarz przy fontach w index.html).
 *
 * Przy plikach widgetu na wlasnym serwerze do Vercela leci dopiero pierwsze pytanie
 * zadane Emmbotkowi - czyli wtedy, gdy uzytkownik sam o to poprosil.
 *
 * Uruchomienie:
 *   npm run paczka-widget
 *
 * Wynik trafia do dist-widget/ i jest gotowy do skopiowania do public/emmbotek/
 * w repozytorium strony.
 */
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KORZEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZRODLO = path.join(KORZEN, 'public');
const CEL = path.join(KORZEN, 'dist-widget');

// kursor-lapka.svg jest wskazywany ze srodka emma-widget.css adresem wzglednym,
// wiec musi lezec obok arkusza - inaczej klikalne elementy traca kursor.
const PLIKI = ['emma-widget.js', 'emma-widget.css', 'emmbotek-avatar.js', 'kursor-lapka.svg'];

await rm(CEL, { recursive: true, force: true });
await mkdir(path.join(CEL, 'avatars'), { recursive: true });

for (const plik of PLIKI) {
  await cp(path.join(ZRODLO, plik), path.join(CEL, plik));
}

// Manifest emocji i wylacznie wersja 192 px - tej uzywa widget. Wersje 512 px
// zostaja w repozytorium asystenta, na stronie tylko zajmowalyby miejsce.
await cp(path.join(ZRODLO, 'avatars', 'manifest.json'), path.join(CEL, 'avatars', 'manifest.json'));
await cp(path.join(ZRODLO, 'avatars', 'small'), path.join(CEL, 'avatars', 'small'), { recursive: true });

/** Sumuje rozmiar katalogu, zeby bylo wiadomo, co dokladamy do paczki strony. */
async function waga(katalog) {
  let suma = 0;
  for (const wpis of await readdir(katalog, { withFileTypes: true })) {
    const sciezka = path.join(katalog, wpis.name);
    suma += wpis.isDirectory() ? await waga(sciezka) : (await stat(sciezka)).size;
  }
  return suma;
}

const bajty = await waga(CEL);
const pozy = (await readdir(path.join(CEL, 'avatars', 'small'))).length;

console.log(`Paczka widgetu gotowa: ${CEL}`);
console.log(`  pliki: ${PLIKI.join(', ')} + avatars/manifest.json + ${pozy} poz (192 px)`);
console.log(`  rozmiar razem: ${Math.round(bajty / 1024)} kB`);
console.log('');
console.log('Skopiuj zawartosc do repozytorium strony:');
console.log('  emmastudiooo/public/emmbotek/');
console.log('');
console.log('Awatary sa doczytywane dopiero przy otwarciu czatu - wejscie na strone');
console.log('kosztuje tylko skrypt, styl i jedna poze na zakladce.');
