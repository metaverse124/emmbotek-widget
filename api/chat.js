/**
 * Vercel serverless entrypoint: POST /api/chat
 *
 * Dwie rzeczy dokladamy tutaj, a nie w samym handlerze, bo zaleza od srodowiska:
 *   - zapis luk wiedzy (Supabase, a lokalnie plik JSON),
 *   - limit zapytan wspolny dla wszystkich instancji (Supabase, a lokalnie pamiec procesu).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import config from '../src/config.js';
import { createChatHandler } from '../src/server/handlers/chat.js';
import { createSharedRateLimiter } from '../src/server/rateLimit.js';
import { recordGap, anonymizeQuestion, gapKey } from '../src/knowledge/gaps.js';
import { supabaseStore } from '../src/storage/supabase.js';

/** Zapis luki do pliku - droga lokalna i awaryjna. Na serverless nie przetrwa instancji. */
async function zapiszLukeDoPliku(question, meta) {
  const target = path.resolve(process.env.GAPS_PATH ?? config.knowledge.gapsPath);
  let registry = [];
  try { registry = JSON.parse(await readFile(target, 'utf8')); } catch { registry = []; }
  const next = recordGap(registry, question, meta);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/**
 * Luki wiedzy sa najcenniejszym, co Emmbotek zbiera dla szkoly: lista pytan, ktore ludzie
 * zadaja, a na ktore nie ma odpowiedzi na stronie. Anonimizacja i klucz agregacji zostaja
 * po stronie aplikacji - do bazy nie trafia nic, czego wczesniej nie oczyscilismy.
 */
async function persistGap(question, meta = {}) {
  const pytanie = anonymizeQuestion(question);
  if (pytanie.length < 4) return;

  if (supabaseStore.skonfigurowany) {
    try {
      await supabaseStore.zapiszLuke({
        klucz: gapKey(pytanie),
        pytanie,
        intencja: meta.intent ?? 'GENERAL',
        wynik: meta.topScore ?? 0,
      });
      return;
    } catch {
      // Baza niedostepna - probujemy pliku. Na serverless to zwykle tez sie nie uda,
      // ale lokalnie ratuje zapis, a rozmowy i tak nie wolno przerywac.
    }
  }
  try { await zapiszLukeDoPliku(question, meta); } catch { /* telemetria nie psuje UX */ }
}

export default createChatHandler({
  onGap: persistGap,
  limiter: createSharedRateLimiter({ store: supabaseStore }),
});
export const config_ = { runtime: 'nodejs' };
