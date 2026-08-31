/**
 * Vercel serverless entrypoint: POST /api/analytics (anonimowe liczniki CTA)
 *
 * Z Supabase liczniki podbija baza (jedno wywolanie RPC na paczke zdarzen), bo instancji
 * jest wiele i odczyt-modyfikacja-zapis gubilby zdarzenia. Bez Supabase - a wiec lokalnie
 * i przy `npm run dev` - zostaje plik JSON.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import config from '../src/config.js';
import { createAnalyticsHandler } from '../src/server/handlers/analytics.js';
import { supabaseStore } from '../src/storage/supabase.js';

const target = () => path.resolve(process.env.ANALYTICS_PATH ?? config.knowledge.analyticsPath);

const plikowy = {
  read: async () => {
    try { return JSON.parse(await readFile(target(), 'utf8')); } catch { return {}; }
  },
  write: async (store) => {
    await mkdir(path.dirname(target()), { recursive: true });
    await writeFile(target(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  },
};

export default createAnalyticsHandler(
  supabaseStore.skonfigurowany
    ? { record: (zdarzenia) => supabaseStore.zapiszCta(zdarzenia) }
    : plikowy,
);
