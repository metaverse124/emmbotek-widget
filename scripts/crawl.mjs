/**
 * Reczna / cron-owa synchronizacja wiedzy: sitemap -> ekstrakcja -> indeks -> data/knowledge.json
 * Uzycie: npm run crawl  (opcjonalnie SITEMAP_URL=... npm run crawl)
 */
import config from '../src/config.js';
import { loadBase, saveBase } from '../src/knowledge/store.js';
import { syncKnowledge } from '../src/crawler/run.js';

const started = Date.now();
console.log(`Synchronizacja wiedzy z ${config.site.sitemap}`);

const base = await loadBase();
const { base: updated, report } = await syncKnowledge(base, {
  onProgress: (event) => {
    if (event.phase === 'sitemap') console.log(`Znaleziono ${event.total} adresow w sitemap.`);
    if (event.phase === 'fetch' && event.done % 10 === 0) console.log(`  pobrano ${event.done}/${event.total}`);
  },
});

await saveBase(updated);

console.log('\nRaport synchronizacji');
console.log(`  nowe:        ${report.added.length}`);
console.log(`  zmienione:   ${report.updated.length}`);
console.log(`  bez zmian:   ${report.unchanged.length}`);
console.log(`  zarchiwizowane: ${report.archived.length}`);
console.log(`  bledy:       ${report.failed.length}`);
console.log(`  dokumenty:   ${updated.stats.documents} (fragmenty: ${updated.stats.chunks})`);
console.log(`  cele CTA:    ${report.ctaTargets}`);
console.log(`  czas:        ${((Date.now() - started) / 1000).toFixed(1)} s`);

if (report.failed.length) {
  console.log('\nNieudane adresy:');
  for (const item of report.failed.slice(0, 20)) console.log(`  - ${item.url}: ${item.reason}`);
}
