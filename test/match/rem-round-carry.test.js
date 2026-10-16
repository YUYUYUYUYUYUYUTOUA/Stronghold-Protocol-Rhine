import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult, createBattleFromSpec } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { makeMatch } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { validateC2S } from '../../shared/protocol.js';

test('unite inputs carry only each helper own normal-field appearances and fresh normal inputs reset', () => {
  const h = makeMatch({ humans: 3, fake: true }).start();
  try {
    h.toPrep(1);
    const m = h.m;
    m.lastResults.set('p_0', { unitsEnd: [], remAppearances: 50 });
    m.lastResults.set('p_1', { unitsEnd: [], remAppearances: 12 });
    const opts = uniteBattleOpts(m, { helpers: [h.ps('p_0'), h.ps('p_1')], leaked: [] }, 30);
    assert.deepEqual(opts.players.map(p => [p.playerId, p.remAppearances]), [['p_0', 50], ['p_1', 12]]);
    assert.equal(m._normalOpts(h.ps('p_0')).players[0].remAppearances, undefined);
  } finally { h.m.dispose(); }
});

test('SP_VERIFY off still verifies positive client appearance carry and discards a forged count', () => {
  const h = makeMatch({ humans: 2, fake: true, clientCombat: true, clients: false, verify: 'off' }).start();
  try {
    h.toPrep(1);
    const m = h.m;
    h.drive(() => m.phase === 'COMBAT');
    const field = m.fields.find(f => f.players.includes('p_0'));
    const battle = createBattleFromSpec(field.spec, m.ds, { BattleClass: FakeBattle });
    while (!battle.finished) battle.step();
    const raw = compactResult(battle.result());
    raw.perPlayer.p_0.remAppearances = 50;
    assert.equal(validateC2S({ t: 'b.result', battleId: field.battleId, result: raw }), null);
    const valid = validateClientResult(field.spec, raw, { gd: m.gd });
    assert.equal(valid.ok, true, valid.reason);
    assert.equal(valid.result.perPlayer.p_0.remAppearances, 50, 'whitelisting retains valid-shaped state for mandatory verification');
    assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: field.battleId, result: raw }), { ok: true });
    h.run(() => field.done);
    assert.equal(m.verifyStats.checked, 1);
    assert.equal(m.verifyStats.mismatches, 1);
    assert.equal(field.result.perPlayer.p_0.remAppearances, undefined, 'only the server result can feed the helper input');
    assert.equal(m.fields.find(f => f.players.includes('p_1')).done, false, 'other clients remain independent');
    for (const bad of [-1, NaN, 0.5, 1e9 + 1]) {
      raw.perPlayer.p_0.remAppearances = bad;
      assert.ok(validateC2S({ t: 'b.result', battleId: field.battleId, result: raw }));
      assert.equal(validateClientResult(field.spec, raw, { gd: m.gd }).reason, 'reinforcement appearances');
    }
  } finally { h.m.dispose(); }
});
