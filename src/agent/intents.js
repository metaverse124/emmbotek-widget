/**
 * Rozpoznawanie intencji (sekcja 12 briefu). Intencja nigdy nie jest pokazywana uzytkownikowi -
 * steruje retrievalem, wyborem CTA, prowadzeniem rozmowy i profilowaniem.
 */
import { normalize } from '../knowledge/retrieval.js';

const SIGNALS = [
  { intent: 'TRIAL_LESSON', weight: 3, words: ['lekcja probna', 'zajecia probne', 'probna lekcja', 'chce sprobowac', 'darmowa lekcja'] },
  { intent: 'LEVEL_TEST', weight: 3, words: ['test poziomujacy', 'jaki mam poziom', 'sprawdzic poziom', 'test poziomu'] },
  { intent: 'PRICE', weight: 3, words: ['cena', 'ile kosztuje', 'ile to kosztuje', 'cennik', 'koszt', 'oplata', 'ile placi', 'ile zaplace'] },
  { intent: 'SCHEDULE', weight: 3, words: ['harmonogram', 'kiedy sa zajecia', 'godziny', 'terminy', 'w soboty', 'grafik', 'kiedy start'] },
  { intent: 'CONTACT', weight: 3, words: ['kontakt', 'telefon', 'zadzwonic', 'napisac do', 'sekretariat', 'mail do'] },
  { intent: 'LOCATION', weight: 3, words: ['gdzie jestescie', 'adres', 'dojazd', 'jak trafic', 'lokalizacja'] },
  { intent: 'COMPANY', weight: 3, words: ['dla firm', 'szkolenie dla firmy', 'pracownikow', 'firmowy', 'b2b', 'faktura'] },
  { intent: 'CHILD', weight: 3, words: ['dla corki', 'dla syna', 'dla dziecka', 'moje dziecko', 'lat ma', 'przedszkolak', 'dla dzieci'] },
  { intent: 'EXAM', weight: 3, words: ['fce', 'cae', 'ielts', 'toefl', 'egzamin', 'matura', 'certyfikat'] },
  { intent: 'REGULATION', weight: 3, words: ['regulamin', 'rezygnacja', 'umowa', 'polityka prywatnosci', 'rodo'] },
  { intent: 'NEWS', weight: 2, words: ['nowa grupa', 'aktualnosci', 'nabor', 'zapisy', 'co nowego', 'nowosci'] },
  { intent: 'BLOG', weight: 2, words: ['artykul', 'blog', 'wpis', 'czytalem', 'poradnik'] },
  { intent: 'ADULT', weight: 2, words: ['dla mnie', 'dla siebie', 'dorosly', 'po pracy', 'dla doroslych'] },
  { intent: 'COURSE_SEARCH', weight: 2, words: ['kurs', 'zajecia', 'szukam', 'oferta', 'chcialbym sie uczyc', 'chcialabym sie uczyc', 'nauka angielskiego', 'nauka hiszpanskiego'] },
];

/** Pytania czysto jezykowe: "co znaczy...", "jak powiedziec...", "roznica miedzy". */
const LANGUAGE_PATTERNS = [
  /co znaczy/, /jak sie mowi/, /jak powiedziec/, /roznica miedzy/, /kiedy uzywamy/,
  /jak przetlumaczyc/, /odmiana/, /czas (present|past|future)/, /gramatyk/, /jak napisac po/,
];

/**
 * @returns {{intent: string, confidence: number, scores: Record<string, number>}}
 */
export function detectIntent(message, { history = [], currentPageType = null } = {}) {
  const text = normalize(message);
  const scores = {};

  const add = (intent, weight) => { scores[intent] = (scores[intent] ?? 0) + weight; };

  for (const signal of SIGNALS) {
    for (const word of signal.words) {
      if (text.includes(normalize(word))) add(signal.intent, signal.weight);
    }
  }

  if (LANGUAGE_PATTERNS.some((pattern) => pattern.test(text))) add('LANGUAGE_QUESTION', 4);

  // kontekst podstrony podbija powiazana intencje (sekcja 11 briefu)
  const pageBoost = { PRICE: 'PRICE', COURSE: 'COURSE_SEARCH', NEWS: 'NEWS', BLOG: 'BLOG', CONTACT: 'CONTACT', EXAM: 'EXAM' };
  if (currentPageType && pageBoost[currentPageType]) add(pageBoost[currentPageType], 1);

  // krotkie pytania kontekstowe ("a ile to kosztuje?") dziedzicza temat z historii
  if (text.split(' ').length <= 4 && history.length) {
    const last = [...history].reverse().find((turn) => turn.intent);
    if (last) add(last.intent, 1.5);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { intent: 'GENERAL', confidence: 0.2, scores };

  const [intent, score] = ranked[0];
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  return { intent, confidence: Number((score / total).toFixed(2)), scores };
}
