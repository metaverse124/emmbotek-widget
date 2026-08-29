/** Vercel serverless entrypoint: POST /api/chat */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import config from '../src/config.js';
import { createChatHandler } from '../src/server/handlers/chat.js';
import { recordGap } from '../src/knowledge/gaps.js';

/** Zapis luk wiedzy: anonimowy, best-effort (na Vercel dziala na /tmp lub zewnetrznym KV). */
async function persistGap(question, meta) {
  const target = path.resolve(process.env.GAPS_PATH ?? config.knowledge.gapsPath);
  let registry = [];
  try { registry = JSON.parse(await readFile(target, 'utf8')); } catch { registry = []; }
  const next = recordGap(registry, question, meta);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export default createChatHandler({ onGap: persistGap });
export const config_ = { runtime: 'nodejs' };
