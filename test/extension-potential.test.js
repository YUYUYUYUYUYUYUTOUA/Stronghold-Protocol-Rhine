import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atPotential } from '../shared/potential.js';
import { loadoutRecord, resolveRecordLoadout } from '../shared/loadoutRecord.js';
import { makeBattle } from './helpers/battleHarness.js';

const chess = JSON.parse(readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));

test('extension operators keep full-potential defaults and expose their official low-potential attribute steps', () => {
  const mayer = chess.chess_rhine_mayer_a;
  assert.deepEqual([atPotential(mayer, 1).stats.cost, atPotential(mayer, 6).stats.cost], [11, 9]);
  assert.deepEqual([atPotential(mayer, 1).stats.res, atPotential(mayer, 6).stats.res], [20, 28]);
  const odda = chess.chess_kazdel_odd_a;
  assert.deepEqual([atPotential(odda, 1).stats.cost, atPotential(odda, 6).stats.cost], [21, 18]);
  assert.deepEqual([atPotential(odda, 1).stats.respawnTime, atPotential(odda, 6).stats.respawnTime], [80, 70]);
  const wisdel = chess.chess_kazdel_wisdel_b;
  const body = loadoutRecord(wisdel, resolveRecordLoadout(wisdel, { potential: 1 }));
  assert.deepEqual([body.stats.atk, body.stats.cost], [717, 25]);
  assert.deepEqual([wisdel.stats.atk, wisdel.stats.cost], [749, 23]);
});

test('an expansion operator fights at the potential and development sent by the battle spec', () => {
  const h = makeBattle({ autoFinish: false, units: [
    { uid: 1, chessId: 'chess_rhine_mayer_a', row: 10, col: 3, potential: 1, cultivate: 0 },
    { uid: 2, chessId: 'chess_rhine_mayer_a', row: 10, col: 7, potential: 6, cultivate: 3 },
  ] });
  const one = h.unit(1), six = h.unit(2);
  assert.deepEqual([one.base.cost, six.base.cost], [11, 9]);
  assert.equal(one.s.maxHp, 801);
  assert.ok(Math.abs(six.s.maxHp - 881.1) < 1e-9);
});
