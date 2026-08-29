/**
 * Profilowanie leada (sekcja 13 briefu).
 * Zasada: jedno pytanie naraz, nigdy ankieta. Ten modul tylko czyta sygnaly
 * z rozmowy i podpowiada, czego jeszcze brakuje - nie zadaje pytan sam.
 */
import { normalize } from '../knowledge/retrieval.js';

export const PROFILE_FIELDS = ['dlaKogo', 'jezyk', 'poziom', 'cel', 'tryb'];

export const emptyProfile = () => ({
  dlaKogo: null, jezyk: null, poziom: null, cel: null, tryb: null,
});

/**
 * Sygnaly zapisujemy jako rdzenie slow (polska fleksja): "cork" trafia w corka, corki, corce.
 * Rdzen jednowyrazowy dopasowuje sie do POCZATKU slowa, wiec "syn" nie zlapie "synonimu";
 * fraza wielowyrazowa dopasowuje sie jako ciag znakow.
 */
const MATCHERS = {
  dlaKogo: [
    { value: 'dziecko', words: ['dzieck', 'dzieci', 'cork', 'synek', 'syna', 'przedszkol', 'lat 6', 'lat 7', 'lat 8', 'lat 9', 'lat 10', '6 lat', '7 lat', '8 lat', '9 lat', '10 lat'] },
    { value: 'nastolatek', words: ['nastolat', 'liceum', 'gimnazj', 'szkola srednia', 'matur', '14 lat', '15 lat', '16 lat', '17 lat'] },
    { value: 'firma', words: ['dla firm', 'pracownik', 'zespol', 'b2b', 'szkolenie dla firmy', 'faktur'] },
    { value: 'dorosly', words: ['dla mnie', 'dla siebie', 'dorosl', 'po pracy', 'pracuje'] },
  ],
  jezyk: [
    { value: 'angielski', words: ['angielsk', 'english', 'ang.'] },
    { value: 'hiszpanski', words: ['hiszpansk', 'espanol', 'hiszp'] },
  ],
  poziom: [
    { value: 'poczatkujacy', words: ['od zera', 'poczatkujac', 'nie znam', 'podstaw', 'a1', 'a2'] },
    { value: 'sredni', words: ['sredni', 'komunikatywn', 'b1', 'b2', 'srednio zaawansowan'] },
    { value: 'zaawansowany', words: ['zaawansowan', 'c1', 'c2', 'plynnie'] },
  ],
  cel: [
    { value: 'egzamin', words: ['egzamin', 'fce', 'cae', 'ielts', 'toefl', 'matur', 'certyfikat'] },
    { value: 'praca', words: ['prac', 'zawodow', 'kariera', 'awans', 'biznesow'] },
    { value: 'rozmowa kwalifikacyjna', words: ['rozmowa kwalifikacyjna', 'rekrutacj', 'interview'] },
    { value: 'wyjazd', words: ['wyjazd', 'wakacj', 'podroz', 'emigracj', 'za granice'] },
    { value: 'szkola', words: ['ocen', 'sprawdzian', 'nadrobic', 'zaleglosci w szkole'] },
    { value: 'hobby', words: ['hobby', 'dla przyjemnosci'] },
  ],
  tryb: [
    { value: 'grupa', words: ['grup'] },
    { value: 'indywidualnie', words: ['indywidualn', 'jeden na jeden', 'prywatne lekcje', '1 na 1'] },
    { value: 'online', words: ['online', 'zdalnie', 'przez internet'] },
    { value: 'stacjonarnie', words: ['stacjonarn', 'na miejscu', 'w poznaniu'] },
  ],
};

/** Rdzen jednowyrazowy dopasowujemy do poczatku slowa, fraze - jako ciag znakow. */
function matches(tokens, text, stem) {
  const needle = normalize(stem);
  if (needle.includes(' ')) return text.includes(needle);
  return tokens.some((token) => token.startsWith(needle));
}

/** Wyciaga sygnaly profilu z pojedynczej wiadomosci uzytkownika. */
export function extractProfileSignals(message) {
  const text = normalize(message);
  const tokens = text.split(' ').filter(Boolean);
  const found = {};
  for (const [field, matchers] of Object.entries(MATCHERS)) {
    for (const matcher of matchers) {
      if (matcher.words.some((word) => matches(tokens, text, word))) {
        found[field] = matcher.value;
        break;
      }
    }
  }
  return found;
}

/** Scala nowe sygnaly z dotychczasowym profilem (nowsza informacja nadpisuje starsza). */
export function mergeProfile(profile, signals) {
  const merged = { ...emptyProfile(), ...profile };
  for (const [field, value] of Object.entries(signals)) {
    if (PROFILE_FIELDS.includes(field) && value) merged[field] = value;
  }
  return merged;
}

export const missingFields = (profile) =>
  PROFILE_FIELDS.filter((field) => !profile?.[field]);

export const isProfileComplete = (profile) => missingFields(profile).length === 0;

/**
 * Etap rozmowy - uzywany przez CTA Engine (sekcja 30 briefu).
 * eksploracja -> dopasowanie -> decyzja -> kontakt
 */
export function conversationStage(profile, { turns = 0, intent = 'GENERAL' } = {}) {
  if (['TRIAL_LESSON', 'LEVEL_TEST', 'CONTACT'].includes(intent)) return 'decyzja';
  const known = PROFILE_FIELDS.filter((field) => profile?.[field]).length;
  if (known >= 4) return 'decyzja';
  if (known >= 2 || turns >= 3) return 'dopasowanie';
  return 'eksploracja';
}

/** Nastepne, pojedyncze pytanie profilujace - nigdy nie zwraca listy. */
export function nextProfileQuestion(profile) {
  const order = ['dlaKogo', 'jezyk', 'poziom', 'cel', 'tryb'];
  const field = order.find((item) => !profile?.[item]);
  if (!field) return null;
  return {
    field,
    hint: {
      dlaKogo: 'dla kogo szukamy kursu (dziecko, nastolatek, osoba dorosla, firma)',
      jezyk: 'ktory jezyk interesuje uzytkownika (angielski czy hiszpanski)',
      poziom: 'jaki jest obecny poziom lub czy byl wczesniejszy kontakt z jezykiem',
      cel: 'po co uczy sie jezyka (egzamin, praca, wyjazd, szkola, hobby)',
      tryb: 'czy woli grupe czy zajecia indywidualne, online czy stacjonarnie',
    }[field],
  };
}
