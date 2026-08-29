/**
 * Swiadomosc aktualnosci (sekcje 7 i 9 briefu).
 * Rozstrzyga, czy dokument jest wazny "dzis", jak bardzo jest swiezy
 * i ktore ze sprzecznych zrodel ma pierwszenstwo.
 */
import config from '../config.js';
import { TIME_SENSITIVE_TYPES, authorityOf } from './types.js';

const DAY = 24 * 60 * 60 * 1000;

const toTime = (value) => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/** Najlepsza znana data dokumentu: updatedAt -> publishedAt -> indexedAt. */
export function documentDate(doc) {
  return toTime(doc.updatedAt) ?? toTime(doc.publishedAt) ?? toTime(doc.indexedAt) ?? null;
}

/** Czy dokument obowiazuje w danym momencie (validFrom / validUntil). */
export function isCurrentlyValid(doc, now = Date.now()) {
  if (doc.status !== 'active') return false;
  const from = toTime(doc.validFrom);
  const until = toTime(doc.validUntil);
  if (from !== null && now < from) return false;
  if (until !== null && now > until) return false;
  return true;
}

/**
 * Tresc terminowa (ceny, aktualnosci, wydarzenia) starsza niz staleAfterDays
 * nie moze byc podawana jako "aktualna oferta" - oznaczamy ja jako wymagajaca weryfikacji.
 */
export function isStale(doc, now = Date.now()) {
  if (!TIME_SENSITIVE_TYPES.has(doc.sourceType)) return false;
  const date = documentDate(doc);
  if (date === null) return true;
  return now - date > config.knowledge.staleAfterDays * DAY;
}

/** 0..1 - im swiezszy dokument, tym wyzej. Polowiczny zanik co 180 dni. */
export function recencyScore(doc, now = Date.now()) {
  const date = documentDate(doc);
  if (date === null) return 0.3;
  const ageDays = Math.max(0, (now - date) / DAY);
  return 1 / (1 + ageDays / 180);
}

/**
 * Rozstrzyga konflikt miedzy dwoma dokumentami.
 * Zwraca dokument o wyzszym priorytecie albo null, jesli konflikt jest nierozstrzygalny
 * (wtedy eMMa nie zgaduje i kieruje do sekretariatu - sekcja 7 briefu).
 */
export function resolveConflict(a, b, now = Date.now()) {
  const validA = isCurrentlyValid(a, now);
  const validB = isCurrentlyValid(b, now);
  if (validA !== validB) return validA ? a : b;

  const authorityA = authorityOf(a.sourceType);
  const authorityB = authorityOf(b.sourceType);
  if (authorityA !== authorityB) return authorityA < authorityB ? a : b;

  const dateA = documentDate(a);
  const dateB = documentDate(b);
  if (dateA !== null && dateB !== null && dateA !== dateB) return dateA > dateB ? a : b;
  if (dateA !== null && dateB === null) return a;
  if (dateB !== null && dateA === null) return b;

  return null;
}

/** Etykieta doklejana do kontekstu, zeby model wiedzial, jak traktowac dane. */
export function freshnessLabel(doc, now = Date.now()) {
  if (!isCurrentlyValid(doc, now)) return 'NIEAKTUALNE';
  if (isStale(doc, now)) return 'WYMAGA_WERYFIKACJI';
  return 'AKTUALNE';
}
