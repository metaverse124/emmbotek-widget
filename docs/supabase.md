# Supabase — co tam trafia i jak to uruchomić

## Po co to jest

Wiedza o ofercie **nie** trafia do bazy. Pochodzi z kanału `/wiedza.json` i żyje w pamięci
instancji — szczegóły w `src/knowledge/provider.js`. Baza obsługuje wyłącznie trzy rzeczy,
których strona nie publikuje, a które **narastają**:

| Tabela | Co trzyma | Po co |
|---|---|---|
| `emmbotek_luki` | pytania bez pokrycia w treści strony | **najcenniejsze dla szkoły** — lista tego, o co ludzie pytają, a czego nie ma na stronie |
| `emmbotek_cta` | ile razy przycisk się pokazał i ile razy został kliknięty | które ścieżki działają, a które nie |
| `emmbotek_limity` | okno limitu zapytań | żeby limit obowiązywał wspólnie dla wszystkich instancji, a nie osobno w każdej |

Bez skonfigurowanego Supabase **Emmbotek działa normalnie** — traci tylko pamięć o tych
trzech rzeczach, a limit zapytań spada do pamięci pojedynczej instancji.

## Ile to zajmie miejsca

Wszystko jest **zagregowane, nie zdarzeniowe**: jeden wiersz na kombinację, licznik
w kolumnie. Baza nie rośnie liniowo z ruchem.

| | Rozmiar wiersza | Przy 100 zdarzeniach dziennie |
|---|---|---|
| Luki wiedzy | ~300 B | ~2 MB rocznie |
| Liczniki CTA | ~200 B | rośnie do kilkuset wierszy i przestaje |
| Limity | ~100 B | zerowy — wiersze są sprzątane |
| **Razem** | | **poniżej 10 MB rocznie** |

To około **2% darmowego limitu 500 MB** — po roku.

## Uruchomienie, krok po kroku

**1. Wybierz projekt.** Najlepiej ten, którego używa strona (`glevfinphpxzgcmsrrrk`) —
wtedy nie zakładasz nowej usługi i projekt nie zostanie uśpiony za brak aktywności.

**2. Załóż tabele.** W panelu Supabase otwórz **SQL Editor**, wklej całą zawartość
`sql/001-emmbotek.sql` i wykonaj. Plik jest idempotentny — można go puścić ponownie.

**3. Skopiuj dane dostępowe.** W panelu: **Settings → API**. Potrzebne są dwie rzeczy:

- **Project URL** — postaci `https://xxxxx.supabase.co`
- **`service_role` key** — ten z dopiskiem „secret", **nie** `anon`/`publishable`

**4. Wpisz je do `.env`** (plik jest poza gitem):

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

**5. Sprawdź, czy działa:**

```bash
node --env-file=.env scripts/test-supabase.mjs
```

Skrypt zapisuje dane testowe, sprawdza wszystkie trzy funkcje wraz z blokadą limitu,
po czym po sobie sprząta. Klucza nigdzie nie wypisuje.

**6. Na Vercelu** te same dwie zmienne wchodzą w **Settings → Environment Variables**.
Do żadnego pliku w repozytorium nie trafiają.

## Dlaczego `service_role`, a nie klucz publiczny

Tabele mają włączone RLS **bez żadnej polityki**, a uprawnienia dla ról `anon`
i `authenticated` są odebrane. Oznacza to, że z kluczem publicznym — tym samym, który
strona wysyła do przeglądarki — **nie da się ani odczytać, ani dopisać niczego**.
Backend Emmbotka łączy się kluczem `service_role`, który RLS omija.

Konsekwencja jest taka sama jak przy kluczu Gemini: **`service_role` nigdy nie może
trafić do przeglądarki ani do repozytorium.**

## Dlaczego liczniki podbija baza, a nie aplikacja

Instancji funkcji serverless jest wiele i pracują równolegle. Gdyby każda odczytywała stan,
dodawała jedynkę i zapisywała z powrotem, przy dwóch kliknięciach w tej samej sekundzie
jedno by przepadło. Dlatego liczniki podbijają funkcje w Postgresie
(`emmbotek_zapisz_cta`, `emmbotek_zapisz_luke`) — jedno zapytanie, bez wyścigu.

Tak samo limit zapytań: `emmbotek_sprawdz_limit` wstawia albo podbija licznik i zwraca
decyzję w jednym zapytaniu, z resetem okna po jego wygaśnięciu.

## Co się dzieje, gdy baza nie odpowiada

- **Luki wiedzy i liczniki CTA** — po cichu przepadają. Telemetria nigdy nie psuje rozmowy.
- **Limit zapytań** — schodzi do limitera w pamięci instancji. Będzie luźniejszy niż
  zakładamy (każda instancja liczy swój), ale **nadal istnieje**. Awaria bazy nie może
  otworzyć bramy na oścież, bo każde zapytanie kosztuje wywołanie Gemini.

## Prywatność

Żadna z tych tabel nie zawiera danych osobowych:

- **pytania są anonimizowane** przed zapisem — e-maile, telefony i daty urodzenia są
  wycinane w `src/knowledge/gaps.js`, zanim cokolwiek opuści serwer,
- **adres IP nigdy nie trafia do bazy** — kluczem limitu jest jego skrót solony sekretem
  serwera, więc nie da się go odwrócić słownikiem wszystkich adresów,
- **z adresu strony zostaje sama ścieżka** — bez parametrów i bez fragmentu,
- nie zapisujemy identyfikatora sesji ani treści rozmowy.

## Jak odczytać luki wiedzy

Najprościej z konsoli:

```bash
npm run luki
```

Wypisze pytania od dwóch wystąpień w górę, z intencjami i datami. `npm run luki -- --od 1`
pokaże też pojedyncze, a `-- --wszystkie` również te już oznaczone jako uzupełnione.

To samo w SQL Editor:

```sql
select pytanie, liczba, intencje, ostatni_raz
from public.emmbotek_luki
where liczba >= 3 and status = 'nowa'
order by liczba desc
limit 20;
```

To jest lista tematów, które warto dopisać na stronie. Po uzupełnieniu treści ustaw
`status = 'uzupelniona'`, żeby nie wracały w kolejnym przeglądzie.

## Sprzątanie

Wiersze limitów są śmieciem po wygaśnięciu okna. Można je usunąć w dowolnej chwili:

```sql
select public.emmbotek_sprzataj_limity();
```

Nie wymaga harmonogramu — tabela i tak nie urośnie zauważalnie.
