import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectiveProfile } from '../../server/sim/ai.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
const C = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url)));
const names = ['jcinta', 'glider', 'aprl', 'warmy', 'tmslot', 'savage', 'asbest', 'thumpy', 'ray'];
function field(name, skillIndex = 1, elite = false, uniEquipId = 'none', others = []) {
  const id = `chess_rem_${name}_${elite ? 'b' : 'a'}`;
  const h = makeBattle({ timeLimit: 180, autoFinish: false, captureNoisy: true,
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, speed: 0, def: 0, res: 0 }) },
      chess: { ally: chessRec({ id: 'ally', hp: 10000, atk: 0 }) } },
    flags: { dpPerSec: 0, dpMax: 999 },
    units: [{ uid: 1, chessId: id, skillIndex, moduleId: uniEquipId, row: 10, col: 5 }, ...others] });
  h.step(); return { h, u: h.unit(1) };
}
function cast(u) { u.skill.charges = Math.max(1, u.skill.maxCharges); u.skill.sp = u.skill.spCost; assert.ok(u.skill.activate()); }
function clean(h) { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); }
for (const name of names) for (const elite of [false, true]) {
  const record = C[`chess_rem_${name}_${elite ? 'b' : 'a'}`];
  for (let index = 0; index < record.skills.length; index++) for (const mod of ['none', ...(elite ? record.modules.map((m) => m.uniEquipId) : [])]) {
    test(`${name} ${elite ? 'elite' : 'normal'} S${index + 1} ${mod}: native skill, deterministic live execution`, () => {
      const { h, u } = field(name, index, elite, mod);
      assert.equal(u.kit.generic, undefined); assert.equal(u.kit.skillSource, 'skills');
      assert.equal(u.skill.id, record.skills[index].skillId);
      h.spawn('dummy', { pos: [10, 5.3] });
      if (!u.skill.active) cast(u);
      h.run(45); clean(h);
      if (!['jcinta', 'glider'].includes(name)) assert.ok(u.stats.dmg > 0);
    });
  }
}
test('四月 S2 camouflage starts on deployment and expires; native cost/redeploy talent applied once', () => {
  const { h, u } = field('aprl');
  assert.ok(u.skill.active); assert.ok(u.s.flags.camou);
  assert.equal(u.base.cost, u.def.stats.cost + C.chess_rem_aprl_a.talents[0].bb.cost);
  assert.equal(u.base.respawnTime, u.def.stats.respawnTime + C.chess_rem_aprl_a.talents[0].bb.respawn_time);
  h.run(u.skill.duration + 1); assert.ok(!u.s.flags.camou); clean(h);
});
test('嘉辛塔 S1 pays exactly 18 DP and cannot attack during skill', () => {
  const { h, u } = field('jcinta', 0); let total = 0;
  h.b.addDp = (owner, value) => { total += value; };
  cast(u); h.spawn('dummy', { pos: [10, 5.3] });
  h.run(u.skill.duration + 0.1); assert.equal(total, 18); clean(h);
});
test('嘉辛塔 S2 fixed healing cadence ignores ASPD and stops under disarm', () => {
  const { h, u } = field('jcinta', 1, false, 'none', [{ uid: 2, chessId: 'ally', row: 10, col: 6 }]);
  const a = h.unit(2); a.hp = 1000; cast(u);
  h.b.addBuff(u, { key: 'speed', mods: { aspd: 1000 } });
  h.run(3); const healed = u.stats.heal;
  assert.ok(healed > 0 && healed <= u.s.atk * 0.15 * 4 + 1e-6);
  h.b.applyStatus(u, 'disarm', { duration: 3 }); h.run(2); assert.equal(u.stats.heal, healed); clean(h);
});
test('时隙 S2 outside-range drone lock triggers immediate shortened overload and clears at end', () => {
  const { h, u } = field('tmslot'); const e = h.spawn('dummy', { pos: [10, 6] }); cast(u); h.run(1);
  assert.equal(u.mem.remMarkedTarget, e); e.x = 10; e.tileC = 10; h.step(2);
  assert.ok(u.mem.tmslotOver); assert.ok(u.skill.timeLeft <= u.skill.duration / 2);
  u.skill.end('manual'); assert.equal(u.mem.remMarkedTarget, null); assert.equal(u.mem.tmslotOver, false); clean(h);
});
test('温米 S2 consumes both charges and extends only charged duration', () => {
  const { h, u } = field('warmy'); cast(u);
  assert.ok(u.mem.warmyCharged); assert.equal(u.skill.charges, 0);
  assert.equal(u.skill.timeLeft, C.chess_rem_warmy_a.skills[1].bb.enhanced_duration); clean(h);
});
test('石棉 S1 absorbs one arts hit, reduces later arts damage, leaves physical hits unchanged', () => {
  const { h, u } = field('asbest', 0); const e = h.spawn('dummy', { pos: [10, 6] }); cast(u);
  const hp = u.hp; h.b.dealDamage(e, u, { amount: 100, type: 'arts', isAttack: true }); assert.equal(u.hp, hp);
  h.b.dealDamage(e, u, { amount: 100, type: 'arts', isAttack: true }); assert.ok(u.hp < hp); assert.equal(u.mem.asbestShield, false); clean(h);
});
test('石棉 S2 is +40% interval and hits flying enemies with a radius-1 projectile', () => {
  const { h, u } = field('asbest'); cast(u);
  assert.ok(Math.abs(u.s.bat - u.base.bat * 1.4) < 1e-9);
  assert.equal(u.skill.spec.attack.canHitFly, true); assert.equal(u.skill.spec.attack.splashRadius, 1);
  assert.equal(u.skill.spec.attack.attack, 'ranged'); clean(h);
});
test('石棉 talent grants SP on normal arts damage including non-attack sources, not splash', () => {
  const { h, u } = field('asbest'); const e = h.spawn('dummy', { pos: [10, 6] });
  u.skill.sp = 0; u.skill.charges = 0;
  h.b.dealDamage(e, u, { amount: 10, type: 'arts', isAttack: false });
  assert.equal(u.skill.sp, C.chess_rem_asbest_a.talents[0].bb.sp);
  const before = u.skill.sp; h.b.dealDamage(e, u, { amount: 10, type: 'arts', isSplash: true });
  assert.equal(u.skill.sp, before); clean(h);
});
test('温米 S1 adds burn gauge from mitigated arts damage; talent activates only within range', () => {
  const { h, u } = field('warmy', 0); const e = h.spawn('dummy', { pos: [10, 6] }); cast(u); h.run(1);
  assert.ok(e.elem.burn > 0);
  const hp = e.hp; h.b.emit('elementBurst', { target: e, element: 'burn' });
  assert.ok(Math.abs((hp - e.hp) - u.s.atk * C.chess_rem_warmy_a.talents[0].bb.ep_damage_scale) < 1e-5);
  e.x = 10; const hp2 = e.hp; h.b.emit('elementBurst', { target: e, element: 'burn' }); assert.equal(e.hp, hp2); clean(h);
});
test('时隙 attack talent and module drone start scale come from the selected form', () => {
  const { h, u } = field('tmslot', 0, true, 'uniequip_002_tmslot'); h.spawn('dummy', { pos: [10, 6] }); h.step(2);
  assert.equal(u.profile.funnel.init, 0.35); assert.equal(u.mem.tmslotDrones[0].scale, 0.35);
  assert.ok(u.s.atk > u.base.atk); clean(h);
});
test('蜜莓 S1 heals two highest elemental gauges and adds delayed elemental recovery', () => {
  const { h, u } = field('glider', 0, false, 'none', [
    { uid: 2, chessId: 'ally', row: 10, col: 6 }, { uid: 3, chessId: 'ally', row: 11, col: 6 }]);
  const a = h.unit(2), b = h.unit(3); a.elem.burn = 900; b.elem.burn = 800;
  cast(u); h.run(0.1);
  assert.ok(a.findBuff(`glider:recovery:${u.id}`)); assert.ok(b.findBuff(`glider:recovery:${u.id}`));
  const value = a.elem.burn; u.atkCd = 10; h.run(1); assert.ok(a.elem.burn < value); clean(h);
});
test('嘉辛塔 native aerial protection ignores ground attacks and applies strongest only', () => {
  const { h, u } = field('jcinta'); const e = h.spawn('dummy', { pos: [10, 6] });
  const hp = u.hp; h.b.dealDamage(e, u, { amount: 100, type: 'arts' }); const ground = hp - u.hp;
  e.motion = 'FLY'; const hp2 = u.hp; h.b.dealDamage(e, u, { amount: 100, type: 'arts' });
  assert.ok(Math.abs((hp2 - u.hp) - ground * (1 - C.chess_rem_jcinta_a.talents[0].bb.damage_resistance)) < 1e-6); clean(h);
});
test('嘉辛塔 BEA-X gives forward operator one block during the skill and cleans on end', () => {
  const { h, u } = field('jcinta', 1, true, 'uniequip_002_jcinta', [{ uid: 2, chessId: 'ally', row: 10, col: 6 }]);
  const a = h.unit(2), base = a.s.blockCnt; cast(u); h.step(2);
  assert.equal(a.s.blockCnt, base + 1); u.skill.end('manual'); assert.equal(a.s.blockCnt, base); clean(h);
});
test('四月 MAR-Y grants ASPD only while a ground enemy is within range', () => {
  const { h, u } = field('aprl', 0, true, 'uniequip_002_aprl'); const base = u.s.aspd;
  const e = h.spawn('dummy', { pos: [10, 6] }); h.step(2); assert.equal(u.s.aspd, base + 8);
  e.motion = 'FLY'; h.step(2); assert.equal(u.s.aspd, base); clean(h);
});
test('温米 PRI-X amplifies damage only against an elemental-burst target', () => {
  const { h, u } = field('warmy', 0, true, 'uniequip_002_warmy'); const e = h.spawn('dummy', { pos: [10, 6] });
  const hp = e.hp; h.b.dealDamage(u, e, { amount: 100, type: 'phys' }); assert.equal(hp - e.hp, 100);
  h.b.addBuff(e, { key: 'fakeBurst', flags: { burstLock: true } });
  const hp2 = e.hp; h.b.dealDamage(u, e, { amount: 100, type: 'phys' }); assert.ok(Math.abs(hp2 - e.hp - 110) < 1e-5); clean(h);
});
test('石棉 AST-X retaliates once per enemy attack without recursion', () => {
  const { h, u } = field('asbest', 0, true, 'uniequip_002_asbest'); const e = h.spawn('dummy', { pos: [10, 6] }); cast(u);
  const hp = e.hp; h.b.dealDamage(e, u, { amount: 100, type: 'phys', isAttack: true });
  assert.ok(Math.abs(hp - e.hp - u.s.atk * 0.1) < 1e-5); clean(h);
});
test('蜜莓 native HP aura applies to ranged operators and is removed when source leaves', () => {
  const { h, u } = field('glider', 1, false, 'none', [{ uid: 2, chessId: 'chess_rem_aprl_a', row: 10, col: 6 }]);
  const a = h.unit(2); h.run(0.6); assert.ok(a.findBuff('glider:collective')); assert.ok(a.s.maxHp > a.base.maxHp);
  h.b.kill(u, { source: null }); h.run(0.7); assert.ok(!a.findBuff('glider:collective')); clean(h);
});
test('暴行 山谷 requires two orthogonal high tiles and removes when condition ends', () => {
  const { h, u } = field('savage'); const original = h.b.grid.tile.bind(h.b.grid);
  h.b.grid.tile = (r, c) => ([`${u.tileR - 1},${u.tileC}`, `${u.tileR},${u.tileC + 1}`].includes(`${r},${c}`) ? { ...original(r, c), height: 'HIGH' } : original(r, c));
  h.step(2); assert.ok(u.findBuff('savage:valley')); h.b.grid.tile = original; h.step(2); assert.ok(!u.findBuff('savage:valley')); clean(h);
});
test('时隙 released skill drones continue under disarm while native caster attacks stop', () => {
  const { h, u } = field('tmslot'); h.spawn('dummy', { pos: [10, 6] }); cast(u); h.run(1);
  h.b.applyStatus(u, 'disarm', { duration: 5 }); const attacks = u.stats.attacks, dmg = u.stats.dmg;
  h.run(3); assert.equal(u.stats.attacks, attacks); assert.ok(u.stats.dmg > dmg); clean(h);
});
test('温米 uncharged S2 also discards the partially refilled second charge', () => {
  const { h, u } = field('warmy'); u.skill.charges = 1; u.skill.sp = u.skill.spCost / 2;
  assert.ok(u.skill.activate()); assert.equal(u.mem.warmyCharged, false); assert.equal(u.skill.sp, 0); assert.equal(u.skill.charges, 0); clean(h);
});

for (const elite of [false,true]) for (const skillIndex of [0,1]) {
  test(`石棉 native effective profile and damage: ${elite?'elite':'normal'} S${skillIndex+1}`, () => {
    const id=`chess_rem_asbest_${elite?'b':'a'}`;
    const h=makeBattle({timeLimit:30,autoFinish:false,
      defs:{enemies:{ground:enemyRec({key:'ground',hp:1e7,atk:0,speed:0}),fly:enemyRec({key:'fly',hp:1e7,atk:0,speed:0,motion:'FLY'})}},
      units:[{uid:'asbest',chessId:id,skillIndex,moduleId:'none',row:10,col:5}]});
    h.step(); const u=h.unit('asbest'), ground=h.spawn('ground',{pos:[10,5.2]}), fly=h.spawn('fly',{pos:[10,5.4]});
    const base=effectiveProfile(u);
    assert.equal(base.dmgType,'phys'); assert.equal(base.attack,'melee'); assert.equal(base.canHitFly,false);
    assert.equal(canTargetEnemy(u,fly,base),false);
    const hits=[]; h.b.on('damaged',ctx=>{if(ctx.source===u)hits.push({type:ctx.dmg.type,target:ctx.target});});
    h.b.forceAttack(u,[ground]); h.run(.3);
    assert.ok(hits.some(x=>x.type==='phys'&&x.target===ground),'resting attacks really resolve physical damage');
    cast(u); const active=effectiveProfile(u);
    assert.equal(active.dmgType,'arts'); assert.equal(active.attack,skillIndex===0?'melee':'ranged');
    assert.equal(active.canHitFly,skillIndex===1); assert.equal(canTargetEnemy(u,fly,active),skillIndex===1);
    hits.length=0; h.b.forceAttack(u,[skillIndex===0?ground:fly]); h.run(1);
    assert.ok(hits.some(x=>x.type==='arts'&&x.target===(skillIndex===0?ground:fly)),'active native attack really resolves arts damage on its supported target');
    clean(h);
  });
}
