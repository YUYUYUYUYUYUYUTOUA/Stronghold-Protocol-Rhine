import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as rem from '../../server/sim/content/rem.js';
import { compactResult, resultDigest, buildBattleSpec } from '../../server/sim/spec.js';

function field(count = 0, players = null, kind = 'normal') {
  const h = makeBattle({ kind, content: 'generic', extraContent: [rem], autoFinish: false, timeLimit: 180,
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

test('Rem 6/9 appearance attack and HP count successful generations of all types and sources to 200/300%', () => {
  for (const [count, increment, cap] of [[3, 0, 0], [6, 4, 200], [9, 8, 300]]) {
    const h = field(count), s = h.b.remState.get('p1'), op = h.unit(1), outsider = h.unit(2);
    const types = ['child', 'miner', 'combined', 'chef', 'enthusiast', 'food', 'bus', 'boss'];
    const sources = ['regular', 'jacinta', 'sandreckoner', 'bus'];
    const expected = () => Math.min(cap, s.appeared * increment) / 100;
    for (let i = 0; i < 55; i++) {
      s.queue.push({ type: types[i % types.length], source: sources[i % sources.length] });
      const appeared = s.appeared; h.step(); assert.equal(s.appeared, appeared + 1);
      assert.ok(Math.abs(op.s.atk - 100 * (1 + expected())) < 1e-8);
      assert.ok(Math.abs(op.s.maxHp - 1000 * (1 + expected())) < 1e-8);
      const unit = s.units.at(-1), before = op.s.atk;
      h.b.emit('remSpawned', { unit, ownerId: 'p1', type: unit.remType });
      assert.equal(op.s.atk, before, 'replayed events do not count as another creation');
      h.b.kill(unit); assert.equal(op.s.atk, before, 'a death never subtracts appearances');
      assert.equal(outsider.s.atk, 100); assert.equal(outsider.s.maxHp, 1000);
    }
    assert.equal(op.s.atk, 100 * (1 + cap / 100));
    assert.deepEqual(h.b.errors, []);
  }
});

test('Rem appearance ignores failed deployment, preserves the buff through redeploy and resets in a new round', () => {
  const h = field(6), s = h.b.remState.get('p1'), op = h.unit(1);
  const count = s.appeared, before = op.s.atk, spawn = h.b.spawnToken;
  h.b.spawnToken = () => null;
  s.queue.push({ type: 'miner', source: 'test' }); h.step();
  assert.equal(s.appeared, count); assert.equal(op.s.atk, before); assert.equal(s.queue.length, 1);
  h.b.spawnToken = spawn; h.step();
  assert.equal(s.appeared, count + 1); assert.equal(op.findBuff('rem:appearance').mods.hpPct, (count + 1) * .04);
  h.b.kill(op); h.b.kill(s.units.at(-1));
  s.queue.push({ type: 'food', source: 'test' }); h.step();
  const pct = s.appeared * .04;
  assert.equal(op.findBuff('rem:appearance').mods.atkPct, pct);
  assert.ok(h.b.redeploy(op)); assert.ok(Math.abs(op.s.maxHp - 1000 * (1 + pct)) < 1e-8);
  const next = field(6); assert.equal(next.b.remState.get('p1').appeared, count);
  assert.equal(next.unit(1).s.atk, before);
  assert.deepEqual(h.b.errors, []);
});

test('Rem appearance is player-local in shared fields', () => {
  const h = field(0, ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field',
    units: [{ uid: playerId, chessId: 'rem_op', row: 12, col: 8 + seat }],
    bonds: { remShip: { active: true, count: 6, layers: 0 } } })));
  const a = h.b.getPlayer('p1').units[0], b = h.b.getPlayer('p2').units[0], before = b.s.atk;
  const s = h.b.remState.get('p1'); s.queue.push({ type: 'miner', source: 'test' }); h.step();
  assert.equal(a.s.atk, 100 * (1 + s.appeared * .04)); assert.equal(b.s.atk, before);
  assert.deepEqual(h.b.errors, []);
});

test('Rem appearance crosses normal combat into unite, survives the wire and never carries into a new round', () => {
  const normal = field(6), source = normal.b.remState.get('p1');
  source.queue.push({ type: 'miner', source: 'test' }); normal.step();
  normal.b.forceEnd();
  const result = normal.result(), wire = compactResult(result), appeared = source.appeared;
  assert.equal(result.perPlayer.p1.remAppearances, appeared);
  assert.equal(wire.perPlayer.p1.remAppearances, appeared);
  assert.equal(resultDigest(wire).hash, resultDigest(result).hash);
  assert.notEqual(resultDigest({ ...wire, perPlayer: { p1: { ...wire.perPlayer.p1, remAppearances: appeared + 1 } } }).hash,
    resultDigest(wire).hash, 'carry affects subsequent combat and belongs in the verification digest');
  for (const count of [6, 9]) {
    const player = { playerId: 'p1', remAppearances: 50,
      units: [{ uid: 1, chessId: 'rem_op', row: 12, col: 8 }],
      bonds: { remShip: { active: true, count, layers: 0 } } };
    const h = field(count, [player], 'unite'), op = h.unit(1), cap = count === 6 ? 2 : 3;
    assert.equal(op.s.atk, 100 * (1 + cap)); assert.equal(op.s.maxHp, 1000 * (1 + cap));
    assert.equal(h.b.remState.get('p1').appeared >= 50, true);
    const fresh = field(count, [player], 'normal');
    assert.ok(fresh.b.remState.get('p1').appeared < 50, 'another combat round starts its own count');
  }
  for (const kind of ['normal', 'boss', 'hidden']) {
    const spec = buildBattleSpec({ kind, players: [{ playerId: 'p1', remAppearances: 50, units: [] }] });
    assert.equal(spec.players[0].remAppearances, undefined);
  }
  for (const bad of [-1, 1.5, 1e9 + 1, '12']) {
    const spec = buildBattleSpec({ kind: 'unite', players: [{ playerId: 'p1', remAppearances: bad, units: [] }] });
    assert.equal(spec.players[0].remAppearances, undefined);
  }
  assert.deepEqual(normal.b.errors, []);
});

test('ordinary Rem reinforcements continuously patrol passable rally neighbours, stop to fight and resume', () => {
  for (const type of ['child', 'miner', 'combined', 'chef', 'enthusiast']) {
    const h = field(), s = h.b.remState.get('p1'); s.gate = [10, 3]; s.rally = [10, 6];
    s.queue.push({ type, source: 'test' }); h.step(); const unit = s.units.at(-1);
    unit.profile.noAttack = true;
    h.b.grid.setObstacle(9, 5, true);
    h.runUntil(() => unit.mem.remSettled, 15); assert.ok(unit.mem.remSettled, type);
    const visited = new Set(); let steps = 0;
    for (let i = 0; i < 300; i++) {
      const [x, y] = [unit.x, unit.y]; h.step();
      if (unit.x !== x || unit.y !== y) steps++;
      assert.ok(Math.max(Math.abs(unit.x - 6), Math.abs(unit.y - 10)) <= 1 + 1e-8);
      assert.ok(h.b.grid.groundPassable(unit.tileR, unit.tileC));
      visited.add(`${unit.tileR}:${unit.tileC}`); assert.ok(checkInvariants(h.b));
    }
    assert.ok(visited.size >= 4, `${type} tours distinct neighbours`);
    assert.equal(steps, 300, `${type} keeps marching every tick when unengaged`);
    const enemy = h.spawn('dummy', { pos: [unit.tileR, unit.tileC] });
    h.step(); const position = [unit.x, unit.y]; h.run(1);
    assert.deepEqual([unit.x, unit.y], position); assert.equal(unit.moving, false);
    h.b.kill(enemy); h.run(.2); assert.notDeepEqual([unit.x, unit.y], position);
    assert.deepEqual(h.b.errors, []);
  }
});
