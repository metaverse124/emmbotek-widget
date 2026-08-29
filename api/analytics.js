/** Vercel serverless entrypoint: POST /api/analytics (anonimowe liczniki CTA) */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import config from '../src/config.js';
import { createAnalyticsHandler } from '../src/server/handlers/analytics.js';

const target = () => path.resolve(process.env.ANALYTICS_PATH ?? config.knowledge.analyticsPath);

export default createAnalyticsHandler({
  read: async () => {
    try { return JSON.parse(await readFile(target(), 'utf8')); } catch { return {}; }
  },
  write: async (store) => {
    await mkdir(path.dirname(target()), { recursive: true });
    await writeFile(target(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  },
});
