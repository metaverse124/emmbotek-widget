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

let updated;
let report;
try {
  ({ base: updated, report } = await syncKnowledge(base, {
    onProgress: (event) => {
      if (event.phase === 'sitemap') console.log(`Znaleziono ${event.total} adresow w sitemap.`);
      if (event.phase === 'fetch' && event.done % 10 === 0) console.log(`  pobrano ${event.done}/${event.total}`);
    },
  }));
} catch (error) {
  // Nieosiagalna sitemap to najczestszy powod niepowodzenia (blokada sieci, WAF, literowka w adresie).
  // Nie nadpisujemy wtedy istniejacej bazy wiedzy - zostaje ostatnia dobra wersja.
  console.error(`\nNie udalo sie pobrac sitemap: ${error.message}`);
  console.error('Baza wiedzy pozostala bez zmian. Sprawdz:');
  console.error(`  1. czy adres ${config.site.sitemap} otwiera sie w przegladarce,`);
  console.error('  2. czy siec/firewall nie blokuje domeny,');
  console.error('  3. czy serwer nie odrzuca User-Agenta crawlera (403 z WAF).');
  process.exit(1);
}

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
