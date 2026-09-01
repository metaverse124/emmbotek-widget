/**
 * Centralna konfiguracja eMMa AI.
 * Wszystkie wartosci wrazliwe pochodza ze zmiennych srodowiskowych (nigdy z frontendu).
 */

const env = (key, fallback) => {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
};

const num = (key, fallback) => {
  const value = Number.parseInt(env(key, ''), 10);
  return Number.isFinite(value) ? value : fallback;
};

/** '1', 'true', 'tak' -> true; '0', 'false', 'nie' -> false; brak wartosci -> domyslna. */
const bool = (key, fallback) => {
  const value = String(env(key, '')).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'tak', 'yes'].includes(value);
};

const list = (key, fallback = []) => {
  const value = env(key, '');
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback;
};

export const config = {
  school: {
    name: 'eMMa - Prywatne Studio Jezykow Obcych',
    city: 'Poznan',
    since: 1992,
    /**
     * Jezyki, w ktorych mozna prowadzic rozmowe z Emmbotkiem - te same, ktorych
     * uczy szkola. `kod` idzie do atrybutu lang, `nazwa` na przycisk wyboru,
     * `wlasna` to nazwa jezyka w nim samym (tak podpisuje sie go na liscie).
     */
    languages: ['angielski', 'hiszpanski'],
    chatLanguages: [
      { kod: 'pl', nazwa: 'polski', wlasna: 'Polski' },
      { kod: 'en', nazwa: 'angielski', wlasna: 'English' },
      { kod: 'es', nazwa: 'hiszpanski', wlasna: 'Español' },
      { kod: 'de', nazwa: 'niemiecki', wlasna: 'Deutsch' },
      { kod: 'fr', nazwa: 'francuski', wlasna: 'Français' },
      { kod: 'it', nazwa: 'wloski', wlasna: 'Italiano' },
      { kod: 'ru', nazwa: 'rosyjski', wlasna: 'Русский' },
      { kod: 'uk', nazwa: 'ukrainski', wlasna: 'Українська' },
      { kod: 'ko', nazwa: 'koreanski', wlasna: '한국어' },
    ],
    groupSize: '4-8 osob',
  },
  site: {
    url: env('SITE_URL', 'https://emmastudio.pl'),
    sitemap: env('SITEMAP_URL', 'https://emmastudio.pl/sitemap.xml'),
    /**
     * Kanal wiedzy publikowany przez strone przy budowaniu (narzedzia/eksport-wiedzy.mjs
     * w repozytorium emmastudiooo). Strona renderuje sie w przegladarce, wiec crawler HTTP
     * widzi same puste szkielety - kanal oddaje tresc wprost ze zrodel prawdy.
     * Pusta wartosc wylacza kanal i przywraca crawl HTML.
     */
    feed: env('KNOWLEDGE_FEED_URL', 'https://emmastudio.pl/wiedza.json'),
  },
  gemini: {
    apiKey: env('GEMINI_API_KEY', ''),
    /**
     * gemini-2.5-flash zostal wycofany dla nowych kluczy - API odpowiada wtedy 404
     * z podpowiedzia, zeby uzyc modelu 3.6. Sprawdzone 2026-08-30 na zywym kluczu:
     * gemini-3.6-flash dziala, gemini-flash-latest wraca z 503 (przeciazenie),
     * a gemini-flash-lite-latest odpowiada w ~1,5 s - stad taki zapasowy.
     */
    /*
       Kolejnosc modeli odwrocona 2026-09-01 na podstawie pomiaru na zywym kluczu.
       Cztery kolejne wywolania kazdego, ten sam prompt i ta sama konfiguracja:

         gemini-3.6-flash          8202 ms | 52460 ms | HTTP 429 | HTTP 429
         gemini-flash-lite-latest   964 ms |  1332 ms |   985 ms |  760 ms

       Model "mocniejszy" na darmowym planie albo przekracza prog przelaczenia,
       albo odbija sie od limitu. W efekcie KAZDA rozmowa najpierw marnowala
       wywolanie i do dziewieciu sekund czekania, a odpowiadal i tak model lekki -
       widac to bylo w polu meta.model kazdej odpowiedzi z produkcji.

       Jakosc sprawdzona na tych samych pytaniach: lekki model podaje te same ceny,
       te same CTA i poprawne polskie znaki. Zamiana daje odpowiedzi w 1,6-1,9 s
       zamiast 5-7 s i o polowe mniejsze zuzycie limitu.

       Ciezszy model zostaje jako zapasowy - gdyby lekki kiedys zawiodl, lepiej
       poczekac dluzej niz nie odpowiedziec wcale.
    */
    model: env('GEMINI_MODEL', 'gemini-flash-lite-latest'),
    fallbackModel: env('GEMINI_FALLBACK_MODEL', 'gemini-3.6-flash'),
    endpoint: env('GEMINI_ENDPOINT', 'https://generativelanguage.googleapis.com/v1beta/models'),
    temperature: 0.6,
    /**
     * Budzet obejmuje tez tokeny myslenia modelu. Przy 800 odpowiedz z pelnym
     * kontraktem (tresc + CTA + profil) urywala sie w polowie JSON-a i do
     * uzytkownika trafialy nawiasy klamrowe zamiast zdania.
     */
    maxOutputTokens: num('GEMINI_MAX_OUTPUT_TOKENS', 2048),
    /** Poziom myslenia modeli 3.x: '' wylacza pole, 'low' skraca czas odpowiedzi o polowe. */
    thinkingLevel: env('GEMINI_THINKING_LEVEL', 'low'),
    // Strumieniowanie odpowiedzi. Wylaczone na podstawie pomiaru - powody
    // i liczby w src/server/sse.js przy `chceStrumienia`.
    streaming: bool('GEMINI_STREAMING', false),
    /**
     * Prog przelaczenia na model zapasowy, a nie realny limit cierpliwosci.
     * Po zamianie kolejnosci modeli glowny (lekki) odpowiada w okolo sekunde,
     * wiec dziewiec sekund to bardzo duzy zapas - siega po zapasowy dopiero
     * wtedy, gdy naprawde cos jest nie tak.
     */
    timeoutMs: num('GEMINI_TIMEOUT_MS', 9000),
  },
  security: {
    allowedOrigins: list('ALLOWED_ORIGINS', ['https://emmastudio.pl', 'https://www.emmastudio.pl']),
    /**
     * Czy zadanie bez naglowka Origin ma byc odrzucane. Domyslnie tak na produkcji:
     * przegladarka przy tresci JSON zawsze wysyla Origin, wiec brak naglowka znaczy
     * "to nie widget". Lokalnie zostaje furtka na diagnostyke curl-em.
     */
    requireOrigin: bool('REQUIRE_ORIGIN', process.env.NODE_ENV === 'production'),
    /**
     * Sekret do podpisywania krotkotrwalych tokenow wstepu (src/server/token.js).
     * Sama jego obecnosc wlacza ochrone - bez niego /api/chat dziala jak dotad.
     * Nagłowek Origin da sie podrobic curl-em, wiec allowlista sama nie wystarcza.
     */
    tokenSecret: env('TOKEN_SECRET', ''),
    /** Jak dlugo token jest wazny. 20 minut wystarcza na rozmowe, a skrypt musi
     *  po kazdym wygasnieciu wracac po nowy. */
    tokenTtlMs: num('TOKEN_TTL_MS', 20 * 60 * 1000),
    /**
     * Dzienny budzet zapytan do modelu - twarda granica na wypadek naduzycia.
     * Po jego przekroczeniu Emmbotek odsyla do sekretariatu zamiast wolac Gemini.
     * To jedyne zabezpieczenie, ktore GWARANTUJE, ze limit nie zostanie przepalony.
     */
    dailyBudget: num('DAILY_BUDGET', 800),
    syncToken: env('SYNC_TOKEN', ''),
    /**
     * Vercel Cron wysyla `Authorization: Bearer $CRON_SECRET`, a nie nasz SYNC_TOKEN.
     * Akceptujemy oba, zeby cron dzialal bez recznego ustawiania naglowka.
     */
    cronSecret: env('CRON_SECRET', ''),
    rateLimit: {
      windowMs: num('RATE_LIMIT_WINDOW_MS', 60000),
      max: num('RATE_LIMIT_MAX', 15),
    },
  },
  limits: {
    maxMessageChars: num('MAX_MESSAGE_CHARS', 600),
    maxHistoryTurns: num('MAX_HISTORY_TURNS', 12),
    maxRetrievedChunks: num('MAX_RETRIEVED_CHUNKS', 6),
    maxChunkChars: 1200,
  },
  crawler: {
    userAgent: 'eMMa-AI-KnowledgeBot/1.0 (+https://emmastudio.pl)',
    maxPages: num('CRAWLER_MAX_PAGES', 300),
    requestTimeoutMs: num('CRAWLER_TIMEOUT_MS', 15000),
    politenessDelayMs: num('CRAWLER_DELAY_MS', 350),
    /**
     * Budzet czasu jednego przebiegu. Funkcja serverless ma twardy limit (30 s na Vercel),
     * wiec crawl konczy sie wczesniej i zapisuje to, co zdazyl zebrac.
     */
    maxDurationMs: num('CRAWLER_MAX_DURATION_MS', 25000),
  },
  /**
   * Trwaly zapis tego, czego strona nie publikuje: luki wiedzy, liczniki CTA, okna limitu.
   * Bez konfiguracji Emmbotek dziala dalej - traci tylko pamiec o tych trzech rzeczach.
   * Klucz service_role omija RLS, wiec nigdy nie moze trafic do przegladarki.
   */
  supabase: {
    url: env('SUPABASE_URL', ''),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY', ''),
    timeoutMs: num('SUPABASE_TIMEOUT_MS', 4000),
  },
  knowledge: {
    path: env('KNOWLEDGE_PATH', 'data/knowledge.json'),
    /**
     * Jak dlugo instancja trzyma kanal wiedzy w pamieci. Kanal wazy 42 kB po kompresji,
     * wiec odswiezenie jest tanie - 5 minut daje wiedze swiezsza niz jakikolwiek cron,
     * a strone odpytujemy najwyzej 12 razy na godzine na instancje.
     */
    cacheTtlMs: num('KNOWLEDGE_CACHE_TTL_MS', 300000),
    gapsPath: env('GAPS_PATH', 'data/knowledge-gaps.json'),
    analyticsPath: env('ANALYTICS_PATH', 'data/analytics.json'),
    /** Po ilu dniach tresc terminowa (NEWS/EVENT/PRICE) uznawana jest za "do weryfikacji". */
    staleAfterDays: num('STALE_AFTER_DAYS', 120),
  },
  branding: {
    base: '#133B47',
    accent: '#D9A441',
    tabLabel: 'Zapytaj Emmbotka',
  },
};

export default config;
