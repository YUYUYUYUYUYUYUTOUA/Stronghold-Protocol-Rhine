// Five seats through the actual match interfaces: field authority, progress, settlement, odd boss pairing and R15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, MAX_SEATS } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildBattleSpec, createBattleFromSpec, compactResult, fitResult } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { bossPoolHp, pairPlayers } from '../../server/match/finalAssault.js';
import { DATA, makeMatch, checkInvariants, give, legalTileFor, chessOfTier } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const ids = ['p_0', 'p_1', 'p_2', 'p_3', 'p_4'];
const pairs = [['p_0', 'p_1'], ['p_2', 'p_3'], ['p_4']];
const finishFake = (m, f) => {
  const b = createBattleFromSpec(f.spec, m.ds, { BattleClass: FakeBattle });
  while (!b.finished) b.step();
  return compactResult(b.result());
};
const close = (h) => { h.m.dispose(); h.clients?.closeAll(); };

test('a real five-player BattleResult retains the fifth entry through compact upload and validation', () => {
  assert.ok(ids.length <= MAX_SEATS, 'five-player matches remain supported within the room capacity');
  const spec = buildBattleSpec({
    battleId: 'five-player-upload', fieldId: 'n:five', kind: 'normal', seed: 5, round: 1,
    stageId: Object.keys(DATA.stages)[0], timeLimit: 1, content: 'full',
    players: ids.map((playerId) => ({ playerId, side: 'L', units: [] })),
    spawns: ids.map((ownerPlayerId) => ({ enemyKey: 'enemy_1007_slime', ownerPlayerId, time: 0, count: 1 })),
    flags: { layerGainsEnabled: true },
  });
  const battle = createBattleFromSpec(spec, DATA, { recordEvents: false, quiet: true });
  const result = compactResult(battle.runToEnd(2));
  assert.deepEqual(Object.keys(result.perPlayer), ids);
  assert.ok(result.perPlayer.p_4.total > 0, 'the fifth player owns its spawned enemy');
  assert.equal(validateC2S({ t: 'b.result', battleId: spec.battleId, result }), null);
  const validated = validateClientResult(spec, result);
  assert.equal(validated.ok, true, validated.reason);
  assert.deepEqual(Object.keys(validated.result.perPlayer), ids);
  const trimmed = fitResult(result, { budget: 1 });
  assert.deepEqual(Object.keys(trimmed.perPlayer), ids, 'frame-size trimming keeps every player');
});

test('five client-run normal fields wait for the fifth result; its progress, units and LP are preserved', () => {
  const h = makeMatch({ mode: 'coop', humans: 5, seed: 15001, fake: true, clientCombat: true, clients: false,
    script: (b) => ({ duration: 6, leaks: Object.fromEntries(b.players.map((pid) => [pid, pid === 'p_4' ? 2 : 1])) }),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const fifth = h.ps('p_4');
  const id = chessOfTier(1).find((key) => m.pool.has(key));
  const unit = give(m, fifth, id, 'board', legalTileFor(m, fifth, id));
  const lp = fifth.lp;
  h.drive(() => m.phase === PHASE.COMBAT);
  assert.deepEqual(m.publicView().players.map((p) => p.playerId), ids);
  assert.deepEqual(m.fields.map((f) => f.players), ids.map((pid) => [pid]));
  for (const pid of ids) {
    const f = m.fields.find((x) => x.players.includes(pid));
    assert.equal(f.authority, pid);
    const start = h.lastTo(pid, 'b.start');
    assert.equal(start.fieldId, `n:${pid}`);
    assert.equal(start.authoritative, true);
  }
  const f5 = m.fields[4];
  assert.ok(f5.spec.players[0].units.some((u) => u.uid === unit.uid));
  m.handle('p_4', { t: 'b.progress', battleId: f5.battleId, gt: 4, killed: 1, total: 9, leaks: 2 });
  assert.deepEqual(m.publicView().fields[4].progress, { killed: 1, total: 9, done: false });
  assert.equal(m.publicView().players[4].pendingLp, 2);
  m.handle('p_0', { t: 'b.progress', battleId: f5.battleId, gt: 99, killed: 9, total: 9 });
  assert.equal(f5.progress.killed, 1, 'only the fifth player can report its own field');
  for (const f of m.fields.slice(0, 4)) m.handle(f.authority, { t: 'b.result', battleId: f.battleId, result: finishFake(m, f) });
  assert.equal(m.phase, PHASE.COMBAT);
  assert.equal(f5.done, false, 'four finished fields do not advance the five-player round');
  m.handle('p_4', { t: 'b.result', battleId: f5.battleId, result: finishFake(m, f5) });
  h.runToPhase(PHASE.SETTLE);
  assert.deepEqual([...m.lastResults.keys()], ids);
  assert.equal(fifth.lp, lp - 2);
  assert.equal(m.verifyStats.rejected, 0);
  checkInvariants(m);
  close(h);
});

test('five-player unite can select the fifth helper; ranked routing and authority include everyone', () => {
  const h = makeMatch({ mode: 'coop', humans: 5, seed: 15002, fake: true, clientCombat: true,
    script: (b) => b.kind === 'normal' ? { leaks: { p_0: 2, p_1: 3, p_3: 4 } }
      : b.kind === 'unite' ? { survivors: { p_0: 1, p_1: 2, p_3: 3 } } : {},
  }).start();
  const m = h.m;
  h.toPrep(1);
  const [a, b] = chessOfTier(1).filter((key) => m.pool.has(key)).slice(0, 2);
  const first = give(m, h.ps('p_4'), a, 'board', legalTileFor(m, h.ps('p_4'), a));
  give(m, h.ps('p_4'), b, 'board', legalTileFor(m, h.ps('p_4'), b));
  give(m, h.ps('p_2'), a, 'board', legalTileFor(m, h.ps('p_2'), a));
  const before = Object.fromEntries(ids.map((pid) => [pid, h.ps(pid).lp]));
  h.drive(() => m.phase === PHASE.UNITE);
  const f = m.fields[0];
  assert.deepEqual(f.players, ['p_4', 'p_2'], 'the fifth helper ranks first by deployed count');
  assert.equal(f.authority, 'p_2', 'the lower seated connected helper reports the shared field');
  assert.deepEqual(f.spec.players.map((p) => [p.playerId, p.colOffset]), [['p_4', 8], ['p_2', 0]]);
  assert.deepEqual(f.spec.players[0].units.find((u) => u.uid === first.uid).carryState, { hpPct: 0.5, sp: 3, skillActive: false });
  assert.equal(f.spec.spawns.length, 9);
  for (const pid of ids) {
    const start = h.lastTo(pid, 'b.start');
    assert.equal(start.fieldId, 'u');
    assert.equal(start.watch, !f.players.includes(pid));
    assert.equal(start.authoritative, pid === 'p_2');
  }
  m.handle('p_2', { t: 'b.progress', battleId: f.battleId, gt: 3, killed: 3, total: 9, left: { p_0: 1, p_1: 2, p_3: 3 } });
  const pub = m.publicView();
  for (const [pid, left] of [['p_0', 1], ['p_1', 2], ['p_3', 3]]) assert.equal(pub.players.find((p) => p.playerId === pid).uniteLeft, left);
  h.drive(() => m.phase === PHASE.SETTLE);
  for (const [pid, loss] of [['p_0', 1], ['p_1', 2], ['p_2', 0], ['p_3', 3], ['p_4', 0]]) assert.equal(h.ps(pid).lp, before[pid] - loss);
  assert.equal(m.verifyStats.rejected, 0);
  checkInvariants(m);
  close(h);
});

test('five-player unite attributes the fifth leaker and publishes all four leakers beside one helper', () => {
  const leakers = ['p_0', 'p_1', 'p_3', 'p_4'];
  const h = makeMatch({ mode: 'coop', humans: 5, seed: 15003, fake: true, clientCombat: true,
    script: (b) => b.kind === 'normal' ? { leaks: Object.fromEntries(leakers.map((pid) => [pid, 2])) }
      : b.kind === 'unite' ? { survivors: Object.fromEntries(leakers.map((pid) => [pid, 1])) } : {},
  }).start();
  const m = h.m;
  h.toPrep(1);
  const lp = h.ps('p_4').lp;
  h.drive(() => m.phase === PHASE.UNITE);
  const f = m.fields[0];
  assert.deepEqual(m.unitePlan.leakers.map((p) => p.playerId), leakers);
  assert.deepEqual(f.players, ['p_2']);
  assert.equal(f.spec.spawns.filter((s) => s.sourcePlayerId === 'p_4').length, 2);
  m.handle('p_2', { t: 'b.progress', battleId: f.battleId, gt: 3, killed: 4, total: 8,
    left: Object.fromEntries(leakers.map((pid) => [pid, 1])) });
  assert.deepEqual(m.publicView().players.filter((p) => p.uniteLeft != null).map((p) => [p.playerId, p.uniteLeft]), leakers.map((pid) => [pid, 1]));
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(h.ps('p_4').lp, lp - 1);
  assert.equal(m.verifyStats.rejected, 0);
  checkInvariants(m);
  close(h);
});

for (const clientCombat of [false, true]) {
  test(`five-player Final Assault ${clientCombat ? 'client' : 'server'}: 2+2+1, unchanged shared boss HP and five result rows`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 5, seed: 15004, fake: true, clientCombat,
      script: (b) => b.kind === 'boss' ? { bossDps: b.sharedBoss.maxHp / 30,
        leakEvents: b.fieldId === 'b3' ? [{ at: 1, lpr: 7 }] : [] } : {},
    }).start();
    const m = h.m;
    h.toPrep(14);
    ids.forEach((pid, i) => { h.ps(pid).lp = 10 * (i + 1); });
    assert.deepEqual(m.bossWaves.map((w) => w.players), pairs, 'prep previews already include the singleton');
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    assert.equal(m.teamLp, 150);
    assert.deepEqual(m.fields.map((f) => [f.fieldId, f.players]), [['b1', pairs[0]], ['b2', pairs[1]], ['b3', pairs[2]]]);
    const opts = m.fields.map((f) => clientCombat ? f.spec : f.battle.opts);
    assert.deepEqual(opts.map((o) => o.players.map((p) => p.side)), [['L', 'R'], ['L', 'R'], ['L']]);
    assert.ok(/_s$/.test(opts[2].waveId));
    assert.equal(m.bossPool.maxHp, bossPoolHp(m.gd, m.bossId, 4), 'adding a fifth seat preserves boss balance');
    assert.equal(m.bossPool.maxHp, bossPoolHp(m.gd, m.bossId, 5));
    assert.ok(opts.every((o) => o.flags.layerGainsEnabled === false));
    if (clientCombat) {
      assert.deepEqual(m.fields.map((f) => f.authority), ['p_0', 'p_2', 'p_4']);
      assert.equal(h.lastTo('p_4', 'b.start').fieldId, 'b3');
      assert.equal(h.lastTo('p_4', 'b.start').authoritative, true);
    }
    assert.equal(m.handle('p_4', { t: 'g.watch', fieldId: 'b1' }).error, 'BAD_TARGET');
    const result = h.runToEnd();
    assert.equal(result.victory, true);
    assert.equal(result.roundsPassed, 14);
    assert.deepEqual(result.players.map((p) => p.playerId), ids);
    assert.equal(result.teamLp, 143);
    assert.equal(result.players.reduce((sum, p) => sum + p.lp, 0), 143);
    assert.ok(result.players[4].stats.bossDamage > 0, 'the singleton credits its damage to the shared pool');
    for (const pid of ids) assert.equal(h.lastTo(pid, 'm.result').playerId, pid);
    assert.equal(m.errorCount, 0);
    assert.equal(m.verifyStats.rejected, 0);
    checkInvariants(m);
    close(h);
  });

  test(`five-player Hidden Core ${clientCombat ? 'client' : 'server'}: the fifth player's layers unlock R15 and all three groups return`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 5, seed: 52, fake: true, clientCombat,
      script: (b) => b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: b.sharedBoss.maxHp / 18 } : {},
    }).start();
    const m = h.m;
    h.toPrep(14);
    ids.forEach((pid, i) => { const p = h.ps(pid); p.bondCountBonus.yanShip = 3; p.layers.yanShip = i === 4 ? 1 : 300; p.recompute(); });
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    assert.equal(m.hiddenLayerSum, 1201, 'first four contribute only the 1200 threshold; the fifth crosses it');
    h.toPrep(15);
    assert.equal(m.hiddenReached, true);
    assert.deepEqual(m.bossWaves.map((w) => w.players), pairs);
    const teamLp = m.teamLp;
    h.drive(() => m.phase === PHASE.HIDDEN_CORE);
    assert.deepEqual(m.fields.map((f) => f.players), pairs);
    assert.equal(m.teamLp, teamLp);
    assert.equal(m.bossPool.maxHp, bossPoolHp(m.gd, m.hiddenBossId, 4));
    if (clientCombat) assert.equal(h.lastTo('p_4', 'b.start').fieldId, 'b3');
    const result = h.runToEnd();
    assert.equal(result.hiddenCleared, true);
    assert.equal(result.roundsPassed, 15);
    assert.ok(result.players.every((p) => p.roundsPassed === 15));
    assert.deepEqual(result.players.map((p) => p.playerId), ids);
    assert.equal(m.errorCount, 0);
    assert.equal(m.verifyStats.rejected, 0);
    checkInvariants(m);
    close(h);
  });
}

test('odd five-player pairing sorts seats and keeps the fifth survivor when another player leaves', () => {
  const alive = ids.map((playerId, seat) => ({ playerId, seat })).reverse();
  assert.deepEqual(pairPlayers(alive).map((g) => g.map((p) => p.playerId)), pairs);
  assert.deepEqual(pairPlayers(alive.filter((p) => p.playerId !== 'p_1')).map((g) => g.map((p) => p.playerId)), [['p_0', 'p_2'], ['p_3', 'p_4']]);
});
