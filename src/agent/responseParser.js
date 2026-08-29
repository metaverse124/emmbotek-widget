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
