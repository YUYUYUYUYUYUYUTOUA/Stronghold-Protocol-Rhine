import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { bodyInRange } from '../../server/sim/body.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import * as rem from '../../server/sim/content/rem.js';
import * as remTraits from '../../server/sim/content/rem_traits.js';

const ORDINARY = ['child', 'miner', 'combined', 'chef', 'enthusiast'];
const STAGE = 'act2autochess_m01';
const BOSS = 'enemy_9013_acstmk';
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);
const state = h => h.b.remState.get('p1');
const hits = (h, source, target) => h.hooksOf('damaged').filter(c => c.source === source && c.target === target && c.amount > 0);

function fixture({ kind = 'boss', side = 'L', body = false, click = false, sharedBoss = null } = {}) {
  const anchor = chessRec({ id: 'boss_test_anchor', profession: 'SNIPER', golden: click, skill: null,
    bonds: click ? ['remShip'] : [], rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]],
    stats: { atk: 0, blockCnt: 0, maxHp: 1e8 } });
  if (click) anchor.garrisonIds = ['garrison_rem_tmslot_b'];
  const h = makeBattle({ kind, stageId: STAGE, content: 'generic', extraContent: click ? [rem, remTraits] : [rem],
    autoFinish: false, timeLimit: 180, captureNoisy: true, sharedBoss,
    defs: { chess: { boss_test_anchor: anchor,
      boss_test_body: chessRec({ id: 'boss_test_body', skill: null, stats: { atk: 0, blockCnt: 0, maxHp: 1e8, respawnTime: 1000 } }) },
    enemies: { boss_test_mob: enemyRec({ key: 'boss_test_mob', hp: 1e8, atk: 0, speed: 0 }) } },
    players: [{ playerId: 'p1', seat: 0, side, units: [
      { uid: 1, chessId: 'boss_test_anchor', row: 12, col: 4 },
      ...(body ? [{ uid: 2, chessId: 'boss_test_body', row: 12, col: 5 }] : []),
    ], bonds: {} }],
  });
  h.step();
  for (const u of h.b.allyUnits) u.profile.noAttack = true;
  assert.equal(h.unit('boss_test_anchor').deployed, true, 'the nonattacking anchor is really deployed');
  return h;
}

function spawnBoss(h, pos = [3, 10]) {
  const boss = h.spawn(BOSS, { pos, tag: 'boss', mods: { speedMul: 0 } });
  boss.profile.noAttack = true;
  assert.equal(boss.isBoss, true);
  assert.ok(boss.hitArea, 'use the real giant body, not a point substitute');
  return boss;
}

function spawnRem(h, type, point = null) {
  const s = state(h), before = s.units.length;
  s.queue.push({ type, source: 'boss-ai-test' });
  h.step();
  assert.equal(s.units.length, before + 1, `actual ${type} generation succeeds`);
  const unit = s.units.at(-1);
  if (point) assert.equal(h.b.relocate(unit, ...point), true);
  return unit;
}

function stepGround(h, troops, ticks = 1) {
  for (let n = 0; n < ticks; n++) {
    const before = troops.map(u => [u.x, u.y]);
    h.step();
    for (const [i, u] of troops.entries()) {
      assert.ok(h.b.grid.groundPassable(u.tileR, u.tileC), `legal ground for ${u.remType}`);
      assert.equal(h.b.downOn(u.tileR, u.tileC), null, 'never enter a knocked-out body');
      assert.equal(h.b._occ.includes(u), false, 'reinforcements do not reserve operator tiles');
      const dx = Math.abs(u.x - before[i][0]), dy = Math.abs(u.y - before[i][1]);
      assert.ok(dx + dy <= h.TICK + 1e-8, 'one tile per game second without a jump');
      assert.ok(dx < 1e-8 || dy < 1e-8, 'only cardinal path segments');
    }
  }
}

function reachAndHit(h, troop, boss, seconds = 35) {
  const hp = boss.hp, before = hits(h, troop, boss).length;
  for (let n = 0; n < seconds / h.TICK && hits(h, troop, boss).length <= before; n++) stepGround(h, [troop]);
  assert.ok(hits(h, troop, boss).length > before, `${troop.remType} actually damages the real Boss again`);
  assert.ok(boss.hp < hp);
  assert.ok(bodyInRange(boss, troop.rangeKeys));
  assert.deepEqual(h.b.errors, []);
  checkInvariants(h.b);
}

for (const kind of ['boss', 'hidden']) for (const side of ['L', 'R']) {
  test(`${kind}/${side}: all five ordinary reinforcements reach and hit the real Boss body without friendly coverage`, () => {
    for (const type of ORDINARY) {
      const h = fixture({ kind, side }), boss = spawnBoss(h), troop = spawnRem(h, type);
      const start = [troop.x, troop.y];
      assert.equal(h.unit('boss_test_anchor').profile.noAttack, true);
      reachAndHit(h, troop, boss);
      assert.ok(Math.abs(troop.x - start[0]) + Math.abs(troop.y - start[1]) > 3, 'really approaches from its own blue gate');
      assert.equal(troop.rangeKeys.includes(3 * 21 + 10), false, 'hits the extended body while the center is out of its cross range');
      assert.equal(troop.mem.remBossTarget, boss.id);
    }
  });
}

test('ordinary Boss pursuit respects a real bottleneck obstacle and resumes after it is removed', () => {
  const h = fixture(), boss = spawnBoss(h), troop = spawnRem(h, 'child');
  h.b.setObstacle(5, 6, true);
  stepGround(h, [troop], 450);
  assert.equal(hits(h, troop, boss).length, 0);
  assert.ok(troop.x <= 5, 'does not cross the closed sole bridge');
  h.b.setObstacle(5, 6, false);
  reachAndHit(h, troop, boss);
});

test('a downed body closes the real Boss approach; a living ally can be crossed after redeployment', () => {
  const h = fixture({ body: true }), boss = spawnBoss(h), body = h.unit('boss_test_body');
  h.b.kill(body);
  assert.equal(h.b.downOn(5, 5), body);
  const troop = spawnRem(h, 'miner');
  stepGround(h, [troop], 450);
  assert.equal(hits(h, troop, boss).length, 0);
  assert.equal(h.b.redeploy(body), true);
  assert.equal(h.b._occ[5 * 21 + 5], body);
  reachAndHit(h, troop, boss);
  assert.equal(h.b._occ[5 * 21 + 5], body, 'crossing preserves the deployed operator occupancy');
});

test('multiple ordinary reinforcements share the real Boss firing position and each deals damage', () => {
  const h = fixture(), boss = spawnBoss(h), troops = ORDINARY.map(type => spawnRem(h, type));
  for (let n = 0; n < 35 / h.TICK && !troops.every(u => hits(h, u, boss).length); n++) stepGround(h, troops);
  assert.ok(troops.every(u => hits(h, u, boss).length > 0), 'every generated unit lands its own hit');
  for (const u of troops) { near(u.x, troops[0].x, 'shared firing x'); near(u.y, troops[0].y, 'shared firing y'); }
  assert.equal(state(h).queue.length, 0);
  assert.deepEqual(h.b.errors, []);
  checkInvariants(h.b);
});

for (const concealment of ['untargetable', 'hidden']) {
  test(`a live ${concealment} Boss retains pursuit, waits near its body, then takes real damage when available`, () => {
    const h = fixture({ kind: concealment === 'hidden' ? 'hidden' : 'boss' }), boss = spawnBoss(h);
    if (concealment === 'hidden') boss.hidden = true;
    else h.b.addBuff(boss, { key: 'test:boss-unavailable', persist: true, flags: { untargetable: true } });
    const troop = spawnRem(h, 'child'), hp = boss.hp;
    stepGround(h, [troop], 600);
    assert.ok(bodyInRange(boss, troop.rangeKeys), 'waits at geometric attack range despite temporary unavailability');
    assert.equal(hits(h, troop, boss).length, 0); assert.equal(boss.hp, hp);
    const at = [troop.x, troop.y]; stepGround(h, [troop], 60);
    near(troop.x, at[0], 'wait x'); near(troop.y, at[1], 'wait y');
    if (concealment === 'hidden') boss.hidden = false;
    else h.b.removeBuff(boss, 'test:boss-unavailable');
    reachAndHit(h, troop, boss, 5);
  });
}

test('Boss death cancels an in-flight old chase, selects another local Boss and clears pursuit when none remains', () => {
  const h = fixture(), first = spawnBoss(h), next = spawnBoss(h, [3, 15]), troop = spawnRem(h, 'child');
  stepGround(h, [troop], 12);
  assert.equal(troop.mem.remBossTarget, first.id);
  const at = [troop.x, troop.y]; h.b.kill(first); stepGround(h, [troop]);
  assert.notEqual(troop.mem.remBossTarget, first.id);
  assert.ok(!troop.mem.remLeg || troop.mem.remLeg.target !== first.id);
  assert.ok(Math.abs(troop.x - at[0]) + Math.abs(troop.y - at[1]) <= h.TICK + 1e-8, 'returns along its real edge instead of snapping');
  reachAndHit(h, troop, next, 45);
  h.b.kill(next); stepGround(h, [troop], 35);
  assert.equal(h.b.remBossTarget(troop), null);
  assert.equal(troop.mem.remBossTarget, undefined);
  assert.ok(!troop.mem.remLeg || !['bossChase', 'chase'].includes(troop.mem.remLeg.intent));
});

test('a Boss in another Battle sharing the same real HP pool cannot create a local pursuit lock', () => {
  const pool = new SharedBossPool(1e7), local = fixture({ sharedBoss: pool }), other = fixture({ side: 'R', sharedBoss: pool });
  const foreign = spawnBoss(other), troop = spawnRem(local, 'child'), hp = pool.hp;
  assert.equal(foreign.bossPool, pool);
  stepGround(local, [troop], 240);
  assert.equal(local.b.enemies.length, 0);
  assert.equal(local.b.remBossTarget(troop), null);
  assert.equal(troop.mem.remBossTarget, undefined);
  assert.ok(troop.x <= 3, 'only clears its own entry, never marches toward the foreign Boss');
  assert.equal(pool.hp, hp); assert.equal(hits(local, troop, foreign).length, 0);
  checkInvariants(local.b); checkInvariants(other.b);
});

test('true small-enemy contact is cleared in place before the same Boss pursuit resumes', () => {
  for (const kind of ['boss', 'hidden']) {
    const h = fixture({ kind }), boss = spawnBoss(h), troop = spawnRem(h, 'child', [2, 4]);
    const escort = h.spawn('boss_test_mob', { pos: [2, 4] }); escort.hp = 700;
    stepGround(h, [troop]); assert.equal(escort.blockedBy, troop);
    const start = [troop.x, troop.y], enemyAt = [escort.x, escort.y];
    for (let n = 0; escort.alive && n < 300; n++) {
      stepGround(h, [troop]);
      if (escort.alive) { near(troop.x, start[0], 'blocked troop x'); near(troop.y, start[1], 'blocked troop y'); }
      near(escort.x, enemyAt[0], 'does not drag enemy x'); near(escort.y, enemyAt[1], 'does not drag enemy y');
    }
    assert.equal(escort.alive, false); assert.ok(hits(h, troop, escort).length > 0);
    assert.equal(hits(h, troop, boss).length, 0, 'the Boss is still distant while clearing the blocker');
    reachAndHit(h, troop, boss);
  }
});

test('an in-range Boss takes priority even over a true contact blocker without releasing or dragging it', () => {
  for (const kind of ['boss', 'hidden']) {
    const h = fixture({ kind }), boss = spawnBoss(h), troop = spawnRem(h, 'child', [5, 7]);
    const escort = h.spawn('boss_test_mob', { pos: [5, 7] }), hp = escort.hp;
    stepGround(h, [troop]);
    assert.equal(escort.blockedBy, troop); assert.ok(troop.blocking.includes(escort));
    const troopAt = [troop.x, troop.y], enemyAt = [escort.x, escort.y];
    reachAndHit(h, troop, boss, 5);
    assert.equal(escort.hp, hp); assert.equal(hits(h, troop, escort).length, 0);
    assert.equal(escort.blockedBy, troop); assert.ok(troop.blocking.includes(escort));
    near(troop.x, troopAt[0], 'blocked attacker x'); near(troop.y, troopAt[1], 'blocked attacker y');
    near(escort.x, enemyAt[0], 'blocked escort x'); near(escort.y, enemyAt[1], 'blocked escort y');
  }
});

test('a nearby ordinary enemy and active Click guidance cannot divert an in-range Boss attack', () => {
  const h = fixture({ kind: 'hidden', click: true }), boss = spawnBoss(h), troop = spawnRem(h, 'child', [5, 7]);
  const marked = h.spawn('boss_test_mob', { pos: [4, 7] }), hp = marked.hp;
  h.unit('boss_test_anchor').mem.remMarkedTarget = marked;
  h.step();
  assert.equal(marked.blockedBy, null, 'this priority competitor is not a contact blocker');
  assert.equal(troop.mem.remGuidedTarget, marked, 'the real Click trait is active');
  assert.ok(troop.findBuff('rem:click'));
  assert.equal(troop.s.aspd, 120, 'elite Click retains its real +20 ASPD while Boss priority stays intact');
  reachAndHit(h, troop, boss, 5);
  assert.equal(marked.hp, hp); assert.equal(hits(h, troop, marked).length, 0);
});

function capturePizza(h) {
  const events = [], original = h.b.fx.bind(h.b);
  h.b.fx = (kind, fx) => { if (kind === 'remPizza' || kind === 'remPizzaImpact') events.push({ kind, time: h.b.time, ...fx }); return original(kind, fx); };
  return events;
}

test('nine-tier pizza caches the Boss launch point and attack for one second rather than following its later position', () => {
  const h = fixture(), target = spawnBoss(h), fx = capturePizza(h);
  state(h).stage = 3;
  const thrower = spawnRem(h, 'boss'), attack = thrower.s.atk;
  assert.equal(attack, 2500, 'the approved nine-tier special ATK multiplier applies');
  assert.ok(h.runUntil(() => fx.some(e => e.kind === 'remPizza'), 2));
  const shot = fx.find(e => e.kind === 'remPizza');
  near(shot.x, target.x, 'launch Boss x'); near(shot.y, target.y, 'launch Boss y');
  assert.ok(Math.abs(shot.x - thrower.x) > 3, 'aims at the leader, not the air-route thrower');
  const victim = h.spawn('boss_test_mob', { pos: [shot.y, shot.x] }), hp = victim.hp, targetHp = target.hp;
  target.x = target.tileC = 16; target.y = target.tileR = 2;
  h.b.addBuff(thrower, { key: 'test:after-launch-atk', mods: { atkFlat: 1000 } });
  h.run(.9); assert.equal(victim.hp, hp);
  assert.ok(h.runUntil(() => fx.some(e => e.kind === 'remPizzaImpact'), .2));
  const impact = fx.find(e => e.kind === 'remPizzaImpact');
  near(impact.time - shot.time, 1, 'original fuse');
  near(impact.x, shot.x, 'cached impact x'); near(impact.y, shot.y, 'cached impact y');
  near(hp - victim.hp, 2 * attack, 'actual first bomb retains launch ATK against zero DEF');
  assert.equal(target.hp, targetHp, 'the displaced Boss does not receive a homing hit');
  assert.equal(thrower.isFlying, true); assert.equal(h.b._occ.includes(thrower), false);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('Boss aiming does not change the pizza thrower air route, and ordinary fields still bomb their own position', () => {
  const a = fixture(), b = fixture(); spawnBoss(a);
  const x = spawnRem(a, 'boss'), y = spawnRem(b, 'boss');
  for (let n = 0; n < 100; n++) {
    a.step(); b.step(); near(x.x, y.x, 'same air-route x with and without target'); near(x.y, y.y, 'same air-route y with and without target');
  }
  const normal = fixture({ kind: 'normal' }), fx = capturePizza(normal), thrower = spawnRem(normal, 'boss', [10, 5]);
  normal.b.addBuff(thrower, { key: 'test:stationary', flags: { noMove: true } });
  const enemy = normal.spawn('boss_test_mob', { pos: [10, 5] }), hp = enemy.hp;
  normal.run(2.1);
  const shot = fx.find(e => e.kind === 'remPizza'), impact = fx.find(e => e.kind === 'remPizzaImpact');
  assert.ok(shot && impact); near(shot.x, 5, 'normal self x'); near(shot.y, 10, 'normal self y');
  near(impact.time - shot.time, 1, 'normal fuse'); assert.ok(enemy.hp < hp);
  assert.deepEqual(normal.b.errors, []); checkInvariants(normal.b);
});
