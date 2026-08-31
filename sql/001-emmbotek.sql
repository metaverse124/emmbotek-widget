-- =============================================================================
--  Emmbotek — trwaly zapis tego, czego strona nie publikuje
--
--  Wiedza o ofercie NIE trafia do bazy: pochodzi z kanalu /wiedza.json i zyje
--  w pamieci instancji. Tutaj laduja wylacznie dane, ktore narastaja:
--
--    1. luki wiedzy   — pytania bez pokrycia w tresci strony (najcenniejsze dla szkoly),
--    2. liczniki CTA  — ile razy przycisk sie pokazal i ile razy zostal klikniety,
--    3. limity zapytan — wspolne dla wszystkich instancji funkcji serverless.
--
--  Wszystko jest ZAGREGOWANE, nie zdarzeniowe: jeden wiersz na kombinacje, licznik
--  w kolumnie. Dzieki temu baza nie rosnie liniowo z ruchem — po roku to jednostki
--  megabajtow, a nie setki.
--
--  Zadna z tych tabel nie zawiera danych osobowych: bez IP, bez identyfikatora sesji,
--  bez tresci rozmowy. Z adresu strony zostaje sama sciezka.
--
--  Uruchomienie: wklej caly plik do SQL Editor w panelu Supabase i wykonaj.
--  Jest idempotentny — mozna puscic ponownie.
-- =============================================================================

-- ------------------------------------------------------------------ 1. LUKI --

create table if not exists public.emmbotek_luki (
  klucz            text primary key,          -- znormalizowane pytanie (12 pierwszych slow)
  pytanie          text        not null,      -- wersja czytelna, po anonimizacji
  liczba           integer     not null default 1,
  intencje         text[]      not null default '{}',
  najlepszy_wynik  real        not null default 0,   -- najlepsze trafienie retrievalu
  pierwszy_raz     timestamptz not null default now(),
  ostatni_raz      timestamptz not null default now(),
  status           text        not null default 'nowa'  -- nowa | w_toku | uzupelniona | odrzucona
);

comment on table public.emmbotek_luki is
  'Pytania, na ktore Emmbotek nie znalazl odpowiedzi w tresci strony. Zanonimizowane i zagregowane.';

create index if not exists emmbotek_luki_czestotliwosc
  on public.emmbotek_luki (liczba desc, ostatni_raz desc);

-- --------------------------------------------------------------- 2. LICZNIKI --

create table if not exists public.emmbotek_cta (
  zdarzenie   text        not null,   -- cta_impression | cta_click
  cta_typ     text        not null,
  intencja    text        not null default 'GENERAL',
  -- Obie kolumny wchodza do klucza glownego, wiec NIE MOGA byc NULL: Postgres tego
  -- zabrania, a poza tym NULL nigdy nie rowna sie NULL, wiec `on conflict` nigdy by nie
  -- trafil i zamiast podbijac licznik dokladalibysmy nowy wiersz przy kazdym klikniecu.
  etap        text        not null default '-',   -- eksploracja | dopasowanie | decyzja | kontakt
  sciezka     text        not null default '-',   -- sama sciezka adresu, bez query i fragmentu
  liczba      integer     not null default 0,
  ostatni_raz timestamptz not null default now(),
  primary key (zdarzenie, cta_typ, intencja, etap, sciezka)
);

comment on table public.emmbotek_cta is
  'Zagregowane liczniki wyswietlen i klikniec przyciskow CTA. Bez IP i bez identyfikatora sesji.';

-- ----------------------------------------------------------------- 3. LIMITY --

create table if not exists public.emmbotek_limity (
  klucz    text        primary key,   -- skrot adresu IP, nie sam adres
  okno_od  timestamptz not null default now(),
  liczba   integer     not null default 0
);

comment on table public.emmbotek_limity is
  'Okno limitu zapytan wspolne dla wszystkich instancji. Klucz to skrot, nie adres IP.';

-- ------------------------------------------------------------------- DOSTEP --

-- RLS wlaczone i BEZ polityk: nikt z kluczem publicznym nie zajrzy i nie dopisze.
-- Backend Emmbotka laczy sie kluczem service_role, ktory RLS omija.
alter table public.emmbotek_luki   enable row level security;
alter table public.emmbotek_cta    enable row level security;
alter table public.emmbotek_limity enable row level security;

revoke all on public.emmbotek_luki,   public.emmbotek_cta,   public.emmbotek_limity from anon, authenticated;

-- ---------------------------------------------------------------- FUNKCJE --
-- Liczniki podbijamy w bazie, a nie w aplikacji. Odczyt-modyfikacja-zapis po stronie
-- funkcji serverless gubilby zdarzenia, bo instancji jest wiele i pracuja rownolegle.

create or replace function public.emmbotek_zapisz_luke(
  p_klucz    text,
  p_pytanie  text,
  p_intencja text default 'GENERAL',
  p_wynik    real default 0
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.emmbotek_luki as l (klucz, pytanie, liczba, intencje, najlepszy_wynik)
  values (p_klucz, p_pytanie, 1, array[coalesce(p_intencja, 'GENERAL')], coalesce(p_wynik, 0))
  on conflict (klucz) do update set
    liczba          = l.liczba + 1,
    ostatni_raz     = now(),
    najlepszy_wynik = greatest(l.najlepszy_wynik, excluded.najlepszy_wynik),
    intencje        = coalesce((
      select array_agg(distinct i)
      from unnest(l.intencje || excluded.intencje) as i
    ), l.intencje);
$$;

comment on function public.emmbotek_zapisz_luke is
  'Dopisuje pytanie bez pokrycia albo podbija licznik istniejacego. Wolane przez backend Emmbotka.';

create or replace function public.emmbotek_zapisz_cta(p_zdarzenia jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  zapisanych integer := 0;
begin
  insert into public.emmbotek_cta as c (zdarzenie, cta_typ, intencja, etap, sciezka, liczba)
  select
    z ->> 'zdarzenie',
    z ->> 'cta_typ',
    coalesce(nullif(z ->> 'intencja', ''), 'GENERAL'),
    coalesce(nullif(z ->> 'etap', ''), '-'),
    coalesce(nullif(z ->> 'sciezka', ''), '-'),
    1
  from jsonb_array_elements(p_zdarzenia) as z
  where z ->> 'zdarzenie' is not null and z ->> 'cta_typ' is not null
  on conflict (zdarzenie, cta_typ, intencja, etap, sciezka) do update set
    liczba      = c.liczba + 1,
    ostatni_raz = now();

  get diagnostics zapisanych = row_count;
  return zapisanych;
end;
$$;

comment on function public.emmbotek_zapisz_cta is
  'Podbija liczniki CTA dla paczki zdarzen. Agregacja po stronie bazy, bez wyscigu miedzy instancjami.';

create or replace function public.emmbotek_sprawdz_limit(
  p_klucz   text,
  p_okno_ms integer,
  p_max     integer
) returns table (dozwolone boolean, pozostalo integer, ponow_za_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  okno interval := make_interval(secs => p_okno_ms::double precision / 1000);
  wiersz public.emmbotek_limity%rowtype;
begin
  -- Jedno zapytanie zamyka caly cykl: wstaw albo podbij, z resetem okna gdy minelo.
  insert into public.emmbotek_limity as t (klucz, okno_od, liczba)
  values (p_klucz, now(), 1)
  on conflict (klucz) do update set
    okno_od = case when now() - t.okno_od >= okno then now() else t.okno_od end,
    liczba  = case when now() - t.okno_od >= okno then 1 else t.liczba + 1 end
  returning * into wiersz;

  return query select
    wiersz.liczba <= p_max,
    greatest(p_max - wiersz.liczba, 0),
    case
      when wiersz.liczba <= p_max then 0
      else greatest(ceil(extract(epoch from (wiersz.okno_od + okno - now())) * 1000)::integer, 0)
    end;
end;
$$;

comment on function public.emmbotek_sprawdz_limit is
  'Atomowe okno limitu zapytan wspolne dla wszystkich instancji. Zwraca decyzje i czas do odblokowania.';

-- Funkcje wola wylacznie backend kluczem service_role.
-- Samo odebranie praw rolom anon/authenticated nie wystarczy: Postgres nadaje prawo
-- wykonania funkcji roli PUBLIC, ktorej obie te role sa czlonkami. Odbieramy wiec
-- PUBLIC i nadajemy imiennie.
revoke all on function
  public.emmbotek_zapisz_luke(text, text, text, real),
  public.emmbotek_zapisz_cta(jsonb),
  public.emmbotek_sprawdz_limit(text, integer, integer)
from public, anon, authenticated;

grant execute on function
  public.emmbotek_zapisz_luke(text, text, text, real),
  public.emmbotek_zapisz_cta(jsonb),
  public.emmbotek_sprawdz_limit(text, integer, integer)
to service_role;

-- ------------------------------------------------------------------ PORZADKI --
-- Wiersze limitow sa smieciem po wygasnieciu okna. Sprzatanie jest tanie i moze
-- dziac sie przy okazji - nie potrzeba do tego harmonogramu.

create or replace function public.emmbotek_sprzataj_limity(p_starsze_niz interval default interval '1 hour')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  usunietych integer;
begin
  delete from public.emmbotek_limity where okno_od < now() - p_starsze_niz;
  get diagnostics usunietych = row_count;
  return usunietych;
end;
$$;

revoke all on function public.emmbotek_sprzataj_limity(interval) from public, anon, authenticated;
grant execute on function public.emmbotek_sprzataj_limity(interval) to service_role;
