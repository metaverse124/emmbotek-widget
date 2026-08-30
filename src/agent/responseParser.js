/**
 * Parsowanie odpowiedzi modelu do kontraktu frontendu (sekcja 32 briefu).
 * Model powinien zwrocic JSON, ale nigdy na tym nie polegamy w 100% -
 * czysty tekst z tagiem emocji tez jest poprawnie obslugiwany.
 */
import { parseEmotion, stripEmotionTags, DEFAULT_EMOTION } from './emotions.js';
import { sanitizeModelCtas } from './ctaEngine.js';
import { isIntent } from '../knowledge/types.js';
import { PROFILE_FIELDS } from './profile.js';

const stripCodeFence = (text) =>
  String(text ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

const chr92 = String.fromCharCode(92);
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\x08', f: '\x0c' };

function tryParseJson(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Wyciaga tresc z JSON-a urwanego w polowie.
 *
 * Model odpowiada JSON-em, a budzet tokenow obejmuje tez jego mysli - przy ciasnym
 * budzecie odpowiedz konczyla sie w srodku struktury. Zwykly parser zwracal wtedy
 * null, a caly surowy tekst szedl do uzytkownika jako wiadomosc: zamiast zdania
 * widzial `{"message":" Zajecia w grupie 4-8 osob kosztuja 3`.
 *
 * Czytamy wiec pole "message" znak po znaku, respektujac znaki ucieczki, i oddajemy
 * tyle tresci, ile model zdazyl napisac. Reszty kontraktu (CTA, profil) nie da sie
 * z urwanego JSON-a bezpiecznie odzyskac i celowo jej nie zgadujemy.
 *
 * @returns {string|null}
 */
export function salvageMessage(text) {
  const cleaned = stripCodeFence(text);
  if (!cleaned.startsWith('{')) return null;

  const klucz = /"message"\s*:\s*"/g.exec(cleaned);
  if (!klucz) return null;

  let out = '';
  for (let i = klucz.index + klucz[0].length; i < cleaned.length; i += 1) {
    const znak = cleaned[i];
    if (znak === chr92) {
      const nastepny = cleaned[i + 1];
      if (nastepny === undefined) break;      // ucieczka urwana razem z odpowiedzia
      out += ESCAPES[nastepny] ?? nastepny;
      i += 1;
      continue;
    }
    if (znak === '"') return out.trim() || null;  // pelne, domkniete pole
    out += znak;
  }
  // Pole sie nie domknelo - oddajemy urwane zdanie, bo lepsze niz nawiasy klamrowe.
  return out.trim() || null;
}

const pickProfile = (value) => {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const field of PROFILE_FIELDS) {
    const item = value[field];
    if (typeof item === 'string' && item.trim()) out[field] = item.trim().slice(0, 40);
  }
  return out;
};

/**
 * @returns {{emotion, message, cta, profile, intent, format}}
 */
export function parseModelResponse(raw, { ctaMap = {}, contact = {} } = {}) {
  const parsed = tryParseJson(raw);

  if (parsed && typeof parsed.message === 'string') {
    const { emotion, text } = parseEmotion(parsed.message);
    return {
      emotion,
      message: stripEmotionTags(text),
      cta: sanitizeModelCtas(parsed.cta, { ctaMap, contact }),
      profile: pickProfile(parsed.profil ?? parsed.profile),
      intent: isIntent(parsed.intent) ? parsed.intent : null,
      format: 'json',
    };
  }

  const uratowana = salvageMessage(raw);
  if (uratowana) {
    const { emotion, text } = parseEmotion(uratowana);
    return {
      emotion: emotion || DEFAULT_EMOTION,
      message: stripEmotionTags(text),
      cta: [],
      profile: {},
      intent: null,
      format: 'json-urwany',
    };
  }

  const { emotion, text } = parseEmotion(raw);
  return {
    emotion: emotion || DEFAULT_EMOTION,
    message: stripEmotionTags(text),
    cta: [],
    profile: {},
    intent: null,
    format: 'text',
  };
}
