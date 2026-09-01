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
import { json, checkOrigin, applyCors, readJsonBody, clientKey, zrodloZadania } from '../http.js';
import { defaultLimiter } from '../rateLimit.js';
import { sprawdzToken, tokenWymagany } from '../token.js';
import { validateChatRequest } from '../validate.js';
import { detectIntent } from '../../agent/intents.js';
import { extractProfileSignals, mergeProfile, conversationStage } from '../../agent/profile.js';
import { retrieve, hasUsableKnowledge, baselineKnowledge } from '../../knowledge/retrieval.js';
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
/**
 * Dzienny budzet zapytan do modelu.
 *
 * Limit po adresie IP nie chroni portfela: wystarczy rotacja adresow. To jest twarda
 * granica na cala dobe - po jej przekroczeniu Emmbotek odsyla do sekretariatu zamiast
 * wolac Gemini. Licznik idzie tym samym mechanizmem co limit zapytan (okno 24 h,
 * jeden wspolny klucz), wiec baza nie potrzebuje zadnej zmiany.
 *
 * Bez skonfigurowanej bazy licznik jest w pamieci instancji - slabszy, ale nadal
 * lepszy niz brak jakiejkolwiek granicy.
 */
const DOBA_MS = 24 * 60 * 60 * 1000;
let budzetLokalny = { dzien: null, zuzyte: 0 };

async function budzetWyczerpany(store, teraz) {
  const limit = config.security.dailyBudget;
  if (!limit) return false;

  if (store?.skonfigurowany) {
    try {
      const wynik = await store.sprawdzLimit('__budzet_dzienny__', DOBA_MS, limit);
      return !wynik.allowed;
    } catch {
      // Baza niedostepna - schodzimy na licznik lokalny, jak przy limicie zapytan.
    }
  }

  const dzien = new Date(teraz).toISOString().slice(0, 10);
  if (budzetLokalny.dzien !== dzien) budzetLokalny = { dzien, zuzyte: 0 };
  budzetLokalny.zuzyte += 1;
  return budzetLokalny.zuzyte > limit;
}

export function createChatHandler({
  limiter = defaultLimiter,
  budgetStore = null,
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

    // Token wstepu: naglowek Origin da sie podrobic curl-em, wiec sama allowlista
    // nie wystarcza. Ochrona wlacza sie sama, gdy ustawiony jest TOKEN_SECRET.
    if (tokenWymagany()) {
      const wynik = sprawdzToken(req.headers?.['x-emmbotek-token'], { origin: zrodloZadania(req) });
      if (!wynik.ok) {
        return json(res, 401, {
          error: 'Nieprawidlowy lub wygasly token wstepu.',
          powod: wynik.powod,
          odswiezToken: true,     // sygnal dla widgetu: pobierz nowy i sprobuj raz jeszcze
        });
      }
    }

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

    // Budzet liczymy po walidacji, zeby smieciowe zadania go nie zjadaly.
    if (await budzetWyczerpany(budgetStore, timestamp.getTime())) {
      return json(res, 200, {
        emotion: systemEmotion.overloaded,
        message: 'Na dziś wyczerpałem limit rozmów. Proszę napisać do sekretariatu — '
          + 'chętnie odpowiedzą na wszystkie pytania.',
        cta: [],
        meta: { budzetWyczerpany: true },
      });
    }

    const base = await getBase(loadKnowledge);
    let knowledge = retrieve(base, guarded.text, {
      intent,
      currentUrl: value.currentUrl,
      now: timestamp.getTime(),
    });

    // Pytanie w obcym jezyku nie trafia w polska baze wiedzy po slowach kluczowych.
    // Zamiast odpowiadac "nie mam tych danych" przy cenniku lezacym obok, podajemy
    // modelowi przekroj najwazniejszych dokumentow - sam przetlumaczy, co trzeba.
    const jezykObcy = value.language && value.language !== 'pl';
    if (jezykObcy && !hasUsableKnowledge(knowledge)) {
      knowledge = baselineKnowledge(base, { now: timestamp.getTime() });
    }

    // Knowledge gap: pytanie bez pokrycia w bazie wiedzy (sekcja 40) - zapis wylacznie anonimowy.
    // Pytan w obcym jezyku tu nie liczymy: to ograniczenie retrievalu, nie brak tresci
    // na stronie - trafialyby do rejestru jako falszywe luki.
    if (!hasUsableKnowledge(knowledge) && !jezykObcy && onGap) {
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
      language: value.language,
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
      podpowiedzi: parsed.podpowiedzi ?? [],
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
