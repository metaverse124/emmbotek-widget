import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEmotion, stripEmotionTags, EMOTIONS } from '../src/agent/emotions.js';

test('wszystkie 12 emocji z briefu jest obslugiwanych', () => {
  assert.equal(EMOTIONS.length, 12);
  for (const emotion of ['SMILE', 'GREETING', 'THINKING', 'EXCITED', 'FUNNY', 'NEUTRAL',
    'EMPATHY', 'CURIOUS', 'SURPRISED', 'PROUD', 'FOCUS', 'SHY']) {
    assert.ok(EMOTIONS.includes(emotion), `brak emocji ${emotion}`);
  }
});

test('tag jest usuwany z tekstu przed wyswietleniem', () => {
  const { emotion, text } = parseEmotion('[GREETING] Dzien dobry! W czym moge pomoc?');
  assert.equal(emotion, 'GREETING');
  assert.equal(text, 'Dzien dobry! W czym moge pomoc?');
  assert.ok(!text.includes('['));
});

test('nieznany tag zamienia sie w NEUTRAL', () => {
  assert.equal(parseEmotion('[ZDZIWIONA] Hmm...').emotion, 'NEUTRAL');
});

test('brak taga to rowniez NEUTRAL', () => {
  const { emotion, text, tagged } = parseEmotion('Bez taga.');
  assert.equal(emotion, 'NEUTRAL');
  assert.equal(tagged, false);
  assert.equal(text, 'Bez taga.');
});

test('tagi wstawione w srodku tekstu tez sa usuwane', () => {
  assert.equal(stripEmotionTags('Tekst [FOCUS] w srodku'), 'Tekst w srodku');
});
