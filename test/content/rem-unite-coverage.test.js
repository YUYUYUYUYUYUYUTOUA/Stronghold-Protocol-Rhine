import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as rem from '../../server/sim/content/rem.js';

const REM = 'remShip';
const cross = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${message}: ${actual} != ${expected}`);
const up = u => u.alive && u.deployed && !u.removed;

function fixture({ offset = 8, stageId = 'flat', teammateRem = false, bridgeBody = false } = {}) {
  const otherOffset = offset ? 0 : 8;
  // The left blue gate belongs to the whole unite field. A right-side helper is
  // side L plus colOffset 8 in the production input, not a mirrored Boss side R.
  const h = makeBattle({ kind: 'unite', stageId, content: 'generic', extraContent: [rem],
    autoFinish: false, timeLimit: 120, captureNoisy: true, hooks: ['damaged'],
    defs: { chess: {
      own_rem: chessRec({ id: 'own_rem', bonds: [REM], skill: null, rangeGrid: cross,
        stats: { atk: 0, blockCnt: 0, maxHp: 1e8, respawnTime: 1000 } }),
      ordinary: chessRec({ id: 'ordinary', bonds: teammateRem ? [REM] : [], skill: null,
        // The teammate can cover the blue gate from either prep half, leaving
        // a separate component from the destination operator's cross range.
        rangeGrid: teammateRem ? cross
          : [[0, 2 - (3 + otherOffset)], [0, 3 - (3 + otherOffset)], [1, 2 - (3 + otherOffset)]],
        stats: { atk: 0, blockCnt: 0, maxHp: 1e8 } }),
      bridge_body: chessRec({ id: 'bridge_body', skill: null,
        stats: { atk: 0, blockCnt: 0, maxHp: 1e8, respawnTime: 1000 } }),
    }, enemies: { cover_dummy: enemyRec({ key: 'cover_dummy', hp: 1e7, atk: 0, def: 0, speed: 0 }) } },
    players: [
      { playerId: 'own', seat: 0, side: 'L', colOffset: offset, bonds: {},
        units: [{ uid: 'own_rem', chessId: 'own_rem', row: 10, col: 7 }] },
      { playerId: 'teammate', seat: 1, side: 'L', colOffset: otherOffset, bonds: {},
        units: [{ uid: 'ordinary', chessId: 'ordinary', row: teammateRem ? 10 : 9, col: teammateRem ? 4 : 3 },
          ...(bridgeBody ? [{ uid: 'bridge_body', chessId: 'bridge_body', row: 10, col: 9 - otherOffset }] : [])] },
    ],
  });
  h.step();
  const own = h.unit('own_rem'), ordinary = h.unit('ordinary');
  assert.ok(up(own) && up(ordinary), 'both actual helper bodies deploy');
  assert.deepEqual([own.tileR, own.tileC], [10, 7 + offset], 'the production prep-to-unite transform is applied');
  assert.equal(h.b.getPlayer('own').mirror, false, 'unite right side is an offset, not Boss mirroring');
  const body = bridgeBody ? h.unit('bridge_body') : null;
  if (body) { assert.ok(up(body)); body.profile.noAttack = true; }
  return { h, own, ordinary, body };
}

function summon(h, owner = 'own', type = 'miner') {
  const s = h.b.remState.get(owner), before = s.units.length;
  s.queue.push({ type, source: 'unite-coverage-test' }); h.step();
  assert.equal(s.units.length, before + 1, 'an actual owned reinforcement is generated');
  const u = s.units.at(-1);
  assert.equal(u.ownerId, owner); assert.equal(u.remType, type);
  assert.deepEqual(s.gate, [9, 2], 'use the real shared blue gate, never relocate it for the test');
  return u;
}

function tick(h, troops, n = 1) {
  for (let i = 0; i < n; i++) {
    const before = troops.map(u => [u.x, u.y]); h.step();
    for (const [j, u] of troops.entries()) {
      const dx = Math.abs(u.x - before[j][0]), dy = Math.abs(u.y - before[j][1]);
      assert.ok(dx + dy <= h.TICK + 1e-8, 'actual movement remains at one tile per game second');
      assert.ok(dx < 1e-8 || dy < 1e-8, 'a path segment never cuts a diagonal corner');
      assert.ok(h.b.grid.groundPassable(u.tileR, u.tileC));
      assert.equal(h.b.downOn(u.tileR, u.tileC), null);
      assert.equal(h.b._occ.includes(u), false, 'reinforcements never take operator occupancy');
    }
  }
}

function reaches(h, troops, predicate, seconds = 40) {
  for (let i = 0; i < seconds / h.TICK && !predicate(); i++) tick(h, troops);
  assert.ok(predicate(), 'reinforcement reaches the expected live coverage');
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
}

function dealt(h, u, foe) {
  return h.hooksOf('damaged').some(e => e.source === u && e.target === foe && e.amount > 0);
}

function cover(h, op, tiles) {
  op.rangeGrid = tiles.map(([r, c]) => [r - op.tileR, c - op.tileC]);
  h.b._refreshRange(op);
}

function watch(h, u, seconds) {
  const visited = new Set();
  for (let n = 0; n < seconds / h.TICK; n++) {
    tick(h, [u]); visited.add(`${u.tileR},${u.tileC}`);
  }
  return visited;
}

for (const offset of [0, 8]) {
  test(`unite offset ${offset}: owned reinforcements leave the near teammate component for their own Rem operator`, () => {
    const { h, own, ordinary } = fixture({ offset }), u = summon(h);
    const original = [own.x, own.y, ordinary.x, ordinary.y];
    const foe = h.spawn('cover_dummy', { pos: [10, own.tileC + 1] }), hp = foe.hp;
    reaches(h, [u], () => dealt(h, u, foe));
    assert.ok(foe.hp < hp, 'the generated unit actually fights at its own Rem coverage');
    assert.equal(u.ownerId, 'own');
    assert.deepEqual([own.x, own.y, ordinary.x, ordinary.y], original, 'ordinary operators never become pathfinding units');
    assert.ok(Math.abs(u.x - own.x) <= 2 && Math.abs(u.y - own.y) <= 2);
  });
}

for (const offset of [0, 8]) {
  test(`unite offset ${offset}: two Rem owners independently follow their own coverage`, () => {
    const { h, own, ordinary } = fixture({ offset, teammateRem: true });
    const ownTroop = summon(h, 'own', 'chef'), helperTroop = summon(h, 'teammate', 'chef');
    const ownFoe = h.spawn('cover_dummy', { pos: [11, own.tileC] });
    const helperFoe = h.spawn('cover_dummy', { pos: [11, ordinary.tileC] });
    const positions = [own.x, own.y, ordinary.x, ordinary.y];
    reaches(h, [ownTroop, helperTroop], () => dealt(h, ownTroop, ownFoe) && dealt(h, helperTroop, helperFoe));
    assert.ok(Math.abs(ownTroop.x - own.x) <= 2, 'the first owner reaches its own Rem operator');
    assert.ok(Math.abs(helperTroop.x - ordinary.x) <= 2, 'the other owner retains its own coverage too');
    assert.equal(ownTroop.ownerId, 'own'); assert.equal(helperTroop.ownerId, 'teammate');
    assert.deepEqual([own.x, own.y, ordinary.x, ordinary.y], positions, 'neither operator body moves');
  });
}

test('a nonattacking own Rem source falls back locally, then immediately resumes priority when it can attack', () => {
  const { h, own } = fixture(); own.profile.noAttack = true;
  const u = summon(h), foe = h.spawn('cover_dummy', { pos: [10, 16] });
  const visited = watch(h, u, 4);
  assert.ok(visited.size > 1, 'fallback keeps wandering in available allied coverage');
  assert.ok(u.x <= 3, 'the nonattacking Rem operator grants no preferred coverage');
  assert.equal(dealt(h, u, foe), false);
  own.profile.noAttack = false;
  reaches(h, [u], () => dealt(h, u, foe));
});

test('a dead own Rem source loses priority; redeployment takes priority back from the fallback component', () => {
  const { h, own } = fixture(), u = summon(h);
  reaches(h, [u], () => u.x >= 7, 12);
  h.b.kill(own);
  assert.equal(h.b.downOn(10, 15), own, 'a real dead operator supplies a body rather than attack coverage');
  reaches(h, [u], () => u.x <= 3, 15);
  assert.equal(own.alive, false, 'the long respawn timer keeps the fallback phase real');
  assert.equal(h.b.redeploy(own), true);
  const foe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => dealt(h, u, foe));
});

test('a covered enemy in a disconnected preferred component is reached across uncovered legal tiles', () => {
  const { h, own } = fixture();
  cover(h, own, [[10, 6], [10, 7], [10, 15], [10, 16]]);
  const u = summon(h, 'own', 'chef');
  reaches(h, [u], () => own.rangeKeys.includes(u.tileR * 21 + u.tileC) && u.x < 8, 12);
  const foe = h.spawn('cover_dummy', { pos: [10, 16] });
  let crossedGap = false;
  for (let n = 0; n < 30 / h.TICK && !dealt(h, u, foe); n++) {
    tick(h, [u]);
    if (u.x > 8 && u.x < 14 && !own.rangeKeys.includes(u.tileR * 21 + u.tileC)) crossedGap = true;
  }
  assert.ok(crossedGap, 'the unit travels beyond component A through genuinely uncovered intermediate tiles');
  assert.ok(dealt(h, u, foe), 'it does not turn back to the nearest component at every completed path edge');
  assert.ok(own.rangeKeys.includes(u.tileR * 21 + u.tileC), 'the final attack position remains preferred');
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('a changed live range abandons the old preferred component without teleporting', () => {
  const { h, own } = fixture();
  cover(h, own, [[10, 6], [10, 7]]);
  const u = summon(h);
  reaches(h, [u], () => u.x > 5 && u.x < 6, 12);
  assert.ok(u.mem.remLeg, 'the range changes during an actual movement edge');
  cover(h, own, [[10, 15], [10, 16]]);
  const foe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => dealt(h, u, foe));
});

test('unreachable preferred coverage uses reachable allied coverage and retries when the terrain opens', () => {
  const { h } = fixture();
  for (const r of [9, 10, 11, 12]) h.b.setObstacle(r, 9, true);
  const u = summon(h), foe = h.spawn('cover_dummy', { pos: [10, 16] });
  const visited = watch(h, u, 4);
  assert.ok(visited.size > 1, 'reachable fallback is used instead of freezing at the gate');
  assert.ok(u.x <= 3, 'the closed complete barrier is not crossed');
  assert.equal(dealt(h, u, foe), false);
  for (const r of [9, 10, 11, 12]) h.b.setObstacle(r, 9, false);
  reaches(h, [u], () => dealt(h, u, foe));
});

test('a real bridge body blocks the current edge without changing terrain version and recovery is retried', () => {
  const { h, own, body } = fixture({ bridgeBody: true });
  for (const r of [9, 11, 12]) h.b.setObstacle(r, 9, true);
  const u = summon(h), foe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => u.x > 8 && u.x < 8.4 && u.mem.remLeg?.to[0] === 10 && u.mem.remLeg?.to[1] === 9, 15);
  const version = h.b.grid.version, preferred = [...own.rangeKeys];
  h.b.kill(body);
  assert.equal(h.b.grid.version, version, 'operator death is not a terrain-version invalidation');
  assert.deepEqual(own.rangeKeys, preferred, 'the preferred coverage signature does not change');
  assert.equal(h.b.downOn(10, 9), body);
  reaches(h, [u], () => u.x <= 3, 15);
  assert.equal(dealt(h, u, foe), false, 'a body never becomes a crossable bridge');
  assert.equal(h.b.redeploy(body), true);
  assert.equal(h.b.grid.version, version, 'redeployment also leaves terrain version unchanged');
  reaches(h, [u], () => dealt(h, u, foe));
  assert.equal(h.b._occ[10 * 21 + 9], body, 'crossing a living ally preserves its actual occupancy');
});

test('a changed preferred range finishes the legal edge when its old endpoint becomes a real body', () => {
  const { h, own, body } = fixture({ bridgeBody: true });
  assert.equal(h.b.relocate(body, 10, 8), true);
  for (const r of [9, 11, 12]) h.b.setObstacle(r, 9, true);
  const u = summon(h), foe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => u.x > 8.6 && u.x < 8.9 && u.mem.remLeg?.from[0] === 10
    && u.mem.remLeg?.from[1] === 8 && u.mem.remLeg?.to[1] === 9, 15);
  const before = u.x, version = h.b.grid.version;
  h.b.kill(body);
  assert.equal(h.b.downOn(10, 8), body);
  assert.equal(h.b.grid.version, version);
  cover(h, own, [[10, 16], [11, 16]]);
  tick(h, [u]);
  assert.ok(u.x > before, 'a changed destination never freezes or reverses into the newly downed origin');
  reaches(h, [u], () => dealt(h, u, foe));
  assert.equal(h.b.downOn(10, 8), body, 'the recovery does not remove or cross the body');
});

test('restored preferred coverage finishes a legal fallback edge whose origin just became a body', () => {
  const { h, own, ordinary, body } = fixture({ bridgeBody: true });
  own.profile.noAttack = true;
  cover(h, ordinary, [[9, 4], [9, 5]]);
  assert.equal(h.b.relocate(body, 9, 4), true);
  const u = summon(h);
  reaches(h, [u], () => u.x > 4.6 && u.x < 4.9 && u.mem.remLeg?.from[0] === 9
    && u.mem.remLeg?.from[1] === 4 && u.mem.remLeg?.to[1] === 5, 10);
  const before = u.x, version = h.b.grid.version;
  h.b.kill(body); own.profile.noAttack = false;
  assert.equal(h.b.downOn(9, 4), body);
  assert.equal(h.b.grid.version, version);
  const foe = h.spawn('cover_dummy', { pos: [10, 16] });
  tick(h, [u]);
  assert.ok(u.x > before, 'restoring priority finishes the existing legal edge rather than waiting over a body');
  reaches(h, [u], () => dealt(h, u, foe));
});

test('a preferred transit can escape along its original edge when its return endpoint becomes a body later', () => {
  const { h, own, body } = fixture({ bridgeBody: true });
  assert.equal(h.b.relocate(body, 10, 8), true);
  for (const r of [9, 11, 12]) h.b.setObstacle(r, 9, true);
  const u = summon(h), foe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => u.x > 8.6 && u.x < 8.9 && u.mem.remLeg?.from[0] === 10
    && u.mem.remLeg?.from[1] === 8 && u.mem.remLeg?.to[1] === 9, 15);
  const forward = u.x;
  cover(h, own, [[10, 16], [11, 16]]);
  tick(h, [u]);
  assert.ok(u.x < forward, 'changing the preferred range first causes a real return along the current edge');
  const returning = u.x, version = h.b.grid.version;
  h.b.kill(body);
  assert.equal(h.b.downOn(10, 8), body);
  assert.equal(h.b.grid.version, version);
  tick(h, [u]);
  assert.ok(u.x > returning, 'the legal original forward endpoint is retained when the return endpoint later closes');
  reaches(h, [u], () => dealt(h, u, foe));
  assert.equal(h.b.downOn(10, 8), body);
});

test('restored own coverage recovers an already returning fallback edge after the fallback source dies', () => {
  const { h, own, ordinary } = fixture();
  own.profile.noAttack = true;
  assert.equal(h.b.relocate(ordinary, 10, 8), true);
  cover(h, ordinary, Array.from({ length: 10 }, (_, i) => [10, i + 2]));
  const u = summon(h, 'own', 'chef'), fallbackFoe = h.spawn('cover_dummy', { pos: [10, 11] });
  reaches(h, [u], () => u.x > 8.6 && u.x < 8.9 && u.mem.remLeg?.from[0] === 10
    && u.mem.remLeg?.from[1] === 8 && u.mem.remLeg?.to[1] === 9, 15);
  const forward = u.x;
  h.b.kill(fallbackFoe);
  tick(h, [u]);
  assert.ok(u.x < forward, 'the fallback target dying first causes a real return along the current edge');
  const returning = u.x, version = h.b.grid.version;
  h.b.kill(ordinary); own.profile.noAttack = false;
  assert.equal(h.b.downOn(10, 8), ordinary);
  assert.equal(h.b.grid.version, version);
  const foe = h.spawn('cover_dummy', { pos: [10, 16] });
  tick(h, [u]);
  assert.ok(u.x > returning, 'restoring preferred coverage can recover the legal endpoint of an older fallback return');
  reaches(h, [u], () => dealt(h, u, foe));
});

test('a nearby nonblocking enemy does not strand an entering reinforcement in unrelated allied coverage', () => {
  const { h } = fixture(), u = summon(h, 'own', 'chef');
  const nearFoe = h.spawn('cover_dummy', { pos: [10, 4] });
  const farFoe = h.spawn('cover_dummy', { pos: [10, 16] });
  let passedInRange = false;
  for (let n = 0; n < 35 / h.TICK && !dealt(h, u, farFoe); n++) {
    tick(h, [u]);
    if (u.rangeKeys.includes(10 * 21 + 4)) {
      assert.equal(nearFoe.blockedBy, null);
      passedInRange = true;
    }
  }
  assert.ok(passedInRange, 'the near enemy actually enters the generated unit attack range during transit');
  assert.ok(dealt(h, u, farFoe), 'mere attack range does not hold the unit outside its own preferred area');
  assert.deepEqual([nearFoe.x, nearFoe.y], [4, 10], 'the passed enemy is never dragged');
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('real contact blocking still stops a preferred transit and resumes after the blocker dies', () => {
  const { h } = fixture(), u = summon(h);
  reaches(h, [u], () => u.x > 4 && u.x < 5, 8);
  const nearFoe = h.spawn('cover_dummy', { pos: [u.y, u.x + .6] });
  const farFoe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => nearFoe.blockedBy === u, 1);
  const at = [u.x, u.y, nearFoe.x, nearFoe.y];
  watch(h, u, 3);
  assert.deepEqual([u.x, u.y, nearFoe.x, nearFoe.y], at, 'real contact preserves both world positions');
  assert.ok(dealt(h, u, nearFoe), 'the stopped reinforcement actually fights its blocked target');
  assert.equal(dealt(h, u, farFoe), false);
  h.b.kill(nearFoe);
  reaches(h, [u], () => dealt(h, u, farFoe));
});

test('with no reachable attack coverage the unit clears the gate, waits, then resumes after recovery', () => {
  const { h, own, ordinary } = fixture();
  own.profile.noAttack = ordinary.profile.noAttack = true;
  const u = summon(h); watch(h, u, 3);
  assert.notDeepEqual([u.tileR, u.tileC], [9, 2], 'the actual shared blue gate remains clear');
  const at = [u.x, u.y]; watch(h, u, 3);
  near(u.x, at[0], 'no-coverage waiting x'); near(u.y, at[1], 'no-coverage waiting y');
  own.profile.noAttack = false;
  const foe = h.spawn('cover_dummy', { pos: [10, 16] });
  reaches(h, [u], () => dealt(h, u, foe));
});

test('the right helper reaches its own attack range on the real unite map', () => {
  const { h } = fixture({ stageId: 'act2autochess_m01' }), u = summon(h);
  const foe = h.spawn('cover_dummy', { pos: [9, 15] });
  assert.ok(h.b.grid.groundPassable(9, 15), 'the target is on a real legal road');
  reaches(h, [u], () => dealt(h, u, foe));
});
