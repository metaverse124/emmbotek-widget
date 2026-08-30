# Skąd Emmbotek weźmie wiedzę o stronie

Dokument opisuje blokadę wykrytą 2026-08-30 przy pierwszym crawlu prawdziwej strony
oraz możliwe drogi wyjścia. Decyzja należy do właściciela projektu.

## Co się stało

`npm run crawl` przeszedł całą sitemapę emmastudio.pl — **39 adresów, 39 niepowodzeń**,
wszystkie z tym samym powodem: `zbyt malo tresci`.

Powód nie leży po stronie crawlera. emmastudio.pl to aplikacja React + Vite: serwer
oddaje szkielet HTML z metadanymi i pustym `<div id="root">`, a cały tekst dokleja
JavaScript w przeglądarce. Crawler HTTP nie wykonuje JavaScriptu, więc widzi stronę
bez treści:

```
$ curl -s https://emmastudio.pl/oferta | grep -c "Business English"
0
```

Krok po budowaniu (`narzedzia/po-budowaniu.mjs` w repozytorium strony) generuje osobny
`index.html` dla każdej ścieżki, ale wpisuje do niego **tylko `<title>` i `<meta>`** —
na potrzeby robotów społecznościowych. Treści tam nie ma.

Skutkiem ubocznym tego przebiegu było odkrycie dwóch błędów, już naprawionych:
adresy nie były normalizowane (`/oferta` i `/oferta/` uchodziły za dwie różne strony,
przez co żywa podstrona trafiała do archiwum), a przebieg, w którym nie udało się
pobrać **niczego**, traktował to jako dowód, że strona zniknęła.

## Czego potrzebujemy

Brief wymaga **żywej bazy wiedzy**: asystent ma znać także treści opublikowane po
wdrożeniu (nowe wpisy blogowe, aktualności, zmiany w cenniku). Samo jednorazowe
przepisanie oferty do pliku tego nie spełnia.

## Trzy drogi

### A. Kanał wiedzy budowany razem ze stroną (`/wiedza.json`)

Repozytorium strony dostaje skrypt w `narzedzia/`, który przy `npm run build` zapisuje
`public/wiedza.json` — ustrukturyzowany zrzut treści prosto ze źródeł prawdy:
`src/data/oferta.ts` (tabela cennika, 12 wierszy), `kontakt.ts`, `blogPosts.ts`,
`ogloszenia.ts` i rejestr stron `strony.ts`. Crawler pobiera jeden adres zamiast 39.

- **Za:** dane dokładne, nie zgadywane ze scrapingu; ceny i kontakt trafiają do
  asystenta w tej samej postaci, w jakiej widzi je klient; przebieg trwa sekundę,
  więc mieści się w cronie; wzorzec już w repozytorium istnieje (`eksport-stron.mjs`).
- **Przeciw:** proza zaszyta w komponentach JSX (`/o-nas`, `/standardy`) nie wchodzi
  tam sama — trzeba ją wyciągnąć albo dopisać skrótem; treści dodane przez CMS po
  wdrożeniu wymagają osobnego odczytu z Supabase.

### B. Prerendering stron do pełnego HTML-a

Krok po budowaniu przestaje wpisywać same metadane i zaczyna renderować komponenty
do HTML-a (`react-dom/server`). Crawler działa bez żadnej zmiany.

- **Za:** rozwiązuje przy okazji **dziurę SEO strony** — dziś roboty Google widzą
  podstrony i 25 wpisów blogowych jako puste szkielety; wpisy blogowe nie mają nawet
  własnych prerenderowanych plików.
- **Przeciw:** realna zmiana w działającej produkcyjnie stronie; wymaga, żeby żaden
  komponent nie dotykał `window`/`localStorage` na poziomie modułu; treści z CMS
  nadal pojawiają się dopiero po przebudowaniu strony.

### C. Crawl w przeglądarce bezgłowej (Playwright w GitHub Actions)

Crawler dostaje drugi pobieracz: zamiast `fetch` uruchamia przeglądarkę, czeka na
wyrenderowanie i oddaje gotowy HTML. Przebieg nie mieści się w funkcji serverless,
więc jedzie w GitHub Actions według harmonogramu i zapisuje wynik do magazynu.

- **Za:** zero zmian w stronie; asystent widzi dokładnie to, co użytkownik, łącznie
  z treściami z CMS-a; naprawdę „żywy" bez udziału builda strony.
- **Przeciw:** ciężki (przeglądarka w CI), wolniejszy, i najbardziej kruchy —
  każda zmiana układu strony może zmienić to, co crawler uzna za treść.

## Rekomendacja

**A jako podstawa, B jako osobna, wartościowa robota na stronie.**

A daje dokładne dane najmniejszym kosztem i najszybciej odblokowuje asystenta.
B warto zrobić niezależnie od Emmbotka, bo strona traci dziś na SEO — a gdy powstanie,
crawler HTML zacznie działać sam z siebie i stanie się zapasowym źródłem wiedzy.
C zostaje w odwodzie na wypadek, gdyby żadna zmiana w repozytorium strony nie wchodziła
w grę.

Niezależnie od wyboru: treści dodawane przez panel `/emmadmin` (tabele `site_content`
i `blog_posts` w Supabase) powinny trafiać do bazy wiedzy odczytem wprost z Supabase —
inaczej „żywa" jest tylko do najbliższego wdrożenia strony.
