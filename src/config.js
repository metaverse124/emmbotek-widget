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

const list = (key, fallback = []) => {
  const value = env(key, '');
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback;
};

export const config = {
  school: {
    name: 'eMMa - Prywatne Studio Jezykow Obcych',
    city: 'Poznan',
    since: 1992,
    languages: ['angielski', 'hiszpanski'],
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
    model: env('GEMINI_MODEL', 'gemini-3.6-flash'),
    fallbackModel: env('GEMINI_FALLBACK_MODEL', 'gemini-flash-lite-latest'),
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
    /**
     * Prog przelaczenia na model zapasowy, a nie realny limit cierpliwosci.
     * Zmierzone 2026-08-31: gemini-3.6-flash odpowiada zwykle w 5-7 s, ale potrafi
     * skoczyc do 25 s; gemini-flash-lite-latest trzyma sie 1-2 s przy odpowiedziach
     * tej samej jakosci (te same ceny, te same CTA). Przy progu 20 s jedna odpowiedz
     * w tescie zajela 23 s - w widgecie czatu to wieczność. Przy 9 s najgorszy
     * przypadek to okolo 11 s, a typowa odpowiedz nadal idzie z mocniejszego modelu.
     */
    timeoutMs: num('GEMINI_TIMEOUT_MS', 9000),
  },
  security: {
    allowedOrigins: list('ALLOWED_ORIGINS', ['https://emmastudio.pl', 'https://www.emmastudio.pl']),
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
