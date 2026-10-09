import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { RHINE_CHARACTERS as C, RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { otterKit, OTTER } from '../../server/sim/content/kits/rhineSupport.js';
import { SharedBossPool, CreditPool } from '../../server/match/finalAssault.js';
import { LocalBossPool } from '../../server/sim/spec.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `expected ${b}, got ${a}`);
const op = (uid, row = 10, col = 4, extra = {}) => ({ uid, chessId: `${uid}_a`, row, col, ...extra });
const device = (key, stage = 0, row = 10, col = 5, uid = key) => ({ uid, kind: 'token', tokenId: `token_rhine_${key}`, key, row, col, stage });
const player = (playerId, units, { count = 9, layers = 0, ...extra } = {}) => ({
  playerId, units, seat: playerId === 'p1' ? 0 : 1, side: 'L', colOffset: 0,
  bonds: { rhineShip: { count, layers, active: true } },
  research: { active: true, devices: units.filter((u) => RHINE_DEVICES.some((d) => d.tokenId === u.tokenId)).map((u) => ({ ...u, onBoard: true })) }, ...extra,
});
function arena(players, extra = {}) {
  const chess = {}, kits = {};
  for (const p of players) for (const u of p.units) if (u.kind !== 'token') {
    chess[u.chessId] = chessRec({ id: u.chessId, charId: u.charId ?? 'test', stats: { atk: 100, maxHp: 2000, blockCnt: 0 }, skill: u.cast ? {} : null });
    chess[u.chessId].garrisonIds = u.charId === C.mayer ? ['garrison_rhine_mayer_a'] : [];
    kits[u.chessId] = () => ({ trait: { noAttack: true }, skill: u.cast ? { kind: 'instant', trigger: { rule: 'NEVER' } } : null });
  }
  const tokens = Object.fromEntries(RHINE_DEVICES.map((d) => [d.tokenId, { name: d.name, stats: { maxHp: 100, atk: 1, blockCnt: 0 } }]));
  const h = makeBattle({ players, defs: { chess, tokens, enemies: {
    dummy: enemyRec({ key: 'dummy', hp: 1000000, speed: 0 }),
    small: enemyRec({ key: 'small', hp: 10000, speed: 0 }),
    resistant: enemyRec({ key: 'resistant', hp: 1000000, speed: 0, res: 50 }),
  } }, kits, captureNoisy: true, hooks: ['heal', 'healResolved', 'damaged', 'layerGain'], ...extra });
  h.step();
  return h;
}
const cast = (h, uid) => assert.equal(h.unit(uid).skill.activate('test', { free: true }), true);
const layers = (h) => h.b.getPlayer('p1').bonds.rhineShip.layers;
const shield = (h, target = 'patient', source = 'medical') => h.unit(target).findBuff(`rhine:overheal:${h.unit(source).id}`)?.shield ?? 0;
const valid = (h) => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

test('Rhine shield observes final adjusted treatment after every heal hook and never enters the heal hook early', () => {
  const h = arena([player('p1', [op('healer', 10, 4), op('patient', 11, 5), device('medical', 1)])]);
  const healer = h.unit('healer'), patient = h.unit('patient'); patient.hp = 1900;
  h.b.addBuff(healer, { key: 'test:out', mods: { healingDealtMul: 2 } });
  h.b.addBuff(patient, { key: 'test:in', mods: { healingTakenMul: 1.5 } });
  h.b.on('heal', (ctx) => { assert.equal(shield(h), 0); ctx.amount += 40; });
  h.b.on('heal', (ctx) => { assert.equal(shield(h), 0); ctx.amount *= .5; }, { priority: -1000000 });
  close(h.b.heal(healer, patient, 100), 100);
  close(patient.hp, 2000); close(healer.stats.heal, 100);
  close(shield(h), 170 * .25 + 70 * .5);
  const resolved = h.hooksOf('healResolved').at(-1);
  close(resolved.amount, 170); close(resolved.actual, 100); close(resolved.overheal, 70);
  valid(h);
});

test('Rhine shield accepts real own, allied, self, sourceless and summon treatments while remaining owner/operator scoped', () => {
  const h = arena([player('p1', [op('healer', 10, 4), op('patient', 11, 5), device('medical', 1)]),
    player('p2', [op('foreign', 10, 7)])]);
  const patient = h.unit('patient');
  const summon = h.b.spawnToken(h.unit('healer'), 'test_healer_token', 9, 5, {
    def: { stats: { maxHp: 100, atk: 10, blockCnt: 0 } }, kit: { trait: { noAttack: true } },
  });
  assert.ok(summon);
  for (const source of [h.unit('healer'), h.unit('foreign'), patient, null, summon]) {
    patient.hp = 1950;
    close(h.b.heal(source, patient, 100), 50);
  }
  close(shield(h), 5 * (100 * .25 + 50 * .5));
  h.unit('foreign').hp = 1950; h.b.heal(h.unit('healer'), h.unit('foreign'), 100);
  assert.equal(h.unit('foreign').s.shield, 0);
  summon.hp = 50; h.b.heal(h.unit('medical'), summon, 100);
  assert.equal(summon.s.shield, 0);
  valid(h);
});

test('Rhine shield honors full-HP valid heals, excludes regen, forbidden and zeroed heals, and expires after six seconds', () => {
  const h = arena([player('p1', [op('healer', 10, 4), op('patient', 11, 5), device('medical', 1)])]);
  const healer = h.unit('healer'), patient = h.unit('patient');
  close(h.b.heal(healer, patient, 100), 0); close(shield(h), 75);
  patient.hp = 1000;
  close(h.b.heal(healer, patient, 100, { regen: true }), 100); close(shield(h), 75);
  h.b.addBuff(patient, { key: 'test:ban', flags: { healFree: true } });
  close(h.b.heal(healer, patient, 100), 0); close(shield(h), 75);
  close(h.b.heal(patient, patient, 100, { self: true, ignoreHealFree: true }), 100); close(shield(h), 75);
  h.b.removeBuff(patient, 'test:ban');
  h.b.addBuff(patient, { key: 'test:noHeal', flags: { noHeal: true } });
  close(h.b.heal(healer, patient, 100), 0); close(shield(h), 75);
  h.b.removeBuff(patient, 'test:noHeal');
  const cancelled = h.b.on('heal', (ctx) => { ctx.amount = 0; });
  close(h.b.heal(healer, patient, 100), 0); close(shield(h), 75); h.b.off(cancelled);
  h.b.getPlayer('p1').input.research.active = false; h.run(6.1); close(shield(h), 0);
  valid(h);
});

test('Rhine shield uses final treatment instead of device A, caps each source at 40% max HP, and shares Mayer work cooldown', () => {
  const h = arena([player('p1', [op('m', 10, 4, { charId: C.mayer }), op('patient', 11, 5), device('medical', 1)])]);
  const gainTimes = [];
  h.b.on('layerGain', () => gainTimes.push(h.b.time));
  const patient = h.unit('patient'); patient.hp = 1000;
  close(h.b.heal(null, patient, 40), 40); close(shield(h), 10); close(layers(h), 1);
  h.b.heal(null, patient, 40); close(shield(h), 20); close(layers(h), 1);
  h.spawn('dummy', { pos: [10, 6] });
  h.run(3.1); close(layers(h), 2);
  for (let i = 0; i < 20; i++) h.b.heal(null, patient, 1000);
  close(shield(h), 800); close(layers(h), 2);
  for (let i = 1; i < gainTimes.length; i++) assert.ok(gainTimes[i] - gainTimes[i - 1] >= 3 - 1e-6);
  valid(h);
});

test('Rhine shield ignores actual engine HP-regeneration ticks, including forbidden-healing targets', () => {
  const h = arena([player('p1', [op('patient', 11, 5), device('medical', 1)])]);
  const patient = h.unit('patient'); patient.hp = 1000;
  h.b.addBuff(patient, { key: 'test:regen', mods: { hpRegen: 100 }, flags: { healFree: true }, persist: true });
  h.run(2); close(patient.hp, 1200); close(shield(h), 0);
  const ticks = h.hooksOf('healResolved').filter((c) => c.target === patient);
  assert.ok(ticks.length > 0); assert.ok(ticks.every((c) => c.opts.regen));
  h.b.removeBuff(patient, 'test:regen'); patient.hp = 1000;
  h.b.addBuff(patient, { key: 'test:regen2', mods: { hpRegen: 100 }, persist: true });
  h.run(.5); close(patient.hp, 1050); close(shield(h), 0); valid(h);
});

test('Rhine upgraded medical shield follows its two/three-cell radius and excludes isolated or hidden operators', () => {
  for (const stage of [1, 2]) {
    const h = arena([player('p1', [op('patient', 10, 8), device('medical', stage)])]);
    const patient = h.unit('patient'); patient.hp = 1000;
    h.b.heal(null, patient, 100); close(shield(h), stage === 2 ? 25 : 0);
    h.b.addBuff(patient, { key: 'test:isolation', flags: { isolated: true } });
    h.b.heal(null, patient, 100); close(shield(h), stage === 2 ? 25 : 0);
    h.b.removeBuff(patient, 'test:isolation'); patient.hidden = true;
    h.b.heal(null, patient, 100); close(shield(h), stage === 2 ? 25 : 0); patient.hidden = false;
    valid(h);
  }
});

test('Rhine laser Mayer research advances once per three effective attack seconds and pauses without losing the lock', () => {
  const h = arena([player('p1', [op('m', 10, 4, { charId: C.mayer }), device('laser')])]);
  const target = h.spawn('dummy', { pos: [10, 10] });
  h.run(2.9); close(layers(h), 0); target.hidden = true; h.run(5); close(layers(h), 0);
  target.hidden = false; h.run(.35); close(layers(h), 1);
  h.run(3); close(layers(h), 2); valid(h);
});

test('Rhine medical stages heal 1/2/3 at 75/75/100% A; stage-one range shield chooses less same-device shield on equal HP ratios', () => {
  for (const stage of [0, 1, 2]) {
    const h = arena([player('p1', [op('a', 10, 4), op('b', 11, 5), op('c', 10, 6), device('medical', stage)])]);
    for (const uid of ['a', 'b', 'c']) h.unit(uid).hp = 500;
    h.run(3.05);
    assert.equal(['a', 'b', 'c'].filter((uid) => h.unit(uid).hp > 500).length, stage + 1);
    for (const uid of ['a', 'b', 'c']) if (h.unit(uid).hp > 500) close(h.unit(uid).hp, 500 + [225, 225, 300][stage]);
    valid(h);
  }
  const h = arena([player('p1', [op('a', 10, 4), op('b', 11, 5), op('c', 10, 6), device('medical', 1)])]);
  for (const uid of ['a', 'b', 'c']) h.unit(uid).hp = 500;
  h.b.addBuff(h.unit('a'), { key: `rhine:overheal:${h.unit('medical').id}`, shield: 100, duration: 6 });
  h.run(3.05); close(h.unit('a').hp, 500); close(h.unit('b').hp, 725); close(h.unit('c').hp, 725);
  valid(h);
});

test('Rhine medical treats real mechanical otters while the all-source shield only covers operators', () => {
  const h = arena([player('p1', [op('healer', 10, 4), op('patient', 11, 5), device('medical', 1)])]);
  const otter = h.b.spawnToken(h.unit('healer'), OTTER, 9, 5, { kit: otterKit() });
  assert.ok(otter); otter.hp = 10;
  close(h.b.heal(h.unit('healer'), otter, 100), 0);
  const before = otter.hp; h.run(3.05); close(otter.hp, before + 225); close(otter.s.shield, 0);
  assert.ok(shield(h, 'healer') > 0); valid(h);
});

test('Rhine energy stage zero emits over every device-range tile and retains the explicitly confirmed three-charge cost', () => {
  const h = arena([player('p1', [op('a', 10, 4, { cast: true }), op('b', 11, 5, { cast: true }),
    op('c', 9, 5, { cast: true }), device('energy')])]);
  const primary = h.spawn('dummy', { pos: [10, 4] }), opposite = h.spawn('dummy', { pos: [10, 7] });
  const outside = h.spawn('dummy', { pos: [12, 7] });
  cast(h, 'a'); cast(h, 'b'); close(primary.hp, primary.s.maxHp); assert.equal(h.unit('energy').researchCharges, 2);
  cast(h, 'c'); close(primary.s.maxHp - primary.hp, 540); close(opposite.s.maxHp - opposite.hp, 540);
  close(outside.hp, outside.s.maxHp); assert.equal(h.unit('energy').researchCharges, 0); valid(h);
});

test('Rhine energy stage one reaches radius three and limits separately charged pulses to 1.5 seconds', () => {
  const h = arena([player('p1', [...['a', 'b', 'c', 'd', 'e', 'f'].map((uid, i) => op(uid, 9 + Math.floor(i / 3), 2 + i % 3, { cast: true })), device('energy', 1)])]);
  const target = h.spawn('dummy', { pos: [10, 8] });
  for (const uid of ['a', 'b', 'c']) cast(h, uid); close(target.s.maxHp - target.hp, 720);
  for (const uid of ['d', 'e', 'f']) cast(h, uid); close(target.s.maxHp - target.hp, 720); assert.equal(h.unit('energy').researchCharges, 3);
  h.run(1.4); close(target.s.maxHp - target.hp, 720);
  h.run(.15); close(target.s.maxHp - target.hp, 1440); valid(h);
});

test('Rhine laser requires nine members, clamps its stage, selects max panel HP, and holds its lock through temporary exclusions', () => {
  const gated = arena([player('p1', [device('laser', 2)], { count: 8 })]);
  const forbidden = gated.spawn('dummy', { pos: [10, 6] }); gated.run(2); close(forbidden.hp, forbidden.s.maxHp); valid(gated);
  const h = arena([player('p1', [device('laser', 2)])]);
  const small = h.spawn('small', { pos: [10, 6] }), target = h.spawn('small', { pos: [9, 10] });
  h.b.addBuff(target, { key: 'test:maxHp', mods: { hpPct: 1 } });
  h.run(1); assert.equal(h.unit('laser').researchStage, 0); assert.equal(h.unit('laser').researchLaserTarget, target.id);
  close(small.hp, small.s.maxHp);
  const newcomer = h.spawn('dummy', { pos: [11, 10] }); h.run(.5); assert.equal(h.unit('laser').researchLaserTarget, target.id);
  for (const flag of ['hidden', 'untargetable', 'invulnerable', 'stealth']) {
    const beforeHp = target.hp, beforeProgress = h.unit('laser').researchLaserProgress;
    if (flag === 'hidden') target.hidden = true;
    else h.b.addBuff(target, { key: 'test:pause', flags: { [flag]: true } });
    h.run(1); close(target.hp, beforeHp); close(h.unit('laser').researchLaserProgress, beforeProgress);
    assert.equal(h.unit('laser').researchLaserTarget, target.id); assert.equal(h.unit('laser').researchLaserActive, false);
    if (flag === 'hidden') target.hidden = false; else h.b.removeBuff(target, 'test:pause');
    h.run(.3); assert.ok(target.hp < beforeHp); assert.equal(h.unit('laser').researchLaserTarget, target.id);
  }
  h.b.kill(target); h.run(.3); assert.equal(h.unit('laser').researchLaserTarget, newcomer.id);
  assert.ok(h.unit('laser').researchLaserProgress <= .5); valid(h);
});

test('Rhine laser ignores attack-speed/ATK buffs and penetration, ramps additively, and adds its first true hit only after 21 effective seconds', () => {
  const h = arena([player('p1', [device('laser')])]); const target = h.spawn('resistant', { pos: [10, 9] });
  h.b.addBuff(h.unit('laser'), { key: 'test:power', mods: { atkFlat: 10000, atkPct: 3, aspd: 1000, resIgnorePct: 1, resIgnoreFlat: 50 } });
  h.run(1); close(target.s.maxHp - target.hp, 225); close(h.unit('laser').researchLaserProgress, 1);
  h.run(19); close(h.unit('laser').researchLaserProgress, 20);
  const hits = () => h.hooksOf('damaged').filter((c) => c.source === h.unit('laser'));
  const arts = hits().filter((c) => c.type === 'arts');
  close(arts[0].dmg.amount, 112.5); close(arts.at(-1).dmg.amount, 112.5 * 1.95);
  assert.equal(hits().filter((c) => c.type === 'true').length, 0);
  h.run(.9); assert.equal(hits().filter((c) => c.type === 'true').length, 0);
  h.run(.1); const trueHits = hits().filter((c) => c.type === 'true'); assert.equal(trueHits.length, 1);
  close(trueHits[0].dmg.amount, target.s.maxHp * .005);
  close(hits().filter((c) => c.type === 'arts').at(-1).dmg.amount, 225);
  assert.ok(h.eventsOf('fx').some((e) => e[1] === 'rhineLaser' && e[4].active && e[4].progress === 20));
  valid(h);
});

test('Rhine laser pauses both ramp and mature true-damage timing, and transfers after permanent removal', () => {
  const h = arena([player('p1', [device('laser')])]); const target = h.spawn('dummy', { pos: [10, 10] });
  h.run(20.5); target.hidden = true; const hp = target.hp; h.run(10); close(target.hp, hp);
  assert.equal(h.hooksOf('damaged').filter((c) => c.type === 'true').length, 0);
  target.hidden = false; h.run(.5); assert.equal(h.hooksOf('damaged').filter((c) => c.type === 'true').length, 1);
  const next = h.spawn('small', { pos: [11, 10] }); target.removed = true; h.run(.3);
  assert.equal(h.unit('laser').researchLaserTarget, next.id); assert.ok(h.unit('laser').researchLaserProgress <= .5);
  valid(h);
});

test('each Rhine laser uses the entire shared max HP across several fields and mirror bosses, even as current HP drops', () => {
  const pool = { hp: 6000000, maxHp: 6000000, damage(_pid, amount) { this.hp = Math.max(0, this.hp - amount); } };
  const fields = Array.from({ length: 3 }, (_, i) => arena([player('p1', [device('laser')])], {
    kind: 'boss', sharedBoss: pool, flags: { bossFieldMaxHp: pool.maxHp / 3 }, fieldId: `b${i + 1}`,
  }));
  for (const h of fields) {
    const target = h.spawn('dummy', { pos: [2, 9], tag: 'boss' }); close(target.s.maxHp, pool.maxHp);
    h.spawn('dummy', { pos: [2, 8], tag: 'boss' });
    h.run(20); assert.equal(h.hooksOf('damaged').filter((c) => c.type === 'true').length, 0);
    h.run(1); const trueHits = h.hooksOf('damaged').filter((c) => c.type === 'true');
    assert.equal(trueHits.length, 1); close(trueHits[0].dmg.amount, 30000); valid(h);
  }
  const allTrue = fields.flatMap((h) => h.hooksOf('damaged').filter((c) => c.type === 'true'));
  close(allTrue.reduce((sum, c) => sum + c.dmg.amount, 0), pool.maxHp * .005 * fields.length);
});

test('laser percentage damage reads shared max HP through browser and takeover pools rather than a modified leader panel', () => {
  for(const makePool of [()=>new LocalBossPool(6000000,3000000),()=>new CreditPool(new SharedBossPool(6000000))]) {
    const pool=makePool(),h=arena([player('p1',[device('laser')])],{kind:'boss',sharedBoss:pool,flags:{bossFieldMaxHp:2000000}});
    const target=h.spawn('dummy',{pos:[2,9],tag:'boss'});
    h.b.addBuff(target,{key:'test:leaderHp',mods:{hpPct:1}});
    close(target.s.maxHp,12000000);h.run(21);
    const hits=h.hooksOf('damaged').filter(c=>c.type==='true');
    assert.equal(hits.length,1);close(hits[0].dmg.amount,30000);valid(h);
  }
});
