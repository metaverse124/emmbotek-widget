/**
 * Tworzy startowa (seed) baze wiedzy z faktow bazowych potwierdzonych w briefie.
 * To tylko punkt startowy - wlasciwa wiedza pochodzi z crawlera (npm run crawl).
 */
import { mergeDocuments, emptyBase, contentHash } from '../src/knowledge/store.js';
import { buildCtaMap } from '../src/knowledge/ctaMap.js';
import { saveBase } from '../src/knowledge/store.js';
import { chunkBlocks } from '../src/crawler/chunk.js';

const SITE = process.env.SITE_URL ?? 'https://emmastudio.pl';

const seed = [
  {
    sourceUrl: `${SITE}/`,
    sourceTitle: 'eMMa - Prywatne Studio Jezykow Obcych w Poznaniu',
    sourceType: 'LANDING_PAGE',
    blocks: [
      { type: 'heading', level: 1, text: 'Prywatne Studio Jezykow Obcych eMMa' },
      { type: 'text', text: 'Studio dziala w Poznaniu nieprzerwanie od 1992 roku. Uczymy angielskiego i hiszpanskiego.' },
      { type: 'text', text: 'Zajecia prowadzimy w kameralnych grupach 4-8 osob oraz indywidualnie. Uczymy dzieci, mlodziez, doroslych i firmy.' },
    ],
  },
  {
    sourceUrl: `${SITE}/oferta/`,
    sourceTitle: 'Oferta kursow',
    sourceType: 'COURSE',
    blocks: [
      { type: 'heading', level: 1, text: 'Oferta kursow jezykowych' },
      { type: 'text', text: 'Kursy grupowe i indywidualne z angielskiego i hiszpanskiego dla dzieci, mlodziezy i doroslych.' },
      { type: 'text', text: 'W ofercie znajduje sie takze angielski biznesowy oraz szkolenia dla firm.' },
    ],
  },
  {
    sourceUrl: `${SITE}/egzaminy/`,
    sourceTitle: 'Kursy egzaminacyjne',
    sourceType: 'EXAM',
    blocks: [
      { type: 'heading', level: 1, text: 'Przygotowanie do egzaminow' },
      { type: 'text', text: 'Przygotowujemy do egzaminow FCE, CAE, IELTS i TOEFL.' },
    ],
  },
  {
    sourceUrl: `${SITE}/kontakt/`,
    sourceTitle: 'Kontakt i sekretariat',
    sourceType: 'CONTACT',
    blocks: [
      { type: 'heading', level: 1, text: 'Kontakt' },
      { type: 'text', text: 'Sekretariat eMMy w Poznaniu odpowiada na pytania o zapisy, terminy i lekcje probne.' },
      { type: 'heading', level: 2, text: 'Bezplatna lekcja probna', anchor: 'lekcja-probna' },
      { type: 'text', text: 'Bezplatna lekcje probna umawia sekretariat szkoly.' },
    ],
  },
];

const now = new Date().toISOString();
const documents = seed.map((item) => ({
  id: contentHash(item.sourceUrl),
  sourceUrl: item.sourceUrl,
  sourceTitle: item.sourceTitle,
  sourceType: item.sourceType,
  content: item.blocks.map((block) => block.text).join('\n'),
  publishedAt: null,
  updatedAt: now,
  indexedAt: now,
  status: 'active',
  headings: item.blocks.filter((block) => block.type === 'heading').map((block) => block.text),
  anchors: item.blocks.filter((block) => block.anchor).map((block) => ({ id: block.anchor, text: block.text })),
  chunks: chunkBlocks(item.blocks),
}));

const { base } = mergeDocuments(emptyBase(), documents, { now });
base.ctaMap = buildCtaMap(base, { now: Date.parse(now) });
base.seed = true;
base.note = 'Baza startowa z faktow bazowych. Uruchom `npm run crawl`, aby zaindeksowac aktualna strone.';

const target = await saveBase(base);
console.log(`Zapisano baze startowa: ${target}`);
console.log(`Dokumenty: ${base.stats.documents}, fragmenty: ${base.stats.chunks}, cele CTA: ${Object.keys(base.ctaMap).length}`);
