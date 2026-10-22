import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { createRng } from '../../server/sim/rng.js';
import { REM_POOLS, remPick, remStage } from '../../shared/rem.js';
import * as rem from '../../server/sim/content/rem.js';

const bond = count => ({ active: count >= 3, count, layers: 100 });
function fixture(count = 0, opts = {}) {
  return makeBattle({ content: 'generic', extraContent: [rem], autoFinish: false, timeLimit: 180,
    defs: { chess: { rem_test: chessRec({ id: 'rem_test', bonds: [], skill: null }) },
      enemies: { rem_enemy: enemyRec({ key: 'rem_enemy', hp: 100000, atk: 0, def: 0, speed: 0 }) } },
    units: [{ chessId: 'rem_test', row: 12, col: 8 }], bonds: { remShip: bond(count) },
    setup: b => { b.rng = () => .5; }, ...opts });
}
const state = (h, owner = 'p1') => h.b.remState.get(owner);
const live = s => s.units.filter(u => u.alive && u.deployed && !u.removed);
const ordinary = u => !['food', 'bus', 'boss'].includes(u.remType);
function cover(h, tiles, owner = 'p1') {
  const op = h.b.getPlayer(owner).units.find(u => u.kind === 'op');
  op.rangeGrid = tiles.map(([r, c]) => [r - op.tileR, c - op.tileC]);
  op.base.atk = 0; op.markDirty(); op.profile.noAttack = false;
  h.b._refreshRange(op);
  delete h.b._remCoverageTick;
  return op;
}
const lane = (from = 3, to = 10, row = 10) => Array.from({ length: to - from + 1 }, (_, i) => [row, from + i]);
function direct(h, type, point, source = 'test') {
  const s = state(h);
  const before = s.units.length;
  s.queue.push({ type, source }); h.step();
  assert.equal(s.units.length, before + 1, `spawn ${type}`);
  const u = s.units.at(-1);
  if (point) assert.ok(h.b.relocate(u, ...point));
  return u;
}
function drainManually(h) {
  const s = state(h);
  for (let n = 0; s.queue.length && n < 60; n++) {
    const gateUnit = live(s).find(u => u.tileR === s.gate[0] && u.tileC === s.gate[1]);
    if (gateUnit) {
      let moved = false;
      for (let r = 9; r <= 12 && !moved; r++) for (let c = 3; c <= 17 && !moved; c++) {
        if (h.b.grid.groundPassable(r, c) && !h.b._occ[r * 21 + c] && !h.b.downOn(r, c)) moved = h.b.relocate(gateUnit, r, c);
      }
      assert.ok(moved, 'fixture has space to clear its gate');
    }
    h.step();
  }
  assert.equal(s.queue.length, 0);
}

test('Rim thresholds and exact pool weights: a single combination trial, then normalized chef exclusion', () => {
  assert.deepEqual([0, 2, 3, 5, 6, 8, 9, 20].map(count => remStage(bond(count))), [0, 0, 1, 1, 2, 2, 3, 3]);
  for (let stage = 1; stage <= 3; stage++) for (const chef of [false, true]) {
    let calls = 0;
    assert.equal(remPick(() => { calls++; return .019999; }, stage, chef), 'combined');
    assert.equal(calls, 1);
    const weights = Object.entries(REM_POOLS[stage - 1]).filter(([type]) => chef || type !== 'chef');
    const total = weights.reduce((n, [, w]) => n + w, 0);
    let start = 0;
    for (const [type, weight] of weights) {
      const values = [.02, (start + weight / 2) / total];
      assert.equal(remPick(() => values.shift(), stage, chef), type);
      assert.equal(values.length, 0);
      start += weight;
    }
  }
});

test('seeded 100k draws per pool follow unconditional 2% and conditional ordinary weights', () => {
  for (let stage = 1; stage <= 3; stage++) {
    const rng = createRng(731 + stage), counts = {};
    for (let i = 0; i < 100000; i++) { const t = remPick(rng, stage); counts[t] = (counts[t] || 0) + 1; }
    assert.ok(Math.abs(counts.combined / 100000 - .02) < .002);
    for (const [type, weight] of Object.entries(REM_POOLS[stage - 1])) {
      assert.ok(Math.abs(counts[type] / 100000 - .98 * weight / 100) < .006, `${stage}/${type}`);
    }
  }
});

test('regular caps, Jacinta uncounted exceptions and bus/Shanbi counted exceptions are distinct', () => {
  for (const [count, cap] of [[3, 6], [6, 12], [9, 16]]) {
    const h = fixture(count); h.step(); const s = state(h);
    s.queue = s.queue.filter(q => q.type !== 'boss');
    h.b.remSummon('p1', 99, { source: 'regular', capMode: 'regular' }); drainManually(h);
    assert.equal(live(s).filter(u => u.remCounted).length, cap);
    assert.equal(h.b.remSummon('p1', 2, { source: 'regular', capMode: 'regular' }), 0);
    assert.equal(h.b.remSummon('p1', 2, { source: 'jacinta', poolStage: 1 }), 2); drainManually(h);
    assert.equal(live(s).filter(u => u.remCounted).length, cap);
    assert.equal(h.b.remSummon('p1', 2, { source: 'shanbi' }), 2); drainManually(h);
    assert.equal(live(s).filter(u => u.remCounted).length, cap + 2);
    assert.equal(h.b.remSummon('p1', 5, { source: 'bus' }), 5); drainManually(h);
    assert.equal(live(s).filter(u => u.remCounted).length, cap + 7);
    assert.equal(h.b.remSummon('p1', 1, { source: 'regular', capMode: 'regular' }), 0);
    assert.deepEqual(h.b.errors, []);
  }
});

test('chefs share the actual owner stage limit across Jacinta and other summon sources', () => {
  for (const [count, limit] of [[3, 1], [6, 2], [9, 3]]) {
    const h = fixture(count); h.step(); const s = state(h);
    s.queue = [];
    let draw = 0; h.b.rng = () => ++draw % 2 ? .5 : .95;
    h.b.remSummon('p1', 8, { source: 'jacinta', poolStage: 1 });
    h.b.remSummon('p1', 8, { source: 'shanbi', poolStage: 1 });
    drainManually(h);
    assert.equal(live(s).filter(u => u.remType === 'chef').length, limit);
    assert.deepEqual(h.b.errors, []);
  }
});

test('all opening reinforcements spawn together and leave the blue gate without a rally', () => {
  for (const [count, opening] of [[3, 2], [6, 2], [9, 3]]) {
    const h = fixture(count); h.run(4);
    const s = state(h);
    assert.equal(live(s).filter(u => u.remSource === 'regular').length, opening);
    assert.equal(s.rally, undefined); assert.equal(s.depth, undefined);
    assert.equal(h.b._occ[s.gate[0] * 21 + s.gate[1]], null);
    assert.ok(live(s).every(u => !h.b._occ.includes(u)));
    assert.deepEqual(h.b.errors, []); assert.ok(checkInvariants(h.b));
  }
});

test('pathfinding avoids occupied squares, hard obstacles, bodies and diagonal corner cutting', () => {
  const h = fixture(); h.step(); const u = h.unit('rem_test');
  h.b.setObstacle(10, 4, true);
  const path = rem.remPath(h.b, [10, 3], [[10, 5]]);
  assert.ok(path && path.length > 3);
  assert.ok(path.every(([r, c]) => !(r === 10 && c === 4)));
  for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]), 1);
  assert.equal(rem.remPath(h.b, [10, 3], [[u.tileR, u.tileC]]), null);
  h.b.kill(u);
  assert.equal(rem.remPath(h.b, [10, 3], [[u.tileR, u.tileC]]), null);
});

test('chefs are nonblocking arts attackers; aura is owner-only, nonstacking and removed on exit', () => {
  const players = ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field', bonds: {},
    units: [{ chessId: 'rem_test', row: 10 + seat, col: 6 }] }));
  const h = fixture(0, { players, kind: 'unite' }); h.step();
  state(h).stage = 2; // Two legal chefs; keep the fixture free of unrelated opening troops.
  const a = h.b.getPlayer('p1').units[0], ally = h.b.getPlayer('p2').units[0];
  const before = [a.s.res, a.s.aspd, ally.s.res];
  const chef = direct(h, 'chef', [10, 5]); const other = direct(h, 'chef', [9, 5]);
  h.run(.25);
  assert.equal(chef.s.blockCnt, 0); assert.equal(chef.profile.dmgType, 'arts');
  assert.equal(a.s.res, before[0] + 15); assert.equal(a.s.aspd, before[1] + 15);
  assert.equal(ally.s.res, before[2]);
  h.b.kill(chef); h.b.kill(other); h.run(.25);
  assert.equal(a.s.res, before[0]); assert.equal(a.s.aspd, before[1]);
});

test('food hits each grounded enemy only once per vehicle and never attacks or blocks', () => {
  const h = fixture(); h.step(); const food = direct(h, 'food', [10, 5]);
  h.b.addBuff(food, { key: 'test:stationary', flags: { noMove: true } });
  const e = h.spawn('rem_enemy', { pos: [10, 5] }); e.x = 5; e.y = 10;
  const hp = e.hp; h.run(.4); assert.equal(hp - e.hp, 1500);
  h.run(3); assert.equal(hp - e.hp, 1500);
  assert.equal(food.s.blockCnt, 0); assert.equal(food.profile.noAttack, true);
});

test('boss bombs once per second with one second flight and cached attack, independent of attack speed', () => {
  const h = fixture(); h.step(); const boss = direct(h, 'boss', [10, 5]);
  h.b.addBuff(boss, { key: 'test:stationary', flags: { noMove: true }, mods: { aspd: 500 } });
  const e = h.spawn('rem_enemy', { pos: [10, 5] }); e.x = 5; e.y = 10;
  const hp = e.hp; h.run(1.05); assert.equal(e.hp, hp);
  h.b.addBuff(boss, { key: 'test:later-atk', mods: { atkFlat: 1000 } });
  h.run(1.05); assert.equal(hp - e.hp, 2000, 'first projectile caches pre-buff ATK and approved damage multiplier');
  assert.equal(boss.s.blockCnt, 0); assert.equal(boss.profile.noAttack, true);
  assert.equal(boss.isFlying, true, 'boss has genuine flying identity');
  assert.equal(h.events.filter(e => e[0] === 'fx' && e[1] === 'remPizza').length, 2);
});

test('battle end clears every reinforcement and pending queue, without corpse or soul recursion', () => {
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    const h = fixture(0, { kind }); h.step();
    h.b.remSummon('p1', 20, { source: 'jacinta' });
    h.b.forceEnd();
    assert.equal(live(state(h)).length, 0); assert.equal(state(h).queue.length, 0);
    assert.equal(h.b.allyUnits.filter(u => u.kazdelSoul).length, 0);
    assert.deepEqual(h.b.errors, []);
  }
});

test('regular cadence is a single frozen stage timer, full caps never bank missed replenishment', () => {
  for (const [count, interval, batch, opening, cap] of [[3, 10, 1, 2, 6], [6, 8, 2, 2, 12], [9, 6, 3, 3, 16]]) {
    const h = fixture(count); h.step(); const s = state(h);
    const regularTotal = () => s.units.filter(u => u.remSource === 'regular').length + s.queue.filter(q => q.source === 'regular').length;
    assert.equal(regularTotal(), opening);
    s.ps.bonds.remShip.count = 0;
    h.run(interval - .1); assert.equal(regularTotal(), opening);
    h.run(.15); assert.equal(regularTotal(), opening + batch);
    h.b.remSummon('p1', cap, { source: 'regular', capMode: 'regular' });
    assert.equal(regularTotal(), cap);
    h.run(interval * 3); assert.equal(regularTotal(), cap);
    const old = live(s).find(u => u.remSource === 'regular'); h.b.kill(old);
    h.run(.2); assert.equal(regularTotal(), cap, 'no immediate catch-up after a slot becomes vacant');
  }
});

test('food begins at ten seconds; buses begin at 25 and bosses never reserve more than two', () => {
  const h = fixture(9); h.step(); const s = state(h);
  const total = type => s.units.filter(u => u.remType === type).length + s.queue.filter(q => q.type === type).length;
  assert.equal(total('boss'), 1); assert.equal(total('bus'), 0); assert.equal(total('food'), 0);
  h.run(9.8); assert.equal(total('food'), 0);
  h.run(.3); assert.equal(total('food'), 1);
  h.run(14.7); assert.equal(total('bus'), 0);
  h.run(.3); assert.equal(total('bus'), 1);
  h.run(5); assert.equal(total('food'), 2); assert.equal(total('boss'), 2);
  h.run(30); assert.equal(total('boss'), 2);
});

test('bus unloads at most five counted passengers once and disappears without collision damage', () => {
  const h = fixture(); h.step(); const s = state(h);
  const bus = direct(h, 'bus', s.vehicleStop);
  const e = h.spawn('rem_enemy', { pos: [bus.tileR, bus.tileC] }); e.x = bus.x; e.y = bus.y;
  let busDamage = 0; h.b.on('damaged', ({ source, amount }) => { if (source === bus) busDamage += amount; });
  h.run(1.1);
  assert.equal(bus.alive, false);
  assert.equal(s.units.filter(u => u.remSource === 'bus').length + s.queue.filter(q => q.source === 'bus').length, 5);
  assert.equal(busDamage, 0, 'bus does not deal collision damage');
  assert.ok(s.units.filter(u => u.remSource === 'bus').every(u => u.remCounted));
});

test('enthusiast stuns the primary target tile for 1.5 seconds and stores at most one charge', () => {
  const h = fixture(); h.step(); const u = direct(h, 'enthusiast', [10, 4]);
  h.b.addBuff(u, { key: 'test:stationary', flags: { noMove: true } });
  h.run(22); assert.equal(u.mem.remStun, 10);
  const target = h.spawn('rem_enemy', { pos: [10, 5] }), colocated = h.spawn('rem_enemy', { pos: [10, 5] });
  const nearSelf = h.spawn('rem_enemy', { pos: [10, 4] });
  for (const e of [target, colocated]) { e.x = 5; e.y = 10; }
  nearSelf.x = 4; nearSelf.y = 10;
  h.b.emit('attack', { attacker: u, targets: [target], isSkill: false });
  assert.equal(target.s.flags.stun, true); assert.equal(colocated.s.flags.stun, true);
  assert.notEqual(nearSelf.s.flags.stun, true); assert.equal(u.mem.remStun, 0);
  h.run(1.6); assert.notEqual(target.s.flags.stun, true);
});

test('marching contact blocks and attacks in place without rear coverage or dragging enemies', () => {
  const h = fixture(); h.step(); const u = direct(h, 'miner', [10, 4]);
  const e = h.spawn('rem_enemy', { pos: [10, 4] }); e.x = u.x; e.y = u.y;
  h.b._checkBlock(e); assert.equal(e.blockedBy, u);
  const before = [u.tileR, u.tileC, e.x, e.y];
  h.run(3);
  assert.deepEqual([u.tileR, u.tileC, e.x, e.y], before);
  assert.ok(e.hp < e.s.maxHp, 'attacks even without supporting operators');
  assert.ok(checkInvariants(h.b));
});

test('reinforcement stats scale the full player-layer panel and combination bonus by the owner tier only', () => {
  for (const S of [0, 100, 200, 300]) {
    const h = fixture(); h.step(); const s = state(h); s.stage = 1; s.ps.bonds.remShip.layers = S;
    const miner = direct(h, 'miner', [10, 5]), combo = direct(h, 'combined', [11, 5]);
    assert.equal(miner.s.atk, (500 + S) * 1.3); assert.equal(combo.s.atk - miner.s.atk, 780);
    assert.equal(miner.s.def, 240); assert.equal(combo.s.def - miner.s.def, 960);
    assert.equal(miner.s.maxHp, (1800 + 5 * S) * 1.5); assert.equal(combo.s.maxHp, miner.s.maxHp);
  }
});

test('two owners keep generation, counted limits and summon ownership independent', () => {
  const players = ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field',
    bonds: { remShip: bond(3) }, units: [{ chessId: 'rem_test', row: 12, col: 8 + seat }] }));
  const h = fixture(0, { players, kind: 'unite' }); h.step();
  for (const pid of ['p1', 'p2']) assert.equal(h.b.remSummon(pid, 10, { source: 'regular', capMode: 'regular' }), 4);
  const before = state(h, 'p2').queue.length;
  h.b.remSummon('p1', 3, { source: 'jacinta', poolStage: 1 });
  assert.equal(state(h, 'p2').queue.length, before);
  h.run(12);
  for (const pid of ['p1', 'p2']) {
    const s = state(h, pid);
    assert.ok(s.units.every(u => u.ownerId === pid && u.ownerUnit == null));
    assert.ok(live(s).filter(u => u.remCounted).length <= 6);
  }
  assert.deepEqual(h.b.errors, []); assert.ok(checkInvariants(h.b));
});

test('food and pizza exclude flying enemies; chef aura gives bosses RES but no ASPD', () => {
  const h = fixture(); h.step(); const chef = direct(h, 'chef', [10, 4]);
  const boss = direct(h, 'boss', [10, 5]), food = direct(h, 'food', [11, 5]);
  for (const u of [chef, boss, food]) h.b.addBuff(u, { key: 'test:stationary', flags: { noMove: true } });
  const e = h.spawn('rem_enemy', { pos: [10, 5] }); e.x = 5; e.y = 10;
  h.b.addBuff(e, { key: 'test:air', flags: { float: true } });
  const hp = e.hp;
  h.run(2.2);
  assert.equal(e.hp, hp); assert.equal(boss.s.res, 15); assert.equal(boss.s.aspd, 100);
  e.x = food.x; e.y = food.y; h.run(.2); assert.equal(e.hp, hp);
});

test('the production starter map admits the full opening batch without an enemy blocking the gate', () => {
  const h = fixture(9, { stageId: 'act2autochess_m01' }); h.run(15);
  const s = state(h);
  assert.ok(s.units.filter(u => u.remSource === 'regular').length >= 3,
    `opening troops stuck: ${JSON.stringify(s.units.map(u => [u.remType, u.tileR, u.tileC]))}`);
  assert.deepEqual(h.b.errors, []); assert.ok(checkInvariants(h.b));
});

test('both independent bosses can enter even when the ground gate and first off-road home are occupied', () => {
  const h = fixture(9); h.step(); const s = state(h);
  const first = s.units.find(u => u.remType === 'boss'); assert.ok(first);
  h.b.remSummon('p1', 30, { source: 'shanbi' });
  h.run(35);
  assert.equal(live(s).filter(u => u.remType === 'boss').length, 2, 'second boss must not starve behind grounded allies');
  assert.deepEqual(h.b.errors, []); assert.ok(checkInvariants(h.b));
});

test('moving boss bombs its world position and shares no occupancy with operators or other reinforcements', () => {
  const h = fixture(9); h.step(); const s = state(h), boss = s.units.find(u => u.remType === 'boss');
  const home = [boss.tileR, boss.tileC];
  const bombs = [];
  h.run(3.1);
  for (const e of h.events) if (e[0] === 'fx' && e[1] === 'remPizza') bombs.push({ x: e[2], y: e[3] });
  assert.ok(bombs.length >= 3);
  assert.notEqual(bombs[0].x, bombs[2].x, 'bomb centers follow the traveling boss');
  assert.deepEqual([boss.tileR, boss.tileC], home);
  assert.notEqual(h.b._occ[home[0] * 21 + home[1]], boss);
  assert.ok(h.b.remTroops.has(boss));
  assert.notEqual(h.b._occ[Math.round(boss.y) * 21 + Math.round(boss.x)], boss);
  assert.equal(boss.isFlying, true); assert.equal(boss.ground, false);
  assert.deepEqual(h.b.errors, []);
});

test('death frees shared chef and counted budgets, while pending reservations remain bounded', () => {
  const h = fixture(3); h.step(); const s = state(h);
  h.b.remSummon('p1', 99, { source: 'regular', capMode: 'regular' }); drainManually(h);
  const killed = live(s).find(u => u.remCounted); h.b.kill(killed);
  assert.equal(h.b.remSummon('p1', 99, { source: 'regular', capMode: 'regular' }), 1);
  assert.equal(live(s).filter(u => u.remCounted).length + s.queue.filter(q => q.source === 'regular').length, 6);
  s.queue = [];
  let draw = 0; h.b.rng = () => ++draw % 2 ? .5 : .95;
  h.b.remSummon('p1', 1, { source: 'jacinta', poolStage: 1 }); drainManually(h);
  const chef = live(s).find(u => u.remType === 'chef'); assert.ok(chef); h.b.kill(chef);
  h.b.remSummon('p1', 1, { source: 'jacinta', poolStage: 1 }); drainManually(h);
  assert.equal(live(s).filter(u => u.remType === 'chef').length, 1);
  assert.equal(chef.kazdelSoulUnit, undefined);
  assert.deepEqual(h.b.errors, []);
});

test('production starter-map troops fill beyond six bodies instead of parking across an empty downstream branch', () => {
  const h = fixture(9, { stageId: 'act2autochess_m01' }); h.run(60);
  const s = state(h);
  assert.ok(live(s).filter(u => u.remCounted).length >= 9,
    `six-body choke persists: ${JSON.stringify(s.units.map(u => [u.remType, u.tileR, u.tileC]))}`);
  assert.equal(live(s).filter(u => u.remType === 'boss').length, 2);
  assert.deepEqual(h.b.errors, []); assert.ok(checkInvariants(h.b));
});

test('a bypass arrival filling capacity cancels delayed regular slots instead of banking over-cap replenishment', () => {
  const h = fixture(3); h.step(); const s = state(h);
  assert.ok(h.b.spawnToken('p1', 'test_gate_blocker', ...s.gate, { def: { stats: { maxHp: 10000, blockCnt: 0 } }, kit: { trait: { noAttack: true } } }));
  h.b.remSummon('p1', 4, { source: 'regular', capMode: 'regular' });
  assert.ok(s.queue.some(q => q.regular));
  h.b.remSummon('p1', 6, { source: 'bus', point: [10, 6] });
  h.step();
  assert.ok(live(s).filter(u => u.remCounted).length >= 6);
  assert.equal(s.queue.filter(q => q.regular).length, 0);
  assert.equal(s.units.filter(u => u.remSource === 'regular').length, 2);
  assert.deepEqual(h.b.errors, []);
});

test('a full starter-map formation overlaps safely and keeps special vehicle routes usable', () => {
  const h = fixture(9, { stageId: 'act2autochess_m01' });
  h.run(120);
  const s = state(h);
  assert.ok(s.units.some(u => u.remType === 'food' || u.remType === 'bus'), 'vehicles have entered the corridor');
  for (let second = 0; second < 50; second++) {
    h.run(1);
    assert.deepEqual(h.b.errors, []);
    assert.ok(checkInvariants(h.b));
    assert.ok(live(s).every(u => !h.b._occ.includes(u) && !u.remTransitAnchor));
    assert.equal(live(s).filter(u => u.remType === 'boss').length, 2);
    assert.ok(s.queue.filter(q => q.regular).length <= Math.max(0, 16 - live(s).filter(u => u.remCounted).length),
      'blocked regular requests do not accumulate beyond their admission capacity');
  }
  assert.ok(s.units.some(u => ['remRouteEnd', 'remPassengersOut'].includes(u.removeReason)),
    'patrolling troops leave finite vehicle routes usable');
  h.b.forceEnd();
  assert.equal(live(s).length, 0);
  assert.equal(s.queue.length, 0);
});

function crossingFixture(type = 'miner', teammate = false) {
  const h = teammate ? fixture(0, { kind: 'unite', players: [
    { playerId: 'p1', coords: 'field', bonds: {}, units: [{ chessId: 'rem_test', row: 12, col: 8 }] },
    { playerId: 'p2', coords: 'field', bonds: {}, units: [] },
  ] }) : fixture(0);
  h.step(); const s = state(h); s.gate = [10, 3]; s.vehicleStop = [10, 8]; s.exit = [10, 9];
  cover(h, lane());
  const far = h.spawn('rem_enemy', { pos: [10, 10] });
  const allies = [4, 5].map(c => h.b.spawnToken(teammate ? 'p2' : 'p1', 'test_crossed_ally', 10, c,
    { def: { stats: { maxHp: 10000, atk: 0, blockCnt: 0 } }, kit: { trait: { noAttack: true } } }));
  for (let c = 2; c <= 13; c++) for (const r of [9, 11]) h.b.grid.setObstacle(r, c, true);
  const marcher = direct(h, type, [10, 3]);
  return { h, s, marcher, allies, far };
}

test('reinforcements continuously cross allied occupants without reserving or overwriting their tiles', () => {
  const { h, marcher, allies } = crossingFixture();
  h.run(1.05);
  assert.equal(marcher.tileC, 4);
  assert.equal(marcher.remTransitAnchor, undefined);
  assert.equal(h.b._occ[10 * 21 + 4], allies[0]);
  assert.equal(h.b._occ[10 * 21 + 3], null);
  assert.equal(h.b.relocate(marcher, 10, 5), false, 'an explicit deployment still refuses a non-Rem occupant');
  h.run(2.05);
  assert.equal(marcher.tileC, 6);
  assert.equal(h.b._occ[10 * 21 + 6], null);
  assert.equal(h.b._occ[10 * 21 + 5], allies[1]);
  assert.ok(checkInvariants(h.b));
});

test('real-position contact stops a marcher until its blocked enemy dies, then pursuit resumes', () => {
  const { h, marcher } = crossingFixture(); h.run(1.05);
  const behind = h.spawn('rem_enemy', { pos: [10, 3] });
  h.b._checkBlock(behind); assert.notEqual(behind.blockedBy, marcher);
  const enemy = h.spawn('rem_enemy', { pos: [10, 4] });
  h.b._checkBlock(enemy); assert.equal(enemy.blockedBy, marcher);
  const before = [marcher.x, marcher.y, enemy.x, enemy.y]; h.run(1.1);
  assert.deepEqual([marcher.x, marcher.y, enemy.x, enemy.y], before);
  h.b.kill(enemy); h.b.kill(behind); h.run(1.1);
  assert.ok(marcher.x > before[0] + 1);
  assert.ok(checkInvariants(h.b));
});

test('reinforcement death and battle cleanup preserve overlapping allies and release dedicated blockers', () => {
  for (const kill of [true, false]) {
    const { h, marcher, allies } = crossingFixture(); h.run(1.05);
    if (kill) h.b.kill(marcher); else h.b.forceEnd();
    assert.equal(h.b._occ[10 * 21 + 3], null);
    assert.equal(h.b._occ[10 * 21 + 4], allies[0]);
    assert.equal(h.b.remTroops.has(marcher), false);
    assert.equal(marcher.mem.remLeg, undefined);
    assert.equal(marcher.mem.remTarget, undefined);
    assert.ok(checkInvariants(h.b));
  }
});

test('a reinforcement attacks from its fractional crossing position without dragging enemies', () => {
  const { h, marcher, allies } = crossingFixture(); h.run(1.05);
  const enemy = h.spawn('rem_enemy', { pos: [10, 4] });
  const hp = enemy.hp, position = [marcher.x, marcher.y]; h.run(3.1);
  assert.ok(enemy.hp < hp);
  assert.deepEqual([marcher.x, marcher.y], position);
  assert.equal(h.b._occ[10 * 21 + 4], allies[0]);
  assert.equal(enemy.blockedBy, marcher);
  assert.ok(checkInvariants(h.b));
});

test('vehicles cross teammate units while retaining owner, route, no-block and damage rules', () => {
  for (const type of ['food', 'bus']) {
    const { h, marcher, allies } = crossingFixture(type, true);
    const hp = allies.map(a => a.hp); h.run(1.05);
    assert.equal(marcher.tileC, 4, type);
    assert.equal(marcher.ownerId, 'p1'); assert.equal(allies[0].ownerId, 'p2');
    assert.deepEqual(allies.map(a => a.hp), hp);
    assert.equal(state(h, 'p2').units.length, 0);
    assert.equal(h.b._occ[10 * 21 + 4], allies[0]); assert.equal(marcher.s.blockCnt, 0);
    h.b.kill(marcher);
    assert.equal(h.b._occ[10 * 21 + 4], allies[0]);
    assert.ok(allies.every(a => a.alive)); assert.ok(checkInvariants(h.b));
  }
});

test('all eight actual reinforcement types may spawn and stop over one another, including two vehicles', () => {
  const h = fixture(0); h.step(); const s = state(h); s.stage = 3;
  s.queue.push(...['child', 'miner', 'combined', 'chef', 'enthusiast', 'food', 'food', 'bus', 'bus', 'boss', 'boss']
    .map(type => ({ type, source: 'overlap' })));
  h.step();
  assert.equal(s.queue.length, 0); assert.equal(s.units.length, 11);
  for (const u of s.units) h.b.addBuff(u, { key: 'hold', flags: { noMove: true }, persist: true });
  const ordinaryUnits = s.units.filter(ordinary);
  assert.equal(new Set(ordinaryUnits.map(u => `${u.x}:${u.y}`)).size, 1, 'all ordinary units share their spawn position');
  h.run(1);
  assert.ok(s.units.every(u => !h.b._occ.includes(u) && h.b.remTroops.has(u)));
  assert.equal(s.units.filter(u => u.remType === 'food').length, 2);
  assert.equal(s.units.filter(u => u.remType === 'bus').length, 2);
  assert.ok(checkInvariants(h.b));
  h.b.forceEnd(); assert.equal(h.b.remTroops.size, 0);
});

test('non-occupying reinforcements permit normal deployment without weakening other occupancy or body checks', () => {
  const h = fixture(0); h.step(); const a = direct(h, 'miner', [10, 4]), b = direct(h, 'child', [10, 4]);
  const op = h.unit('rem_test'); assert.ok(h.b.relocate(op, 10, 4));
  assert.equal(h.b._occ[10 * 21 + 4], op);
  assert.equal(h.b.spawnToken('p1', 'ordinary_token', 10, 4, { def: { stats: {} } }), null);
  const fake = h.b.spawnToken('p1', 'unrelated_token', 10, 5,
    { def: { stats: {} }, kit: { install(_b, u) { u.remMobile = true; } } });
  assert.equal(h.b._occ[10 * 21 + 5], fake, 'a marker on an unrelated token cannot bypass occupancy');
  h.b.kill(a); assert.equal(h.b._occ[10 * 21 + 4], op); assert.ok(b.alive);
  h.b.kill(op); assert.ok(h.b.downOn(10, 4));
  assert.equal(h.b.relocate(b, 10, 4), false);
  assert.ok(checkInvariants(h.b));
});

test('a downed operator still prevents marching through its body', () => {
  const { h, marcher, allies } = crossingFixture();
  h.b.kill(allies[0]); const operator = state(h).ps.units[0];
  assert.ok(h.b.relocate(operator, 10, 4)); h.b.kill(operator);
  assert.ok(h.b.downOn(10, 4)); h.run(2.1);
  assert.equal(marcher.tileC, 3); assert.ok(checkInvariants(h.b));
});

test('a bus whose unloading route becomes unreachable waits without unloading at a fallback tile', () => {
  const { h, s, marcher } = crossingFixture('bus'); h.run(1.05);
  s.vehicleStop = [10, 9];
  for (const c of [6, 7, 8, 9, 10]) h.b.grid.setObstacle(10, c, true);
  h.run(3.1);
  assert.equal(marcher.alive, true); assert.ok(marcher.x <= 5);
  assert.equal(s.queue.some(q => q.source === 'bus'), false);
  assert.equal(s.units.some(u => u.remSource === 'bus'), false);
  assert.ok(checkInvariants(h.b));
});

test('ground troops and vehicles advance one thirtieth tile on every moving tick and pause under stun', async () => {
  const { animOf, unitTuple } = await import('../../server/sim/snapshot.js');
  const { ANIM } = await import('../../shared/constants.js');
  const { SnapshotBuffer } = await import('../../public/js/render/interp.js');
  for (const type of ['miner', 'food', 'bus']) {
    const { h, marcher: u, allies } = crossingFixture(type, true); u.deployedAt = -10;
    for (let i = 0; i < 24; i++) {
      const before = { x: u.x, y: u.y }, a = unitTuple(u, h.b.time), t = h.b.time; h.step();
      assert.ok(Math.abs(Math.hypot(u.x - before.x, u.y - before.y) - 1 / 30) < 1e-8, `${type} tick ${i}`);
      assert.equal(animOf(u, h.b.time), ANIM.MOVE);
      const buffer = new SnapshotBuffer(); buffer.push({ t, units: [a] }, t);
      buffer.push({ t: h.b.time, units: [unitTuple(u, h.b.time)] }, h.b.time);
      const shown = buffer.sample((t + h.b.time) / 2).get(u.id);
      assert.ok(Math.abs(shown.x - (before.x + u.x) / 2) < .011);
      assert.ok(checkInvariants(h.b));
    }
    assert.equal(h.b._occ[10 * 21 + 4], allies[0]);
    h.b.applyStatus(u, 'stun', { duration: 1 }); const stopped = [u.x, u.y]; h.run(.3);
    assert.deepEqual([u.x, u.y], stopped); assert.equal(u.moving, false);
  }
});

test('a fractional marcher blocks before reaching the next tile and resumes after enemy death', () => {
  const { h, marcher: u } = crossingFixture(); h.run(.4);
  const enemy = h.spawn('rem_enemy', { pos: [10, u.x + .65] });
  h.b._checkBlock(enemy); assert.equal(enemy.blockedBy, u);
  const positions = [u.x, u.y, enemy.x, enemy.y]; h.run(.5);
  assert.deepEqual([u.x, u.y, enemy.x, enemy.y], positions); assert.equal(u.moving, false);
  h.b.kill(enemy); h.step(); assert.ok(u.x > positions[0] && u.x - positions[0] <= 1 / 30 + 1e-8);
  assert.ok(checkInvariants(h.b));
});

test('active pursuit skips unreachable, flying and concealed targets and reselects after death', () => {
  const h = fixture(0); h.step(); const s = state(h); s.gate = [10, 3];
  cover(h, [9, 10, 11, 12].flatMap(r => lane(3, 10, r)));
  for (const r of [9, 10, 11, 12]) h.b.grid.setObstacle(r, 5, true);
  const unreachable = h.spawn('rem_enemy', { pos: [10, 7] });
  const flying = h.spawn('rem_enemy', { pos: [9, 3] }); h.b.addBuff(flying, { key: 'air', flags: { liftoff: true } }); flying.motion = 'FLY';
  const hidden = h.spawn('rem_enemy', { pos: [10, 4] }); h.b.addBuff(hidden, { key: 'hidden', flags: { stealth: true } });
  const first = h.spawn('rem_enemy', { pos: [12, 3] });
  const troop = direct(h, 'chef', [10, 3]); h.step();
  assert.equal(troop.mem.remTarget, first.id);
  h.b.kill(first);
  const second = h.spawn('rem_enemy', { pos: [9, 4] }); h.step(4);
  assert.notEqual(troop.mem.remTarget, first.id);
  h.run(1.2); assert.ok(troop.stats.attacks > 0 || troop.mem.remTarget === second.id);
  assert.ok(unreachable.alive && flying.alive && hidden.alive); assert.deepEqual(h.b.errors, []);
});

test('pursuit and wandering remain inside coverage and react to a moved target and shrinking range', () => {
  const h = fixture(0); h.step(); const s = state(h); s.gate = [10, 3];
  cover(h, lane(3, 7)); const enemy = h.spawn('rem_enemy', { pos: [10, 7] });
  const troop = direct(h, 'chef', [10, 3]); h.run(1.5);
  assert.equal(troop.mem.remTarget, enemy.id);
  enemy.x = 10;
  let traveled = 0;
  for (let i = 0; i < 240; i++) { const before = [troop.x, troop.y]; h.step(); traveled += Math.hypot(troop.x - before[0], troop.y - before[1]); assert.ok(troop.x >= 3 - 1e-8 && troop.x <= 7 + 1e-8 && troop.y === 10); }
  assert.ok(traveled > 5, 'unengaged troops continuously wander instead of waiting on a fixed point');
  assert.equal(troop.mem.remTarget, undefined);
  cover(h, lane(3, 5)); h.run(3);
  for (let i = 0; i < 90; i++) { h.step(); assert.ok(troop.x >= 3 - 1e-8 && troop.x <= 5 + 1e-8); }
  assert.deepEqual(h.b.errors, []); assert.ok(checkInvariants(h.b));
});

test('pure healers give no fire coverage; an attacking medic and a cooperating operator do', () => {
  const players = [
    { playerId: 'p1', coords: 'field', bonds: {}, units: [{ chessId: 'rem_test', row: 12, col: 8 }] },
    { playerId: 'p2', coords: 'field', bonds: {}, units: [{ chessId: 'rem_test', row: 12, col: 9 }] },
  ];
  const h = fixture(0, { kind: 'unite', players }); h.step(); const s = state(h); s.gate = [10, 3];
  for (const id of ['p1', 'p2']) { const op = cover(h, lane(), id); op.profile.heal = { mode: 'single' }; op.profile.dmgType = 'heal'; }
  const enemy = h.spawn('rem_enemy', { pos: [10, 10] }); const troop = direct(h, 'miner', [10, 3]);
  h.run(3); const waiting = [troop.x, troop.y]; h.run(2); assert.deepEqual([troop.x, troop.y], waiting);
  assert.notDeepEqual(waiting, [3, 10]); assert.equal(troop.mem.remTarget, undefined);
  const op = h.b.getPlayer('p2').units[0]; op.profile.heal = null; op.profile.dmgType = 'arts';
  h.step(); h.run(2); assert.ok(troop.mem.remTarget === enemy.id || troop.x > waiting[0] + 1);
  assert.equal(troop.ownerId, 'p1'); assert.deepEqual(h.b.errors, []);
  h.b.retreat(op, { permanent: true }); h.run(2); const stopped = [troop.x, troop.y]; h.run(2);
  assert.deepEqual([troop.x, troop.y], stopped, 'lost coverage becomes safe idle');
});

test('coverage uses enemy colliders and current operator facing, deployment and range extension', () => {
  const h = fixture(0); h.step(); const s = state(h); s.gate = [10, 3];
  const op = cover(h, lane(3, 7)); const troop = direct(h, 'chef', [10, 3]);
  const enemy = h.spawn('rem_enemy', { pos: [10, 7.59] }); h.step(); assert.equal(troop.mem.remTarget, enemy.id);
  enemy.x = 7.61; h.run(1.1); assert.equal(troop.mem.remTarget, undefined);
  h.b.addBuff(op, { key: 'extend', mods: { rangeExtend: 1 } }); h.run(1.1);
  assert.equal(troop.mem.remTarget, enemy.id);
  h.b.retreat(op, { permanent: true }); h.run(2); assert.equal(troop.mem.remTarget, undefined);
  assert.ok(checkInvariants(h.b));
});

test('turning an operator immediately changes fire coverage and cancels outward pursuit', () => {
  const h = fixture(0); h.step(); const op = h.unit('rem_test');
  assert.ok(h.b.relocate(op, 10, 6)); op.base.atk = 0; op.markDirty();
  op.rangeGrid = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]; h.b._refreshRange(op);
  const enemy = h.spawn('rem_enemy', { pos: [10, 10] });
  const troop = direct(h, 'chef', [10, 7]); h.step(); assert.equal(troop.mem.remTarget, enemy.id);
  op.dir = 'LEFT'; h.b._refreshRange(op); h.step(); assert.equal(troop.mem.remTarget, undefined);
  h.run(4); assert.ok(troop.x <= 6); assert.ok(checkInvariants(h.b));
});

test('a newly blocked segment never reverses into an also blocked origin and resumes when clear', () => {
  const { h, marcher } = crossingFixture(); h.run(.4); const at = [marcher.x, marcher.y];
  h.b.grid.setObstacle(10, 3, true); h.b.grid.setObstacle(10, 4, true); h.run(.5);
  assert.deepEqual([marcher.x, marcher.y], at); assert.equal(marcher.moving, false);
  h.b.grid.setObstacle(10, 3, false); h.b.grid.setObstacle(10, 4, false); h.step();
  assert.ok(marcher.x > at[0] && marcher.x - at[0] <= 1 / 30 + 1e-8);
  assert.ok(checkInvariants(h.b));
});

test('invalidated pursuit waits if its return edge is blocked instead of continuing toward the dead target', () => {
  const { h, marcher, far } = crossingFixture(); h.run(.4); const x = marcher.x;
  h.b.grid.setObstacle(10, 3, true); h.b.kill(far); h.run(.5);
  assert.equal(marcher.x, x); assert.equal(marcher.moving, false);
  assert.equal(marcher.mem.remTarget, undefined);
  h.b.grid.setObstacle(10, 3, false); h.step();
  assert.ok(marcher.x < x && x - marcher.x <= 1 / 30 + 1e-8);
  assert.ok(checkInvariants(h.b));
});

test('real starter-map later batches reach a covered enemy instead of filling four old rally tiles', () => {
  function exercise() {
    const h = fixture(9, { stageId: 'act2autochess_m01', timeLimit: 200 }); h.step();
    cover(h, [9, 10, 11, 12].flatMap(r => lane(2, 10, r)));
    const enemy = h.spawn('rem_enemy', { pos: [9, 10] }); enemy.base.maxHp = 1e9; enemy.hp = 1e9; enemy.markDirty();
    h.run(70); const s = state(h), before = new Set(s.units.map(u => u.id));
    h.b.remSummon('p1', 3, { source: 'jacinta', poolStage: 1 });
    const later = s.units.filter(u => !before.has(u.id)); assert.equal(later.length, 3);
    const travel = new Map(later.map(u => [u.id, 0]));
    for (let i = 0; i < 17 * 30; i++) {
      const old = later.map(u => [u.x, u.y]); h.step();
      later.forEach((u, j) => travel.set(u.id, travel.get(u.id) + Math.hypot(u.x - old[j][0], u.y - old[j][1])));
      assert.ok(checkInvariants(h.b));
    }
    assert.ok(later.every(u => travel.get(u.id) >= 11 && u.stats.attacks > 0), JSON.stringify(later.map(u => [u.id, u.x, u.y, travel.get(u.id), u.stats.attacks])));
    assert.equal(s.queue.filter(q => q.source === 'jacinta').length, 0);
    assert.ok(live(s).every(u => !h.b._occ.includes(u)));
    const end = later.map(u => [u.id, u.x, u.y, u.stats.attacks, travel.get(u.id)]);
    h.b.forceEnd(); assert.equal(h.b.remTroops.size, 0); assert.equal(s.queue.length, 0); assert.deepEqual(h.b.errors, []);
    return end;
  }
  assert.deepEqual(exercise(), exercise(), 'repeated battles produce identical movement and attacks');
});
