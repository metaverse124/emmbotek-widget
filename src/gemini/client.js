/**
 * Klient Gemini. Wywolywany WYLACZNIE po stronie serwera - klucz nigdy nie trafia do przegladarki.
 * Obsluguje: timeout, mapowanie bledow, fallback na model zapasowy i graceful degradation przy 429.
 */
import config from '../config.js';

export class GeminiError extends Error {
  constructor(message, { status = 502, kind = 'upstream', retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.kind = kind;
    this.retryable = retryable;
  }
}

const buildBody = ({ systemPrompt, contents, temperature, maxOutputTokens, thinkingLevel }) => ({
  systemInstruction: { parts: [{ text: systemPrompt }] },
  contents,
  generationConfig: {
    temperature,
    maxOutputTokens,
    responseMimeType: 'application/json',
    // Modele 3.x "mysla" przed odpowiedzia, a tokeny myslenia licza sie do
    // maxOutputTokens. Zmierzone na zywym kluczu (2026-08-30): bez ograniczenia
    // 905 tokenow mysli i 7,4 s, przy poziomie "low" 249 tokenow i 3,4 s - przy
    // identycznej dlugosci odpowiedzi. W widgecie czatu polowa czasu oczekiwania
    // jest warta wiecej niz niewidoczna roznica w rozumowaniu.
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
  },
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  ],
});

export const extractText = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? '').join('').trim();
};

async function callModel(model, body, { fetchImpl, apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${config.gemini.endpoint}/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (response.status === 429) {
      throw new GeminiError('Wyczerpany limit zapytan Gemini', { status: 429, kind: 'rate_limit', retryable: true });
    }
    if (response.status === 401 || response.status === 403) {
      throw new GeminiError('Blad autoryzacji Gemini', { status: 502, kind: 'auth' });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new GeminiError(`Gemini HTTP ${response.status}: ${detail.slice(0, 200)}`, {
        status: 502, kind: 'upstream', retryable: response.status >= 500,
      });
    }

    return await response.json();
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (error.name === 'AbortError') {
      throw new GeminiError('Przekroczono czas oczekiwania na Gemini', { status: 504, kind: 'timeout', retryable: true });
    }
    throw new GeminiError(`Blad polaczenia z Gemini: ${error.message}`, { status: 502, kind: 'network', retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {{text: string, model: string, usage: object|null}}
 */
export async function generate({
  systemPrompt,
  contents,
  fetchImpl = fetch,
  apiKey = config.gemini.apiKey,
  model = config.gemini.model,
  fallbackModel = config.gemini.fallbackModel,
  temperature = config.gemini.temperature,
  maxOutputTokens = config.gemini.maxOutputTokens,
  thinkingLevel = config.gemini.thinkingLevel,
  timeoutMs = config.gemini.timeoutMs,
} = {}) {
  if (!apiKey) throw new GeminiError('Brak GEMINI_API_KEY po stronie serwera', { status: 500, kind: 'config' });

  const body = buildBody({ systemPrompt, contents, temperature, maxOutputTokens, thinkingLevel });

  try {
    const payload = await callModel(model, body, { fetchImpl, apiKey, timeoutMs });
    return { text: extractText(payload), model, usage: payload.usageMetadata ?? null };
  } catch (error) {
    const canFallback = fallbackModel && fallbackModel !== model && error.retryable;
    if (!canFallback) throw error;
    const payload = await callModel(fallbackModel, body, { fetchImpl, apiKey, timeoutMs });
    return { text: extractText(payload), model: fallbackModel, usage: payload.usageMetadata ?? null };
  }
}
