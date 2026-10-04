import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { RHINE_CHARACTERS as C, RHINE_DEVICES, RHINE_BALANCE as B } from '../../shared/rhineResearch.js';
import { deviceBaseAttack } from '../../server/sim/content/rhine.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `expected ${b}, got ${a}`);
const op = (uid, charId = 'test', row = 10, col = 4, extra = {}) => ({ uid, chessId: `${uid}_a`, charId, row, col, ...extra });
const device = (key, row = 10, col = 5, stage = 0, uid = key) => ({ uid, kind: 'token', tokenId: `token_rhine_${key}`, key, row, col, stage });
const player = (playerId, units, { count = 3, layers = 0, active = true, devices = null, ...extra } = {}) => ({
  playerId, units, seat: playerId === 'p1' ? 0 : 1, side: 'L', colOffset: 0,
  bonds: { rhineShip: { count, layers, active } },
  research: { active, unlocked: true, devices: devices ?? units.filter((u) => u.kind === 'token').map((u) => ({ ...u, onBoard: true })) }, ...extra,
});
function battle(players, extra = {}) {
  const chess = {}, kits = {};
  for (const p of players) for (const u of p.units) if (u.kind !== 'token') {
    chess[u.chessId] = chessRec({ id: u.chessId, charId: u.charId, golden: u.elite, stats: { atk: 100, maxHp: 2000, blockCnt: 0 }, skill: u.cast ? {} : null });
    kits[u.chessId] = () => ({ trait: { noAttack: true }, skill: u.cast ? { kind: u.passive ? 'passive' : 'instant', trigger: { rule: u.auto ? 'SP_FULL' : 'NEVER' }, spCost: u.auto ? 1 : 10 } : null });
  }
  const tokens = Object.fromEntries(RHINE_DEVICES.map((d) => [d.tokenId, { name: d.name, stats: { maxHp: 100, atk: 1, blockCnt: 5 }, rangeGrid: [[0, 0]] }]));
  const h = makeBattle({ players, defs: { chess, tokens, enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, speed: 0 }) } }, kits, ...extra });
  h.step();
  return h;
}
const cast = (h, uid) => assert.equal(h.unit(uid).skill.activate('test', { free: true }), true);

test('Rhine: two devices read live layers; strongest front Mayer only; Ifrit inherits base ATK without a feedback loop', () => {
  const h = battle([player('p1', [
    op('m1', C.mayer, 10, 4), op('m2', C.mayer, 9, 5, { dir: 'UP', elite: true }),
    op('s', C.saria, 11, 4, { elite: true }), op('i', C.ifrit, 12, 4, { elite: true }),
    device('medical'), device('energy', 11, 5), device('ecology', 12, 5),
  ], { count: 6, layers: 10 })]);
  close(h.unit('medical').base.atk, 338);
  close(h.unit('energy').base.atk, 330);
  close(h.unit('i').s.atk, 100 + (338 + 330) * 0.6);
  close(h.unit('s').s.healingDealtMul, 1.06);
  h.b.addBuff(h.unit('medical'), { key: 'externalAttack', mods: { atkMul: 10, atkFlat: 5000 } });
  h.b.addLayers('p1', 'rhineShip', 5, 'test'); h.step(2);
  close(h.unit('medical').base.atk, 357);
  close(h.unit('i').s.atk, 100 + (357 + 345) * 0.6);
  close(h.unit('s').s.healingDealtMul, 1.10);
  h.run(10);
  close(h.unit('i').s.atk, 100 + (357 + 345) * 0.6);
  assert.equal(h.unit('i').buffs.filter((b) => b.key === 'rhine:ifrit').length, 1);
  checkInvariants(h.b);
});

test('Rhine: front tile honors all four deployment directions and ignores other owners', () => {
  for (const [dir, row, col] of [['RIGHT', 10, 4], ['LEFT', 10, 6], ['UP', 9, 5], ['DOWN', 11, 5]]) {
    const h = battle([player('p1', [op('m', C.mayer, row, col, { dir }), device('medical')], { layers: 10 })]);
    close(deviceBaseAttack(h.b, h.unit('medical')), 334);
    h.unit('m').dir = dir === 'RIGHT' ? 'LEFT' : 'RIGHT'; h.step();
    close(deviceBaseAttack(h.b, h.unit('medical')), 330);
    checkInvariants(h.b);
  }
  const h = battle([player('p1', [device('medical')], { layers: 10 }), player('p2', [op('foreign', C.mayer, 10, 4, { elite: true })], { layers: 100 })]);
  close(deviceBaseAttack(h.b, h.unit('medical')), 330);
});

test('Rhine: inactive, forged capacity and duplicated type inputs cannot activate excess devices', () => {
  for (const cfg of [{ active: false, count: 6 }, { active: true, count: 2 }]) {
    const h = battle([player('p1', [op('i', C.ifrit), device('medical')], cfg)]);
    h.unit('i').hp = 100; h.run(4);
    close(h.unit('i').hp, 100); close(h.unit('i').s.atk, 100);
  }
  const units = [op('i', C.ifrit, 10, 4), device('medical'), device('medical', 11, 5, 2, 'duplicate'), device('energy', 12, 5)];
  const h = battle([player('p1', units, { count: 3 })]);
  close(h.unit('i').s.atk, 190);
  const both = battle([player('p1', units, { count: 6 })]);
  close(both.unit('i').s.atk, 280);
  const forged = battle([player('p1', [op('i', C.ifrit), device('medical')], { devices: [{ key: 'medical', tokenId: 'token_rhine_medical', uid: 'wrong', onBoard: true, stage: 2 }] })]);
  close(forged.unit('i').s.atk, 100);
  checkInvariants(both.b);
});

test('Rhine sim boundary enables the third distinct device only at count nine', () => {
  for (const count of [8, 9, 12]) {
    const h = battle([player('p1', [op('i', C.ifrit), device('medical'), device('energy', 11, 5), device('ecology', 12, 5)], { count })]);
    close(h.unit('i').s.atk, 100 + 300 * (count < 9 ? 2 : 3) * B.ifritInheritance[0]);
    assert.equal(Number.isInteger(h.unit('ecology').researchStage), count >= 9);
    checkInvariants(h.b);
  }
});

test('Rhine grid effects include entire highlighted tiles for moving enemies and exclude neighboring unhighlighted tiles', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy')])]);
  const inside = h.spawn('dummy', { pos: [11.49, 6.49] });
  const outside = h.spawn('dummy', { pos: [11.51, 6.51] });
  for (const uid of ['a', 'b', 'c']) cast(h, uid);
  close(inside.s.maxHp - inside.hp, 300 * B.energyPulseScale);
  close(outside.hp, outside.s.maxHp);
  checkInvariants(h.b);

  const ecology = battle([player('p1', [device('ecology')])]);
  const near = ecology.spawn('dummy', { pos: [11.49, 6.49] });
  const far = ecology.spawn('dummy', { pos: [11.51, 6.51] });
  ecology.run(B.ecologyInterval);
  assert.ok(near.findBuff('slow'));
  assert.equal(far.findBuff('slow'), null);
  checkInvariants(ecology.b);
});

test('Rhine: device occupies its tile but has no attack/block and ignores direct, AoE and elemental damage', () => {
  const h = battle([player('p1', [device('energy')])]);
  const u = h.unit('energy');
  assert.equal(u.profile.noAttack, true); assert.equal(u.s.blockCnt, 0);
  assert.equal(u.s.flags.untargetable, true);
  assert.equal(h.b._occ[u.tileR * 21 + u.tileC], u);
  for (const type of ['phys', 'arts', 'true', 'elemental', 'element']) {
    close(h.b.dealDamage(null, u, { amount: 10000, type, element: 'burn', tags: ['aoe'], canDodge: false }), 0);
  }
  close(u.hp, u.s.maxHp); checkInvariants(h.b);
});

test('Rhine medical: heals the lowest HP ratio, stays inside the owner and respects its period', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4), op('b', 'test', 11, 5), device('medical')]), player('p2', [op('other', 'test', 10, 6)])]);
  h.unit('a').hp = 1000; h.unit('b').hp = 500; h.unit('other').hp = 10;
  h.run(2.8); close(h.unit('b').hp, 500);
  h.run(0.3); close(h.unit('b').hp, 650); close(h.unit('a').hp, 1000); close(h.unit('other').hp, 10);
  checkInvariants(h.b);
});

test('Rhine medical breakthroughs: final overheal yields 50% timed shield; stage II heals two targets', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4), op('b', 'test', 11, 5), device('medical', 10, 5, 2)])]);
  const d = h.unit('medical');
  h.b.addBuff(d, { key: 'healing', mods: { healingDealtMul: 2 } });
  h.b.addBuff(h.unit('a'), { key: 'received', mods: { healingTakenMul: 1.5 } });
  h.b.on('heal', (ctx) => { ctx.amount *= 0.5; });
  h.run(3.1);
  close(h.unit('a').s.shield, 112.5); close(h.unit('b').s.shield, 75);
  h.b.getPlayer('p1').bonds.rhineShip.active = false; h.run(B.medicalShieldDuration + 0.2);
  close(h.unit('a').s.shield, 0); close(h.unit('b').s.shield, 0);
  checkInvariants(h.b);
});

test('Rhine energy: actual skill starts charge once per contributor / 3s; stages add spread then damage', () => {
  for (const stage of [0, 1, 2]) {
    const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }), op('c', 'test', 9, 5, { cast: true }), device('energy', 10, 5, stage)]), player('p2', [op('other', 'test', 10, 6, { cast: true })])]);
    const e = h.spawn('dummy', { pos: [10, 6] }), nearby = h.spawn('dummy', { pos: [10, 7] }), far = h.spawn('dummy', { pos: [12, 7] });
    cast(h, 'a'); cast(h, 'a'); cast(h, 'other'); cast(h, 'b');
    close(e.hp, e.s.maxHp);
    cast(h, 'c');
    const damage = 300 * B.energyPulseScale * (stage >= 2 ? B.energyStage2Scale : 1);
    close(e.s.maxHp - e.hp, damage); close(nearby.s.maxHp - nearby.hp, stage >= 1 ? damage : 0); close(far.hp, far.s.maxHp);
    h.run(3); cast(h, 'a'); cast(h, 'b'); cast(h, 'c');
    close(e.s.maxHp - e.hp, 2 * damage);
    assert.equal(h.hooksOf('skillStart').length, 8, 'pulses do not emit skill starts or create a charging loop');
    checkInvariants(h.b);
  }
});

test('Rhine ecology: zone is periodic, slow scales to cap, stage I binds only at start and stage II extends range', () => {
  for (const stage of [0, 1, 2]) {
    const h = battle([player('p1', [device('ecology', 10, 5, stage)], { layers: 900 })]);
    const near = h.spawn('dummy', { pos: [10, 7] }), far = h.spawn('dummy', { pos: [10, 8] });
    h.run(7.8); assert.equal(near.findBuff('slow'), null);
    h.run(0.3);
    close(near.findBuff('slow').mods.moveMul, 1 - B.ecologySlowCap);
    assert.equal(!!near.s.flags.bind, stage >= 1);
    assert.equal(!!far.findBuff('slow'), stage >= 2);
    h.run(1.1); assert.equal(!!near.s.flags.bind, false, 'no perpetual bind while inside zone');
    h.run(3.2); assert.equal(near.findBuff('slow'), null);
    checkInvariants(h.b);
  }
});

test('Rhine energy: concealed and untargetable enemies cannot be primary targets; reveal enables the next pulse', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy')])]);
  const concealed = h.spawn('dummy', { pos: [10, 6] }), untargetable = h.spawn('dummy', { pos: [11, 6] });
  h.b.addBuff(concealed, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  h.b.addBuff(untargetable, { key: 'test:untargetable', flags: { untargetable: true }, persist: true });
  for (const id of ['a', 'b', 'c']) cast(h, id);
  close(concealed.hp, concealed.s.maxHp); close(untargetable.hp, untargetable.s.maxHp);
  h.b.addBuff(concealed, { key: 'test:reveal', flags: { reveal: true }, persist: true });
  h.run(3.1);
  for (const id of ['a', 'b', 'c']) cast(h, id);
  close(concealed.s.maxHp - concealed.hp, 300 * B.energyPulseScale);
  close(untargetable.hp, untargetable.s.maxHp);
  checkInvariants(h.b);
});

test('Rhine energy splash: hidden enemies are skipped, while blocked stealth enemies remain selectable', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy', 10, 5, 1)])]);
  const primary = h.spawn('dummy', { pos: [10, 5] }), concealed = h.spawn('dummy', { pos: [10, 6] });
  const blocked = h.spawn('dummy', { pos: [10, 4] }), hidden = h.spawn('dummy', { pos: [11, 5] });
  for (const e of [concealed, blocked]) h.b.addBuff(e, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  h.b.addBuff(h.unit('a'), { key: 'test:block', mods: { blockCnt: 1 }, persist: true });
  h.b._checkBlock(blocked);
  assert.equal(blocked.blockedBy, h.unit('a'));
  hidden.hidden = true;
  for (const id of ['a', 'b', 'c']) cast(h, id);
  const damage = 300 * B.energyPulseScale;
  close(primary.s.maxHp - primary.hp, damage); close(blocked.s.maxHp - blocked.hp, damage);
  close(concealed.hp, concealed.s.maxHp); close(hidden.hp, hidden.s.maxHp);
  checkInvariants(h.b);
});

test('Rhine ecology: stealth prevents bind and slow; revealing inside an active zone enables only slow', () => {
  const h = battle([player('p1', [device('ecology', 10, 5, 2)])]);
  const concealed = h.spawn('dummy', { pos: [10, 7] }), visible = h.spawn('dummy', { pos: [10, 8] });
  h.b.addBuff(concealed, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  h.run(8.1);
  assert.equal(concealed.findBuff('slow'), null); assert.equal(!!concealed.s.flags.bind, false);
  assert.ok(visible.findBuff('slow')); assert.ok(visible.s.flags.bind);
  h.b.addBuff(concealed, { key: 'test:reveal', flags: { reveal: true }, persist: true });
  h.step(2);
  assert.ok(concealed.findBuff('slow')); assert.equal(!!concealed.s.flags.bind, false);
  h.b.removeBuff(concealed, 'test:reveal'); h.step(4);
  assert.equal(concealed.findBuff('slow'), null);
  checkInvariants(h.b);
});

test('Rhine medical: isolation removes an ally from healing and shield selection until it ends', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4), op('b', 'test', 11, 5), device('medical', 10, 5, 2)])]);
  const isolated = h.unit('a'), patient = h.unit('b');
  isolated.hp = 1; patient.hp = 100;
  h.b.addBuff(isolated, { key: 'test:isolation', flags: { isolated: true }, persist: true });
  h.run(3.1);
  close(isolated.hp, 1); close(isolated.s.shield, 0); close(patient.hp, 250);
  h.b.removeBuff(isolated, 'test:isolation'); h.run(3);
  close(isolated.hp, 151); close(patient.hp, 400);
  checkInvariants(h.b);
});

test('Rhine: real automatic casts charge, passive and carried starts do not', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true, auto: true }), op('b', 'test', 11, 5, { cast: true, auto: true }),
    op('c', 'test', 9, 5, { cast: true, auto: true }), op('passive', 'test', 11, 4, { cast: true, passive: true }), device('energy')])]);
  const target = h.spawn('dummy', { pos: [10, 6] });
  h.b.emit('skillStart', { unit: h.unit('a'), reason: 'carry', skill: { kind: 'duration' } });
  h.b.emit('skillStart', { unit: h.unit('b'), reason: 'passive', skill: { kind: 'passive' } });
  cast(h, 'c'); close(target.hp, target.s.maxHp);
  h.run(1.1); close(target.s.maxHp - target.hp, 360);
  assert.equal(h.unit('passive').skill.activations, 0);
  checkInvariants(h.b);
});

test('Rhine: boss mirrors and unite helpers keep independent device ATK, inheritance and owner death', () => {
  for (const kind of ['boss', 'unite']) {
    const p1 = player('p1', [op('left_m', C.mayer, 10, 4), op('left_i', C.ifrit, 11, 4), device('medical', 10, 5, 0, 'left_dev')], { layers: 10 });
    const p2 = player('p2', [op('right_m', C.mayer, 10, 4, { elite: true }), op('right_i', C.ifrit, 11, 4), device('medical', 10, 5, 0, 'right_dev')], { layers: 20, side: 'R', colOffset: kind === 'unite' ? 8 : 0 });
    const h = battle([p1, p2], { kind });
    close(h.unit('left_dev').base.atk, 334); close(h.unit('right_dev').base.atk, 376);
    close(h.unit('left_i').s.atk, 100 + 334 * 0.3); close(h.unit('right_i').s.atk, 100 + 376 * 0.3);
    h.b.kill(h.unit('left_m')); h.step();
    assert.equal(h.unit('left_dev').alive, true);
    close(h.unit('left_i').s.atk, 199); close(h.unit('right_i').s.atk, 100 + 376 * 0.3);
    h.b.retreat(h.unit('right_m')); h.step();
    assert.equal(h.unit('right_dev').alive, true); close(h.unit('right_i').s.atk, 208);
    checkInvariants(h.b);
  }
});

test('Rhine: normal Saria healing and an active ecological zone react to live layer changes', () => {
  const h = battle([player('p1', [op('s', C.saria, 10, 4), op('patient', 'test', 11, 4), device('ecology')], { layers: 2 })]);
  const target = h.spawn('dummy', { pos: [10, 7] });
  h.run(8.1); close(target.findBuff('slow').mods.moveMul, 1 - 0.252);
  h.unit('patient').hp = 100;
  close(h.b.heal(h.unit('s'), h.unit('patient'), 100), 100);
  h.b.addLayers('p1', 'rhineShip', 298, 'test'); h.step(2);
  close(target.findBuff('slow').mods.moveMul, 0.45);
  close(h.b.heal(h.unit('s'), h.unit('patient'), 100), 200);
  h.b.getPlayer('p1').bonds.rhineShip.active = false; h.step(3);
  close(h.b.heal(h.unit('s'), h.unit('patient'), 100), 100);
  assert.equal(target.findBuff('slow'), null);
  checkInvariants(h.b);
});

test('Rhine real Ifrit: inherited flat ATK feeds the authored burn skill once and ignores buffed device ATK', () => {
  for (const suffix of ['a', 'b']) {
    const units = [{ uid: 'ifrit', chessId: `chess_rhine_ifrit_${suffix}`, row: 10, col: 4, skillIndex: 2, moduleId: 'none' }, device('medical'), device('energy', 11, 5)];
    const h = makeBattle({ players: [player('p1', units, { count: 6, layers: 30 })],
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, speed: 0, res: 50 }) } }, captureNoisy: true });
    h.step();
    const u = h.unit('ifrit'), d = h.unit('medical');
    const inherit = (390 + 390) * B.ifritInheritance[suffix === 'b' ? 1 : 0];
    close(u.findBuff('rhine:ifrit').mods.atkFlat, inherit);
    close(u.s.atk, u.base.atk + inherit);
    h.b.addBuff(d, { key: 'temporaryDevicePower', mods: { atkMul: 20, atkFlat: 10000 } });
    h.b.addBuff(u, { key: 'operatorPower', mods: { atkPct: 0.5 } });
    h.step();
    close(u.s.atk, (u.base.atk + inherit) * 1.5);
    const target = h.spawn('dummy', { pos: [10, 7] });
    assert.equal(u.skill.activate('test', { free: true }), true);
    h.run(1.1);
    const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes('ifritBurn'));
    assert.equal(hits.length, 1);
    close(hits[0].dmg.amount, u.s.atk * u.def.skill.bb.atk_scale);
    const resistance = Math.max(0, (50 + u.def.skill.bb.magic_resistance) * (1 + u.def.talents[0].bb.magic_resistance));
    close(target.s.res, resistance);
    close(hits[0].amount, hits[0].dmg.amount * (1 - resistance / 100));
    h.run(3);
    close(u.findBuff('rhine:ifrit').mods.atkFlat, inherit);
    assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
  }
});

test('Rhine real Mayer / Saria: normal and elite records carry only their replacement battle trait', () => {
  for (const suffix of ['a', 'b']) {
    const units = [{ uid: 'm', chessId: `chess_rhine_mayer_${suffix}`, row: 10, col: 4 },
      { uid: 's', chessId: `chess_char_5_11_${suffix}`, row: 11, col: 4 }, device('medical')];
    const h = makeBattle({ players: [player('p1', units, { layers: 15 })] });
    h.step();
    assert.deepEqual(h.unit('m').def.raw.garrisonIds, [`garrison_rhine_mayer_${suffix}`]);
    assert.deepEqual(h.unit('s').def.raw.garrisonIds, [`garrison_rhine_saria_${suffix}`]);
    close(h.unit('medical').base.atk, suffix === 'a' ? 351 : 357);
    close(h.unit('s').s.healingDealtMul, suffix === 'a' ? 1.05 : 1.10);
    assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
  }
});
