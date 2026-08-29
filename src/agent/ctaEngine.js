/**
 * Contextual CTA Engine (sekcje 18-32 briefu).
 *
 * CTA to nie staly element wiadomosci ani reklama - to most miedzy rozmowa a strona.
 * Decyzja przechodzi przez cztery bramki (sekcja 29):
 *   1. czy uzytkownik chce wykonac dzialanie,
 *   2. czy istnieje aktualny, wlasciwy cel,
 *   3. czy CTA realnie pomaga,
 *   4. czy istnieje wlasciwy URL lub akcja.
 * Domyslnie 0-2 CTA, preferowane jedno (sekcja 21).
 */
import { ctaUrl } from '../knowledge/ctaMap.js';
import { conversationStage } from './profile.js';

export const CTA_TYPES = [
  'VIEW_COURSE', 'VIEW_FULL_OFFER', 'VIEW_PRICE', 'VIEW_SCHEDULE', 'VIEW_NEWS', 'VIEW_BLOG',
  'VIEW_EXAM', 'VIEW_FOR_COMPANIES', 'VIEW_FOR_CHILDREN', 'VIEW_FOR_ADULTS',
  'TRIAL_LESSON', 'LEVEL_TEST', 'CONTACT', 'CALL', 'EMAIL', 'FORM', 'LOCATION',
];

/** Definicje CTA: etykieta, ikona, cel w mapie URL, akcja i etap rozmowy. */
const CATALOG = {
  VIEW_FULL_OFFER:    { label: 'Zobacz pelna oferte',            icon: '📚', target: 'OFFER',           action: 'url',   stage: ['eksploracja', 'dopasowanie'] },
  VIEW_COURSE:        { label: 'Zobacz szczegoly kursu',         icon: '📘', target: 'OFFER',           action: 'url',   stage: ['dopasowanie', 'decyzja'] },
  VIEW_FOR_CHILDREN:  { label: 'Poznaj oferte dla dzieci',       icon: '📚', target: 'COURSE_CHILDREN', action: 'url',   stage: ['eksploracja', 'dopasowanie'] },
  VIEW_FOR_ADULTS:    { label: 'Poznaj oferte dla doroslych',    icon: '📚', target: 'COURSE_ADULTS',   action: 'url',   stage: ['eksploracja', 'dopasowanie'] },
  VIEW_FOR_COMPANIES: { label: 'Zobacz oferte dla firm',         icon: '🏢', target: 'COMPANY',         action: 'url',   stage: ['eksploracja', 'dopasowanie'] },
  VIEW_PRICE:         { label: 'Zobacz aktualny cennik',         icon: '💰', target: 'PRICE',           action: 'url',   stage: ['dopasowanie', 'decyzja'] },
  VIEW_SCHEDULE:      { label: 'Sprawdz harmonogram',            icon: '🗓️', target: 'SCHEDULE',        action: 'url',   stage: ['dopasowanie', 'decyzja'] },
  VIEW_EXAM:          { label: 'Zobacz kursy egzaminacyjne',     icon: '🎓', target: 'EXAM',            action: 'url',   stage: ['dopasowanie', 'decyzja'] },
  VIEW_NEWS:          { label: 'Zobacz nowa grupe',              icon: '🆕', target: 'NEWS',            action: 'url',   stage: ['eksploracja', 'dopasowanie', 'decyzja'] },
  VIEW_BLOG:          { label: 'Przeczytaj caly artykul',        icon: '📖', target: 'BLOG',            action: 'url',   stage: ['eksploracja', 'dopasowanie'] },
  TRIAL_LESSON:       { label: 'Umow bezplatna lekcje probna',   icon: '✨', target: 'TRIAL_LESSON',    action: 'url',   stage: ['decyzja', 'kontakt'], fallbackTarget: 'CONTACT', fallbackAnchor: 'lekcja-probna' },
  LEVEL_TEST:         { label: 'Zrob test poziomujacy',          icon: '🧭', target: 'LEVEL_TEST',      action: 'url',   stage: ['dopasowanie', 'decyzja'] },
  CONTACT:            { label: 'Skontaktuj sie z sekretariatem', icon: '💬', target: 'CONTACT',         action: 'url',   stage: ['decyzja', 'kontakt'] },
  FORM:               { label: 'Wyslij formularz',               icon: '📝', target: 'CONTACT',         action: 'url',   stage: ['kontakt'] },
  CALL:               { label: 'Zadzwon do sekretariatu',        icon: '📞', target: 'CONTACT',         action: 'call',  stage: ['kontakt'] },
  EMAIL:              { label: 'Napisz e-mail',                  icon: '✉️', target: 'CONTACT',         action: 'email', stage: ['kontakt'] },
  LOCATION:           { label: 'Sprawdz dojazd',                 icon: '📍', target: 'LOCATION',        action: 'url',   stage: ['dopasowanie', 'decyzja'], fallbackTarget: 'CONTACT' },
};

/** Intencja -> kandydaci CTA w kolejnosci trafnosci. */
const INTENT_CANDIDATES = {
  PRICE: ['VIEW_PRICE', 'TRIAL_LESSON'],
  COURSE_SEARCH: ['VIEW_FULL_OFFER', 'TRIAL_LESSON'],
  CHILD: ['VIEW_FOR_CHILDREN', 'TRIAL_LESSON'],
  ADULT: ['VIEW_FOR_ADULTS', 'LEVEL_TEST'],
  COMPANY: ['VIEW_FOR_COMPANIES', 'CONTACT'],
  EXAM: ['VIEW_EXAM', 'LEVEL_TEST'],
  SCHEDULE: ['VIEW_SCHEDULE', 'CONTACT'],
  NEWS: ['VIEW_NEWS', 'TRIAL_LESSON'],
  BLOG: ['VIEW_BLOG'],
  TRIAL_LESSON: ['TRIAL_LESSON', 'CONTACT'],
  LEVEL_TEST: ['LEVEL_TEST', 'TRIAL_LESSON'],
  CONTACT: ['CONTACT', 'CALL'],
  LOCATION: ['LOCATION', 'CONTACT'],
  REGULATION: [],
  LANGUAGE_QUESTION: [],
  GENERAL: [],
};

/** Sekcja 28: pytanie czysto jezykowe nie generuje CTA sprzedazowego. */
const NO_CTA_INTENTS = new Set(['LANGUAGE_QUESTION', 'REGULATION']);

const ACTION_INTENT_HINTS = [
  'zapisac', 'zapisz', 'chce sie zapisac', 'umowic', 'probna', 'kiedy start', 'ile kosztuje',
  'cennik', 'kontakt', 'zadzwon', 'formularz', 'gdzie', 'harmonogram', 'zapisy', 'test poziom',
];

/** Bramka 1: czy uzytkownik zmierza do jakiegos dzialania. */
export function wantsAction(message, intent, stage) {
  if (NO_CTA_INTENTS.has(intent)) return false;
  const text = String(message ?? '').toLowerCase();
  if (ACTION_INTENT_HINTS.some((hint) => text.includes(hint))) return true;
  if (['PRICE', 'TRIAL_LESSON', 'LEVEL_TEST', 'CONTACT', 'SCHEDULE', 'LOCATION', 'NEWS'].includes(intent)) return true;
  return stage !== 'eksploracja';
}

/**
 * Buduje liste 0-2 CTA dla konkretnej odpowiedzi.
 *
 * @param {object} input
 * @param {string} input.message      wiadomosc uzytkownika
 * @param {string} input.intent       rozpoznana intencja
 * @param {object} input.profile      profil leada
 * @param {object} input.ctaMap       dynamiczna mapa intent -> URL (z indeksowania)
 * @param {Array}  input.knowledge    fragmenty uzyte w odpowiedzi (zrodla)
 * @param {string} input.currentUrl   adres podstrony uzytkownika
 * @param {number} input.turns        liczba tur rozmowy
 * @param {string[]} input.shown      typy CTA juz pokazane w tej rozmowie
 * @returns {Array<{type,label,action,target,icon}>}
 */
export function buildCtas(input) {
  const {
    message = '', intent = 'GENERAL', profile = {}, ctaMap = {}, knowledge = [],
    currentUrl = null, turns = 0, shown = [], contact = {},
  } = input;

  const stage = conversationStage(profile, { turns, intent });

  // BRAMKA 1: czy uzytkownik chce wykonac dzialanie
  if (!wantsAction(message, intent, stage)) return [];

  const candidates = [...(INTENT_CANDIDATES[intent] ?? [])];

  // profil podpowiada dodatkowa, rownie sensowna sciezke
  if (profile.dlaKogo === 'dziecko') candidates.push('VIEW_FOR_CHILDREN');
  if (profile.dlaKogo === 'dorosly') candidates.push('VIEW_FOR_ADULTS');
  if (profile.dlaKogo === 'firma') candidates.push('VIEW_FOR_COMPANIES');
  if (stage === 'decyzja') candidates.push('TRIAL_LESSON', 'CONTACT');

  // CTA do zrodla, ktore realnie zostalo uzyte w odpowiedzi (blog/aktualnosc)
  const blogSource = knowledge.find((item) => item.sourceType === 'BLOG');
  const newsSource = knowledge.find((item) => item.sourceType === 'NEWS');
  if (blogSource) candidates.push('VIEW_BLOG');
  if (newsSource) candidates.push('VIEW_NEWS');

  const seen = new Set();
  const result = [];

  for (const type of candidates) {
    if (result.length >= 2) break;
    if (seen.has(type)) continue;
    seen.add(type);

    const definition = CATALOG[type];
    if (!definition) continue;

    // BRAMKA 3: CTA ma pomagac - nie powtarzamy tego samego w kolko
    if (shown.filter((item) => item === type).length >= 2) continue;
    // nie proponuj etapu odleglego od biezacego
    if (!definition.stage.includes(stage) && result.length > 0) continue;

    // BRAMKA 2 i 4: musi istniec aktualny, wlasciwy cel
    let url = null;
    if (type === 'VIEW_BLOG' && blogSource?.sourceUrl) {
      url = blogSource.anchor ? `${blogSource.sourceUrl}#${blogSource.anchor}` : blogSource.sourceUrl;
    } else if (type === 'VIEW_NEWS' && newsSource?.sourceUrl) {
      url = newsSource.sourceUrl;
    } else {
      url = ctaUrl(ctaMap, definition.target);
      if (!url && definition.fallbackTarget) {
        url = ctaUrl(ctaMap, definition.fallbackTarget, { anchor: definition.fallbackAnchor });
      }
    }

    if (definition.action === 'call' && contact.phone) url = `tel:${contact.phone.replace(/\s/g, '')}`;
    if (definition.action === 'email' && contact.email) url = `mailto:${contact.email}`;

    if (!url) continue;
    // uzytkownik juz jest na tej stronie - CTA nic nie wnosi
    if (currentUrl && url.split('#')[0] === currentUrl.split('#')[0] && definition.action === 'url') continue;

    result.push({
      type,
      label: definition.label,
      icon: definition.icon,
      action: definition.action,
      target: url,
      stage,
    });
  }

  return result.slice(0, 2);
}

/** Waliduje i przycina CTA zaproponowane przez model (sekcja 32). */
export function sanitizeModelCtas(list, { ctaMap = {}, contact = {} } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (out.length >= 2) break;
    const type = String(item?.type ?? '').toUpperCase();
    if (!CTA_TYPES.includes(type)) continue;
    const definition = CATALOG[type];
    if (!definition) continue;

    let target = typeof item.target === 'string' ? item.target.trim() : '';
    const allowed = /^(\/|https?:\/\/|tel:|mailto:|#)/.test(target);
    if (!target || !allowed) {
      target = ctaUrl(ctaMap, definition.target)
        ?? (definition.fallbackTarget ? ctaUrl(ctaMap, definition.fallbackTarget, { anchor: definition.fallbackAnchor }) : null)
        ?? (definition.action === 'call' && contact.phone ? `tel:${contact.phone.replace(/\s/g, '')}` : null)
        ?? (definition.action === 'email' && contact.email ? `mailto:${contact.email}` : null);
    }
    if (!target) continue;

    out.push({
      type,
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 60) : definition.label,
      icon: definition.icon,
      action: definition.action,
      target,
    });
  }
  return out;
}

export const ctaCatalog = CATALOG;
