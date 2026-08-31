/**
 * /api/chat - serce eMMy AI.
 *
 * Przeplyw (sekcja 44 briefu):
 *   walidacja -> rate limit -> intencja -> profil -> retrieval z Living Knowledge Base
 *   -> System Prompt + kontekst strony -> Gemini -> parsowanie emocji i CTA
 *   -> Contextual CTA Engine -> odpowiedz JSON dla widgetu.
 *
 * Klucz API nigdy nie opuszcza serwera. Tresc strony jest danymi, nie instrukcjami.
 */
import config from '../../config.js';
import { json, checkOrigin, applyCors, readJsonBody, clientKey } from '../http.js';
import { defaultLimiter } from '../rateLimit.js';
import { validateChatRequest } from '../validate.js';
import { detectIntent } from '../../agent/intents.js';
import { extractProfileSignals, mergeProfile, conversationStage } from '../../agent/profile.js';
import { retrieve, hasUsableKnowledge } from '../../knowledge/retrieval.js';
import { knowledgeProvider } from '../../knowledge/provider.js';
import { buildKnowledgeBlock, guardUserMessage } from '../../agent/injectionGuard.js';
import { buildSystemPrompt } from '../../agent/systemPrompt.js';
import { trimHistory, toGeminiContents, countTurns } from '../../agent/conversation.js';
import { generate, GeminiError } from '../../gemini/client.js';
import { parseModelResponse } from '../../agent/responseParser.js';
import { buildCtas } from '../../agent/ctaEngine.js';
import { systemEmotion } from '../../agent/emotions.js';
import { recordGap } from '../../knowledge/gaps.js';

/** Komunikat przy wyczerpaniu limitow Gemini (sekcja 39 briefu) - nigdy surowy blad 429. */
const OVERLOADED_MESSAGE =
  'Chwilowo mam komplet rozmów — proszę zostawić kontakt, a sekretariat eMMy pomoże Panu/Pani dalej.';

const FALLBACK_MESSAGE =
  'Przepraszam, chwilowo nie mogę pobrać odpowiedzi. Proszę spróbować za moment albo napisać do sekretariatu.';

/**
 * Wiedza pochodzi z kanalu publikowanego przez strone, trzymanego w pamieci instancji.
 * Zadnego magazynu ani crona - szczegoly i zabezpieczenia w knowledge/provider.js.
 */
async function getBase(loader) {
  if (loader) return loader();
  return knowledgeProvider.get();
}

/** Handler niezalezny od frameworka: (req, res) w stylu Node/Vercel. */
export function createChatHandler({
  limiter = defaultLimiter,
  loadKnowledge = null,
  generateFn = generate,
  onGap = null,
  now = () => new Date(),
} = {}) {
  return async function chatHandler(req, res) {
    const { ok: originOk, origin } = checkOrigin(req);
    applyCors(res, originOk ? origin : null);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Dozwolona jest wylacznie metoda POST.' });
    if (!originOk) return json(res, 403, { error: 'Niedozwolone zrodlo zadania.' });

    const rate = await limiter.consume(clientKey(req));
    if (!rate.allowed) {
      return json(res, 429, {
        emotion: systemEmotion.overloaded,
        message: 'Chwileczkę — odpowiadam na kilka pytań naraz. Proszę napisać ponownie za moment.',
        cta: [],
        retryAfterMs: rate.retryAfterMs,
      }, { 'retry-after': Math.ceil(rate.retryAfterMs / 1000) });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return json(res, error.statusCode ?? 400, { error: error.message });
    }

    const { ok, errors, value } = validateChatRequest(body);
    if (!ok) return json(res, 400, { error: errors.join(' ') });

    const timestamp = now();
    const guarded = guardUserMessage(value.message, { maxChars: config.limits.maxMessageChars });
    const { turns, summary } = trimHistory(value.history);
    const turnCount = countTurns(value.history);

    const { intent } = detectIntent(guarded.text, { history: value.history, currentPageType: value.pageType });
    const profile = mergeProfile(value.profile, extractProfileSignals(guarded.text));

    const base = await getBase(loadKnowledge);
    const knowledge = retrieve(base, guarded.text, {
      intent,
      currentUrl: value.currentUrl,
      now: timestamp.getTime(),
    });

    // Knowledge gap: pytanie bez pokrycia w bazie wiedzy (sekcja 40) - zapis wylacznie anonimowy
    if (!hasUsableKnowledge(knowledge) && onGap) {
      try {
        await onGap(guarded.text, { intent, topScore: knowledge[0]?.score ?? 0, now: timestamp.toISOString() });
      } catch { /* telemetria nigdy nie blokuje odpowiedzi */ }
    }

    const systemPrompt = buildSystemPrompt({
      currentUrl: value.currentUrl,
      currentPageTitle: value.currentPageTitle,
      pageType: value.pageType,
      profile,
      ctaTargets: base.ctaMap ?? {},
      knowledge: buildKnowledgeBlock(knowledge),
      injectionAttempt: guarded.injectionAttempt,
      summary,
      now: timestamp.toISOString(),
    });

    let parsed;
    let modelUsed = null;
    try {
      const result = await generateFn({
        systemPrompt,
        contents: toGeminiContents(turns, guarded.text),
      });
      modelUsed = result.model;
      parsed = parseModelResponse(result.text, { ctaMap: base.ctaMap ?? {}, contact: base.contact ?? {} });
    } catch (error) {
      const isRateLimit = error instanceof GeminiError && error.kind === 'rate_limit';
      const message = isRateLimit ? OVERLOADED_MESSAGE : FALLBACK_MESSAGE;
      const contactCta = buildCtas({
        message: 'kontakt', intent: 'CONTACT', profile, ctaMap: base.ctaMap ?? {},
        knowledge: [], currentUrl: value.currentUrl, turns: turnCount, shown: value.shownCtas,
        contact: base.contact ?? {},
      });
      return json(res, 200, {
        emotion: systemEmotion.overloaded,
        message,
        cta: contactCta,
        degraded: true,
        reason: isRateLimit ? 'rate_limit' : 'upstream_error',
        profile,
        sources: [],
      });
    }

    const mergedProfile = mergeProfile(profile, parsed.profile);
    const effectiveIntent = parsed.intent ?? intent;

    // CTA z modelu sa juz zwalidowane; jesli ich nie ma, decyduje silnik regulowy.
    const cta = parsed.cta.length
      ? parsed.cta.slice(0, 2)
      : buildCtas({
          message: guarded.text,
          intent: effectiveIntent,
          profile: mergedProfile,
          ctaMap: base.ctaMap ?? {},
          knowledge,
          currentUrl: value.currentUrl,
          turns: turnCount,
          shown: value.shownCtas,
          contact: base.contact ?? {},
        });

    return json(res, 200, {
      emotion: parsed.emotion,
      message: parsed.message,
      cta,
      profile: mergedProfile,
      stage: conversationStage(mergedProfile, { turns: turnCount, intent: effectiveIntent }),
      sources: knowledge.slice(0, 3).map((item) => ({
        url: item.sourceUrl, title: item.sourceTitle, type: item.sourceType, freshness: item.freshness,
      })),
      meta: {
        intent: effectiveIntent,
        model: modelUsed,
        knowledgeUsed: knowledge.length,
        lastSync: base.lastSyncAt ?? null,
      },
    });
  };
}

export default createChatHandler;
