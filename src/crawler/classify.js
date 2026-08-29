/** Klasyfikacja typu dokumentu (sekcja 5 briefu) na podstawie URL, tytulu i tresci. */
import { normalize } from '../knowledge/retrieval.js';

const RULES = [
  { type: 'PRICE', url: ['cennik', 'ceny', 'oplaty', 'price'], text: ['cennik', 'zl za', 'oplata za kurs', 'cena kursu'] },
  { type: 'CONTACT', url: ['kontakt', 'contact', 'sekretariat'], text: ['telefon', 'adres', 'e-mail', 'godziny otwarcia'] },
  { type: 'REGULATION', url: ['regulamin', 'polityka', 'rodo', 'prywatnosc'], text: ['regulamin', 'administratorem danych'] },
  { type: 'TEAM', url: ['kadra', 'lektor', 'zespol', 'o-nas', 'about'], text: ['lektorzy', 'nasza kadra', 'nauczyciele'] },
  { type: 'EXAM', url: ['egzamin', 'fce', 'cae', 'ielts', 'toefl', 'certyfikat'], text: ['egzamin', 'fce', 'cae', 'ielts', 'toefl'] },
  { type: 'FAQ', url: ['faq', 'pytania'], text: ['najczesciej zadawane', 'faq'] },
  { type: 'BLOG', url: ['blog', 'artykul', 'porady', 'wpis'], text: ['czytaj wiecej', 'autor wpisu'] },
  { type: 'NEWS', url: ['aktualnosci', 'news', 'nowosci'], text: ['nowa grupa', 'zapisy trwaja', 'aktualnosc'] },
  { type: 'EVENT', url: ['wydarzenie', 'event', 'warsztaty', 'dzien-otwarty'], text: ['zapraszamy na', 'wydarzenie odbedzie'] },
  { type: 'METHOD', url: ['metoda', 'metodyka', 'jak-uczymy'], text: ['nasza metoda', 'metodyka nauczania'] },
  { type: 'COURSE', url: ['kurs', 'zajecia', 'oferta', 'dla-dzieci', 'dla-doroslych', 'dla-firm', 'angielski', 'hiszpanski'], text: ['kurs', 'zajecia', 'grupa', 'poziom'] },
];

/**
 * @param {{url?: string, title?: string, text?: string}} page
 * @returns {{type: string, confidence: number}}
 */
export function classifyDocument(page) {
  const url = normalize(page.url ?? '');
  const title = normalize(page.title ?? '');
  const text = normalize(page.text ?? '').slice(0, 4000);

  let best = { type: 'GENERAL', confidence: 0.2 };

  for (const rule of RULES) {
    let score = 0;
    if (rule.url.some((needle) => url.includes(needle))) score += 0.6;
    if (rule.url.some((needle) => title.includes(needle))) score += 0.2;
    const hits = rule.text.filter((needle) => text.includes(needle)).length;
    score += Math.min(0.35, hits * 0.12);
    if (score > best.confidence) best = { type: rule.type, confidence: Number(score.toFixed(2)) };
  }

  // strona glowna / krotkie strony przekrojowe
  const path = (page.url ?? '').replace(/https?:\/\/[^/]+/, '').replace(/\/$/, '');
  if (best.confidence < 0.5 && (path === '' || path === '/index.html')) {
    return { type: 'LANDING_PAGE', confidence: 0.8 };
  }
  return best;
}
