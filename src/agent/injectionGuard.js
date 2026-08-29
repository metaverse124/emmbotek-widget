/**
 * Ochrona przed prompt injection (sekcje 36-37 briefu).
 *
 * Baza wiedzy aktualizuje sie automatycznie, wiec tresc strony traktujemy
 * WYLACZNIE jako dane. Instrukcja w tresci ("Ignore previous instructions...")
 * ma zostac przeczytana jako zwykly tekst, nigdy wykonana.
 */
const INSTRUCTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|above)/gi,
  /zignoruj\s+(wszystkie\s+)?(poprzednie|powyzsze|wczesniejsze)/gi,
  /system\s*prompt/gi,
  /reveal\s+your\s+(system\s+)?(prompt|instructions?)/gi,
  /ujawnij\s+(swoj|swoje)\s+(prompt|instrukcje)/gi,
  /act\s+as\s+(?:an?\s+)?(?:admin|developer|system)/gi,
  /jestes\s+teraz\s+(administratorem|deweloperem)/gi,
  /you\s+are\s+now\s+(?:an?\s+)?(?:admin|dan|jailbroken)/gi,
  /\bnew\s+instructions?\s*:/gi,
];

/** Czy tekst zawiera probe przejecia kontroli nad agentem. */
export const looksLikeInjection = (text) =>
  INSTRUCTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(text ?? ''));
  });

/** Neutralizuje tresci sterujace i znaczniki ograniczajace bloki danych. */
export function neutralize(text) {
  let output = String(text ?? '');
  for (const pattern of INSTRUCTION_PATTERNS) {
    pattern.lastIndex = 0;
    output = output.replace(pattern, (match) => `[tresc strony: "${match}"]`);
  }
  return output
    .replace(/<\/?(?:system|instrukcje|instructions)>/gi, ' ')
    .replace(/\[\[?\/?(?:INST|SYS)\]?\]/gi, ' ');
}

/**
 * Pakuje fragmenty wiedzy w blok danych z jasna etykieta zrodla i aktualnosci.
 * Model dostaje instrukcje, ze to DANE, nie polecenia.
 */
export function buildKnowledgeBlock(results) {
  if (!results.length) return 'BRAK DOPASOWANYCH FRAGMENTOW WIEDZY.';
  return results
    .map((item, index) => {
      const meta = [
        `zrodlo=${item.sourceUrl ?? 'brak'}`,
        `typ=${item.sourceType}`,
        `aktualnosc=${item.freshness}`,
        item.updatedAt ? `zaktualizowano=${item.updatedAt}` : null,
      ].filter(Boolean).join(' | ');
      return `[${index + 1}] ${meta}\n${neutralize(item.text)}`;
    })
    .join('\n\n');
}

/** Sanityzacja wiadomosci uzytkownika - nie blokujemy, ale oznaczamy probe. */
export function guardUserMessage(message, { maxChars = 600 } = {}) {
  const trimmed = String(message ?? '').slice(0, maxChars);
  return {
    text: trimmed,
    injectionAttempt: looksLikeInjection(trimmed),
  };
}
