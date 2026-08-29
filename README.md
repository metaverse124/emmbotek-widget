# eMMa AI — asystentka Prywatnego Studia Języków Obcych eMMa

Wdrożenie koncepcji z briefu: **Living Knowledge Base**, **Hybrid Retrieval**,
**Contextual CTA Engine** i animowany awatar maskotki **Emmbotek** w 12 emocjach.

eMMa nie jest chatbotem FAQ — to cyfrowa doradczyni, która zna aktualną treść strony
(także tę opublikowaną po wdrożeniu), prowadzi naturalną rozmowę, profiluje potrzeby
i w odpowiednim momencie podaje jeden trafny przycisk prowadzący dokładnie tam, gdzie trzeba.

---

## Szybki start

```bash
npm test          # 93 testy (node:test, bez zależności)
npm run dev       # http://localhost:3000 — demo widgetu i galeria awatara
npm run crawl     # synchronizacja wiedzy z sitemap.xml
npm run avatars   # ponowne wycięcie poz maskotki z arkuszy źródłowych
```

Bez `GEMINI_API_KEY` serwer deweloperski działa w **trybie demo** — odpowiedzi generuje
lokalna atrapa modelu (`scripts/demo-model.mjs`), więc widać cały UX: emocje, animacje i CTA.

Konfiguracja: skopiuj `.env.example` do `.env` i uzupełnij `GEMINI_API_KEY`, `ALLOWED_ORIGINS`,
`SITEMAP_URL` oraz `SYNC_TOKEN`.

---

## Architektura

```
EMMAstudio.pl ──sitemap/webhook──▶ CRAWLER ──▶ EKSTRAKCJA ──▶ NORMALIZACJA
                                                                  │
                                                          WYKRYCIE ZMIAN (hash)
                                                                  ▼
                                                     LIVING KNOWLEDGE BASE
                                                                  │
                                                   RETRIEVAL (keyword+metadane)
                                                                  ▼
                                             KONTEKST STRONY + PROFIL LEADA
                                                                  ▼
                                                             GEMINI
                                                                  ▼
                                              Czat + Awatar Emmbotek + CTA
```

| Warstwa | Pliki |
|---|---|
| Konfiguracja | `src/config.js` |
| Crawler | `src/crawler/{sitemap,extract,classify,chunk,run}.js` |
| Baza wiedzy | `src/knowledge/{store,types,freshness,retrieval,ctaMap,gaps}.js` |
| Agent | `src/agent/{systemPrompt,emotions,intents,profile,ctaEngine,injectionGuard,conversation,responseParser}.js` |
| Model | `src/gemini/client.js` |
| Serwer | `src/server/{http,rateLimit,validate}.js`, `src/server/handlers/{chat,sync,analytics}.js` |
| Endpointy | `api/{chat,sync,analytics}.js` (Vercel) |
| Frontend | `public/{emma-widget.js,emma-widget.css,emmbotek-avatar.js,index.html}` |
| Awatar | `public/avatars/` (27 poz + `manifest.json`) |

---

## Awatar Emmbotek

27 poz maskotki zostało wyizolowanych z trzech arkuszy 3×3 skryptem
`scripts/extract_avatars.py`:

1. wykrycie czarnych linii siatki → podział na 9 komórek,
2. flood fill od krawędzi po pikselach szachownicy przezroczystości,
3. domknięcie dziur + wybór największej spójnej bryły (odrzuca iskierki i śmieci),
4. dekontaminacja koloru na krawędzi (usuwa szarą obwódkę) + wygładzenie alfy,
5. przycięcie do sylwetki i wyśrodkowanie na kwadracie.

Wynik: `public/avatars/pose-*.png` (512 px) oraz `public/avatars/small/` (192 px, ~9 kB/klatkę —
to właśnie tę wersję ładuje widget).

`public/avatars/manifest.json` mapuje pozy na **12 tagów emocji z briefu**:

| Tag | Klatki | Ruch |
|---|---|---|
| `NEUTRAL` | 2 | breathe |
| `GREETING` | 2 | wave |
| `SMILE` | 3 | bob |
| `THINKING` | 3 | ponder |
| `EXCITED` | 2 | hop |
| `FUNNY` | 2 | tilt |
| `EMPATHY` | 2 | lean |
| `CURIOUS` | 2 | tilt |
| `SURPRISED` | 2 | pop |
| `PROUD` | 2 | puff |
| `FOCUS` | 3 | still |
| `SHY` | 2 | sway |

Plus dwa stany spoza listy modelu: `SLEEPY` (drzemka po dłuższej bezczynności)
i `SAD` (błąd / brak wiedzy).

Animacja ma dwie warstwy: **podmianę klatek** (prawdziwa animacja postaci) i **ruch CSS**
dobrany do emocji. Cykl: `emocja → animacja → NEUTRAL`.
Przy `prefers-reduced-motion` obie warstwy są wyłączone — zostaje statyczna poza.

---

## Osadzenie na stronie

```html
<link rel="stylesheet" href="/emma-widget.css">
<script src="/emmbotek-avatar.js" defer></script>
<script src="/emma-widget.js" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', function () {
    EmmaWidget.init({
      apiUrl: '/api/chat',
      assetsBase: '/',
      privacyUrl: '/polityka-prywatnosci/',
    });
  });
</script>
```

Opcjonalnie podpowiedz typ podstrony, żeby chipsy i retrieval były trafniejsze:

```html
<body data-emma-page-type="COURSE">
```

---

## Kontrakt API

`POST /api/chat`

```json
{
  "message": "Szukam angielskiego dla córki, ma 9 lat.",
  "history": [{ "role": "user", "text": "...", "intent": "CHILD" }],
  "currentUrl": "https://emmastudio.pl/kursy-dla-dzieci/",
  "currentPageTitle": "Angielski dla dzieci",
  "pageType": "COURSE",
  "profile": { "dlaKogo": null, "jezyk": null, "poziom": null, "cel": null, "tryb": null },
  "shownCtas": ["VIEW_PRICE"]
}
```

Odpowiedź:

```json
{
  "emotion": "SMILE",
  "message": "Z tego, co Pani opisała...",
  "cta": [{ "type": "TRIAL_LESSON", "label": "Umów bezpłatną lekcję próbną",
            "action": "url", "target": "/kontakt/#lekcja-probna" }],
  "profile": { "dlaKogo": "dziecko", "jezyk": "angielski" },
  "stage": "dopasowanie",
  "sources": [{ "url": "...", "type": "COURSE", "freshness": "AKTUALNE" }],
  "meta": { "intent": "CHILD", "model": "gemini-2.5-flash", "knowledgeUsed": 4 }
}
```

`POST /api/sync` — synchronizacja wiedzy (nagłówek `x-sync-token`); cron dzienny w `vercel.json`,
można też wywołać webhookiem CMS po publikacji treści.

`POST /api/analytics` — anonimowe liczniki `cta_impression` / `cta_click`.
Nie przyjmuje IP, sessionId ani treści rozmowy; z adresu zostaje sama ścieżka.

---

## Bezpieczeństwo

- Klucz Gemini wyłącznie po stronie serwera — nigdy w przeglądarce.
- Rate limit po IP (sliding window), allowlista `Origin`, limit 600 znaków, limit historii.
- Treść strony trafia do modelu jako **dane w bloku `<<<WIEDZA … WIEDZA>>>`**, nigdy jako instrukcje;
  wzorce typu „Ignore previous instructions” są neutralizowane (`src/agent/injectionGuard.js`).
- CTA zaproponowane przez model są walidowane — adres musi pochodzić z mapy CTA
  zbudowanej podczas indeksowania (blokuje `javascript:` i wymyślone URL-e).
- Przy 429 z Gemini użytkownik dostaje komunikat i kontakt do sekretariatu, nigdy surowy błąd.

## RODO

Rozmowa żyje w `localStorage` przeglądarki. Informacja o tym jest widoczna w stopce widgetu
razem z przyciskiem **Wyczyść rozmowę**. Dane kontaktowe przekazywane są dalej dopiero po
wyraźnej zgodzie; luki wiedzy zapisywane są po usunięciu e-maili, telefonów i dat.

## Dostępność

`role="dialog"`, `aria-live="polite"` na historii rozmowy, focus trap w trybie pełnoekranowym,
Esc zamyka, pełna obsługa klawiatury, kontrast ≥ 4.5:1, obsługa `prefers-reduced-motion`
i `forced-colors`.

---

## Testy

```bash
npm test
```

93 testy pokrywają checklistę jakości z sekcji 46 briefu — m.in. test aktualnej ceny,
zmiany ceny, nowego wpisu blogowego, nowej aktualności, usuniętej podstrony, starej promocji,
konfliktu źródeł, braku wiedzy, luk wiedzy, prompt injection, 429, CTA i integralności awatara.
Mapowanie „punkt briefu → test” znajduje się w [`docs/zgodnosc-z-briefem.md`](docs/zgodnosc-z-briefem.md).
