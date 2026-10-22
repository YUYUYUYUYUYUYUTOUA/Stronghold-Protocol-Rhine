import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as rem from '../../server/sim/content/rem.js';
import { compactResult, resultDigest, buildBattleSpec } from '../../server/sim/spec.js';

function field(count = 0, players = null, kind = 'normal') {
  const h = makeBattle({ kind, content: 'generic', extraContent: [rem], autoFinish: false, timeLimit: 1000,
    defs: { chess: {
      rem_op: chessRec({ id: 'rem_op', bonds: ['remShip'], skill: null, stats: { atk: 100, maxHp: 1000, cost: 0 } }),
      other_op: chessRec({ id: 'other_op', skill: null, stats: { atk: 100, maxHp: 1000 } }),
    }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, speed: 0 }) } },
    players: players ?? [{ playerId: 'p1', units: [
      { uid: 1, chessId: 'rem_op', row: 12, col: 8 },
      { uid: 2, chessId: 'other_op', row: 12, col: 9 },
    ], bonds: { remShip: { active: count >= 3, count, layers: 0 } } }],
  });
  h.b.start();
  for (const s of h.b.remState.values()) {
    for (const u of s.units) h.b.retreat(u, { permanent: true });
    s.queue = []; s.regular = s.food = s.bus = s.boss = -1e6;
  }
  return h;
}
function put(h, type = 'miner', owner = 'p1', source = 'test') {
  const s = h.b.remState.get(owner), before = s.units.length;
  s.queue.push({ type, source }); h.step();
  assert.equal(s.units.length, before + 1, 'a reinforcement actually spawns');
  const unit = s.units.at(-1);
  h.b.addBuff(unit, { key: 'test:stationary', flags: { noMove: true }, persist: true });
  return unit;
}
function assertBonus(op, pct) {
  assert.ok(Math.abs(op.s.atk - 100 * (1 + pct / 100)) < 1e-8, 'attack bonus ' + pct);
  assert.ok(Math.abs(op.s.maxHp - 1000 * (1 + pct / 100)) < 1e-8, 'HP bonus ' + pct);
}

test('Rem 6/9 earns 1/2% per actual reinforcement-second, with no instant appearance reward', () => {
  for (const [count, increment] of [[3, 0], [6, 1], [9, 2]]) {
    const h = field(count), s = h.b.remState.get('p1'), op = h.unit(1), outsider = h.unit(2);
    const unit = put(h);
    assertBonus(op, 0); assert.equal(s.survivalTicks, 0);
    h.b.emit('remSpawned', { unit, ownerId: 'p1', type: unit.remType });
    assertBonus(op, 0);
    h.step(29); assertBonus(op, 0);
    h.step(); assertBonus(op, increment);
    assert.equal(s.survivalTicks, count >= 6 ? 30 : 0);
    assertBonus(outsider, 0); assert.ok(!unit.findBuff('rem:survival'));
    assert.ok(checkInvariants(h.b)); assert.deepEqual(h.b.errors, []);
  }
});

test('every actual Rem type and source, including vehicles and boss, contributes survival time', () => {
  const types = ['child', 'miner', 'combined', 'chef', 'enthusiast', 'food', 'bus', 'boss'];
  const sources = ['regular', 'jacinta', 'sandreckoner', 'bus'];
  for (const count of [6, 9]) for (let i = 0; i < types.length; i++) {
    const h = field(count), s = h.b.remState.get('p1');
    put(h, types[i], 'p1', sources[i % sources.length]); h.step(30);
    assert.equal(s.survivalTicks, 30, types[i]); assertBonus(h.unit(1), count === 6 ? 1 : 2);
    assert.ok(checkInvariants(h.b)); assert.deepEqual(h.b.errors, []);
  }
});

test('partial seconds pool across deaths, multiple survivors add time, caps and earned benefits remain', () => {
  for (const [count, increment, cap] of [[6, 1, 200], [9, 2, 300]]) {
    const h = field(count), s = h.b.remState.get('p1'), op = h.unit(1);
    const first = put(h); h.step(15); h.b.kill(first); h.step(15);
    assert.equal(s.survivalTicks, 15); assertBonus(op, 0);
    put(h); h.step(15); assert.equal(s.survivalTicks, 30); assertBonus(op, increment);
    for (let i = 0; i < 3; i++) put(h);
    const before = s.survivalTicks; h.step(30);
    assert.equal(s.survivalTicks, before + 120);
    h.run(60); assertBonus(op, cap); assert.ok(s.survivalTicks <= 6000);
    for (const unit of s.units) if (unit.alive) h.b.retreat(unit, { permanent: true });
    const earned = s.survivalTicks; h.run(2);
    assert.equal(s.survivalTicks, earned); assertBonus(op, cap);
    assert.ok(checkInvariants(h.b)); assert.deepEqual(h.b.errors, []);
  }
});

test('failed or queued spawns earn nothing; dead operators keep earned growth and redeploy with it', () => {
  const h = field(6), s = h.b.remState.get('p1'), op = h.unit(1), spawn = h.b.spawnToken;
  h.b.spawnToken = () => null;
  s.queue.push({ type: 'miner', source: 'test' }); h.run(2);
  assert.equal(s.survivalTicks, 0); assert.equal(s.queue.length, 1); assertBonus(op, 0);
  h.b.spawnToken = spawn; h.step(); const unit = s.units.at(-1);
  h.b.addBuff(unit, { key: 'test:stationary', flags: { noMove: true }, persist: true });
  h.step(30); assertBonus(op, 1);
  h.b.kill(op); h.step(30); assert.equal(op.findBuff('rem:survival').mods.atkPct, .02);
  assert.ok(h.b.redeploy(op)); assertBonus(op, 2);
  h.b.kill(unit); const earned = s.survivalTicks; h.step(60);
  assert.equal(s.survivalTicks, earned); assertBonus(op, 2); assert.deepEqual(h.b.errors, []);
});

test('Rem survival accounting and rewards stay player-local on a shared field', () => {
  const h = field(0, ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field',
    units: [{ uid: playerId, chessId: 'rem_op', row: 12, col: 8 + seat }],
    bonds: { remShip: { active: true, count: 6, layers: 0 } } })));
  const a = h.b.getPlayer('p1').units[0], b = h.b.getPlayer('p2').units[0];
  put(h); h.step(30); assertBonus(a, 1); assertBonus(b, 0);
  put(h, 'boss', 'p2'); h.step(30); assertBonus(a, 2); assertBonus(b, 1);
  assert.deepEqual(h.b.errors, []);
});

test('actual survival ticks cross normal combat into unite through the verified result, but reset next round', () => {
  const normal = field(6), source = normal.b.remState.get('p1');
  put(normal); normal.step(149); normal.b.forceEnd();
  const result = normal.result(), wire = compactResult(result);
  assert.equal(source.survivalTicks, 149);
  assert.equal(result.perPlayer.p1.remSurvivalTicks, 149); assert.equal(wire.perPlayer.p1.remSurvivalTicks, 149);
  assert.equal(wire.perPlayer.p1.remAppearances, undefined);
  assert.equal(resultDigest(wire).hash, resultDigest(result).hash);
  assert.notEqual(resultDigest({ ...wire, perPlayer: { p1: { ...wire.perPlayer.p1, remSurvivalTicks: 150 } } }).hash,
    resultDigest(wire).hash, 'future combat carry participates in verification');
  const player = { playerId: 'p1', remSurvivalTicks: 149,
    units: [{ uid: 1, chessId: 'rem_op', row: 12, col: 8 }],
    bonds: { remShip: { active: true, count: 6, layers: 0 } } };
  const unite = field(6, [player], 'unite'); assertBonus(unite.unit(1), 4);
  put(unite); unite.step(); assert.equal(unite.b.remState.get('p1').survivalTicks, 150); assertBonus(unite.unit(1), 5);
  const fresh = field(6, [player]); assert.equal(fresh.b.remState.get('p1').survivalTicks, 0); assertBonus(fresh.unit(1), 0);
  for (const kind of ['normal', 'boss', 'hidden']) {
    assert.equal(buildBattleSpec({ kind, players: [{ playerId: 'p1', remSurvivalTicks: 149, units: [] }] }).players[0].remSurvivalTicks, undefined);
  }
  for (const bad of [-1, 1.5, 1e9 + 1, '12']) {
    assert.equal(buildBattleSpec({ kind: 'unite', players: [{ playerId: 'p1', remSurvivalTicks: bad, units: [] }] }).players[0].remSurvivalTicks, undefined);
  }
  assert.deepEqual(normal.b.errors, []); assert.deepEqual(unite.b.errors, []); assert.deepEqual(fresh.b.errors, []);
});

test('unite survival carry is capped to the relevant 6/9-tier reward', () => {
  for (const [count, ticks, cap] of [[6, 6000, 200], [9, 4500, 300], [9, 1e9, 300]]) {
    const h = field(count, [{ playerId: 'p1', remSurvivalTicks: ticks,
      units: [{ uid: 1, chessId: 'rem_op', row: 12, col: 8 }],
      bonds: { remShip: { active: true, count, layers: 0 } } }], 'unite');
    assert.ok(h.b.remState.get('p1').survivalTicks <= 6000); assertBonus(h.unit(1), cap);
    assert.deepEqual(h.b.errors, []);
  }
});

function bossField(S) {
  const h = field(9), s = h.b.remState.get('p1'); s.ps.bonds.remShip.layers = S;
  const boss = put(h, 'boss');
  const enemy = h.spawn('dummy', { pos: [Math.round(boss.y), Math.round(boss.x)] });
  enemy.base.def = 1200; enemy.markDirty(); enemy.profile.noAttack = true;
  return { h, boss, enemy };
}
test('nine-Rem boss scales its full 1000+2S ATK once, then bombs for 200% physical damage after the original fuse', () => {
  for (const [S, atk, damage] of [[0, 2500, 3800], [300, 4000, 6800], [600, 5500, 9800], [999, 7495, 13790]]) {
    const { h, boss, enemy } = bossField(S), hp = enemy.hp;
    assert.equal(boss.s.atk, atk);
    h.run(1.05); assert.equal(enemy.hp, hp, 'the launched bomb still waits its one-second fuse');
    h.run(1.05); assert.equal(hp - enemy.hp, damage, 'physical DEF is deducted after the 200% multiplier');
    assert.deepEqual(h.b.errors, []);
  }
});

test('boss bombs cache launch ATK and stay at one per game second despite attack speed changes', () => {
  const { h, boss, enemy } = bossField(300), hp = enemy.hp;
  h.run(1.05);
  h.b.addBuff(boss, { key: 'test:boss-atk', mods: { atkFlat: 1000, aspd: 500 }, persist: true });
  h.run(1.05); assert.equal(hp - enemy.hp, 6800);
  h.run(1.05); assert.equal(hp - enemy.hp, 15600);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'remPizza').length, 3);
  assert.deepEqual(h.b.errors, []);
});
