/**
 * Knowledge Gaps (sekcja 40 briefu).
 * Zapisujemy WYLACZNIE zanonimizowane, zagregowane pytania - bez danych osobowych,
 * bez sessionId, bez IP. Sluza wlascicielowi szkoly do uzupelniania tresci na stronie.
 */
import { normalize } from './retrieval.js';

const PII_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/g,                         // e-mail
  /(?:\+?\d[\s-]?){9,}/g,                             // telefon
  /\b\d{2}[-/]\d{2}[-/]\d{2,4}\b/g,                   // data urodzenia
];

/** Usuwa dane kontaktowe z pytania, zanim trafi do rejestru luk. */
export function anonymizeQuestion(question) {
  let text = String(question ?? '').slice(0, 200);
  for (const pattern of PII_PATTERNS) text = text.replace(pattern, '[usuniete]');
  return text.trim();
}

export const gapKey = (question) => normalize(question).split(' ').slice(0, 12).join(' ');

/**
 * Dopisuje pytanie do rejestru luk wiedzy (agregacja po znormalizowanym kluczu).
 * @param {Array} registry biezacy rejestr
 * @returns {Array} nowy rejestr posortowany malejaco po czestotliwosci
 */
export function recordGap(registry, question, { intent = 'GENERAL', now = new Date().toISOString(), topScore = 0 } = {}) {
  const anonymized = anonymizeQuestion(question);
  if (anonymized.length < 4) return registry;

  const key = gapKey(anonymized);
  const next = registry.map((entry) => ({ ...entry }));
  const existing = next.find((entry) => entry.key === key);

  if (existing) {
    existing.frequency += 1;
    existing.lastSeen = now;
    existing.intents = [...new Set([...(existing.intents ?? []), intent])];
    existing.bestScore = Math.max(existing.bestScore ?? 0, topScore);
  } else {
    next.push({
      key,
      question: anonymized,
      frequency: 1,
      firstSeen: now,
      lastSeen: now,
      intents: [intent],
      bestScore: topScore,
    });
  }

  next.sort((a, b) => b.frequency - a.frequency || (a.question < b.question ? -1 : 1));
  return next;
}

/** Luki warte uwagi wlasciciela: powtarzalne pytania bez pokrycia w bazie wiedzy. */
export const topGaps = (registry, { minFrequency = 3, limit = 20 } = {}) =>
  registry.filter((entry) => entry.frequency >= minFrequency).slice(0, limit);
