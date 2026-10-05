import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RHINE_BALANCE, advanceRhineResearch, rhineStage } from '../shared/rhineResearch.js';
import { CALCIFICATION_GRID, energyPulseRange } from '../shared/rhineRange.js';

test('Rhine shared progress: each stage requires five points and resets exactly to zero', () => {
  assert.deepEqual(RHINE_BALANCE.breakthroughPoints, [5, 5]);
  assert.equal(RHINE_BALANCE.successPoints, 2);
  assert.equal(RHINE_BALANCE.failurePoints, 1);
  let progress = { stage: 0, points: 0 };
  for (let i = 0; i < 4; i++) progress = advanceRhineResearch(progress, 1);
  assert.deepEqual(progress, { stage: 0, points: 4 });
  progress = advanceRhineResearch(progress, 1);
  assert.deepEqual(progress, { stage: 1, points: 0 }, 'exactly five points');
  progress = advanceRhineResearch(progress, 2);
  assert.deepEqual(progress, { stage: 1, points: 2 });
  progress = advanceRhineResearch(progress, 2);
  assert.deepEqual(progress, { stage: 1, points: 4 });
  progress = advanceRhineResearch(progress, 2);
  assert.deepEqual(progress, { stage: 2, points: 0 }, 'six points discards the extra point');
  for (const gain of [1, 2, 100]) assert.deepEqual(advanceRhineResearch(progress, gain), { stage: 2, points: 0 });
});

test('Rhine shared progress: stage is independent of current points and one settlement cannot skip a stage', () => {
  for (const stage of [0, 1, 2]) assert.equal(rhineStage(stage), stage);
  assert.deepEqual(advanceRhineResearch({ stage: 0, points: 4 }, 0), { stage: 0, points: 4 });
  assert.deepEqual(advanceRhineResearch({ stage: 1, points: 0 }, 0), { stage: 1, points: 0 });
  assert.deepEqual(advanceRhineResearch({ stage: 0, points: 4 }, 100), { stage: 1, points: 0 });
  const before = { stage: 1, points: 3 };
  assert.deepEqual(advanceRhineResearch(before, 2), { stage: 2, points: 0 });
  assert.deepEqual(before, { stage: 1, points: 3 }, 'snapshots are not mutated');
});

test('mature energy splash matches Saria Calcification in both actual operator records', () => {
  const chess = JSON.parse(readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));
  const canonical = grid => grid.map(([r, c]) => `${r},${c}`).sort();
  const variants = Object.values(chess).filter(c => c.charId === 'char_202_demkni');
  assert.equal(variants.length, 2);
  for (const variant of variants) {
    const s3 = variant.skills.find(s => s.skillId === 'skchr_demkni_3');
    assert.equal(s3.rangeId, 'x-3');
    assert.deepEqual(canonical(CALCIFICATION_GRID), canonical(s3.rangeGrid));
  }
  assert.equal(CALCIFICATION_GRID.length, 25);
  for (const [r, c] of CALCIFICATION_GRID) assert.ok(Math.abs(r) + Math.abs(c) <= 3);
  assert.equal(CALCIFICATION_GRID.some(([r, c]) => r === 2 && c === 2), false, 'not a radius-3 circle');
  assert.ok(CALCIFICATION_GRID.some(([r, c]) => r === 3 && c === 0));
  assert.ok(Object.isFrozen(CALCIFICATION_GRID));
  assert.ok(CALCIFICATION_GRID.every(Object.isFrozen));
});

test('energy splash has AOE at level one and changes only to the mature tile shape at level three', () => {
  for (const stage of [0, 1]) assert.deepEqual(energyPulseRange(stage), { radius: 1, grid: null, tileBased: false });
  assert.deepEqual(energyPulseRange(2), { radius: 3, grid: CALCIFICATION_GRID, tileBased: true });
  assert.deepEqual(energyPulseRange(99), energyPulseRange(2));
  assert.deepEqual(energyPulseRange(-3), energyPulseRange(0));
});
