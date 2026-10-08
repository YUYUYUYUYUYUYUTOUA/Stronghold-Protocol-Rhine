import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { RHINE_CHARACTERS as C, RHINE_DEVICES, RHINE_BALANCE as B } from '../../shared/rhineResearch.js';
import { deviceBaseAttack } from '../../server/sim/content/rhine.js';
import { DATA } from '../match/harness.js';

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
    chess[u.chessId] = chessRec({ id: u.chessId, charId: u.charId, golden: u.elite, bonds: u.bonds,
      profession: u.profession, dmgType: u.dmgType, stats: { atk: 100, maxHp: 2000, blockCnt: 0 }, skill: u.cast ? {} : null });
    const trait = Object.entries(C).find(([key, id]) => ['mayer', 'saria', 'ifrit'].includes(key) && id === u.charId)?.[0];
    chess[u.chessId].garrisonIds = trait ? [`garrison_rhine_${trait}_${u.elite ? 'b' : 'a'}`] : [];
    kits[u.chessId] = () => ({ trait: { noAttack: true }, skill: u.cast ? { kind: u.passive ? 'passive' : 'instant', trigger: { rule: u.auto ? 'SP_FULL' : 'NEVER' }, spCost: u.auto ? 1 : 10 } : null });
  }
  const tokens = Object.fromEntries(RHINE_DEVICES.map((d) => [d.tokenId, { name: d.name, stats: { maxHp: 100, atk: 1, blockCnt: 5 }, rangeGrid: [[0, 0]] }]));
  const h = makeBattle({ players, defs: { chess, tokens, enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, speed: 0 }) } }, kits, ...extra });
  h.step();
  return h;
}
const cast = (h, uid) => assert.equal(h.unit(uid).skill.activate('test', { free: true }), true);
const researchLayers = h => h.b.getPlayer('p1').bonds.rhineShip.layers;
const valid = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

test('Rhine Mayer energy work: one complete pulse rewards the strongest facing copy, independent of targets', () => {
  for (const targetCount of [1, 5]) {
    const h = battle([player('p1', [op('normal', C.mayer, 10, 4),
      op('elite', C.mayer, 9, 5, { dir: 'UP', elite: true }), op('elite2', C.mayer, 10, 6, { dir: 'LEFT', elite: true }),
      op('a', 'test', 9, 4, { cast: true }), op('b', 'test', 11, 4, { cast: true }), op('c', 'test', 12, 4, { cast: true }),
      device('energy', 10, 5, 2)])], { captureNoisy: true });
    const foes = Array.from({ length: targetCount }, () => h.spawn('dummy', { pos: [10, 7] }));
    cast(h, 'a'); cast(h, 'b'); close(researchLayers(h), 0);
    cast(h, 'c'); close(researchLayers(h), 2);
    for (const foe of foes) close(foe.s.maxHp - foe.hp, 900);
    assert.equal(h.eventsOf('fx').filter(e => e[1] === 'rhinePulse').length, 1);
    assert.equal(h.hooksOf('layerGain').length, 1);
    assert.equal(h.hooksOf('layerGain')[0].source, h.unit('elite'));
    h.b.retreat(h.unit('elite'), { permanent: true }); h.b.retreat(h.unit('elite2'), { permanent: true });
    h.run(3); for (const uid of ['a', 'b', 'c']) cast(h, uid);
    close(researchLayers(h), 3);
    valid(h);
  }
});

test('Rhine Mayer energy work: full charge waits for a target and reentrant casts wait for the complete pulse', () => {
  const units = [op('m', C.mayer, 10, 4), ...['a','b','c','d','e','f'].map((uid, i) => op(uid, 'test', 9 + Math.floor(i / 3), 1 + i % 3, { cast: true })),
    device('energy', 10, 5, 2)];
  const h = battle([player('p1', units)], { captureNoisy: true });
  for (const uid of ['a','b','c']) cast(h, uid);
  h.step(90); close(researchLayers(h), 0); assert.equal(h.unit('energy').researchCharges, 3);
  const foes = [h.spawn('dummy', { pos: [10, 6] }), h.spawn('dummy', { pos: [11, 6] })];
  let reentered = false;
  h.b.on('damaged', ({ source }) => {
    if (source !== h.unit('energy') || reentered) return;
    reentered = true;
    for (const uid of ['d','e','f']) cast(h, uid);
    close(researchLayers(h), 0, 'the unfinished outer pulse has not earned layers');
    assert.equal(h.unit('energy').researchCharges, 3);
  });
  h.step(); close(researchLayers(h), 1);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'rhinePulse').length, 1);
  for (const foe of foes) close(foe.s.maxHp - foe.hp, 900);
  h.step(); close(researchLayers(h), 1);
  assert.equal(h.unit('energy').researchCharges, 3, 'reentrant charge waits for the pulse interval');
  h.run(1.5); close(researchLayers(h), 2);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'rhinePulse').length, 2);
  for (const foe of foes) close(foe.s.maxHp - foe.hp, 900 + 304 * 3);
  assert.equal(h.unit('energy').researchCharges, 0);
  valid(h);
});

test('Rhine Mayer medical work: empty/full/no-heal/zero heals do not count; two actual heals are one cycle', () => {
  const h = battle([player('p1', [op('m', C.mayer, 10, 4), op('patient', 'test', 11, 5), device('medical')])]);
  h.step(90); close(researchLayers(h), 0);
  const patient = h.unit('patient'); patient.hp = 500;
  h.b.addBuff(patient, { key: 'noHeal', flags: { noHeal: true } }); h.step(90); close(researchLayers(h), 0);
  h.b.removeBuff(patient, 'noHeal');
  const cancel = h.b.on('heal', c => { c.amount = 0; }); h.step(90); close(researchLayers(h), 0);
  h.b.off(cancel); h.step(90); close(patient.hp, 725); close(researchLayers(h), 1);
  valid(h);

  const two = battle([player('p1', [op('m', C.mayer, 10, 4, { elite: true }), op('patient', 'test', 11, 5), device('medical', 10, 5, 2)])]);
  two.unit('m').hp = 500; two.unit('patient').hp = 500;
  two.step(90); close(two.unit('m').hp, 800); close(two.unit('patient').hp, 800); close(researchLayers(two), 2);
  assert.equal(two.hooksOf('layerGain').length, 1);
  valid(two);
});

test('Rhine Mayer medical shields: net increase counts once, capped duration refresh does not, replenishment does', () => {
  const h = battle([player('p1', [op('m', C.mayer, 10, 4), op('patient', 'test', 11, 5), device('medical', 10, 5, 2)])]);
  h.step(90); close(researchLayers(h), 1);
  for (const uid of ['m','patient']) close(h.unit(uid).s.shield, 225);
  const key = `rhine:overheal:${h.unit('medical').id}`;
  for (const uid of ['m','patient']) h.b.addBuff(h.unit(uid), { key, shield: h.unit(uid).s.maxHp * .4, duration: 6 });
  h.step(90); close(researchLayers(h), 1);
  const patient = h.unit('patient'); assert.ok(patient.findBuff(key).timeLeft > 5.9);
  h.b.dealDamage(null, patient, { amount: 50, type: 'true', canDodge: false });
  close(patient.hp, patient.s.maxHp); close(patient.s.shield, patient.s.maxHp * .4 - 50);
  h.step(90); close(researchLayers(h), 2); close(patient.s.shield, patient.s.maxHp * .4);
  h.step(90); close(researchLayers(h), 2);
  valid(h);
});

test('Rhine Mayer medical slow: accumulates three seconds of selectable targets, pauses empty time, never counts entry or ticks', () => {
  for (const stage of [0, 1, 2]) {
    const h = battle([player('p1', [op('m', C.mayer, 10, 4), device('medical', 10, 5, stage)])]);
    h.b.addBuff(h.unit('m'), { key: 'test:noTreatment', flags: { healFree: true }, persist: true });
    const foe = h.spawn('dummy', { pos: [10, 6] });
    h.step(60); close(researchLayers(h), 0);
    foe.hidden = true; h.step(300); close(researchLayers(h), 0);
    foe.hidden = false; h.step(29); close(researchLayers(h), 0);
    h.step(); close(researchLayers(h), 1);
    foe.x = 10; h.step(90); close(researchLayers(h), 1);
    foe.x = 6;
    const second = h.spawn('dummy', { pos: [11, 6] }); h.step(45); close(researchLayers(h), 1);
    h.b.kill(foe); h.step(44); close(researchLayers(h), 1);
    h.step(); close(researchLayers(h), 2);
    assert.ok(second.findBuff('slow')); assert.equal(h.hooksOf('layerGain').length, 2);
    valid(h);
  }
});

test('Rhine Mayer medical slow: hidden/untargetable foes and disabled/removed devices cannot create or retain work', () => {
  const h = battle([player('p1', [op('m', C.mayer, 10, 4, { elite: true }), device('medical')])]);
  const foe = h.spawn('dummy', { pos: [10, 6] });
  h.b.addBuff(foe, { key: 'stealth', flags: { stealth: true }, persist: true }); h.step(90); close(researchLayers(h), 0);
  h.b.removeBuff(foe, 'stealth'); h.b.addBuff(foe, { key: 'untargetable', flags: { untargetable: true } });
  h.step(90); close(researchLayers(h), 0); h.b.removeBuff(foe, 'untargetable');
  h.step(60);
  const ps = h.b.getPlayer('p1'); ps.input.research.active = false; h.step(); ps.input.research.active = true;
  h.step(60); close(researchLayers(h), 0); h.step(30); close(researchLayers(h), 2);
  h.b.retreat(h.unit('medical'), { permanent: true }); h.step(180); close(researchLayers(h), 2);
  valid(h);
});

test('Rhine Mayer work: gainLayers respects field flags, owner state, absent/dead sources and the 999 cap', () => {
  for (const [kind, flags] of [['boss', {}], ['hidden', {}], ['unite', {}], ['normal', { layerGainsEnabled: false }]]) {
    const h = battle([player('p1', [op('m', C.mayer, 10, 4), device('medical')])], { kind, flags });
    h.unit('m').hp = 500; h.step(90); assert.ok(h.unit('m').hp > 500); close(researchLayers(h), 0); valid(h);
  }
  for (const state of ['absent','dead','wrongDirection','inactive']) {
    const h = battle([player('p1', [op('m', state === 'absent' ? 'test' : C.mayer, 10, 4), op('patient', 'test', 11, 5), device('medical')])]);
    if (state === 'dead') h.b.kill(h.unit('m'));
    if (state === 'wrongDirection') h.unit('m').dir = 'LEFT';
    if (state === 'inactive') h.b.getPlayer('p1').bonds.rhineShip.active = false;
    h.unit('patient').hp = 500; h.step(90); close(researchLayers(h), 0); valid(h);
  }
  const capped = battle([player('p1', [op('m', C.mayer, 10, 4, { elite: true }), op('i', C.ifrit, 11, 4, { elite: true }), device('medical')], { layers: 998 })]);
  capped.unit('m').hp = 500; capped.step(90); close(researchLayers(capped), 999);
  assert.equal(capped.eventsOf('layer').at(-1)[3], 1);
  capped.unit('m').hp = 500; capped.step(90); close(researchLayers(capped), 999); close(capped.unit('i').s.atk, 100 + 4296 * 1.5);
  valid(capped);
});

test('Rhine: devices read four ATK per layer without old Mayer ATK; Ifrit inherits one highest base without feedback', () => {
  const h = battle([player('p1', [
    op('m1', C.mayer, 10, 4), op('m2', C.mayer, 9, 5, { dir: 'UP', elite: true }),
    op('s', C.saria, 11, 4, { elite: true }), op('i', C.ifrit, 12, 4, { elite: true }),
    device('medical'), device('energy', 11, 5), device('laser', 12, 5),
  ], { count: 6, layers: 10 })]);
  close(h.unit('medical').base.atk, 340);
  close(h.unit('energy').base.atk, 340);
  close(h.unit('i').s.atk, 100 + 340 * 1.5);
  close(h.unit('s').s.healingDealtMul, 1.06);
  h.b.addBuff(h.unit('medical'), { key: 'externalAttack', mods: { atkMul: 10, atkFlat: 5000 } });
  h.b.addLayers('p1', 'rhineShip', 5, 'test'); h.step(2);
  close(h.unit('medical').base.atk, 360);
  close(h.unit('i').s.atk, 100 + 360 * 1.5);
  close(h.unit('s').s.healingDealtMul, 1.10);
  h.run(10);
  close(h.unit('i').s.atk, 100 + 360 * 1.5);
  assert.equal(h.unit('i').buffs.filter((b) => b.key === 'rhine:ifrit').length, 1);
  checkInvariants(h.b);
});

test('Rhine Mayer: effective work honors all four directions and ignores other owners', () => {
  for (const [dir, row, col] of [['RIGHT', 10, 4], ['LEFT', 10, 6], ['UP', 9, 5], ['DOWN', 11, 5]]) {
    const h = battle([player('p1', [op('m', C.mayer, row, col, { dir }), device('medical')], { layers: 10 })]);
    h.unit('m').hp = 500; h.run(3);
    close(h.b.getPlayer('p1').bonds.rhineShip.layers, 11);
    close(deviceBaseAttack(h.b, h.unit('medical')), 344);
    h.unit('m').dir = dir === 'RIGHT' ? 'LEFT' : 'RIGHT'; h.step();
    h.run(3); close(h.b.getPlayer('p1').bonds.rhineShip.layers, 11);
    close(deviceBaseAttack(h.b, h.unit('medical')), 344);
    checkInvariants(h.b);
  }
  const h = battle([player('p1', [op('patient', 'test', 11, 5), device('medical')], { layers: 10 }), player('p2', [op('foreign', C.mayer, 10, 4, { elite: true })], { layers: 100 })]);
  h.unit('patient').hp = 500; h.run(3);
  close(h.b.getPlayer('p1').bonds.rhineShip.layers, 10);
  close(deviceBaseAttack(h.b, h.unit('medical')), 340);
});

test('Rhine: inactive, forged capacity and duplicated type inputs cannot activate excess devices', () => {
  for (const cfg of [{ active: false, count: 6 }, { active: true, count: 2 }]) {
    const h = battle([player('p1', [op('i', C.ifrit), device('medical')], cfg)]);
    h.unit('i').hp = 100; h.run(4);
    close(h.unit('i').hp, 100); close(h.unit('i').s.atk, 100);
  }
  const units = [op('i', C.ifrit, 10, 4), device('medical'), device('medical', 11, 5, 2, 'duplicate'), device('energy', 12, 5)];
  const h = battle([player('p1', units, { count: 3 })]);
  close(h.unit('i').s.atk, 400);
  const both = battle([player('p1', units, { count: 6 })]);
  close(both.unit('i').s.atk, 400);
  const forged = battle([player('p1', [op('i', C.ifrit), device('medical')], { devices: [{ key: 'medical', tokenId: 'token_rhine_medical', uid: 'wrong', onBoard: true, stage: 2 }] })]);
  close(forged.unit('i').s.atk, 100);
  checkInvariants(both.b);
});

test('Rhine sim boundary enables the third distinct device only at count nine', () => {
  for (const count of [8, 9, 12]) {
    const h = battle([player('p1', [op('i', C.ifrit), device('medical'), device('energy', 11, 5), device('laser', 12, 5)], { count })]);
    close(h.unit('i').s.atk, 100 + 300 * B.ifritInheritance[0]);
    assert.equal(Number.isInteger(h.unit('laser').researchStage), count >= 9);
    checkInvariants(h.b);
  }
});

test('Rhine grid effects include entire highlighted tiles for moving enemies and exclude neighboring unhighlighted tiles', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy')])]);
  const outside = h.spawn('dummy', { pos: [11.51, 6.51] });
  for (const uid of ['a', 'b', 'c']) cast(h, uid);
  close(outside.hp, outside.s.maxHp);
  assert.equal(h.unit('energy').researchCharges, 3, 'an enemy outside the highlighted cells cannot trigger release');
  const inside = h.spawn('dummy', { pos: [11.49, 6.49] });
  h.step();
  close(inside.s.maxHp - inside.hp, 300 * B.energyPulseScale[0]);
  checkInvariants(h.b);

  const ecology = battle([player('p1', [device('medical')])]);
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
  h.run(0.3); close(h.unit('b').hp, 725); close(h.unit('a').hp, 1000); close(h.unit('other').hp, 10);
  checkInvariants(h.b);
});

test('Rhine medical breakthroughs: adjusted healing plus overheal yield a timed shield; stage II heals three targets', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4), op('b', 'test', 11, 5), device('medical', 10, 5, 2)])]);
  const d = h.unit('medical');
  h.b.addBuff(d, { key: 'healing', mods: { healingDealtMul: 2 } });
  h.b.addBuff(h.unit('a'), { key: 'received', mods: { healingTakenMul: 1.5 } });
  h.b.on('heal', (ctx) => { ctx.amount *= 0.5; });
  h.run(3.1);
  close(h.unit('a').s.shield, 337.5); close(h.unit('b').s.shield, 225);
  h.b.getPlayer('p1').bonds.rhineShip.active = false; h.run(B.medicalShieldDuration + 0.2);
  close(h.unit('a').s.shield, 0); close(h.unit('b').s.shield, 0);
  checkInvariants(h.b);
});

test('Rhine energy: actual skill starts charge once per contributor / 3s; every stage uses its authored pulse scale', () => {
  for (const stage of [0, 1, 2]) {
    const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }), op('c', 'test', 9, 5, { cast: true }), device('energy', 10, 5, stage)]), player('p2', [op('other', 'test', 10, 6, { cast: true })])]);
    const e = h.spawn('dummy', { pos: [10, 6] }), nearby = h.spawn('dummy', { pos: [10, 7] }), far = h.spawn('dummy', { pos: [12, 8] });
    cast(h, 'a'); cast(h, 'a'); cast(h, 'other'); cast(h, 'b');
    close(e.hp, e.s.maxHp);
    cast(h, 'c');
    const damage = 300 * B.energyPulseScale[stage];
    close(e.s.maxHp - e.hp, damage); close(nearby.s.maxHp - nearby.hp, damage); close(far.hp, far.s.maxHp);
    h.run(3); cast(h, 'a'); cast(h, 'b'); cast(h, 'c');
    close(e.s.maxHp - e.hp, 2 * damage);
    assert.equal(h.hooksOf('skillStart').length, 8, 'pulses do not emit skill starts or create a charging loop');
    checkInvariants(h.b);
  }
});

test('Rhine medical slow: continuous 50% slow starts immediately, bind pulses every 8s, mature radius is 3', () => {
  for (const stage of [0, 1, 2]) {
    const h = battle([player('p1', [device('medical', 10, 5, stage)], { layers: 900 })]);
    const near = h.spawn('dummy', { pos: [10, 7] }), far = h.spawn('dummy', { pos: [10, 8] });
    h.step(); close(near.findBuff('slow').mods.moveMul, 0.5);
    assert.equal(!!near.s.flags.bind, false, 'the opening aura does not bind');
    assert.equal(!!far.findBuff('slow'), stage >= 2);
    h.run(7.7); close(near.findBuff('slow').mods.moveMul, 0.5);
    h.run(0.3);
    close(near.findBuff('slow').mods.moveMul, 0.5);
    assert.equal(!!near.s.flags.bind, stage >= 2);
    assert.equal(!!far.findBuff('slow'), stage >= 2);
    h.run(1.1); assert.equal(!!near.s.flags.bind, false, 'no perpetual bind while inside zone');
    h.run(3.2); close(near.findBuff('slow').mods.moveMul, 0.5, 'slow has no four-second gap');
    h.b.getPlayer('p1').bonds.rhineShip.active = false; h.step(4);
    assert.equal(near.findBuff('slow'), null);
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
  assert.equal(h.unit('energy').researchCharges, 3);
  h.b.addBuff(concealed, { key: 'test:reveal', flags: { reveal: true }, persist: true });
  h.step();
  close(concealed.s.maxHp - concealed.hp, 300 * B.energyPulseScale[0]);
  close(untargetable.hp, untargetable.s.maxHp);
  assert.equal(h.unit('energy').researchCharges, 0);
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
  const damage = 300 * B.energyPulseScale[1];
  close(primary.s.maxHp - primary.hp, damage); close(blocked.s.maxHp - blocked.hp, damage);
  close(concealed.hp, concealed.s.maxHp); close(hidden.hp, hidden.s.maxHp);
  checkInvariants(h.b);
});

test('Rhine energy: the upstream stealth restoration window remains selectable, then conceals the target again', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy')])]);
  const target = h.spawn('dummy', { pos: [10, 4] }), blocker = h.unit('a');
  h.b.addBuff(target, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  h.b.addBuff(blocker, { key: 'test:block', mods: { blockCnt: 1 }, persist: true });
  h.b._checkBlock(target); assert.equal(target.blockedBy, blocker);
  h.b.releaseBlocked(blocker);
  h.b.removeBuff(blocker, 'test:block');
  assert.equal(target.blockedBy, null);
  assert.ok(h.b.foesInRadius(5, 10, 2).includes(target), 'unblock keeps the target revealed for the upstream restore interval');
  for (const id of ['a', 'b', 'c']) cast(h, id);
  close(target.s.maxHp - target.hp, 300 * B.energyPulseScale[0]);
  h.run(3.1);
  assert.equal(h.b.foesInRadius(5, 10, 2).includes(target), false);
  const hp = target.hp;
  for (const id of ['a', 'b', 'c']) cast(h, id);
  close(target.hp, hp);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('Rhine medical slow: stealth prevents bind and slow; revealing inside an active zone enables only slow', () => {
  const h = battle([player('p1', [device('medical', 10, 5, 2)])]);
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
  close(isolated.hp, 1); close(isolated.s.shield, 0); close(patient.hp, 400);
  h.b.removeBuff(isolated, 'test:isolation'); h.run(3);
  close(isolated.hp, 301); close(patient.hp, 700);
  checkInvariants(h.b);
});

test('Rhine: real automatic casts charge, passive and carried starts do not', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true, auto: true }), op('b', 'test', 11, 5, { cast: true, auto: true }),
    op('c', 'test', 9, 5, { cast: true, auto: true }), op('passive', 'test', 11, 4, { cast: true, passive: true }), device('energy')])]);
  const target = h.spawn('dummy', { pos: [10, 6] });
  h.b.emit('skillStart', { unit: h.unit('a'), reason: 'carry', skill: { kind: 'duration' } });
  h.b.emit('skillStart', { unit: h.unit('b'), reason: 'passive', skill: { kind: 'passive' } });
  cast(h, 'c'); close(target.hp, target.s.maxHp);
  h.run(1.1); close(target.s.maxHp - target.hp, 540);
  assert.equal(h.unit('passive').skill.activations, 0);
  checkInvariants(h.b);
});

test('Rhine: boss mirrors and unite helpers keep independent device ATK, inheritance and owner death', () => {
  for (const kind of ['boss', 'unite']) {
    const p1 = player('p1', [op('left_m', C.mayer, 10, 4), op('left_i', C.ifrit, 11, 4), device('medical', 10, 5, 0, 'left_dev')], { layers: 10 });
    const p2 = player('p2', [op('right_m', C.mayer, 10, 4, { elite: true }), op('right_i', C.ifrit, 11, 4), device('medical', 10, 5, 0, 'right_dev')], { layers: 20, side: 'R', colOffset: kind === 'unite' ? 8 : 0 });
    const h = battle([p1, p2], { kind });
    close(h.unit('left_dev').base.atk, 340); close(h.unit('right_dev').base.atk, 380);
    close(h.unit('left_i').s.atk, 440); close(h.unit('right_i').s.atk, 480);
    h.b.kill(h.unit('left_m')); h.step();
    assert.equal(h.unit('left_dev').alive, true);
    close(h.unit('left_i').s.atk, 440); close(h.unit('right_i').s.atk, 480);
    h.b.retreat(h.unit('right_m')); h.step();
    assert.equal(h.unit('right_dev').alive, true); close(h.unit('right_i').s.atk, 480);
    checkInvariants(h.b);
  }
});

test('Rhine: Saria healing scales with live layers while the continuous ecology slow remains 50%', () => {
  const h = battle([player('p1', [op('s', C.saria, 10, 4), op('patient', 'test', 11, 4), device('medical')], { layers: 2 })]);
  const target = h.spawn('dummy', { pos: [10, 7] });
  h.step(); close(target.findBuff('slow').mods.moveMul, 0.5);
  h.unit('patient').hp = 100;
  close(h.b.heal(h.unit('s'), h.unit('patient'), 100), 100);
  h.b.addLayers('p1', 'rhineShip', 298, 'test'); h.step(2);
  close(target.findBuff('slow').mods.moveMul, 0.5);
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
    const inherit = 420 * B.ifritInheritance[suffix === 'b' ? 1 : 0];
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
    close(h.unit('medical').base.atk, 360);
    close(h.unit('s').s.healingDealtMul, suffix === 'a' ? 1.05 : 1.10);
    assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
  }
});

test('Rhine sharing: damage members and Ifrit read one highest own device with independent scales', () => {
  const rhine = { bonds: ['rhineShip'] };
  const h = battle([player('p1', [
    op('m', C.mayer, 10, 4, { ...rhine, elite: true }),
    op('ordinary', 'test', 9, 4, rhine), op('elite', 'test', 9, 6, { ...rhine, elite: true }),
    op('medic', 'test', 11, 4, { ...rhine, profession: 'MEDIC', dmgType: 'arts' }),
    op('healer', 'test', 12, 4, { ...rhine, profession: 'SUPPORT', dmgType: 'heal' }),
    op('saria', C.saria, 9, 7, rhine), op('ifrit', C.ifrit, 11, 6, { ...rhine, elite: true }),
    op('unrelated', 'test', 12, 6), device('medical'), device('energy', 11, 5), device('laser', 12, 5),
  ], { count: 9, layers: 15 }), player('p2', [op('other', 'test', 10, 7, rhine), device('medical', 12, 8, 0, 'otherDevice')], { count: 6, layers: 100 })]);
  close(h.unit('ordinary').s.atk, 100 + 360 * 0.15);
  close(h.unit('elite').s.atk, 100 + 360 * 0.25);
  close(h.unit('other').s.atk, 100 + 700 * 0.15);
  close(h.unit('ifrit').s.atk, 100 + 360 * 1.5);
  for (const uid of ['medic', 'healer', 'saria', 'unrelated', 'ifrit']) assert.equal(h.unit(uid).findBuff('rhine:sharing'), null);
  h.b.addBuff(h.unit('medical'), { key: 'test:devicePower', mods: { atkMul: 20, atkFlat: 10000 } });
  h.b.addBuff(h.unit('m'), { key: 'test:mayerPower', mods: { atkPct: 3 } });
  h.b.addBuff(h.unit('ordinary'), { key: 'test:operatorPower', mods: { atkPct: 0.5 } });
  h.run(10);
  close(deviceBaseAttack(h.b, h.unit('medical')), 360);
  close(h.unit('ordinary').s.atk, (100 + 360 * 0.15) * 1.5);
  assert.equal(h.unit('ordinary').buffs.filter((b) => b.key === 'rhine:sharing').length, 1);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('Rhine sharing: transformation and harmony use live membership; losing six members or a device clears the bonus', () => {
  const morph = Object.values(DATA.items).find((it) => it.canGiveBond && !it.isGolden).id;
  const p = player('p1', [op('native', 'test', 9, 4, { bonds: ['rhineShip'] }),
    op('morph', 'test', 11, 4, { items: ['chess_item_rhine_terminal_a', morph] }),
    op('harmony', 'test', 12, 4, { bonds: ['maniShip'] }), device('energy')], { count: 6 });
  p.bonds.maniShip = { active: true, count: 2, layers: 0 };
  const h = battle([p]), ps = h.b.getPlayer('p1');
  for (const uid of ['native', 'morph', 'harmony']) close(h.unit(uid).findBuff('rhine:sharing').mods.atkFlat, 45);
  h.unit('morph').items = h.unit('morph').items.filter((id) => id !== morph);
  ps.bonds.maniShip.active = false; h.step();
  assert.equal(h.unit('morph').findBuff('rhine:sharing'), null);
  assert.equal(h.unit('harmony').findBuff('rhine:sharing'), null);
  ps.bonds.rhineShip.count = 5; h.step(); close(h.unit('native').s.atk, 100);
  ps.bonds.rhineShip.count = 6; h.b.addLayers('p1', 'rhineShip', 10, 'test'); h.step(2);
  close(h.unit('native').s.atk, 100 + 340 * 0.15);
  h.b.retreat(h.unit('native')); close(h.unit('native').s.atk, 100);
  assert.equal(h.b.redeploy(h.unit('native')), true); close(h.unit('native').s.atk, 100 + 340 * 0.15);
  h.b.retreat(h.unit('energy'), { permanent: true }); close(h.unit('native').s.atk, 100);
  assert.equal(h.unit('native').findBuff('rhine:sharing'), null);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('Rhine energy: stage one accepts distant same-owner casts, excludes foreign, passive and carried starts', () => {
  for (const stage of [0, 1, 2]) {
    const h = battle([player('p1', [op('a', 'test', 9, 2, { cast: true }), op('b', 'test', 12, 2, { cast: true }),
      op('c', 'test', 9, 10, { cast: true }), device('energy', 10, 5, stage)]),
    player('p2', [op('other', 'test', 12, 10, { cast: true })])]);
    const target = h.spawn('dummy', { pos: [10, 6] });
    cast(h, 'other');
    h.b.emit('skillStart', { unit: h.unit('a'), reason: 'carry', skill: { kind: 'duration' } });
    h.b.emit('skillStart', { unit: h.unit('b'), reason: 'passive', skill: { kind: 'passive' } });
    assert.equal(h.unit('energy').researchCharges, 0);
    cast(h, 'a'); cast(h, 'a'); cast(h, 'b');
    assert.equal(h.unit('energy').researchCharges, stage >= 1 ? 2 : 0);
    cast(h, 'c'); close(target.s.maxHp - target.hp, stage >= 1 ? 300 * B.energyPulseScale[stage] : 0);
    assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
  }
});

test('Rhine energy: full charge waits without overflow or empty FX, releases on enemy entry, and never charges itself', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy', 10, 5, 1)])]);
  for (const uid of ['a', 'b', 'c']) cast(h, uid);
  assert.equal(h.unit('energy').researchCharges, 3);
  h.run(3.1); for (const uid of ['a', 'b', 'c']) cast(h, uid);
  assert.equal(h.unit('energy').researchCharges, 3);
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'rhinePulse').length, 0);
  const outside = h.spawn('dummy', { pos: [10, 9] }); h.step();
  assert.equal(h.unit('energy').researchCharges, 3); close(outside.hp, outside.s.maxHp);
  const inside = h.spawn('dummy', { pos: [10, 6] }); h.step();
  close(inside.s.maxHp - inside.hp, 720); assert.equal(h.unit('energy').researchCharges, 0);
  h.run(10); close(inside.s.maxHp - inside.hp, 720); assert.equal(h.unit('energy').researchCharges, 0);
  h.b.kill(inside);
  for (const uid of ['a', 'b', 'c']) cast(h, uid);
  assert.equal(h.unit('energy').researchCharges, 3);
  h.b.getPlayer('p1').bonds.rhineShip.active = false; h.step();
  assert.equal(h.unit('energy').researchCharges, 0);
  h.b.getPlayer('p1').bonds.rhineShip.active = true;
  const later = h.spawn('dummy', { pos: [10, 6] }); h.step(); close(later.hp, later.s.maxHp);
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'rhinePulse').length, 1);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('Rhine mature energy: the primary-centered Saria diamond includes whole cells and giant bodies, excluding circle corners and stealth', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy', 10, 5, 2)])]);
  const primary = h.spawn('dummy', { pos: [10, 5] });
  const covered = [];
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    if (10 + dr >= 9 && 10 + dr <= 12 && Math.abs(dr) + Math.abs(dc) <= 3 && (dr || dc)) {
      covered.push(h.spawn('dummy', { pos: [10 + dr, 5 + dc] }));
    }
  }
  const corners = [[2, -2], [2, 2]].map(([dr, dc]) => h.spawn('dummy', { pos: [10 + dr, 5 + dc] }));
  const tileEdge = h.spawn('dummy', { pos: [10.49, 8.49] });
  const giant = h.spawn('dummy', { pos: [10, 10.49] }); giant.hitArea = { w: 5, h: 1, dx: 0, dy: 0 };
  const concealed = h.spawn('dummy', { pos: [11, 5] }), untargetable = h.spawn('dummy', { pos: [10, 7] });
  const hidden = h.spawn('dummy', { pos: [10, 4] }); hidden.hidden = true;
  h.b.addBuff(concealed, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  h.b.addBuff(untargetable, { key: 'test:untargetable', flags: { untargetable: true }, persist: true });
  for (const uid of ['a', 'b', 'c']) cast(h, uid);
  for (const target of [primary, ...covered, tileEdge, giant]) close(target.s.maxHp - target.hp, 900);
  for (const target of [...corners, concealed, untargetable, hidden]) {
    assert.equal(target.hp, target.s.maxHp, `excluded enemy ${target.id} at (${target.y},${target.x})`);
  }
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'rhinePulse').length, 1);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});

test('Rhine mature energy: splash follows a moving primary tile beyond device range without turning into a circle', () => {
  const h = battle([player('p1', [op('a', 'test', 10, 4, { cast: true }), op('b', 'test', 11, 5, { cast: true }),
    op('c', 'test', 9, 5, { cast: true }), device('energy', 10, 5, 2)])]);
  const primary = h.spawn('dummy', { pos: [10.49, 6.49] });
  const tip = h.spawn('dummy', { pos: [10.49, 9.49] });
  const corner = h.spawn('dummy', { pos: [12.49, 8.49] });
  for (const uid of ['a', 'b', 'c']) cast(h, uid);
  close(primary.s.maxHp - primary.hp, 900);
  close(tip.s.maxHp - tip.hp, 900);
  close(corner.hp, corner.s.maxHp);
  assert.deepEqual(h.b.errors, []); checkInvariants(h.b);
});
