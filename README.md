# Emmbotek — asystent Prywatnego Studia Języków Obcych eMMa

Wdrożenie koncepcji z briefu: **Living Knowledge Base**, **Hybrid Retrieval**,
**Contextual CTA Engine** i animowany awatar maskotki w 12 emocjach.

**Nazewnictwo:** szkoła nazywa się *eMMa* (eMMa Studio), a jej cyfrowy asystent nazywa się
**Emmbotek**. Asystent nigdy nie przedstawia się jako „eMMa” — to nazwa szkoły, nie jego imię.

Emmbotek nie jest chatbotem FAQ — to cyfrowy doradca, który zna aktualną treść strony
(także tę opublikowaną po wdrożeniu), prowadzi naturalną rozmowę, profiluje potrzeby
i w odpowiednim momencie podaje jeden trafny przycisk prowadzący dokładnie tam, gdzie trzeba.

---

## Szybki start

```bash
npm test          # 93 testy (node:test, bez zależności)
npm run dev       # http://localhost:3000 — demo widgetu i galeria awatara
npm run crawl     # odswiezenie kopii zapasowej data/knowledge.json z kanalu
npm run avatars   # ponowne wycięcie poz maskotki z arkuszy źródłowych
```

Bez `GEMINI_API_KEY` serwer deweloperski działa w **trybie demo** — odpowiedzi generuje
lokalna atrapa modelu (`scripts/demo-model.mjs`), więc widać cały UX: emocje, animacje i CTA.

Konfiguracja: skopiuj `.env.example` do `.env` i uzupełnij `GEMINI_API_KEY`, `ALLOWED_ORIGINS`,
`SITEMAP_URL` oraz `SYNC_TOKEN`.

---

## Architektura

```
EMMAstudio.pl ──/wiedza.json──▶ KANAL WIEDZY ──▶ PAMIEC INSTANCJI (5 min)
   (budowany razem                                        │
    ze strona)                                            │  awaria strony?
                                                          │  ostatnia dobra wiedza,
                                                          │  a w ostatecznosci kopia
                                                          │  z paczki
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
| Awatar | `public/avatars/` (40 poz + `manifest.json`) |

---

## Awatar Emmbotek (maskotka)

40 poz maskotki zostało wyizolowanych z pięciu arkuszy 3×3 skryptem
`scripts/extract_avatars.py`:

1. wykrycie czarnych linii siatki → podział na 9 komórek,
2. flood fill od krawędzi po pikselach szachownicy przezroczystości,
3. domknięcie dziur + wybór największej spójnej bryły (odrzuca iskierki i śmieci),
4. dekontaminacja koloru na krawędzi (usuwa szarą obwódkę) + wygładzenie alfy,
5. przycięcie do sylwetki i wyśrodkowanie na kwadracie.

Prawy dolny kafelek każdego arkusza (`r3c3`) nosi widoczny znak wodny modelu generującego —
biały błysk na brzuchu maskotki. Te pięć poz jest trwale wykluczonych w skrypcie (`WATERMARKED`),
więc nie wrócą przy ponownym uruchomieniu `npm run avatars`.

Arkusze 04 i 05 przyszły od klienta wyłącznie jako JPEG 384×512 — mniejsze i bledsze barwnie
od pozostałych. Skrypt wyrównuje im średnią i odchylenie kanałów RGB do arkuszy 01–03
(`COLOR_MATCH`), licząc statystyki tylko na pikselach postaci, żeby nie ruszyć szachownicy,
po której idzie wycinanie tła. Bez tego kroku maskotka z tych arkuszy wygląda jak inna,
wyblakła zabawka obok reszty.

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

`POST /api/sync` — wymuszenie odświeżenia wiedzy i podgląd jej stanu. Akceptuje sekret
w nagłówku `x-sync-token` albo `Authorization: Bearer` (`SYNC_TOKEN` lub `CRON_SECRET`).

Endpoint **nic nie indeksuje i nic nie zapisuje** — kasuje pamięć podręczną instancji
i pobiera kanał od nowa. Przydaje się jako webhook po publikacji treści w CMS-ie
(żeby nie czekać na wygaśnięcie pamięci) oraz do diagnostyki po wdrożeniu: w odpowiedzi
widać `source` (`kanal` albo `plik`), liczbę dokumentów i ewentualny błąd.
Pole `ok` jest `true` **tylko wtedy, gdy wiedza przyszła ze strony** — praca na kopii
z paczki nie jest sukcesem, o którym można milczeć.

`POST /api/analytics` — anonimowe liczniki `cta_impression` / `cta_click`.
Nie przyjmuje IP, sessionId ani treści rozmowy; z adresu zostaje sama ścieżka.

---

## Skąd bierze się wiedza — i dlaczego bez bazy danych

Strona publikuje przy budowaniu cały swój stan jako `/wiedza.json`: 132 kB, **42 kB po
kompresji**, pobranie w kilkadziesiąt milisekund. Przy takich rozmiarach magazyn jest
zbędny — instancja pobiera kanał i trzyma go w pamięci przez `KNOWLEDGE_CACHE_TTL_MS`
(domyślnie 5 minut).

Wychodzi lepiej niż z magazynem i cronem:

- wiedza jest **świeższa** — minuty zamiast doby,
- nie ma crona, który może po cichu przestać chodzić,
- nie ma stanu, który może się rozjechać z treścią strony.

Emmbotek nigdy nie zostaje bez wiedzy — najwyżej z wiedzą starszą. Trzy poziomy:

1. świeży kanał ze strony,
2. ostatni udany kanał z pamięci — podawany dalej nawet po wygaśnięciu, bo stara cena
   jest lepsza niż brak odpowiedzi (kolejna próba dopiero po 30 s, żeby nie dobijać się
   do strony przy każdym zapytaniu),
3. kopia `data/knowledge.json` wgrana razem z aplikacją — ratuje pierwszą rozmowę po
   starcie instancji, gdyby strona akurat nie odpowiadała.

Równoległe zapytania dzielą jedno pobranie, więc zimny start nie wysyła kilku żądań naraz.

`data/knowledge.json` jest **kopią zapasową, nie stanem** — nic go nie zapisuje w czasie
pracy. Odświeża się go ręcznie przez `npm run crawl` i wgrywa razem z paczką.

## Co trafia do bazy danych

Trwałego zapisu potrzebują tylko dane, które **narastają** i których strona nie publikuje:
luki wiedzy, liczniki CTA i wspólne okno limitu zapytań. Obsługuje je Supabase
(`src/storage/supabase.js`, migracja w `sql/001-emmbotek.sql`) — rząd wielkości poniżej
10 MB rocznie, czyli około 2% darmowego limitu.

Liczniki podbijają funkcje w Postgresie, a nie aplikacja: instancji funkcji serverless jest
wiele i odczyt-modyfikacja-zapis gubiłby zdarzenia. Bez skonfigurowanego Supabase Emmbotek
działa normalnie — traci tylko pamięć o tych trzech rzeczach.

Pełna instrukcja, wraz z tym, co i dlaczego jest anonimizowane: **[docs/supabase.md](docs/supabase.md)**.

## Bezpieczeństwo

- Klucz Gemini wyłącznie po stronie serwera — nigdy w przeglądarce.
- Rate limit po IP (sliding window), allowlista `Origin`, limit 600 znaków, limit historii.
- Treść strony trafia do modelu jako **dane w bloku `<<<WIEDZA … WIEDZA>>>`**, nigdy jako instrukcje;
  wzorce typu „Ignore previous instructions” są neutralizowane (`src/agent/injectionGuard.js`).
- CTA zaproponowane przez model są walidowane względem mapy CTA zbudowanej podczas
  indeksowania: cel musi być **tym samym adresem**, który crawler zaindeksował (dozwolona jest
  jedynie doklejona kotwica do sekcji). Sam schemat `https://` nie jest autoryzacją — bez tego
  porównania błąd modelu albo udana prompt injection zamieniałyby zaufane CTA w link phishingowy.
  Adres spoza mapy jest zastępowany adresem z katalogu, a gdy takiego nie ma — CTA nie powstaje.
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

106 testów pokrywa checklistę jakości z sekcji 46 briefu — m.in. test aktualnej ceny,
zmiany ceny, nowego wpisu blogowego, nowej aktualności, usuniętej podstrony, starej promocji,
konfliktu źródeł, braku wiedzy, luk wiedzy, prompt injection, 429, CTA i integralności awatara.
Mapowanie „punkt briefu → test” znajduje się w [`docs/zgodnosc-z-briefem.md`](docs/zgodnosc-z-briefem.md).
