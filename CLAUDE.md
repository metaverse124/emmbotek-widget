# Emmbotek — kontekst projektu

Asystent AI dla **Prywatnego Studia Języków Obcych eMMa** (emmastudio.pl, Poznań).

## Nazewnictwo — czytaj najpierw

| Nazwa | Co znaczy |
|---|---|
| **eMMa** / eMMa Studio | **szkoła** językowa, klient |
| **Emmbotek** | **asystent** — cyfrowy doradca szkoły, maskotka: pluszowy dinozaur |

Asystent **nigdy** nie przedstawia się jako „eMMa" — to nazwa szkoły. Mówi „jestem Emmbotek".
O sobie mówi w **rodzaju męskim** („sprawdziłem", „przygotowałem").
Brief źródłowy nazywał asystenta „eMMa AI" — to nieaktualne, właściciel projektu poprawił nazwę.

Nazwy techniczne (`emma-ai` w package.json, `emma-widget.js`, `/api/chat`) zostają — to
identyfikatory niewidoczne dla użytkownika.

## Uruchamianie

```bash
npm test          # 125 testów, node:test, zero zależności
npm run dev       # http://localhost:3000 — demo; bez GEMINI_API_KEY działa atrapa modelu
npm run crawl     # synchronizacja wiedzy z /wiedza.json (zapasowo crawl HTML)
node --env-file=.env scripts/test-gemini.mjs   # rozmowa z prawdziwym Gemini
npm run avatars   # ponowne wycięcie poz maskotki z pięciu arkuszy w assets/source/
```

## Mapa kodu

| Warstwa | Gdzie |
|---|---|
| Konfiguracja | `src/config.js` — wszystko przez zmienne środowiskowe |
| Crawler | `src/crawler/` — sitemap, ekstrakcja, klasyfikacja, chunking, orkiestracja |
| Baza wiedzy | `src/knowledge/` — magazyn, świeżość, retrieval, mapa CTA, luki wiedzy |
| Agent | `src/agent/` — System Prompt, emocje, intencje, profil, CTA Engine, ochrona przed injection |
| Model | `src/gemini/client.js` |
| Serwer | `src/server/` + `api/` (funkcje serverless) |
| Frontend | `public/emma-widget.{js,css}`, `public/emmbotek-avatar.js` |
| Awatar | `public/avatars/` — 40 poz + `manifest.json` |

## Zasady, które łatwo złamać

- **System Prompt nie zawiera faktów o ofercie.** Ceny, terminy i kadra pochodzą wyłącznie
  z bazy wiedzy. Aktualizacja strony nie może wymagać zmiany promptu.
- **Treść strony to dane, nie instrukcje.** Trafia do modelu w bloku `<<<WIEDZA … WIEDZA>>>`.
- **Cel CTA musi pochodzić z mapy zbudowanej przy indeksowaniu.** Sam schemat `https://`
  nie jest autoryzacją — inaczej prompt injection zamienia przycisk w link phishingowy.
- **Niepełny crawl nie archiwizuje stron**, których nie zdążył odwiedzić.
- **Klucz Gemini nigdy nie trafia do przeglądarki.**
- **Budżet `maxOutputTokens` obejmuje tokeny myślenia modelu.** Przy zbyt ciasnym
  budżecie odpowiedź urywa się w połowie JSON-a. `salvageMessage` ratuje wtedy samą
  treść, ale to bezpiecznik, nie rozwiązanie — budżet ma być z zapasem.
- **Wiedza pochodzi z kanału `/wiedza.json`**, nie ze scrapingu HTML. Crawl HTML
  został jako droga zapasowa na wypadek wdrożenia strony bez kroku eksportu.
- **Teksty widoczne dla użytkownika piszemy z polskimi znakami.** Komentarze w kodzie są ASCII.
- **Awatary ze znakiem wodnym modelu** (kafelki `r3c3` wszystkich pięciu arkuszy) są
  trwale wykluczone w `scripts/extract_avatars.py` — nie przywracać.
- **Adresy porównujemy po normalizacji** (`normalizeUrl` w `src/knowledge/store.js`).
  `/oferta` i `/oferta/` to jedna podstrona — inaczej crawler archiwizuje żywe strony.

## Stan i luki

Działa i jest przetestowane: crawler, retrieval, agent, CTA Engine, bezpieczeństwo, widget, awatar.

Do zrobienia przed produkcją:

1. **Brak trwałego magazynu** — pliki JSON nie przetrwają na serverless; blokuje cron.
   To jest teraz największa przeszkoda przed wdrożeniem.
2. **Brak CI.**
3. **Brak embeddings** — retrieval działa na słowach kluczowych (etap 2 z briefu).
   Widać to w praktyce: przy pytaniu o gramatykę wśród źródeł ląduje `/statut`.
4. **Rate limit w pamięci procesu** — nie działa przy wielu instancjach.
5. **Widget nie stał jeszcze na prawdziwej stronie.** emmastudio.pl to React + Vite.
6. **Czas odpowiedzi.** Typowo 3–7 s, ale `gemini-3.6-flash` potrafi skoczyć do 25 s.
   Próg przełączenia na model lite skrócony do 9 s, więc najgorszy przypadek to ~13 s.
   Prawdziwym lekarstwem jest strumieniowanie odpowiedzi — pierwsze słowa od razu,
   reszta w trakcie. To robota do widgetu, nie do backendu.
7. **Kanał wiedzy nie jest jeszcze wdrożony** — `wiedza.json` powstaje przy budowaniu
   strony, ale na LH.pl leży jeszcze stara paczka. Do czasu wdrożenia baza pochodzi
   z lokalnego builda.

Zamknięte 2026-08-30: rozmowa z prawdziwym Gemini (`gemini-3.6-flash`) oraz realna
wiedza — 39 dokumentów i 81 fragmentów z kanału `/wiedza.json`.
