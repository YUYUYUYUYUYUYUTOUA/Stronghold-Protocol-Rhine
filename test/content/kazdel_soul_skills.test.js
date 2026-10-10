import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { soulBaseline } from '../../server/sim/content/kazdel/souls.js';
import { itemGrants } from '../../server/sim/content/items/battle.js';
import { withKazdelCannonOrigin, captureKazdelCallback } from '../../server/sim/kazdelOrigin.js';

const data = getData({ log: { warn() {}, info() {}, error() {} } });
const K = 'kazdelShip';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function field(chessId, opts = {}) {
  const h = makeBattle({ autoFinish: false, timeLimit: 180, seed: 417, captureNoisy: true,
    hooks: ['skillStart', 'damaged', 'heal', 'deploy'],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }) } },
    units: [{ chessId, uid: 'body', row: 10, col: 4, ...opts }],
    bonds: { [K]: { active: true, count: 3, layers: 10 } } });
  h.step(); const u = h.unit('body');
  // Also covers non-native Kazdel members obtained with the isomorph pair.
  if (!u.def.bonds.includes(K)) {
    assert.ok(u.items.includes('chess_item_kazdel_sigil_a'));
  }
  h.b.kill(u);
  assert.ok(u.kazdelSoulUnit?.alive, chessId);
  h.soul = u.kazdelSoulUnit; h.body = u;
  return h;
}
const valid = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };
const morph = ['chess_item_kazdel_sigil_a', 'chess_item_6_09_e_a'];

for (const [id, raw] of Object.entries(data.chess).filter(([id, c]) => id.startsWith('chess_kazdel_') || c.bonds?.includes(K))) {
  for (const sk of raw.skills ?? []) test(`Soul native loadout ${id}/${sk.skillId}: fresh skill, talent and cleanup`, () => {
    const h = field(id, { skillIndex: sk.index, moduleId: 'none' }), s = h.soul, u = h.body;
    assert.notEqual(s.skill, u.skill); assert.notEqual(s.mem, u.mem); assert.notEqual(s.kit, u.kit);
    assert.equal(s.skill.id, u.skill.id); assert.equal(s.skill.baseSpCost, u.skill.baseSpCost);
    assert.equal(s.skill.spType, u.skill.spType); assert.equal(s.skill.manual, u.skill.manual);
    assert.equal(s.skill.maxCharges, u.skill.maxCharges); assert.equal(s.skill.duration, u.skill.duration);
    assert.equal(s.base.spRecovery, u.base.spRecovery); assert.equal(s.ownerId, u.ownerId);
    assert.equal(s.ownerUnit, u); assert.equal(s.kind, 'token'); assert.deepEqual(s.items, []);
    assert.equal(itemGrants(h.b, s).length, 0);
    const e = h.spawn('dummy', { pos: [10, 5] });
    if (!s.skill.active) {
      s.skill.gainSp(999, 'init');
      assert.ok(s.skill.activate('test') || s.skill.kind === 'passive', `${id}/${sk.skillId}`);
    }
    h.b.forceAttack(s, [e]); h.run(2);
    assert.ok(s.skill.activations > 0 || s.skill.kind === 'passive');
    const layers = h.b.getPlayer('p1').bonds[K].layers;
    h.b.retreat(s, { reason: 'kazdelReturn', permanent: true }); h.step();
    assert.equal(s.alive, false); assert.equal(s.skill.active, false);
    assert.equal(h.b.getPlayer('p1').bonds[K].layers, layers);
    for (const hooks of Object.values(h.b._hooks)) assert.ok(hooks.every(x => x.owner !== s));
    valid(h);
  });
}

test('Soul time SP starts fresh, pays native cost, pauses during duration and resumes afterwards', () => {
  const h = field('chess_char_1_05_a', { skillIndex: 0 }), s = h.soul;
  close(s.skill.spTotal, s.skill.initSp);
  s.profile.noAttack = true; s.skill.setTrigger('NEVER');
  h.run(1); close(s.skill.spTotal, s.skill.initSp + s.s.spRecovery);
  s.skill.setSpTotal(s.skill.spCost); assert.ok(s.skill.activate('test'));
  assert.equal(s.skill.spTotal, 0); const t = s.skill.timeLeft;
  h.run(1); close(s.skill.spTotal, 0); close(s.skill.timeLeft, t - 1);
  s.skill.end('test'); h.run(1); close(s.skill.spTotal, s.s.spRecovery);
  valid(h);
});

test('Soul native summon variants retain donor skill/grade and new owner identity', () => {
  const h = field('chess_kazdel_wisdel_b', { skillIndex: 2 }), s = h.soul;
  const shadows = () => h.b.allyUnits.filter(u => u.ownerUnit === s && u.defId === 'token_10035_wisdel_wward' && u.alive);
  assert.equal(shadows().length, 1, 'native deploy talent creates its own shadow');
  for (const t of shadows()) { assert.equal(t.ownerId, s.ownerId); assert.ok(t.base.atk > 0); }
  h.spawn('dummy', { pos: [10, 6] }); s.skill.setSpTotal(s.skill.spCost);
  assert.ok(s.skill.activate('test')); assert.ok(shadows().length > 1);
  assert.equal(s.skill.ammoLeft, s.skill.ammo);
  const shots = s.skill.ammoLeft; h.b.forceAttack(s, [h.b.enemies[0]]); assert.equal(s.skill.ammoLeft, shots - 1);
  valid(h);
});

test('Soul Ascalon keeps native dread and skill but never the live-body Kazdel production aura', () => {
  const h = field('chess_kazdel_ascalon_a', { skillIndex: 1 }), s = h.soul;
  const e = h.spawn('dummy', { pos: [10, 4] }), layers = h.b.getPlayer('p1').bonds[K].layers;
  s.skill.setSpTotal(s.skill.spCost); assert.ok(s.skill.activate('test'));
  h.b.forceAttack(s, [e]); h.run(7);
  assert.ok(e.buffs.some(b => b.key.startsWith('ascln:') || b.key.includes('dread')));
  assert.equal(h.b.getPlayer('p1').bonds[K].layers, layers);
  valid(h);
});

test('Soul stat refresh keeps the inherited base formula through native skill buffs', () => {
  const h = field('chess_kazdel_ascalon_a', { skillIndex: 1 }), s = h.soul;
  const base = soulBaseline(h.body), layers = h.b.getPlayer('p1').bonds[K].layers;
  close(s.base.maxHp, .6 * base.maxHp + 10 * layers); close(s.base.atk, .8 * base.atk + 3 * layers);
  s.skill.setSpTotal(s.skill.spCost); s.skill.activate('test'); h.run(2);
  close(s.base.atk, .8 * base.atk + 3 * layers);
  close(s.s.atk, s.base.atk * (1 + s.skill.bb.atk)); valid(h);
});


test('Converted Horn soul has its own one-use native revival; real soul death earns no resources', () => {
  const h = field('chess_char_5_08_a', { items: morph }), s = h.soul;
  const e = h.spawn('dummy', { pos: [10, 5] }), layers = h.b.getPlayer('p1').bonds[K].layers;
  h.b.dealDamage(e, s, { amount: 1e9, type: 'true', canDodge: false });
  assert.ok(s.alive); assert.equal(s.mem.bloodBattle, true); assert.ok(s.hp > 1);
  assert.notEqual(s.mem.bloodBattle, h.body.mem.bloodBattle);
  h.b.dealDamage(e, s, { amount: 1e9, type: 'true', canDodge: false });
  assert.equal(s.alive, false); assert.equal(s.kazdelSoulUnit, undefined);
  assert.equal(h.b.getPlayer('p1').bonds[K].layers, layers); valid(h);
});

test('Converted Mlynar soul retains one native reflection against Echo without reactive recursion', () => {
  const h = field('chess_char_5_19_a', { items: morph }), s = h.soul;
  const e = h.spawn('enemy_9023_acdums', { pos: [10, 5], mods: { hpMul: 100, speedMul: 0 } });
  h.b.dealDamage(s, e, { amount: 1, type: 'true' });
  const reflections = h.hooksOf('damaged').filter(c => c.source === s && c.dmg.tags?.includes('reflect'));
  assert.equal(reflections.length, 1);
  assert.equal(h.hooksOf('damaged').filter(c => c.source === h.body).length, 0); valid(h);
});

test('Soul attack and hurt recovery follow their native SP types', () => {
  const h = field('chess_kazdel_meteorite_a', { skillIndex: 0 }), s = h.soul;
  s.skill.setTrigger('NEVER'); s.skill.setSpTotal(0);
  const e = h.spawn('dummy', { pos: [10, 5] });
  assert.equal(s.skill.spType, 'attack'); h.b.forceAttack(s, [e]);
  close(s.skill.spTotal, 1); valid(h);
  const m = field('chess_char_4_18_a', { skillIndex: 1 }), mud = m.soul;
  mud.skill.setTrigger('NEVER'); mud.skill.setSpTotal(0);
  assert.equal(mud.skill.spType, 'hurt');
  // Native shields may absorb the hit: the native damage/hurt pipeline remains the authority.
  const foe = m.spawn('dummy', { pos: [10, 4] });
  for (let i = 0; i < 5; i++) m.b.dealDamage(foe, mud, { amount: 1, type: 'true', isAttack: true });
  assert.ok(mud.skill.spTotal > 0); valid(m);
});

test('Native self regeneration runs on souls but equipment triggers and body-return duplication do not', () => {
  const h = field('chess_char_1_05_a'), s = h.soul;
  s.hp = 100; h.b.addBuff(s, { key: 'talent:testRegen', mods: { hpRegen: 60 }, source: s });
  h.run(1); close(s.hp, 160);
  assert.ok(h.b.redeploy(h.body, { free: true })); assert.equal(s.alive, false);
  h.b.kill(h.body); const next = h.body.kazdelSoulUnit;
  assert.notEqual(next, s); assert.notEqual(next.kit, s.kit); assert.notEqual(next.skill, s.skill);
  assert.equal(next.findBuff('talent:testRegen'), null); h.step();
  assert.equal(h.b.allyUnits.filter(u => u.kazdelSoul && u.alive).length, 1); valid(h);
});


test('Every ordinary roster identity can create an independent native soul through isomorph equipment', () => {
  for (const [id, raw] of Object.entries(data.chess)) {
    if (!id.endsWith('_a') || raw.isDiy || !raw.charId) continue;
    const h = field(id, { items: morph }), s = h.soul;
    const e = h.spawn('dummy', { pos: [10, 5] });
    s.skill.gainSp(999, 'init');
    if (!s.skill.active) s.skill.activate('test');
    h.b.forceAttack(s, [e]); h.run(1);
    assert.deepEqual(h.b.errors, [], id);
    h.b.forceEnd(); assert.equal(s.alive, false, id);
  }
});

test('Soul regeneration preserves the original healer group before status ticks erase its source', () => {
  const h = field('chess_char_1_05_a'), s = h.soul;
  s.hp = 100;
  h.b.addBuff(s, { key: 'living:regen', source: h.body, mods: { hpRegen: 100, hpRegenRatio: .1, atkFlat: 3 } });
  assert.equal(s.findBuff('living:regen').mods.atkFlat, 3);
  h.run(1); close(s.hp, 100);
  h.b.addBuff(s, { key: 'soul:regen', source: s, mods: { hpRegen: 60 } });
  h.run(1); close(s.hp, 160);
  h.b.addBuff(h.body, { key: 'soul:external', source: s, allowDead: true, mods: { hpRegen: 100 } });
  assert.equal(h.body.findBuff('soul:external').mods.hpRegen, undefined);
  valid(h);
});

test('A soul born from a cannon death starts independent native callbacks and restores the killing context', () => {
  const h = makeBattle({ autoFinish: false, units: [{ chessId: 'chess_char_1_05_a', uid: 'body', row: 10, col: 4 }],
    bonds: { [K]: { active: true, count: 3, layers: 10 } } });
  h.step(); const u = h.unit('body'), setup = h.b._setupUnit; let nativeCallback;
  h.b._setupUnit = function(unit) {
    setup.call(this, unit);
    if (unit.kazdelSoul) nativeCallback = captureKazdelCallback(this, () => this._kazdelCannonOwnerId ?? null);
  };
  withKazdelCannonOrigin(h.b, () => {
    h.b.kill(u);
    assert.equal(h.b._kazdelCannonOwnerId, 'p1');
    assert.equal(h.b._kazdelCannonDamageDepth, 1);
  }, 'p1');
  assert.ok(u.kazdelSoulUnit?.alive); assert.equal(nativeCallback(), null); valid(h);
});
