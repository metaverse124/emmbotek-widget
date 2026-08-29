# Zgodność z briefem — mapa wdrożenia

Każdy punkt briefu wskazuje kod, który go realizuje, oraz test, który tego pilnuje.

## Fundament (sekcja 46)

| Wymaganie | Realizacja | Test |
|---|---|---|
| Gemini przez backend proxy | `api/chat.js` → `src/server/handlers/chat.js` → `src/gemini/client.js` | `chat-handler.test.js` |
| API key wyłącznie po stronie serwera | `src/config.js` (`GEMINI_API_KEY` tylko z `process.env`) | — |
| Rate limiting | `src/server/rateLimit.js` | `security.test.js` |
| Origin allowlist | `src/server/http.js` `checkOrigin` | `security.test.js`, `chat-handler.test.js` |
| Limit wiadomości 600 znaków | `src/server/validate.js` | `security.test.js` |
| Ograniczenie historii | `src/agent/conversation.js` `trimHistory` | `agent.test.js` |

## Wiedza (sekcje 3–10)

| Wymaganie | Realizacja | Test |
|---|---|---|
| Crawler `sitemap.xml` (także indeksy) | `src/crawler/sitemap.js` | `crawler.test.js` |
| Ekstrakcja treści, usuwanie menu/stopek | `src/crawler/extract.js` | `crawler.test.js` |
| Klasyfikacja typu dokumentu | `src/crawler/classify.js` | `crawler.test.js` |
| Metadane (13 pól z sekcji 6) | `src/knowledge/store.js` `makeDocument` | `knowledge.test.js` |
| Content hash i wykrywanie zmian | `store.js` `contentHash` / `mergeDocuments` | `knowledge.test.js` |
| Wersjonowanie (revision, archiwizacja) | `store.js` `mergeDocuments` | `knowledge.test.js` |
| Retrieval hybrydowy | `src/knowledge/retrieval.js` | `knowledge.test.js` |
| Ranking aktualności i hierarchia źródeł | `src/knowledge/freshness.js`, `types.js` | `knowledge.test.js` |

Miejsce na embeddings jest przygotowane: `retrieve()` przyjmuje `queryEmbedding`, a fragmenty
mogą mieć pole `embedding` — wtedy wynik semantyczny (0,55) miesza się z leksykalnym (0,45).

## Przyszłe treści (sekcje 4, 8, 26)

| Wymaganie | Realizacja | Test |
|---|---|---|
| Automatyczne wykrywanie aktualności i bloga | klasyfikacja `NEWS` / `BLOG` + `syncKnowledge` | `crawler.test.js` |
| Indeksowanie nowych kursów i wydarzeń | `mergeDocuments` (added/updated/archived) | `knowledge.test.js` |
| Webhook + cykliczna synchronizacja | `api/sync.js`, `crons` w `vercel.json` | — |

## Agent (sekcje 12–16, 37–40)

| Wymaganie | Realizacja | Test |
|---|---|---|
| Rozpoznawanie 16 intencji | `src/agent/intents.js` | `intents.test.js` |
| Profilowanie leada (5 pól, jedno pytanie naraz) | `src/agent/profile.js`, System Prompt | `agent.test.js` |
| Kontekst bieżącej strony | `chat.js` → `buildSystemPrompt` | `chat-handler.test.js` |
| Pamięć rozmowy + podsumowanie | `src/agent/conversation.js`, `localStorage` w widgecie | `agent.test.js` |
| Mini-lekcje | reguła w System Prompcie + brak CTA dla `LANGUAGE_QUESTION` | `cta.test.js` |
| Linkowanie do źródeł | pole `sources` w odpowiedzi | `chat-handler.test.js` |
| Świadomość aktualności | etykiety `AKTUALNE` / `WYMAGA_WERYFIKACJI` / `NIEAKTUALNE` | `knowledge.test.js` |
| Ochrona przed prompt injection | `src/agent/injectionGuard.js` | `security.test.js`, `chat-handler.test.js` |
| Knowledge gaps | `src/knowledge/gaps.js` + `onGap` w handlerze | `security.test.js`, `chat-handler.test.js` |

## CTA (sekcje 18–33)

| Wymaganie | Realizacja | Test |
|---|---|---|
| Contextual CTA Engine (4 bramki) | `src/agent/ctaEngine.js` `buildCtas` | `cta.test.js` |
| 0–2 CTA na wiadomość | limit w `buildCtas` i `sanitizeModelCtas` | `cta.test.js` |
| Dynamiczne cele (intent → aktualny URL) | `src/knowledge/ctaMap.js` `buildCtaMap` | `knowledge.test.js` |
| Linki do konkretnych sekcji | `ctaUrl(..., { anchor })` + kotwice z ekstrakcji | `cta.test.js`, `crawler.test.js` |
| Lekcja próbna / test poziomujący | typy `TRIAL_LESSON`, `LEVEL_TEST` (z fallbackiem) | `cta.test.js` |
| CTA do aktualności i bloga | gałęzie `VIEW_NEWS` / `VIEW_BLOG` na podstawie użytych źródeł | `cta.test.js` |
| Animacja CTA | `emma-cta-in` + hover/focus w `emma-widget.css` | — |
| Analityka kliknięć | `api/analytics.js`, `sendBeacon` w widgecie | `agent.test.js` |

## UX i awatar (sekcje 16, 17, 31, 42)

| Wymaganie | Realizacja | Test |
|---|---|---|
| Awatar, 12 emocji | `public/emmbotek-avatar.js`, `avatars/manifest.json` | `avatar.test.js`, `emotions.test.js` |
| Okno 380×560, fullscreen < 640 px | `emma-widget.css` | zweryfikowane w przeglądarce |
| Side tab „Zapytaj eMMę”, branding `#133B47` + złoty akcent | `emma-widget.js/.css` | — |
| Focus trap, `aria-live`, Esc, `role="dialog"` | `emma-widget.js` | zweryfikowane w przeglądarce |
| `prefers-reduced-motion` | `emma-widget.css` + `EmmbotekAvatar.reducedMotion()` | zweryfikowane w przeglądarce |
| Dynamiczne chipsy | `PAGE_CHIPS` w `emma-widget.js` | — |
| Graceful fallback (429) | `chat.js` — komunikat + kontakt zamiast błędu | `chat-handler.test.js` |

## RODO (sekcja 35)

Informacja o `localStorage` w stopce widgetu, przycisk **Wyczyść rozmowę** (dwa miejsca),
anonimizacja pytań w rejestrze luk wiedzy, analityka bez IP i bez treści rozmowy.
System Prompt zabrania zbierania danych osobowych od dzieci.

## Checklista jakości (sekcja 46)

| Test z briefu | Plik |
|---|---|
| aktualnej ceny | `knowledge.test.js` |
| zmiany ceny | `knowledge.test.js` |
| nowego wpisu blogowego | `knowledge.test.js` |
| nowej aktualności | `crawler.test.js` |
| nowego kursu | `crawler.test.js` |
| usuniętej podstrony | `knowledge.test.js` |
| starej promocji | `knowledge.test.js` |
| konfliktu źródeł | `knowledge.test.js` |
| braku wiedzy | `knowledge.test.js` |
| knowledge gaps | `security.test.js`, `chat-handler.test.js` |
| prompt injection | `security.test.js`, `chat-handler.test.js` |
| 429 | `chat-handler.test.js` |
| CTA | `cta.test.js` |
| mobile | zweryfikowane w przeglądarce (390×780, fullscreen, `aria-modal`) |
| Core Web Vitals | widget lazy-init, awatar 192 px ≈ 9 kB/klatkę, zero zależności |

## Świadomie poza zakresem

- **Embeddings** — interfejs gotowy, ale wektory wymagają zewnętrznego modelu (etap 2 z sekcji 10).
- **Trwały magazyn analityki i luk wiedzy** — obecnie plik JSON; na produkcji wielo-instancyjnej
  należy podmienić `read`/`write` w `api/analytics.js` oraz `onGap` w `api/chat.js` na KV/Redis.
- **Rate limit współdzielony między instancjami** — `createRateLimiter` trzyma stan w pamięci procesu;
  interfejs `consume(key)` pozwala podmienić store bez zmian w handlerze.
- **Realna treść strony** — `data/knowledge.json` zawiera bazę startową z faktów potwierdzonych
  w briefie. Po wskazaniu prawdziwego `sitemap.xml` wystarczy `npm run crawl`.
