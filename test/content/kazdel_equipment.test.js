import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { installItem, lendItemEffects, itemGrants } from '../../server/sim/content/items/battle.js';
import { soulBaseline, createSoul } from '../../server/sim/content/kazdel/souls.js';
import { cannonSource } from '../../server/sim/content/kazdel/cannon.js';
import { unitBonds } from '../../server/sim/content/support/index.js';

const K = 'kazdelShip', sigil = (q = 'a') => `chess_item_kazdel_sigil_${q}`, blade = (q = 'a') => `chess_item_kazdel_blade_${q}`;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function fight(items, { members = true, active = true, layers = 0 } = {}) {
  const chess = {}, kits = {};
  for (const id of ['a', 'b', 'c']) {
    chess[id] = chessRec({ id, bonds: Array.isArray(members) ? members : members ? [K] : [], skill: null,
      stats: { maxHp: 4000, atk: 1000, def: 0, res: 0, blockCnt: 0, respawnTime: 1000 } });
    kits[id] = () => ({ trait: { noAttack: true }, skill: null });
  }
  const players = ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field',
    units: (seat ? ['c'] : ['a', 'b']).map((id, i) => ({ chessId: id, uid: id, row: 10 + seat, col: 4 + i, items: items[id] ?? [] })),
    bonds: { [K]: { active, count: 6, tier: 2, layers } } }));
  const h = makeBattle({ players, defs: { chess, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, def: 0, res: 0, speed: 0 }) } },
    kits, autoFinish: false, timeLimit: 100 });
  h.step();
  h.foe = h.spawn('dummy', { pos: [10, 8] });
  return h;
}
function fall(h, id) { const u = h.unit(id); h.b.kill(u); const s = u.kazdelSoulUnit; if (s) s.profile.noAttack = true; return s; }
function hit(h, source, target = h.foe) { return h.b.dealDamage(source, target, { amount: 100, type: 'true', canDodge: false }); }
function valid(h) { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); }

test('Kazdel equipment stats are universal, additive, and do not deal damage or add defensive buffs', () => {
  for (const [items, hp, atk] of [[[sigil()], 3400, 1250], [[sigil('b')], 3200, 1400],
    [[blade()], 3200, 1400], [[blade('b')], 3000, 1600], [[sigil(), blade()], 2600, 1650],
    [[sigil('b'), blade('b')], 2200, 2000], [[sigil(), sigil('b')], 2600, 1650]]) {
    const h = fight({ a: items }, { members: false, active: false }), u = h.unit('a');
    close(u.s.maxHp, hp); close(u.hp, hp); close(u.s.atk, atk);
    close(u.s.shield, 0); close(u.s.dmgTakenMul, 1); close(u.s.dmgDealtMul, 1);
    assert.equal(h.b.getPlayer('p1').bonds[K].layers, 0); assert.ok(u.alive); valid(h);
  }
});

test('Blade uses only its corresponding soul, enemy target and same-carrier pairing; gold replaces no extra multiplier', () => {
  for (const q of ['a', 'b']) for (const sq of ['a', 'b']) {
    const h = fight({ a: [blade(q)], b: [sigil(sq)], c: [blade(q), sigil(sq)] });
    close(hit(h, h.unit('a')), 100, 'body is not empowered');
    const a = fall(h, 'a'), b = fall(h, 'b'), c = fall(h, 'c');
    close(hit(h, a), 120); close(hit(h, b), 100); close(hit(h, c), 135);
    close(hit(h, a, b), 100, 'friendly targets are not empowered');
    close(hit(h, cannonSource(h.b.getPlayer('p1'))), 100);
    const grant = installItem(h.b, h.unit('a'), sigil(sq), { lent: true });
    close(hit(h, a), 135); grant.dispose(); close(hit(h, a), 120);
    h.b.getPlayer('p1').bonds[K].active = false; close(hit(h, a), 100); close(hit(h, c), 135);
    valid(h);
  }
});

test('Blade requires carrier membership, including active Harmony, and never empowers arbitrary summons', () => {
  const foreign = fight({ a: [blade(), sigil()] }, { members: false });
  const foreignSoul = createSoul(foreign.b, foreign.unit('a'), 0, () => null);
  close(hit(foreign, foreignSoul), 100); valid(foreign);
  const h = fight({ a: [blade(), sigil()] }, { members: ['maniShip'] });
  h.b.getPlayer('p1').bonds.maniShip = { active: true, count: 2 };
  const a = fall(h, 'a');
  close(hit(h, a), 135);
  h.b.getPlayer('p1').bonds.maniShip.active = false; close(hit(h, a), 100);
  a.kazdelSoul = false; close(hit(h, a), 100); a.kazdelSoul = true;
  valid(h);
});

test('Normal plus elite blades stack ordinary stats but exclusive damage applies once; refresh never compounds', () => {
  const h = fight({ a: [blade(), blade('b')] }, { layers: 100 }), u = h.unit('a');
  close(u.s.maxHp, 3200); close(u.s.atk, 2000);
  const s = fall(h, 'a'); close(s.s.maxHp, 2320); close(s.s.atk, 1900); close(hit(h, s), 120);
  h.step(60); close(s.s.maxHp, 2320); close(s.s.atk, 1900); close(hit(h, s), 120);
  assert.equal(s.items.length, 0); close(s.s.dmgDealtMul, 1); valid(h);
});

test('Borrowed sigil refreshes without stacking, expires on dead donor baseline and cannot lend tier-six blade by default', () => {
  const h = fight({ a: [blade()], b: [sigil('b'), blade('b')] }, { layers: 100 });
  const a = h.unit('a'), b = h.unit('b');
  assert.equal(lendItemEffects(h.b, b, a, { duration: .3 }), 1);
  assert.equal(lendItemEffects(h.b, b, a, { duration: .3 }), 1);
  assert.equal(itemGrants(h.b, a).filter(g => g.lent).length, 1);
  close(a.s.maxHp, 3400); close(a.s.atk, 1800);
  const s = fall(h, 'a'); close(s.s.maxHp, 2440); close(s.s.atk, 1740); close(hit(h, s), 135);
  h.run(.5); close(soulBaseline(a).maxHp, 3200); close(s.s.maxHp, 2920); close(s.s.atk, 1420); close(hit(h, s), 120);
  assert.equal(itemGrants(h.b, a).filter(g => g.lent).length, 0); valid(h);
});

test('Equipment cannot turn cannon kills into layers/charge and souls retain cannon immunity', () => {
  const h = fight({ a: [blade(), sigil()], c: [blade(), sigil()] });
  const a = h.unit('a'), c = h.unit('c'), before = h.b.snapshot().kazdel.map(s => s.charge);
  const source = cannonSource(h.b.getPlayer('p1'));
  h.b.dealDamage(source, a, { amount: 1e6, type: 'true' });
  assert.ok(a.kazdelSoulUnit?.alive); assert.equal(h.b.getPlayer('p1').bonds[K].layers, 0);
  assert.deepEqual(h.b.snapshot().kazdel.map(s => s.charge), before);
  assert.equal(h.b.dealDamage(source, a.kazdelSoulUnit, { amount: 1e6, type: 'true' }), 0);
  assert.equal(h.b.dealDamage(source, c, { amount: 1e6, type: 'true' }), 0); valid(h);
});

test('Sigil/isomorph membership generates souls and qualifies blade; borrowed sigil never grants a tag', () => {
  for (const q of ['a', 'b']) for (const iq of ['a', 'b']) {
    const iso = `chess_item_6_09_e_${iq}`;
    const h = fight({ a: [sigil(q), iso], b: [sigil(q)], c: [iso] }, { members: false, layers: 100 });
    const a = h.unit('a'), c = h.unit('c');
    assert.deepEqual(unitBonds(a), [K]); assert.deepEqual(unitBonds(c), []);
    const spirit = fall(h, 'a'); assert.ok(spirit);
    close(spirit.s.maxHp, q === 'a' ? 3040 : 2920); close(spirit.s.atk, q === 'a' ? 1300 : 1420);
    // Tier VI is not normally lendable; explicitly exercise the existing grant lifecycle.
    const grant = installItem(h.b, a, blade(), { lent: true }); close(hit(h, spirit), 135);
    grant.dispose(); close(hit(h, spirit), 100);
    assert.equal(lendItemEffects(h.b, h.unit('b'), c, { duration: .2 }), 1);
    assert.deepEqual(unitBonds(c), []); h.run(.3); assert.deepEqual(unitBonds(c), []);
    a.items = [iso]; assert.deepEqual(unitBonds(a), []);
    a.items = [sigil(q), iso]; assert.deepEqual(unitBonds(a), [K]);
    valid(h);
  }
});
