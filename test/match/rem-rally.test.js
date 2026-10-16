import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { C2S, validateC2S } from '../../shared/protocol.js';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { ERR } from '../../shared/constants.js';

test('retired rally commands are rejected by both the wire catalogue and match dispatch', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, fake: true }).start();
  try {
    h.toPrep(1);
    assert.equal(Object.hasOwn(C2S, 'g.remRally'), false);
    for (const fields of [{ row: 10, col: 4 }, { row: 0, col: 0 }, {}]) {
      const command = { t: 'g.remRally', ...fields };
      assert.match(validateC2S(command), /^unknown type /);
      assert.deepEqual(h.m.handle('p_0', command), { error: ERR.BAD_MSG });
      assert.deepEqual(h.m._handle(h.ps('p_0'), command), { error: ERR.BAD_MSG });
    }
    assert.equal(h.m.errorCount, 0);
  } finally { h.m.dispose(); }
});

test('new players and reconnect views omit rally metadata even if old state still contains it', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, fake: true }).start();
  try {
    h.toPrep(1);
    for (const playerId of ['p_0', 'p_1']) {
      const ps = h.ps(playerId);
      assert.equal(Object.hasOwn(ps, 'remRally'), false);
      assert.equal(ps.setRemRally, undefined);
      assert.equal(ps.remRallyView, undefined);
      // An older serialized/session record cannot restore either the UI state or battle input.
      ps.remRally = { row: 10, col: 4 };
      assert.equal(Object.hasOwn(ps.privateView(), 'remRally'), false);
      assert.equal(Object.hasOwn(ps.battleInput(), 'remRally'), false);
      h.m.onDisconnect(playerId);
      h.m.onReconnect(playerId);
      const frame = h.lastTo(playerId, 'm.private');
      assert.ok(frame, 'reconnect sends a fresh private view');
      assert.equal(Object.hasOwn(frame, 'remRally'), false);
      assert.equal(Object.hasOwn(h.m._normalOpts(ps).players[0], 'remRally'), false);
    }
    h.invariants();
    assert.equal(h.m.errorCount, 0);
  } finally { h.m.dispose(); }
});

test('all newly built battle kinds strip old rally choices without mutating the input', () => {
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    for (const remRally of [{ row: 10, col: 4 }, { row: 0, col: 0 }, null, 'legacy', [10, 4]]) {
      const player = { playerId: 'p_0', remRally, units: [], bonds: { remShip: { active: true, count: 3 } } };
      const before = JSON.stringify(player);
      const spec = buildBattleSpec({ kind, players: [player] });
      assert.equal(Object.hasOwn(spec.players[0], 'remRally'), false, `${kind}: ${JSON.stringify(remRally)}`);
      assert.equal(JSON.stringify(player), before, 'the source replay/session record stays unchanged');
      assert.deepEqual(spec.players[0].bonds, player.bonds);
    }
  }
});
