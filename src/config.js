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
  },
  gemini: {
    apiKey: env('GEMINI_API_KEY', ''),
    model: env('GEMINI_MODEL', 'gemini-2.5-flash'),
    fallbackModel: env('GEMINI_FALLBACK_MODEL', 'gemini-flash-latest'),
    endpoint: env('GEMINI_ENDPOINT', 'https://generativelanguage.googleapis.com/v1beta/models'),
    temperature: 0.6,
    maxOutputTokens: 800,
    timeoutMs: num('GEMINI_TIMEOUT_MS', 20000),
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
  knowledge: {
    path: env('KNOWLEDGE_PATH', 'data/knowledge.json'),
    gapsPath: env('GAPS_PATH', 'data/knowledge-gaps.json'),
    analyticsPath: env('ANALYTICS_PATH', 'data/analytics.json'),
    /** Po ilu dniach tresc terminowa (NEWS/EVENT/PRICE) uznawana jest za "do weryfikacji". */
    staleAfterDays: num('STALE_AFTER_DAYS', 120),
  },
  branding: {
    base: '#133B47',
    accent: '#D9A441',
    tabLabel: 'Zapytaj eMMe',
  },
};

export default config;
