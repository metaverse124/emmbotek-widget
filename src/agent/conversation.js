/**
 * Pamiec rozmowy (sekcja 34 briefu).
 * Serwer jest bezstanowy - historie przysyla przegladarka (localStorage),
 * a tutaj jest walidowana, przycinana i streszczana.
 */
import config from '../config.js';

export const CONVERSATION_VERSION = 1;

export const emptyConversation = () => ({
  v: CONVERSATION_VERSION,
  sessionId: null,
  firstSeen: null,
  lastSeen: null,
  lead: { imie: null, email: null, telefon: null, zgoda: false },
  profil: { dlaKogo: null, jezyk: null, poziom: null, cel: null, tryb: null },
  messages: [],
});

const ROLES = new Set(['user', 'model']);

/** Odsiewa smieci z historii przyslanej przez klienta. */
export function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && ROLES.has(turn.role) && typeof turn.text === 'string')
    .map((turn) => ({
      role: turn.role,
      text: turn.text.slice(0, config.limits.maxMessageChars * 2),
      intent: typeof turn.intent === 'string' ? turn.intent : undefined,
      at: typeof turn.at === 'string' ? turn.at : undefined,
    }));
}

/**
 * Przycina historie do ostatnich N tur i buduje krotkie podsumowanie starszego kontekstu.
 * @returns {{turns: Array, summary: string|null, dropped: number}}
 */
export function trimHistory(history, { maxTurns = config.limits.maxHistoryTurns } = {}) {
  const clean = sanitizeHistory(history);
  if (clean.length <= maxTurns * 2) return { turns: clean, summary: null, dropped: 0 };

  const keep = clean.slice(-maxTurns * 2);
  const older = clean.slice(0, clean.length - keep.length);
  const topics = [...new Set(older.filter((turn) => turn.intent).map((turn) => turn.intent))];
  const userLines = older.filter((turn) => turn.role === 'user').slice(-4).map((turn) => `- ${turn.text.slice(0, 120)}`);

  const summary = [
    topics.length ? `Wczesniejsze watki: ${topics.join(', ')}.` : null,
    userLines.length ? `Co pisal uzytkownik:\n${userLines.join('\n')}` : null,
  ].filter(Boolean).join('\n');

  return { turns: keep, summary: summary || null, dropped: older.length };
}

/** Zamienia historie na format contents Gemini. */
export const toGeminiContents = (turns, message) => [
  ...turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
  { role: 'user', parts: [{ text: message }] },
];

/** Liczba pelnych tur rozmowy (para user+model). */
export const countTurns = (history) =>
  Math.floor(sanitizeHistory(history).filter((turn) => turn.role === 'user').length);
