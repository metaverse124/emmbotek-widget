/**
 * Lokalny serwer deweloperski: statyczne public/ + endpointy /api/*.
 * Uzycie: GEMINI_API_KEY=... npm run dev  (domyslnie http://localhost:3000)
 * Bez klucza API dziala tryb demo: odpowiedzi generuje lokalna atrapa modelu.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import config from '../src/config.js';
import { createChatHandler } from '../src/server/handlers/chat.js';
import { createAnalyticsHandler } from '../src/server/handlers/analytics.js';
import { createSyncHandler } from '../src/server/handlers/sync.js';
import { createTokenHandler } from '../src/server/handlers/token.js';
import { demoGenerate } from './demo-model.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = path.resolve('public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const useDemo = !config.gemini.apiKey;
const chat = createChatHandler(useDemo ? { generateFn: demoGenerate } : {});
const analytics = createAnalyticsHandler();
const sync = createSyncHandler();
const tokenHandler = createTokenHandler();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/chat') return chat(req, res);
  if (url.pathname === '/api/analytics') return analytics(req, res);
  if (url.pathname === '/api/sync') return sync(req, res);
  if (url.pathname === '/api/token') return tokenHandler(req, res);

  const relative = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC, path.normalize(relative).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; res.end('Forbidden'); return; }

  try {
    const data = await readFile(file);
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`eMMa AI dev: http://localhost:${PORT}`);
  console.log(useDemo
    ? 'Tryb DEMO - brak GEMINI_API_KEY, odpowiedzi generuje lokalna atrapa modelu.'
    : `Model: ${config.gemini.model}`);
});
