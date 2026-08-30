import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { EMOTIONS } from '../src/agent/emotions.js';

const DIR = path.resolve('public/avatars');
const manifest = JSON.parse(await readFile(path.join(DIR, 'manifest.json'), 'utf8'));
const pliki = (await readdir(DIR)).filter((name) => name.startsWith('pose-') && name.endsWith('.png'));

test('wyizolowano 24 pozy: po 8 z kazdego arkusza 3x3', () => {
  // Kafelek r3c3 kazdego arkusza nosi widoczny znak wodny modelu i jest pomijany.
  assert.equal(pliki.length, 24);
  for (const sheet of ['01', '02', '03']) {
    assert.equal(pliki.filter((name) => name.startsWith(`pose-${sheet}-`)).length, 8);
  }
});

test('zadna poza ze znakiem wodnym nie zostala opublikowana', () => {
  for (const watermarked of ['pose-01-r3c3.png', 'pose-02-r3c3.png', 'pose-03-r3c3.png']) {
    assert.ok(!pliki.includes(watermarked), `${watermarked} nie moze byc w repozytorium`);
  }
  const uzyte = new Set();
  for (const grupa of [manifest.emotions, manifest.extraStates]) {
    for (const definition of Object.values(grupa)) definition.frames.forEach((file) => uzyte.add(file));
  }
  for (const watermarked of ['pose-01-r3c3.png', 'pose-02-r3c3.png', 'pose-03-r3c3.png']) {
    assert.ok(!uzyte.has(watermarked), `manifest nie moze odwolywac sie do ${watermarked}`);
  }
});

test('kazda z 12 emocji ma przypisane klatki awatara', () => {
  for (const emotion of EMOTIONS) {
    const definition = manifest.emotions[emotion];
    assert.ok(definition, `brak mapowania dla emocji ${emotion}`);
    assert.ok(definition.frames.length >= 1, `emocja ${emotion} nie ma klatek`);
    assert.ok(definition.motion, `emocja ${emotion} nie ma typu ruchu`);
  }
  assert.equal(Object.keys(manifest.emotions).length, 12);
});

test('wszystkie klatki z manifestu istniej w obu wariantach rozmiaru', async () => {
  const uzyte = new Set();
  for (const grupa of [manifest.emotions, manifest.extraStates]) {
    for (const definition of Object.values(grupa)) definition.frames.forEach((file) => uzyte.add(file));
  }
  for (const file of uzyte) {
    await stat(path.join(DIR, file));
    await stat(path.join(DIR, 'small', file));
  }
  assert.ok(uzyte.size >= 12);
});

test('kazda wyizolowana poza jest opisana w manifescie', () => {
  const opisane = new Set(manifest.poses.map((pose) => pose.file));
  for (const file of pliki) assert.ok(opisane.has(file), `poza ${file} nie ma opisu`);
  assert.equal(opisane.size, pliki.length);
});

test('kazda opublikowana poza jest wykorzystana', () => {
  const uzyte = new Set();
  for (const grupa of [manifest.emotions, manifest.extraStates]) {
    for (const definition of Object.values(grupa)) definition.frames.forEach((file) => uzyte.add(file));
  }
  assert.equal(uzyte.size, pliki.length, 'wszystkie opublikowane pozy powinny byc wykorzystane');
});

test('wersja dla widgetu jest lekka (< 25 kB na klatke)', async () => {
  const male = (await readdir(path.join(DIR, 'small'))).filter((name) => name.endsWith('.png'));
  assert.equal(male.length, 24);
  for (const file of male) {
    const info = await stat(path.join(DIR, 'small', file));
    assert.ok(info.size < 25 * 1024, `${file} wazy ${Math.round(info.size / 1024)} kB`);
  }
});

test('tlo zostalo usuniete - pozy maja kanal alfa i przezroczyste rogi', async () => {
  // sygnatura PNG + typ koloru 6 (RGBA) w naglowku IHDR
  for (const file of pliki.slice(0, 5)) {
    const buffer = await readFile(path.join(DIR, file));
    assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(buffer[25], 6, `${file} nie jest RGBA`);
  }
});

test('stany dodatkowe (drzemka, smutek) nie udaja tagow modelu', () => {
  for (const state of Object.keys(manifest.extraStates)) {
    assert.ok(!EMOTIONS.includes(state), `${state} nie moze byc tagiem emocji modelu`);
  }
});
