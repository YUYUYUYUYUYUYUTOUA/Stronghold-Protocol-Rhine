import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RHINE_BALANCE, advanceRhineResearch, rhineStage } from '../shared/rhineResearch.js';

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
