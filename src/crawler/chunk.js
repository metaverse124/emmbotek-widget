/**
 * Dzielenie tresci na fragmenty (sekcja 4 briefu, krok 7).
 * Fragment nie przekracza limitu znakow, nie rozbija zdan w polowie
 * i zachowuje naglowek + kotwice (dla CTA prowadzacych do sekcji strony).
 */
const MAX_CHARS = 900;
const MIN_CHARS = 120;

export function chunkBlocks(blocks, { maxChars = MAX_CHARS, minChars = MIN_CHARS } = {}) {
  const chunks = [];
  let buffer = { text: '', heading: null, anchor: null };

  const flush = () => {
    const text = buffer.text.trim();
    if (text.length >= 20) chunks.push({ text, heading: buffer.heading, anchor: buffer.anchor });
    buffer = { text: '', heading: buffer.heading, anchor: buffer.anchor };
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (buffer.text.trim().length >= minChars) flush();
      buffer.heading = block.text;
      buffer.anchor = block.anchor ?? null;
      buffer.text = buffer.text.trim() ? `${buffer.text}\n${block.text}` : block.text;
      continue;
    }

    const candidate = buffer.text ? `${buffer.text}\n${block.text}` : block.text;
    if (candidate.length > maxChars && buffer.text.length >= minChars) {
      flush();
      buffer.text = block.text;
    } else if (candidate.length > maxChars) {
      // pojedynczy bardzo dlugi blok - tniemy po zdaniach
      const sentences = block.text.split(/(?<=[.!?])\s+/);
      let piece = buffer.text;
      for (const sentence of sentences) {
        if ((`${piece} ${sentence}`).length > maxChars && piece.trim()) {
          buffer.text = piece;
          flush();
          piece = sentence;
        } else {
          piece = piece ? `${piece} ${sentence}` : sentence;
        }
      }
      buffer.text = piece;
    } else {
      buffer.text = candidate;
    }
  }
  flush();
  return chunks;
}
