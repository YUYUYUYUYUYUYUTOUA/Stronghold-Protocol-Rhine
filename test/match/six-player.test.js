// Six seats through actual match interfaces: result validation, field authority, unite routing and boss settlement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, MAX_SEATS } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildBattleSpec, createBattleFromSpec, compactResult, fitResult } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { bossPoolHp, pairPlayers } from '../../server/match/finalAssault.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildResult } from '../../server/match/results.js';
import { DATA, makeMatch, checkInvariants, give, legalTileFor, chessOfTier } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const ids = ['p_0', 'p_1', 'p_2', 'p_3', 'p_4', 'p_5'];
const pairs = [['p_0', 'p_1'], ['p_2', 'p_3'], ['p_4', 'p_5']];
const finishFake = (m, f) => {
  const b = createBattleFromSpec(f.spec, m.ds, { BattleClass: FakeBattle });
  while (!b.finished) b.step();
  return compactResult(b.result());
};
const close = (h) => { h.m.dispose(); h.clients?.closeAll(); };

test('real six-player results keep the sixth record through upload, trimming and semantic validation', () => {
  assert.equal(MAX_SEATS, 6);
  const spec = buildBattleSpec({
    battleId: 'six-player-upload', fieldId: 'n:six', kind: 'normal', seed: 6, round: 1,
    stageId: Object.keys(DATA.stages)[0], timeLimit: 1, content: 'full',
    players: ids.map((playerId) => ({ playerId, side: 'L', units: [] })),
    spawns: ids.map((ownerPlayerId) => ({ enemyKey: 'enemy_1007_slime', ownerPlayerId, time: 0, count: 1 })),
    flags: { layerGainsEnabled: true },
  });
  const battle = createBattleFromSpec(spec, DATA, { recordEvents: false, quiet: true });
  const result = compactResult(battle.runToEnd(2));
  assert.deepEqual(Object.keys(result.perPlayer), ids);
  assert.ok(result.perPlayer.p_5.total > 0, 'the sixth player owns its spawned enemy');
  assert.equal(validateC2S({ t: 'b.result', battleId: spec.battleId, result }), null);
  const validated = validateClientResult(spec, result);
  assert.equal(validated.ok, true, validated.reason);
  assert.deepEqual(Object.keys(validated.result.perPlayer), ids);
  assert.deepEqual(Object.keys(fitResult(result, { budget: 1 }).perPlayer), ids, 'frame trimming keeps every player');
  const tampered = (edit) => { const r = structuredClone(result); edit(r); return validateClientResult(spec, r); };
  assert.equal(tampered((r) => { delete r.perPlayer.p_5; }).reason, 'players', 'the sixth result is required');
  assert.equal(tampered((r) => { r.perPlayer.p_5.layerGains.yanShip = 65; }).reason, 'layer bound', 'sixth-player gains obey the same bound');
  assert.equal(tampered((r) => { r.perPlayer.p_5.coins = 1; }).reason, 'coins', 'sixth-player coins cannot exceed the spawn bounties');
});

test('six client normal fields wait for the sixth result and preserve its progress, units and LP', () => {
  const h = makeMatch({ mode: 'coop', humans: 6, seed: 16001, fake: true, clientCombat: true, clients: false,
    script: (b) => ({ duration: 6, leaks: Object.fromEntries(b.players.map((pid) => [pid, pid === 'p_5' ? 2 : 1])) }),
  }).start();
  try {
    const m = h.m;
    h.toPrep(1);
    const sixth = h.ps('p_5');
    const id = chessOfTier(1).find((key) => m.pool.has(key));
    const unit = give(m, sixth, id, 'board', legalTileFor(m, sixth, id));
    const lp = sixth.lp;
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
    const f6 = m.fields[5];
    assert.ok(f6.spec.players[0].units.some((u) => u.uid === unit.uid));
    m.handle('p_5', { t: 'b.progress', battleId: f6.battleId, gt: 4, killed: 1, total: 9, leaks: 2 });
    assert.deepEqual(m.publicView().fields[5].progress, { killed: 1, total: 9, done: false });
    assert.equal(m.publicView().players[5].pendingLp, 2);
    m.handle('p_0', { t: 'b.progress', battleId: f6.battleId, gt: 99, killed: 9, total: 9 });
    assert.equal(f6.progress.killed, 1, 'a foreign player cannot report the sixth field');
    for (const f of m.fields.slice(0, 5)) m.handle(f.authority, { t: 'b.result', battleId: f.battleId, result: finishFake(m, f) });
    assert.equal(m.phase, PHASE.COMBAT);
    assert.equal(f6.done, false, 'five finished fields do not advance a six-player round');
    m.handle('p_5', { t: 'b.result', battleId: f6.battleId, result: finishFake(m, f6) });
    h.runToPhase(PHASE.SETTLE);
    assert.deepEqual([...m.lastResults.keys()], ids);
    assert.equal(sixth.lp, lp - 2);
    assert.equal(m.verifyStats.rejected, 0);
    checkInvariants(m);
  } finally { close(h); }
});

test('six-player unite selects the sixth helper and routes the shared field to all six players', () => {
  const h = makeMatch({ mode: 'coop', humans: 6, seed: 16002, fake: true, clientCombat: true,
    script: (b) => b.kind === 'normal' ? { leaks: { p_0: 2, p_1: 3, p_3: 4, p_4: 1 } }
      : b.kind === 'unite' ? { survivors: { p_0: 1, p_1: 2, p_3: 3, p_4: 1 } } : {},
  }).start();
  try {
    const m = h.m;
    h.toPrep(1);
    const [a, b] = chessOfTier(1).filter((key) => m.pool.has(key)).slice(0, 2);
    const first = give(m, h.ps('p_5'), a, 'board', legalTileFor(m, h.ps('p_5'), a));
    give(m, h.ps('p_5'), b, 'board', legalTileFor(m, h.ps('p_5'), b));
    give(m, h.ps('p_2'), a, 'board', legalTileFor(m, h.ps('p_2'), a));
    const before = Object.fromEntries(ids.map((pid) => [pid, h.ps(pid).lp]));
    h.drive(() => m.phase === PHASE.UNITE);
    const f = m.fields[0];
    assert.deepEqual(f.players, ['p_5', 'p_2'], 'the sixth helper ranks first by deployed count');
    assert.equal(f.authority, 'p_2', 'the lower seated connected helper reports the shared field');
    assert.deepEqual(f.spec.players.map((p) => [p.playerId, p.colOffset]), [['p_5', 8], ['p_2', 0]]);
    assert.deepEqual(f.spec.players[0].units.find((u) => u.uid === first.uid).carryState, { hpPct: 0.5, sp: 3, skillActive: false });
    assert.equal(f.spec.spawns.length, 10);
    for (const pid of ids) {
      const start = h.lastTo(pid, 'b.start');
      assert.equal(start.fieldId, 'u');
      assert.equal(start.watch, !f.players.includes(pid));
      assert.equal(start.authoritative, pid === 'p_2');
    }
    m.handle('p_2', { t: 'b.progress', battleId: f.battleId, gt: 3, killed: 3, total: 10, left: { p_0: 1, p_1: 2, p_3: 3, p_4: 1 } });
    for (const [pid, left] of [['p_0', 1], ['p_1', 2], ['p_3', 3], ['p_4', 1]]) assert.equal(m.publicView().players.find((p) => p.playerId === pid).uniteLeft, left);
    h.drive(() => m.phase === PHASE.SETTLE);
    for (const [pid, loss] of [['p_0', 1], ['p_1', 2], ['p_2', 0], ['p_3', 3], ['p_4', 1], ['p_5', 0]]) assert.equal(h.ps(pid).lp, before[pid] - loss);
    assert.equal(m.verifyStats.rejected, 0);
    checkInvariants(m);
  } finally { close(h); }
});

test('six-player unite attributes the sixth leaker and publishes all five leakers beside one helper', () => {
  const leakers = ['p_0', 'p_1', 'p_3', 'p_4', 'p_5'];
  const h = makeMatch({ mode: 'coop', humans: 6, seed: 16003, fake: true, clientCombat: true,
    script: (b) => b.kind === 'normal' ? { leaks: Object.fromEntries(leakers.map((pid) => [pid, 2])) }
      : b.kind === 'unite' ? { survivors: Object.fromEntries(leakers.map((pid) => [pid, 1])) } : {},
  }).start();
  try {
    const m = h.m;
    h.toPrep(1);
    const lp = h.ps('p_5').lp;
    h.drive(() => m.phase === PHASE.UNITE);
    const f = m.fields[0];
    assert.deepEqual(m.unitePlan.leakers.map((p) => p.playerId), leakers);
    assert.deepEqual(f.players, ['p_2']);
    assert.equal(f.spec.spawns.filter((s) => s.sourcePlayerId === 'p_5').length, 2);
    m.handle('p_2', { t: 'b.progress', battleId: f.battleId, gt: 3, killed: 5, total: 10,
      left: Object.fromEntries(leakers.map((pid) => [pid, 1])) });
    assert.deepEqual(m.publicView().players.filter((p) => p.uniteLeft != null).map((p) => [p.playerId, p.uniteLeft]), leakers.map((pid) => [pid, 1]));
    h.drive(() => m.phase === PHASE.SETTLE);
    assert.equal(h.ps('p_5').lp, lp - 1);
    assert.equal(m.verifyStats.rejected, 0);
    checkInvariants(m);
  } finally { close(h); }
});

for (const clientCombat of [false, true]) {
  test(`six-player Final Assault ${clientCombat ? 'client' : 'server'}: 2+2+2, twice the four-player boss HP and six result rows`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 6, seed: 16004, fake: true, clientCombat,
      script: (b) => b.kind === 'boss' ? { bossDps: b.sharedBoss.maxHp / 30,
        leakEvents: b.fieldId === 'b3' ? [{ at: 1, lpr: 7 }] : [] } : {},
    }).start();
    try {
      const m = h.m;
      h.toPrep(14);
      ids.forEach((pid, i) => { h.ps(pid).lp = 10 * (i + 1); });
      assert.deepEqual(m.bossWaves.map((w) => w.players), pairs);
      h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
      assert.equal(m.teamLp, 210);
      assert.deepEqual(m.fields.map((f) => [f.fieldId, f.players]), [['b1', pairs[0]], ['b2', pairs[1]], ['b3', pairs[2]]]);
      const opts = m.fields.map((f) => clientCombat ? f.spec : f.battle.opts);
      assert.deepEqual(opts.map((o) => o.players.map((p) => p.side)), [['L', 'R'], ['L', 'R'], ['L', 'R']]);
      assert.ok(opts.every((o) => !/_s$/.test(o.waveId)), 'all six survivors use paired boss templates');
      assert.equal(m.bossPool.maxHp, 2 * bossPoolHp(new GameData(DATA, m.modeId, 4), m.bossId, 4), 'six-seat pool is 200% of a four-seat match');
      assert.equal(m.bossPool.maxHp, bossPoolHp(m.gd, m.bossId, 6));
      assert.ok(opts.every((o) => o.flags.layerGainsEnabled === false));
      if (clientCombat) {
        assert.deepEqual(m.fields.map((f) => f.authority), ['p_0', 'p_2', 'p_4']);
        assert.equal(h.lastTo('p_5', 'b.start').fieldId, 'b3');
        assert.equal(h.lastTo('p_5', 'b.start').authoritative, false, 'sixth player is the paired display replica');
      }
      const result = h.runToEnd();
      assert.equal(result.victory, true);
      assert.equal(result.roundsPassed, 14);
      assert.deepEqual(result.players.map((p) => p.playerId), ids);
      assert.equal(result.teamLp, 203);
      assert.equal(result.players.reduce((sum, p) => sum + p.lp, 0), 203);
      assert.ok(result.players[5].stats.bossDamage > 0, 'sixth-player damage reaches the shared pool and report');
      for (const [seat, pid] of ids.entries()) {
        const row = result.players[seat];
        assert.equal(row.seat, seat);
        assert.ok(row.reward > 0 && Number.isFinite(row.trophies));
        for (const value of Object.values(row.stats)) assert.ok(Number.isFinite(value));
        assert.equal(h.lastTo(pid, 'm.result').playerId, pid, 'all six get their own addressed result');
      }
      assert.equal(m.errorCount, 0);
      assert.equal(m.verifyStats.rejected, 0);
      checkInvariants(m);
    } finally { close(h); }
  });

  test(`six-player Hidden Core ${clientCombat ? 'client' : 'server'}: sixth-player layers unlock R15 and all three pairs return`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 6, seed: 52, fake: true, clientCombat,
      script: (b) => b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: b.sharedBoss.maxHp / 18 } : {},
    }).start();
    try {
      const m = h.m;
      h.toPrep(14);
      ids.forEach((pid, i) => { const p = h.ps(pid); p.bondCountBonus.yanShip = 3; p.layers.yanShip = i === 5 ? 1 : 240; p.recompute(); });
      h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
      assert.equal(m.hiddenLayerSum, 1201, 'the first five reach the threshold; the sixth crosses it');
      h.toPrep(15);
      assert.equal(m.hiddenReached, true);
      assert.deepEqual(m.bossWaves.map((w) => w.players), pairs);
      const teamLp = m.teamLp;
      h.drive(() => m.phase === PHASE.HIDDEN_CORE);
      assert.deepEqual(m.fields.map((f) => f.players), pairs);
      assert.equal(m.teamLp, teamLp);
      assert.equal(m.bossPool.maxHp, 2 * bossPoolHp(new GameData(DATA, m.modeId, 4), m.hiddenBossId, 4));
      if (clientCombat) assert.equal(h.lastTo('p_5', 'b.start').fieldId, 'b3');
      const result = h.runToEnd();
      assert.equal(result.hiddenCleared, true);
      assert.equal(result.roundsPassed, 15);
      assert.ok(result.players.every((p) => p.roundsPassed === 15));
      assert.deepEqual(result.players.map((p) => p.playerId), ids);
      assert.equal(m.errorCount, 0);
      assert.equal(m.verifyStats.rejected, 0);
      checkInvariants(m);
    } finally { close(h); }
  });
}

test('sixth-player report keeps its own eliminated round, lineup and stats alongside five surviving teammates', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 6, seed: 16006, fake: true }).start();
  try {
    h.toPrep(6);
    const m = h.m;
    const sixth = h.ps('p_5');
    const id = chessOfTier(1).find((key) => m.pool.has(key));
    give(m, sixth, id, 'board', legalTileFor(m, sixth, id));
    sixth.stats.dmgDealt = 1234;
    sixth.stats.kills = 7;
    sixth.lp = 0;
    sixth.eliminate(6);
    m.round = 15;
    const result = buildResult(m, { victory: true, hiddenReached: true, hiddenCleared: true, reason: 'victory' });
    assert.deepEqual(result.players.map((p) => p.playerId), ids);
    const row = result.players[5];
    assert.equal(row.seat, 5);
    assert.equal(row.roundsPassed, 5);
    assert.equal(row.eliminatedRound, 6);
    assert.equal(row.victory, false);
    assert.deepEqual(row.lineup, [], 'the eliminated sixth seat releases its lineup before reporting');
    assert.equal(row.stats.dmgDealt, 1234);
    assert.equal(row.stats.kills, 7);
    assert.equal(row.trophies, m.gd.config.trophies.byRoundsPassed.find((x) => 5 <= x.maxRound).HARD);
    assert.ok(result.players.slice(0, 5).every((p) => p.roundsPassed === 15 && p.victory));
  } finally { close(h); }
});

test('six-player pairing sorts seats; a departed teammate leaves the sixth survivor in a singleton field', () => {
  const alive = ids.map((playerId, seat) => ({ playerId, seat })).reverse();
  assert.deepEqual(pairPlayers(alive).map((g) => g.map((p) => p.playerId)), pairs);
  assert.deepEqual(pairPlayers(alive.filter((p) => p.playerId !== 'p_1')).map((g) => g.map((p) => p.playerId)), [['p_0', 'p_2'], ['p_3', 'p_4'], ['p_5']]);
});
