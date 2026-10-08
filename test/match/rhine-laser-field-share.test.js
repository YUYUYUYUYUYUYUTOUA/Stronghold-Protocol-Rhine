import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { Battle } from '../../server/sim/Battle.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { unitStatsEntry } from '../../shared/protocol.js';

for (const clientCombat of [false, true]) for (const humans of [1, 2, 3, 4, 5, 6]) {
  test(`laser field HP base is a fixed share with ${humans} players (${clientCombat ? 'client' : 'server'} combat)`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans, fake: true, instant: false, clientCombat, clients: false }).start().toPrep(1);
    try {
      h.m.round = 14;
      h.m.startFinalAssault(false);
      const pool = h.m.bossPool;
      const fields = h.m.fields;
      assert.equal(fields.length, Math.ceil(humans / 2));
      for (const field of fields) {
        const flags = clientCombat ? field.spec.flags : field.battle.opts.flags;
        assert.equal(flags.bossFieldMaxHp, pool.maxHp / fields.length);
        assert.equal(flags.layerGainsEnabled, false);
      }
    } finally { h.m.dispose(); }
  });
}

test('client spec, browser reconstruction and server takeover retain the same laser HP base', () => {
  const flags = { bossFieldMaxHp: 20000 };
  const spec = buildBattleSpec({ kind: 'boss', flags, players: [], spawns: [], boss: { poolHp: 60000, poolMax: 60000 } });
  const browser = createBattleFromSpec(JSON.parse(JSON.stringify(spec)), { enemies: {}, chess: {}, tokens: {} });
  assert.equal(browser.bossFieldMaxHp, 20000);
  const takeover = createBattleFromSpec(spec, { enemies: {}, chess: {}, tokens: {} }, { sharedBoss: { maxHp: 60000, hp: 59000 } });
  assert.equal(takeover.bossFieldMaxHp, browser.bossFieldMaxHp);
  const isolated = new Battle({ kind: 'boss', players: [], spawns: [], sharedBoss: { maxHp: 60000, hp: 59000 }, content: false });
  assert.equal(isolated.bossFieldMaxHp, 60000, 'an isolated laboratory field owns the whole test pool');
});

test('joining field metadata and live detail stats preserve laser lock and accumulated seconds', () => {
  const s = { maxHp: 3000, atk: 700, def: 0, res: 0, blockCnt: 0, moveSpeed: 0, flags: {} };
  const u = { id: 1, uid: 10, kind: 'token', side: 'ally', defId: 'token_rhine_laser', x: 4, y: 10,
    hp: 3000, alive: true, base: s, s, researchStage: 0, researchActive: true,
    researchLaserTarget: 8, researchLaserProgress: 17.25, researchLaserActive: true };
  const info = JSON.parse(JSON.stringify(unitInfo(u)));
  const live = unitStatsEntry(u, s);
  for (const view of [info, live]) {
    assert.equal(view.researchLaserTarget, 8);
    assert.equal(view.researchLaserProgress, 17.25);
    assert.equal(view.researchLaserActive, true);
  }
});
