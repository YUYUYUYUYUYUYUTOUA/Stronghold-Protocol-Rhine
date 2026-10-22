import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch, give, giveItem, DATA } from '../match/harness.js';
import { installItem, lendItemEffects, itemGrants } from '../../server/sim/content/items/battle.js';

const REM = 'remShip';
const armor = (q = 'a') => `chess_item_rem_armor_${q}`;
const amplifier = (q = 'a') => `chess_item_rem_amplifier_${q}`;
const types = ['child', 'miner', 'combined', 'chef', 'enthusiast', 'food', 'bus', 'boss'];
const close = (a, b, label = 'value') => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
const present = u => u.alive && u.deployed && !u.removed;
const valid = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

function field(items = {}, { members = {}, kind = 'unite' } = {}) {
  const chess = {}, kits = {};
  for (const id of ['a', 'b', 'c', 'plain']) {
    chess[id] = chessRec({ id, bonds: id === 'plain' || members[id] === false ? [] : [REM], skill: null,
      stats: { maxHp: 4000, atk: 1000, def: 0, res: 0, blockCnt: 0, respawnTime: 1000 } });
    kits[id] = () => ({ trait: { noAttack: true }, skill: null });
  }
  const h = makeBattle({ kind, autoFinish: false, timeLimit: 120, kits, captureNoisy: true,
    hooks: ['damaged', 'attack'],
    defs: { chess, enemies: { equip_dummy: enemyRec({ key: 'equip_dummy', hp: 1e8, atk: 0, def: 400, res: 20, speed: 0 }) } },
    players: [
      { playerId: 'p1', seat: 0, coords: 'field', bonds: {}, units: [
        { chessId: 'a', uid: 'a', row: 10, col: 5, items: items.a ?? [] },
        { chessId: 'b', uid: 'b', row: 11, col: 5, items: items.b ?? [] },
        { chessId: 'plain', uid: 'plain', row: 12, col: 7, items: items.plain ?? [] },
      ] },
      { playerId: 'p2', seat: 1, coords: 'field', bonds: {}, units: [
        { chessId: 'c', uid: 'c', row: 10, col: 12, items: items.c ?? [] },
      ] },
    ],
  });
  h.step(); return h;
}

// Rem troops never reserve operator occupancy. This also lets the range fixture
// place a fractional true world position without rounding it to a different tile.
function at(h, u, r, c) {
  u.x = c; u.y = r; u.tileR = Math.round(r); u.tileC = Math.round(c);
  h.b._refreshRange(u);
}
function add(h, type = 'miner', { owner = 'p1', r = 10, c = 6, hold = true } = {}) {
  const s = h.b.remState.get(owner), before = s.units.length;
  s.queue.push({ type, source: 'equipment-test', point: [r, c] }); h.step();
  assert.equal(s.units.length, before + 1, `a real ${type} reinforcement is generated`);
  const u = s.units.at(-1);
  assert.equal(u.remType, type); assert.equal(u.ownerId, owner); assert.ok(present(u));
  if (hold) h.b.addBuff(u, { key: 'equipment-test:stationary', persist: true, flags: { noMove: true } });
  u.profile.noAttack = true;
  at(h, u, r, c); return u;
}
function foe(h, pos = [10, 8]) { return h.spawn('equip_dummy', { pos }); }
function strike(h, source, target, type = 'phys', amount = 1000) {
  return h.b.dealDamage(source, target, { amount, type, canDodge: false, isAttack: true });
}
function hurt(h, target, amount = 100) {
  return h.b.dealDamage(null, target, { amount, type: 'true', canDodge: false });
}

test('Rem equipment data preserves approved tiers, prices, grades and an explicit non-granting holder restriction', () => {
  for (const q of ['a', 'b']) for (const [id, tier, price] of [[armor(q), 3, 2], [amplifier(q), 6, 4]]) {
    const rec = DATA.items[id]; assert.ok(rec, `${id}: regenerated equipment exists`);
    assert.equal(rec.itemType, 'EQUIP'); assert.equal(rec.tier, tier);
    assert.equal(rec.price, q === 'a' ? price : 5, 'approved normal shop price or existing elite-item price');
    assert.equal(rec.isGolden, q === 'b'); assert.equal(rec.requiresBondId, REM);
    assert.equal(rec.giveBondId, null, 'the restricted item cannot manufacture its own holder membership');
    assert.equal(rec.canGiveBond, false); assert.equal(rec.shopExcluded, false);
  }
});

test('the production equip intent rejects all four Rem items on a non-Rem holder and accepts a Rem operator', () => {
  const remId = Object.values(DATA.chess).find(c => c.visible && !c.isGolden && c.bonds?.includes(REM)).chessId;
  for (const id of [armor(), armor('b'), amplifier(), amplifier('b')]) {
    const h = makeMatch({ mode: 'solo', fake: true }).start().toPrep(), m = h.m, ps = h.ps('p_0');
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
    const outsider = give(m, ps, 'chess_char_1_05_a', 'board', [10, 4]);
    const rem = give(m, ps, remId, 'board', [10, 5]);
    const item = giveItem(m, ps, id);
    assert.deepEqual(ps.equip(item.uid, outsider.uid), { error: 'BAD_TARGET' }, `${id}: non-Rem equip is refused`);
    assert.equal(outsider.items.length, 0); assert.equal(ps.find(item.uid).area, 'hand');
    assert.equal(ps.equip(item.uid, rem.uid).ok, true, `${id}: the real Rem operator can carry it`);
    assert.equal(rem.items.at(-1).id, id); assert.deepEqual(h.logs.error, []); m.dispose();
  }
});

for (const [q, hp, attack] of [['a', 4800, 1250], ['b', 5400, 1400]]) {
  test(`Rem equipment ${q}: only the Rem holder receives its approved ordinary stat bonuses`, () => {
    const h = field({ a: [armor(q), amplifier(q)], plain: [armor(q), amplifier(q)] });
    const a = h.unit('a'), plain = h.unit('plain');
    close(a.s.maxHp, hp); close(a.hp, hp); close(a.s.atk, attack);
    close(plain.s.maxHp, 4000); close(plain.s.atk, 1000, 'an invalid imported loadout gains no stats');
    close(h.unit('b').s.maxHp, 4000); close(h.unit('b').s.atk, 1000);
    const troop = add(h, 'child'); close(troop.s.maxHp, 1200); close(troop.s.atk, 450);
    valid(h);
  });
}

test('same-family normal, elite and duplicate Rem items select one strongest carrier stat as well as one aura', () => {
  for (const [items, hp, attack, reduction, hit] of [
    [[armor(), armor('b')], 5400, 1000, 85, 600],
    [[armor(), armor()], 4800, 1000, 90, 600],
    [[amplifier(), amplifier('b')], 4000, 1400, 100, 700],
    [[amplifier(), amplifier()], 4000, 1250, 100, 660],
  ]) {
    const h = field({ a: items }), a = h.unit('a'), troop = add(h), e = foe(h);
    close(a.s.maxHp, hp); close(a.s.atk, attack);
    close(hurt(h, troop), reduction); close(strike(h, troop, e), hit);
    h.step(30); close(a.s.maxHp, hp); close(a.s.atk, attack, 'refresh cannot compound a family stat');
    valid(h);
  }
  const h = field({ a: [armor(), amplifier()] }), a = h.unit('a');
  const armorUpgrade = installItem(h.b, a, armor('b'), { lent: true });
  const amplifierUpgrade = installItem(h.b, a, amplifier('b'), { lent: true });
  assert.ok(armorUpgrade && amplifierUpgrade);
  close(a.s.maxHp, 5400); close(a.s.atk, 1400);
  armorUpgrade.dispose(); amplifierUpgrade.dispose();
  close(a.s.maxHp, 4800); close(a.s.atk, 1250); valid(h);
});

test('all eight actual Rem reinforcement types receive armor reduction, without empowering ordinary allies or unrelated summons', () => {
  for (const type of types) {
    const h = field({ a: [armor('b')] }), troop = add(h, type);
    close(hurt(h, troop), 85, `${type}: 15% reduction applies to the actual reinforcement`);
    const foreign = add(h, 'miner', { owner: 'p2', r: 10, c: 6 });
    close(hurt(h, foreign), 100, `${type}: a nearby teammate reinforcement does not borrow the aura`);
    close(hurt(h, h.unit('a')), 100); close(hurt(h, h.unit('b')), 100);
    const token = h.b.spawnToken(h.unit('a'), 'unrelated_equipment_token', 12, 5,
      { def: { stats: { maxHp: 1000, atk: 500, def: 0, res: 0 }, rangeGrid: [[0, 0]] } });
    assert.ok(token); close(hurt(h, token), 100, 'a normal summon is not a Rem reinforcement'); valid(h);
  }
});

test('the nine-cell aura uses current unrounded world coordinates including the holder cell and diagonal boundary', () => {
  const h = field({ a: [armor('b'), amplifier('b')] }), troop = add(h), e = foe(h);
  for (const [r, c] of [[10, 5], [11, 6], [9, 4]]) {
    at(h, troop, r, c); close(hurt(h, troop, 10), 8.5); close(strike(h, troop, e), 740);
  }
  for (const [r, c] of [[10, 6.0001], [11.0001, 5], [9, 3.9999]]) {
    at(h, troop, r, c); close(hurt(h, troop, 10), 10); close(strike(h, troop, e), 600);
  }
  at(h, troop, 10, 6); close(strike(h, troop, e), 740, 'walking back into the aura has no stale failed-range cache');
  valid(h);
});

test('multiple auras take the strongest current same-owner value and lose it on hiding, retreat and real death', () => {
  const h = field({ a: [armor(), amplifier()], b: [armor('b'), amplifier('b')], c: [armor('b'), amplifier('b')] });
  const a = h.unit('a'), b = h.unit('b'), troop = add(h), e = foe(h);
  const expect = (cut, damage) => { close(hurt(h, troop, 10), cut); close(strike(h, troop, e), damage); };
  expect(8.5, 740);
  b.hidden = true; expect(9, 700);
  b.hidden = false; expect(8.5, 740);
  h.b.kill(b); expect(9, 700);
  assert.equal(h.b.redeploy(b, { free: true }), true); expect(8.5, 740);
  h.b.retreat(b); expect(9, 700);
  h.b.retreat(a); expect(10, 600);
  valid(h);
});

test('the amplifier requires armor on the same carrier; borrowed pairing refreshes once and expires cleanly', () => {
  const h = field({ a: [amplifier()], b: [armor('b'), amplifier('b')] });
  const a = h.unit('a'), b = h.unit('b'), troop = add(h), e = foe(h);
  // Both carriers initially cover the troop; remove the donor to isolate the
  // unpaired amplifier and then exercise the real item-grant lifetime.
  h.b.retreat(b);
  close(strike(h, troop, e), 660);
  assert.equal(lendItemEffects(h.b, b, a, { duration: .3 }), 1, 'tier VI is not lent by the existing default policy');
  assert.equal(lendItemEffects(h.b, b, a, { duration: .3 }), 1);
  assert.equal(itemGrants(h.b, a).filter(g => g.lent).length, 1);
  close(strike(h, troop, e), 700); close(a.s.maxHp, 5400);
  h.run(.4); close(strike(h, troop, e), 660); close(a.s.maxHp, 4000);
  const elite = installItem(h.b, a, amplifier('b'), { lent: true });
  assert.ok(elite); close(strike(h, troop, e), 700, 'normal and elite unpaired amplifiers choose 25%, not 40%');
  const protection = installItem(h.b, a, armor(), { lent: true });
  assert.ok(protection); close(strike(h, troop, e), 740, 'the strongest paired amplifier replaces its base rate');
  elite.dispose(); close(strike(h, troop, e), 700); protection.dispose(); close(strike(h, troop, e), 660);
  valid(h);
});

test('armor on a separate nearby carrier never upgrades the normal amplifier to its paired rate', () => {
  const h = field({ a: [amplifier()], b: [armor('b')] }), troop = add(h), e = foe(h);
  close(hurt(h, troop), 85); close(strike(h, troop, e), 660);
  valid(h);
});

test('invalid non-Rem carriers provide neither stat bonuses nor reinforcement auras, including borrowed grants', () => {
  const h = field({ a: [armor('b'), amplifier('b')] }, { members: { a: false } });
  const a = h.unit('a'), troop = add(h), e = foe(h);
  close(a.s.maxHp, 4000); close(a.s.atk, 1000); close(hurt(h, troop), 100); close(strike(h, troop, e), 600);
  const borrowed = installItem(h.b, a, armor(), { lent: true });
  if (borrowed) { close(a.s.maxHp, 4000); borrowed.dispose(); }
  close(hurt(h, troop), 100); valid(h);
});

test('amplifier penetration changes physical damage only and does not accumulate across repeated attacks', () => {
  const h = field({ a: [amplifier()] }), troop = add(h), e = foe(h);
  for (let i = 0; i < 3; i++) close(strike(h, troop, e), 660);
  close(strike(h, troop, e, 'arts'), 800); close(strike(h, troop, e, 'true'), 1000);
  close(strike(h, h.unit('a'), e), 600, 'the carrier receives ATK stats, not the reinforcement penetration aura');
  valid(h);
});

test('all five ordinary reinforcement attack loops use the aura without altering the chef arts attack', () => {
  for (const [type, damage] of [['child', 110], ['miner', 160], ['combined', 760], ['chef', 160], ['enthusiast', 110]]) {
    const h = field({ a: [amplifier()] }), troop = add(h, type), e = foe(h, [10, 7]);
    troop.profile.noAttack = false; h.run(3);
    const hits = h.hooksOf('damaged').filter(c => c.source === troop && c.target === e && c.dmg.isAttack);
    assert.ok(hits.length > 0, `${type}: an actual ordinary attack hits the target`);
    for (const hit of hits) close(hit.amount, damage, `${type}: ordinary attack damage`);
    valid(h);
  }
});

for (const [q, paired, ignore] of [['a', false, .15], ['a', true, .25], ['b', false, .25], ['b', true, .35]]) {
  test(`food collision ${q}/${paired ? 'paired' : 'single'} uses the live amplifier rate once per enemy`, () => {
    const h = field({ a: [amplifier(q), ...(paired ? [armor()] : [])] });
    const food = add(h, 'food'), e = foe(h, [10, 6]);
    close(food.s.atk, 1500, 'holder ATK percentage does not feed back to the vehicle');
    h.run(.2);
    const hits = h.hooksOf('damaged').filter(c => c.source === food && c.target === e);
    assert.equal(hits.length, 1); assert.ok(hits[0].dmg.tags.includes('remFood'));
    close(hits[0].amount, 1500 - 400 * (1 - ignore));
    h.run(.8); assert.equal(h.hooksOf('damaged').filter(c => c.source === food && c.target === e).length, 1);
    valid(h);
  });
  test(`boss pizza ${q}/${paired ? 'paired' : 'single'} keeps its launch ATK and physical amplifier penetration`, () => {
    const h = field({ a: [amplifier(q), ...(paired ? [armor()] : [])] }, { kind: 'normal' });
    const boss = add(h, 'boss'), e = foe(h, [10, 6]);
    close(boss.s.atk, 1000); assert.equal(boss.isFlying, true);
    h.run(2.05);
    const hits = h.hooksOf('damaged').filter(c => c.source === boss && c.target === e);
    assert.equal(hits.length, 1); assert.ok(hits[0].dmg.tags.includes('remPizza'));
    close(hits[0].amount, 2000 - 400 * (1 - ignore)); valid(h);
  });
}

test('the bus keeps zero attack and its original unloading route with both Rem equipment auras present', () => {
  const fields = [field(), field({ a: [armor('b'), amplifier('b')] })];
  const traces = fields.map(h => {
    const bus = add(h, 'bus', { r: 9, c: 2, hold: false }), trace = [];
    close(bus.s.atk, 0); assert.equal(bus.s.blockCnt, 0);
    for (let i = 0; i < 70; i++) {
      h.step(); trace.push([bus.x, bus.y, bus.alive, bus.removed]);
    }
    assert.equal(bus.alive, false);
    assert.equal(h.b.remState.get('p1').units.filter(u => u.remSource === 'bus').length, 5);
    assert.equal(h.hooksOf('damaged').filter(c => c.source === bus).length, 0); valid(h); return trace;
  });
  assert.deepEqual(traces[1], traces[0]);
});
