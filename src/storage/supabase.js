/**
 * Trwaly zapis w Supabase - przez REST, bez zadnej biblioteki klienckiej.
 *
 * Do bazy trafiaja WYLACZNIE dane, ktore narastaja i ktorych strona nie publikuje:
 * luki wiedzy, liczniki CTA i okna limitu zapytan. Wiedza o ofercie pochodzi z kanalu
 * `/wiedza.json` i nigdy tu nie zaglada (patrz knowledge/provider.js).
 *
 * Agregacja dzieje sie po stronie bazy (funkcje RPC z sql/001-emmbotek.sql), bo instancji
 * funkcji serverless jest wiele i pracuja rownolegle - odczyt-modyfikacja-zapis po stronie
 * aplikacji gubilby zdarzenia.
 *
 * Klucz `service_role` omija RLS, wiec NIGDY nie moze trafic do przegladarki. Tak samo jak
 * klucz Gemini: zyje tylko w zmiennych srodowiskowych backendu.
 */
import { createHash } from 'node:crypto';

import config from '../config.js';

export class SupabaseError extends Error {
  constructor(message, { status = 0, fn = '' } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.fn = fn;
  }
}

/**
 * Klucz limitu to SKROT adresu, nie adres.
 *
 * Adres IP jest daną osobową, a limitowanie nie wymaga jego znajomosci - wystarczy, zeby
 * ten sam nadawca dawal ten sam klucz. Sol pochodzi z sekretu serwera, wiec skrotu nie da
 * sie odwrocic slownikiem wszystkich adresow IPv4.
 */
export const hashKey = (value, salt = config.security.syncToken || 'emmbotek') =>
  createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);

/**
 * @param {object} opcje
 * @param {string} opcje.url         adres projektu, np. https://xxx.supabase.co
 * @param {string} opcje.serviceKey  klucz service_role (wylacznie po stronie serwera)
 * @param {Function} opcje.fetchImpl wstrzykiwalny fetch (testy)
 * @param {number} opcje.timeoutMs   twardy limit na wywolanie
 */
export function createSupabaseStore({
  url = config.supabase.url,
  serviceKey = config.supabase.serviceKey,
  fetchImpl = fetch,
  timeoutMs = config.supabase.timeoutMs,
} = {}) {
  const skonfigurowany = Boolean(url && serviceKey);

  async function rpc(nazwa, argumenty) {
    if (!skonfigurowany) {
      throw new SupabaseError('Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY', { fn: nazwa });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${nazwa}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(argumenty),
        signal: controller.signal,
      });

      if (!response.ok) {
        const tresc = await response.text().catch(() => '');
        throw new SupabaseError(`${nazwa}: HTTP ${response.status} ${tresc.slice(0, 200)}`, {
          status: response.status,
          fn: nazwa,
        });
      }

      const tekst = await response.text();
      return tekst ? JSON.parse(tekst) : null;
    } catch (error) {
      if (error instanceof SupabaseError) throw error;
      const powod = error.name === 'AbortError' ? `przekroczono ${timeoutMs} ms` : error.message;
      throw new SupabaseError(`${nazwa}: ${powod}`, { fn: nazwa });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    skonfigurowany,

    /** Dopisuje pytanie bez pokrycia albo podbija licznik istniejacego. */
    async zapiszLuke({ klucz, pytanie, intencja = 'GENERAL', wynik = 0 }) {
      if (!klucz || !pytanie) return;
      await rpc('emmbotek_zapisz_luke', {
        p_klucz: String(klucz).slice(0, 200),
        p_pytanie: String(pytanie).slice(0, 200),
        p_intencja: String(intencja).slice(0, 40),
        p_wynik: Number(wynik) || 0,
      });
    },

    /** Podbija liczniki CTA dla paczki zdarzen (jedno wywolanie na zadanie widgetu). */
    async zapiszCta(zdarzenia) {
      const paczka = (zdarzenia ?? []).slice(0, 20).map((z) => ({
        zdarzenie: z.event,
        cta_typ: z.ctaType,
        intencja: z.sourceIntent ?? 'GENERAL',
        etap: z.conversationStage ?? null,
        sciezka: z.currentPage ?? null,
      }));
      if (!paczka.length) return 0;
      return rpc('emmbotek_zapisz_cta', { p_zdarzenia: paczka });
    },

    /**
     * Atomowe okno limitu wspolne dla wszystkich instancji.
     * @returns {{allowed: boolean, remaining: number, retryAfterMs: number}}
     */
    async sprawdzLimit(klucz, oknoMs, max) {
      const wynik = await rpc('emmbotek_sprawdz_limit', {
        p_klucz: hashKey(klucz),
        p_okno_ms: Math.round(oknoMs),
        p_max: Math.round(max),
      });
      const wiersz = Array.isArray(wynik) ? wynik[0] : wynik;
      if (!wiersz) throw new SupabaseError('emmbotek_sprawdz_limit nie zwrocil wiersza');
      return {
        allowed: Boolean(wiersz.dozwolone),
        remaining: Number(wiersz.pozostalo ?? 0),
        retryAfterMs: Number(wiersz.ponow_za_ms ?? 0),
      };
    },
  };
}

/** Domyslny magazyn uzywany przez handlery produkcyjne. */
export const supabaseStore = createSupabaseStore();
