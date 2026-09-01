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
 * Wolanie modelu w trybie strumieniowym.
 *
 * Gemini oddaje wtedy odpowiedz kawalkami jako SSE. Zbieramy je do jednego
 * napisu i po kazdym kawalku wolamy `onFragment` z CALOSCIA tego, co dotad
 * przyszlo - surowa, bez interpretacji. Rozpakowaniem zajmuje sie warstwa
 * wyzej, bo to ona wie, ze kontraktem jest JSON z polem "message".
 *
 * Zwraca to samo, co `callModel`, wiec dalszy potok nie widzi roznicy.
 */
async function callModelStream(model, body, { fetchImpl, apiKey, timeoutMs, onFragment }) {
  const controller = new AbortController();
  // Przy strumieniu licznik czasu pilnuje PIERWSZEGO kawalka, a nie calej
  // odpowiedzi - gdy tekst juz leci, zrywanie polaczenia byloby gorsze niz
  // poczekanie na koncowke.
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  const odswiezTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };

  try {
    const response = await fetchImpl(
      `${config.gemini.endpoint}/${model}:streamGenerateContent?alt=sse`,
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
    if (!response.ok || !response.body) {
      const detail = await response.text?.().catch(() => '') ?? '';
      throw new GeminiError(`Gemini HTTP ${response.status}: ${String(detail).slice(0, 200)}`, {
        status: 502, kind: 'upstream', retryable: true,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bufor = '';
    let tekst = '';
    let usage = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      odswiezTimer();
      bufor += decoder.decode(value, { stream: true });

      // SSE dzieli zdarzenia pusta linia; ostatni, niedomkniety kawalek zostaje w buforze
      const czesci = bufor.split('\n\n');
      bufor = czesci.pop() ?? '';

      for (const czesc of czesci) {
        for (const linia of czesc.split('\n')) {
          if (!linia.startsWith('data:')) continue;
          const surowe = linia.slice(5).trim();
          if (!surowe || surowe === '[DONE]') continue;
          let kawalek;
          try {
            kawalek = JSON.parse(surowe);
          } catch {
            continue;                       // niedomkniety JSON - nastepny kawalek go uzupelni
          }
          const dopisek = extractText(kawalek);
          if (dopisek) {
            tekst += dopisek;
            if (onFragment) {
              try { onFragment(tekst); } catch { /* odbiorca nie moze wywrocic strumienia */ }
            }
          }
          if (kawalek.usageMetadata) usage = kawalek.usageMetadata;
        }
      }
    }

    return { text: tekst.trim(), usage };
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
  onFragment = null,
} = {}) {
  if (!apiKey) throw new GeminiError('Brak GEMINI_API_KEY po stronie serwera', { status: 500, kind: 'config' });

  const body = buildBody({ systemPrompt, contents, temperature, maxOutputTokens, thinkingLevel });

  /*
     Obecnosc `onFragment` wlacza tryb strumieniowy. Model zapasowy zostaje
     zwykly (bez strumienia): skoro glowny wlasnie sie wylozyl, liczy sie to,
     zeby odpowiedz w ogole dotarla, a nie zeby ladnie plynela. Odbiorca
     dostal do tego momentu co najwyzej urwany poczatek, ktory i tak zastapi
     pelna trescia z ostatecznej odpowiedzi.
  */
  if (onFragment) {
    try {
      const wynik = await callModelStream(model, body, { fetchImpl, apiKey, timeoutMs, onFragment });
      return { text: wynik.text, model, usage: wynik.usage };
    } catch (error) {
      const canFallback = fallbackModel && fallbackModel !== model && error.retryable;
      if (!canFallback) throw error;
      const payload = await callModel(fallbackModel, body, { fetchImpl, apiKey, timeoutMs });
      return { text: extractText(payload), model: fallbackModel, usage: payload.usageMetadata ?? null };
    }
  }

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
