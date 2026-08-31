# Wdrożenie Emmbotka na emmastudio.pl

Instrukcja od zera do działającego asystenta. Całość to **cztery etapy**, każdy da się
sprawdzić osobno — jeśli coś nie zagra, wiadomo dokładnie gdzie.

Układ docelowy: **backend na Vercelu, widżet na LH.pl razem ze stroną.** Pliki widżetu
celowo leżą na Twoim serwerze — gdyby przychodziły z Vercela, każdy odwiedzający
(także ten, który nigdy nie otworzy czatu) wysyłałby swoje IP do obcej firmy przy samym
wejściu na stronę. Tak jak przy fontach.

---

## Etap 1 — baza danych (Supabase)

Baza obsługuje wyłącznie luki wiedzy, liczniki kliknięć i wspólny limit zapytań.
**Bez niej asystent działa normalnie**, więc ten etap można pominąć i wrócić do niego później.

1. W panelu Supabase otwórz **SQL Editor**.
2. Wklej całą zawartość `sql/001-emmbotek.sql` i wykonaj. Plik jest idempotentny.
3. **Settings → API** — skopiuj *Project URL* oraz klucz **`service_role`**
   (ten opisany „secret", **nie** `anon`).

Szczegóły i odpowiedzi na „co tam trafia": [docs/supabase.md](docs/supabase.md).

---

## Etap 2 — backend na Vercelu

1. Zaloguj się na Vercel kontem, na którym stoją Twoje projekty.
2. **Add New → Project → Import Git Repository** → wskaż `metaverse124/emmbotek-widget`.
3. Framework Preset: **Other**. Build Command: **zostaw puste**. Output Directory:
   **zostaw puste**. Projekt nie ma kroku budowania — to funkcje serverless plus pliki
   statyczne.
4. Przed pierwszym wdrożeniem wejdź w **Environment Variables** i dodaj:

| Zmienna | Wartość | Uwagi |
|---|---|---|
| `GEMINI_API_KEY` | klucz z aistudio.google.com | **wymagane** |
| `ALLOWED_ORIGINS` | `https://emmastudio.pl,https://www.emmastudio.pl` | bez spacji po przecinku |
| `SITE_URL` | `https://emmastudio.pl` | |
| `KNOWLEDGE_FEED_URL` | `https://emmastudio.pl/wiedza.json` | |
| `SYNC_TOKEN` | wymyśl długi losowy ciąg | do ręcznego odświeżania wiedzy |
| `SUPABASE_URL` | z etapu 1 | pominąć, jeśli bez bazy |
| `SUPABASE_SERVICE_ROLE_KEY` | z etapu 1 | pominąć, jeśli bez bazy |

5. **Deploy**. Zapisz adres, który dostaniesz — np. `https://emmbotek-widget.vercel.app`.

**Sprawdzenie etapu:** otwórz w przeglądarce `https://TWOJ-ADRES.vercel.app/` — powinna
pokazać się strona demo z maskotką. Jeśli widzisz listę plików albo błąd 404, wróć do
punktu 3 (Output Directory musi być puste).

---

## Etap 3 — strona na LH.pl

Zmiany są już w gałęzi `rebranding-2026` repozytorium strony. Trzeba je zbudować
z adresem backendu i wgrać.

1. W katalogu strony utwórz albo uzupełnij plik `.env`:

```
VITE_EMMBOTEK_API=https://TWOJ-ADRES.vercel.app
```

Bez ukośnika na końcu. **Bez tej zmiennej widżet się nie włączy** — strona zadziała
normalnie, tylko bez czatu. To celowe zabezpieczenie, żeby nie wgrać widżetu
wskazującego w próżnię.

2. Zbuduj paczkę:

```bash
npm run build
```

3. Wgraj zawartość katalogu `dist/` na serwer LH.pl, tak jak przy poprzednich wydaniach.
   **Nie pomijaj** katalogu `emmbotek/` ani pliku `wiedza.json` — bez pierwszego nie ma
   widżetu, bez drugiego asystent nie zna oferty.

4. Upewnij się, że `.htaccess` z paczki nadpisał ten na serwerze. Zawiera dwa nowe
   wyjątki: na `wiedza.json` i na `manifest.json`. Bez nich reguła blokująca pliki `.json`
   odpowie **błędem 403** — asystent nie pozna oferty i pokaże się bez maskotki.

**Sprawdzenie etapu**, wpisz w przeglądarce:

- `https://emmastudio.pl/wiedza.json` — powinien pokazać się JSON z ofertą (nie 403),
- `https://emmastudio.pl/emmbotek/avatars/manifest.json` — też JSON (nie 403),
- `https://emmastudio.pl/` — w prawym dolnym rogu pulsująca zakładka z maskotką.

---

## Etap 4 — pierwsza rozmowa

1. Wejdź na `https://emmastudio.pl`, kliknij zakładkę.
2. **Zaznacz zgodę** na zasady korzystania — bez tego pole pisania jest zablokowane.
3. Zapytaj o coś sprawdzalnego, na przykład: *„Ile kosztuje kurs hiszpańskiego
   dla dorosłych?"*.

Poprawna odpowiedź podaje **89 zł za 60 minut** przy zajęciach indywidualnych
z polskim lektorem i **99 zł** z native speakerem — czyli dokładnie to, co stoi
w cenniku. Jeśli asystent odpowiada ogólnikami bez liczb, wiedza do niego nie dotarła:
sprawdź `KNOWLEDGE_FEED_URL` i dostępność `wiedza.json`.

Na koniec sprawdź bazę (jeśli robiłeś etap 1):

```bash
node --env-file=.env scripts/test-supabase.mjs
```

---

## Gdy coś nie działa

| Objaw | Przyczyna | Co zrobić |
|---|---|---|
| Zakładka w ogóle się nie pokazuje | brak `VITE_EMMBOTEK_API` przy budowaniu | dodaj do `.env` i zbuduj ponownie |
| Zakładka jest, ale rozmowa kończy się błędem | zły adres backendu albo brak domeny w `ALLOWED_ORIGINS` | sprawdź obie zmienne na Vercelu |
| Asystent odpowiada ogólnikami, bez cen | nie widzi `wiedza.json` | wejdź na `/wiedza.json` — jeśli 403, brakuje wyjątku w `.htaccess` |
| Widżet bez maskotki, same napisy | `manifest.json` blokowany | ten sam wyjątek w `.htaccess` |
| „Chwilowo mam komplet rozmów" | limit zapytań | to normalne przy nawale; wraca po minucie |
| Odpowiedzi po 20 sekundach | model główny bywa przeciążony | próg przełączenia na model zapasowy to 9 s; zwykle jest 3–7 s |

Diagnostyka backendu — pokazuje, skąd wzięła się wiedza i ile dokumentów widzi:

```bash
curl -X POST -H "x-sync-token: TWOJ_SYNC_TOKEN" https://TWOJ-ADRES.vercel.app/api/sync
```

W odpowiedzi `"source":"kanal"` znaczy, że wiedza przyszła ze strony. `"source":"plik"`
znaczy, że strona nie oddała kanału i asystent pracuje na kopii zapasowej wgranej razem
z aplikacją — wtedy zajrzyj do pola `error`.

---

## Po każdej zmianie w widżecie

Widżet mieszka w tym repozytorium, a jego kopia leży na stronie. Po zmianach:

```bash
npm run paczka-widget                       # tworzy dist-widget/
```

Skopiuj zawartość `dist-widget/` do `public/emmbotek/` w repozytorium strony,
zbuduj stronę i wgraj ponownie. Krok jest ręczny celowo — dzięki temu wydanie strony
nigdy nie zmienia się samo od siebie po zmianie w asystencie.

---

## Co warto zrobić po wdrożeniu

Po tygodniu-dwóch sprawdź, o co ludzie pytali, a czego nie było na stronie:

```bash
npm run luki
```

To najcenniejsza rzecz, jaką Emmbotek zbiera: lista tematów, które warto dopisać.
