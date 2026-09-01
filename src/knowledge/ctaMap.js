/**
 * Dynamiczna mapa CTA (sekcja 23 briefu): intent -> najlepszy aktualny URL.
 * Budowana podczas indeksowania strony, a nie wpisywana na sztywno w widget.
 * Gdy adres na stronie sie zmieni, mapa aktualizuje sie przy najblizszej synchronizacji.
 */
import { activeDocuments } from './store.js';
import { documentDate } from './freshness.js';
import { normalize } from './retrieval.js';

/** Sygnaly URL/tytul -> cel CTA. Kolejnosc ma znaczenie (pierwsze trafienie wygrywa). */
const TARGET_RULES = [
  { target: 'COURSE_CHILDREN', patterns: ['dla-dzieci', 'kursy-dla-dzieci', 'angielski-dla-dzieci', 'dzieci'] },
  { target: 'COURSE_TEENS', patterns: ['mlodziez', 'dla-mlodziezy', 'nastolat'] },
  { target: 'COURSE_ADULTS', patterns: ['dla-doroslych', 'doros'] },
  { target: 'COMPANY', patterns: ['dla-firm', 'biznesow', 'business', 'firmy'] },
  { target: 'EXAM', patterns: ['egzamin', 'fce', 'cae', 'ielts', 'toefl', 'certyfikat'] },
  { target: 'PRICE', patterns: ['cennik', 'ceny', 'oplaty'] },
  { target: 'SCHEDULE', patterns: ['harmonogram', 'terminy', 'grafik', 'plan-zajec'] },
  { target: 'CONTACT', patterns: ['kontakt', 'sekretariat'] },
  { target: 'TRIAL_LESSON', patterns: ['lekcja-probna', 'zajecia-probne', 'bezplatna-lekcja'] },
  { target: 'LEVEL_TEST', patterns: ['test-poziomujacy', 'poziomujacy', 'test-poziomu'] },
  { target: 'NEWS', patterns: ['aktualnosci', 'news'] },
  { target: 'BLOG', patterns: ['blog', 'artykul', 'porady'] },
  { target: 'OFFER', patterns: ['oferta', 'kursy', 'zajecia'] },
  { target: 'METHOD', patterns: ['metoda', 'jak-uczymy', 'metodyka'] },
  { target: 'LOCATION', patterns: ['dojazd', 'lokalizacja', 'gdzie-jestesmy'] },
  { target: 'REGULATION', patterns: ['regulamin', 'polityka-prywatnosci', 'rodo'] },
  { target: 'TEAM', patterns: ['kadra', 'lektorzy', 'zespol', 'o-nas'] },
];

const TYPE_TO_TARGET = {
  PRICE: 'PRICE',
  CONTACT: 'CONTACT',
  NEWS: 'NEWS',
  BLOG: 'BLOG',
  EXAM: 'EXAM',
  REGULATION: 'REGULATION',
  TEAM: 'TEAM',
  METHOD: 'METHOD',
  COURSE: 'OFFER',
};

/** Czy dokument jest wpisem blogowym (a nie sama lista wpisow pod /blog). */
function czyWpisBlogowy(doc) {
  if (doc.sourceType === 'BLOG') return true;
  const sciezka = String(doc.sourceUrl ?? '').replace(/https?:\/\/[^/]+/, '');
  return /^\/blog\/.+/.test(sciezka);
}

function targetsFor(doc) {
  /*
     Wpis blogowy moze byc celem WYLACZNIE dla CTA typu BLOG.

     Bez tego ograniczenia artykul przejmowal cele ofertowe, bo punktacja nizej
     premiuje swiezosc: strona /oferta ma glebokosc 1 (wynik 9), a swiezy wpis
     /blog/cos-tam glebokosc 2, ale z premia za date dochodzi do 11. Zmierzone
     na zywym kanale: cztery z trzynastu celow prowadzily do artykulow -
     przycisk "Poznaj oferte dla doroslych" otwieral wpis o hiszpanskim.

     Regula "blog nie nadpisuje oferty, cennika ani regulaminu" istniala dotad
     tylko w System Prompcie, czyli obowiazywala model, ale nie mape adresow.
     Tutaj jest jej egzekwowanie.
  */
  if (czyWpisBlogowy(doc)) return ['BLOG'];

  const haystack = normalize(`${doc.sourceUrl ?? ''} ${doc.sourceTitle ?? ''}`);
  const found = new Set();
  for (const rule of TARGET_RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) found.add(rule.target);
  }
  const byType = TYPE_TO_TARGET[doc.sourceType];
  if (byType) found.add(byType);
  return [...found];
}

/**
 * Buduje mape celow CTA na podstawie zaindeksowanych dokumentow.
 * Dla kazdego celu wybiera najlepszy (najbardziej trafny i najswiezszy) URL.
 */
export function buildCtaMap(base, { now = Date.now() } = {}) {
  const candidates = new Map();

  for (const doc of activeDocuments(base)) {
    if (!doc.sourceUrl) continue;
    const depth = (doc.sourceUrl.replace(/https?:\/\/[^/]+/, '').match(/\//g) ?? []).length;
    const date = documentDate(doc) ?? 0;

    for (const target of targetsFor(doc)) {
      const score = 10 - depth + (date ? Math.min(3, (date - (now - 3.15e10)) / 1e10) : 0);
      const current = candidates.get(target);
      if (!current || score > current.score) {
        candidates.set(target, {
          score,
          url: doc.sourceUrl,
          title: doc.sourceTitle,
          sourceType: doc.sourceType,
          anchors: doc.anchors ?? [],
        });
      }
    }
  }

  const map = {};
  for (const [target, value] of candidates) {
    map[target] = { url: value.url, title: value.title, sourceType: value.sourceType, anchors: value.anchors };
  }
  return map;
}

/** Zwraca URL dla celu CTA; opcjonalnie dokleja kotwice do sekcji (sekcja 24 briefu). */
export function ctaUrl(ctaMap, target, { anchor = null } = {}) {
  const entry = ctaMap?.[target];
  if (!entry?.url) return null;
  if (!anchor) return entry.url;
  const known = (entry.anchors ?? []).find((item) => normalize(item.id).includes(normalize(anchor)));
  return known ? `${entry.url}#${known.id}` : `${entry.url}#${anchor}`;
}
