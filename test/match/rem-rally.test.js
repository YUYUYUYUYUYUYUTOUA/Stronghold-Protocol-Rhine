import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { ERR } from '../../shared/constants.js';

test('rally protocol rejects malformed/outside-board coordinates', () => {
  assert.equal(validateC2S({ t: 'g.remRally', row: 10, col: 4 }), null);
  for (const [row,col] of [[8,4],[13,4],[10,1],[10,11],[10.5,4],['10',4]]) {
    assert.ok(validateC2S({ t: 'g.remRally', row, col }));
  }
});

test('rally is owner-specific, persists into a copied battle spec, and locks in combat', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 11 }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  const [key] = [...ps.deployMap()].find(([,value]) => value === 'melee');
  const [row,col] = key.split(',').map(Number);
  assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.remRally', row, col }), { ok: true });
  assert.deepEqual(ps.privateView().remRally, { row, col });
  assert.equal(h.ps('p_1').privateView().remRally, null);
  const spec = buildBattleSpec({ players: [ps.battleInput()] });
  ps.remRally.row = 0;
  assert.deepEqual(spec.players[0].remRally, { row, col });
  assert.equal(ps.remRallyView(), null);
  h.m.phase = 'COMBAT';
  assert.equal(ps.setRemRally(row,col).error, ERR.WRONG_PHASE);
});

test('rally refuses high ground and sanitizes untrusted spec metadata', () => {
  const h = makeMatch({ seed: 11 }).start(); h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal(ps.setRemRally(0,0).error, ERR.BAD_TARGET);
  const high = [...ps.deployMap()].find(([,v]) => v === 'ranged');
  if (high) assert.equal(ps.setRemRally(...high[0].split(',').map(Number)).error, ERR.BAD_TARGET);
  assert.equal(buildBattleSpec({ players:[{ remRally:{row:0,col:4}, units:[] }] }).players[0].remRally, null);
});
