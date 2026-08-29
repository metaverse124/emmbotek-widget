/**
 * System emocji awatara Emmbotek (sekcja 16 briefu).
 * Kazda wiadomosc eMMy zaczyna sie dokladnie jednym tagiem, ktory przed
 * wyswietleniem jest usuwany z tekstu i zamieniany na animacje maskotki.
 */
export const EMOTIONS = [
  'SMILE', 'GREETING', 'THINKING', 'EXCITED', 'FUNNY', 'NEUTRAL',
  'EMPATHY', 'CURIOUS', 'SURPRISED', 'PROUD', 'FOCUS', 'SHY',
];

export const DEFAULT_EMOTION = 'NEUTRAL';
export const PENDING_EMOTION = 'THINKING';

const TAG_PATTERN = /^\s*\[([A-Z_]{3,12})\]\s*/;

export const isEmotion = (value) => EMOTIONS.includes(value);

/**
 * Wyciaga tag emocji z poczatku odpowiedzi modelu i zwraca czysty tekst.
 * Nieznany lub brakujacy tag -> NEUTRAL (sekcja 16 briefu).
 * @returns {{emotion: string, text: string, tagged: boolean}}
 */
export function parseEmotion(raw) {
  const input = String(raw ?? '');
  const match = TAG_PATTERN.exec(input);
  if (!match) return { emotion: DEFAULT_EMOTION, text: input.trim(), tagged: false };

  const candidate = match[1];
  const text = input.slice(match[0].length).trim();
  return {
    emotion: isEmotion(candidate) ? candidate : DEFAULT_EMOTION,
    text,
    tagged: true,
  };
}

/** Usuwa ewentualne dodatkowe tagi, gdyby model wstawil je w srodku tekstu. */
export const stripEmotionTags = (text) =>
  String(text ?? '')
    .replace(/\[(?:SMILE|GREETING|THINKING|EXCITED|FUNNY|NEUTRAL|EMPATHY|CURIOUS|SURPRISED|PROUD|FOCUS|SHY)\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

/** Emocja awaryjna dla sytuacji systemowych (bez udzialu modelu). */
export const systemEmotion = {
  greeting: 'GREETING',
  pending: PENDING_EMOTION,
  error: 'EMPATHY',
  overloaded: 'EMPATHY',
  noKnowledge: 'CURIOUS',
};
