import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource, loadoutRecord, resolveLoadout } from '../../server/sim/simdata.js';
import { RHINE_ASSAULT_KITS as kits } from '../../server/sim/content/kits/rhineAssault.js';

const ds = getDefaultSource();
const cid = (name, gold = true) => `chess_rhine_${name}_${gold ? 'b' : 'a'}`;
const close = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const dummy = (key = 'e', extra = {}) => enemyRec({ key, hp: 1e7, speed: 0, atk: 0, ...extra });
function run(name, { gold = true, skill = 2, module = 'none', record = null, enemies = [], enemyDefs = {}, setup } = {}) {
  const id = cid(name, gold), raw = structuredClone(record ?? ds.rawChess(id));
  raw.bonds = []; raw.garrisonIds = [];
  return makeBattle({ autoFinish: false, timeLimit: 200, seed: 11, captureNoisy: true, kits,
    defs: { chess: { [id]: raw }, enemies: { e: dummy(), ...enemyDefs } },
    units: [{ chessId: id, uid: 'operator', row: 10, col: 4, skillIndex: skill, moduleId: module }],
    enemies, setup });
}
function ready(h) {
  h.run(0.1); const u = h.unit('operator'); u.skill.rule = 'NEVER'; u.atkCd = 1000; return u;
}
function cast(u) { assert.equal(u.skill.activate('test', { free: true }), true); }
function done(h) { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); }
function enemy(h, pos = [10, 5], key = 'e') { return h.spawn(key, { pos }); }
function advancedRecord(name, module, patch) {
  const c = ds.rawChess(cid(name)), resolved = structuredClone(loadoutRecord(c, resolveLoadout(c, { moduleId: module })));
  // A synthetic upgraded record tests the same blackboard contract without changing the game's tier-V Lv1 cap.
  delete resolved.modules; delete resolved.statsBase; delete resolved.traitBase; delete resolved.talentsBase;
  resolved.status.equipLevel = 0; patch(resolved); return resolved;
}

test('Ifrit resistance aura respects hidden/untargetable enemies and stealth until reveal or blocking', () => {
  const h = run('ifrit', { skill: 0, enemyDefs: { e: dummy('e', { res: 50 }) } }), u = ready(h);
  const concealed = enemy(h, [10, 5]), untargetable = enemy(h, [10, 6]), hidden = enemy(h, [10, 7]);
  h.b.addBuff(concealed, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  h.b.addBuff(untargetable, { key: 'test:untargetable', flags: { untargetable: true }, persist: true });
  hidden.hidden = true;
  h.run(0.2);
  for (const e of [concealed, untargetable, hidden]) close(e.s.res, 50);
  h.b.addBuff(concealed, { key: 'test:reveal', flags: { reveal: true }, persist: true });
  h.run(0.2); assert.ok(concealed.s.res < 50);
  h.b.removeBuff(concealed, 'test:reveal'); h.run(0.2); close(concealed.s.res, 50);
  h.b.addBuff(u, { key: 'test:block', mods: { blockCnt: 1 }, persist: true });
  concealed.x = u.x; concealed.y = u.y; h.b._checkBlock(concealed);
  assert.equal(concealed.blockedBy, u); h.run(0.2); assert.ok(concealed.s.res < 50);
  done(h);
});

test('all real normal / elite skills and modules use authored specs and preserve the selected loadout', () => {
  let choices = 0;
  for (const name of ['eunectes', 'ifrit']) for (const gold of [false, true]) {
    const raw = ds.rawChess(cid(name, gold));
    assert.equal(raw.skills.length, 3);
    for (const s of raw.skills) for (const module of ['none', ...(gold ? raw.modules.map(m => m.uniEquipId) : [])]) {
      const h = run(name, { gold, skill: s.index, module }), u = ready(h);
      assert.equal(u.skill.id, s.skillId); assert.equal(u.kit.skillSource, 'skills');
      assert.equal(u.def.loadout.moduleId, gold ? module : null);
      if (u.skill.kind !== 'passive') cast(u);
      enemy(h); h.run(1.2); done(h); choices++;
    }
  }
  assert.equal(choices, 24);
});

test('Eunectes S1 is passive ATK / DEF; high-HP talent changes actual attack damage', () => {
  for (const gold of [false, true]) {
    const h = run('eunectes', { gold, skill: 0 }), u = ready(h), bb = u.skill.bb;
    assert.equal(u.skill.kind, 'passive'); close(u.s.atk, u.base.atk * (1 + bb.atk));
    close(u.s.def, u.base.def * (1 + bb.def));
    const e = enemy(h), before = e.hp; h.b.forceAttack(u, [e]);
    close(before - e.hp, u.s.atk * 1.15, 'healthy talent');
    u.hp = u.s.maxHp * 0.5; h.run(0.1);
    const low = e.hp; h.b.forceAttack(u, [e]); close(low - e.hp, u.s.atk, 'low HP attack');
    done(h);
  }
});

test('Eunectes S2 raises ATK, lengthens interval by 0.4 s and continuously stuns newly blocked enemies', () => {
  const h = run('eunectes', { skill: 1 }), u = ready(h);
  cast(u); close(u.s.atk, u.base.atk * 2.3); close(u.s.interval, u.base.bat + 0.4);
  const e = enemy(h, [10, 4]); h.run(0.2);
  assert.equal(e.blockedBy, u); assert.ok(e.s.flags.stun);
  h.run(1.1); assert.ok(e.s.flags.stun);
  u.skill.end('test'); h.run(0.2); assert.ok(!e.s.flags.stun); assert.ok(!u.s.flags.stun);
  close(u.s.atk, u.base.atk); done(h);
});

test('Eunectes S2 respects enemy stun immunity', () => {
  const h = run('eunectes', { skill: 1, enemyDefs: { immune: dummy('immune', { immunities: { stun: true } }) } });
  const u = ready(h); cast(u); const e = enemy(h, [10, 4], 'immune'); h.run(0.5);
  assert.equal(e.blockedBy, u); assert.ok(!e.s.flags.stun); done(h);
});

test('Eunectes S3 gives three blocks, regeneration, ATK / DEF, then five-second self stun', () => {
  const h = run('eunectes'), u = ready(h); cast(u);
  close(u.s.atk, u.base.atk * 2.7); close(u.s.def, u.base.def * 2.2); assert.equal(u.s.blockCnt, 3);
  u.hp = u.s.maxHp * 0.2; const hp = u.hp; h.run(1); close(u.hp - hp, u.s.maxHp * 0.03);
  u.skill.end('test'); assert.ok(u.s.flags.stun); assert.equal(u.s.blockCnt, 1);
  h.run(5.1); assert.ok(!u.s.flags.stun); done(h);
});

for (const [module, rate, gift] of [['none', 0, 0], ['uniequip_002_zumama', 0.2, 3],
  ['uniequip_003_zumama', 0.001, 3]]) {
  test(`Eunectes ${module}: unblocked natural SP / external SP and full recovery while blocking`, () => {
    const h = run('eunectes', { module }), u = ready(h);
    u.skill.sp = 0; u.skill.charges = 0; h.run(2); close(u.skill.sp, rate * 2);
    const before = u.skill.sp; u.skill.gainSp(3, 'gift'); close(u.skill.sp - before, gift);
    enemy(h, [10, 4]); h.run(0.2); assert.ok(u.blocking.length); close(u.s.spRecovery, 1.2);
    const blocked = u.skill.sp; h.run(1); close(u.skill.sp - blocked, 1.2);
    if (module === 'uniequip_003_zumama') { close(u.s.atk, u.base.atk * 1.15); close(u.s.def, u.base.def * 1.15); }
    else { close(u.s.atk, u.base.atk); close(u.s.def, u.base.def); }
    done(h);
  });
}

test('Eunectes advanced X/Y blackboards upgrade blocking recovery and high/low HP talent without affecting true damage', () => {
  const x = advancedRecord('eunectes', 'uniequip_002_zumama', r => { r.talents[1].bb.sp_recovery_per_sec = 0.55; });
  const hx = run('eunectes', { record: x }), ux = ready(hx); enemy(hx, [10, 4]); hx.run(0.2);
  close(ux.s.spRecovery, 1.55); done(hx);
  const y = advancedRecord('eunectes', 'uniequip_003_zumama', r => {
    Object.assign(r.talents[0].bb, { atk_scale: 1.23, damage_resistance: 0.28 });
  });
  const h = run('eunectes', { record: y }), u = ready(h), e = enemy(h);
  const hp = e.hp; h.b.forceAttack(u, [e]); close(hp - e.hp, u.s.atk * 1.23);
  u.hp = u.s.maxHp * 0.5; h.run(0.1);
  close(u.s.physTakenMul, 0.72); close(u.s.artsTakenMul, 0.72); close(u.s.trueTakenMul, 1);
  const hp2 = u.hp; h.b.dealDamage(e, u, { type: 'true', amount: 100 }); close(hp2 - u.hp, 100); done(h);
});

test('Ifrit S1 increases ATK and ASPD while attacking the whole straight line including flyers', () => {
  const h = run('ifrit', { skill: 0, enemyDefs: { fly: dummy('fly', { motion: 'FLY' }) } }), u = ready(h);
  const a = enemy(h, [10, 5]), b = enemy(h, [10, 7]), flyer = enemy(h, [10, 6], 'fly'), off = enemy(h, [11, 5]);
  h.run(0.1); // Battle rebuilds its target index each tick after enemy movement / spawning.
  cast(u); close(u.s.atk, u.base.atk * 1.2); assert.equal(u.s.aspd, u.base.aspd + 67);
  h.b.forceAttack(u); assert.ok(a.hp < a.s.maxHp && b.hp < b.s.maxHp && flyer.hp < flyer.s.maxHp);
  close(off.hp, off.s.maxHp); done(h);
});

test('Ifrit S2 charges three times, applies DEF reduction to every target and burns three times after leaving', () => {
  const h = run('ifrit', { skill: 1, enemyDefs: { e: dummy('e', { def: 500 }) } }), u = ready(h);
  const a = enemy(h, [10, 5]), b = enemy(h, [10, 7]); h.run(0.1); u.skill.gainSp(999, 'test'); assert.equal(u.skill.charges, 3);
  assert.ok(u.skill.activate('test')); const before = a.hp; h.b.forceAttack(u);
  close(before - a.hp, u.s.atk * 1.9); assert.equal(u.skill.charges, 2);
  assert.equal(a.s.def, 300); assert.equal(b.s.def, 300);
  h.b.retreat(u, { reason: 'test', permanent: true }); const atk = u.s.atk;
  h.run(3.1); const ticks = h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritScorch'));
  assert.equal(ticks.length, 6); ticks.forEach(c => close(c.amount, atk * 0.33));
  assert.equal(a.s.def, 500); assert.equal(b.s.def, 500); done(h);
});

test('Ifrit S3 targets ground only, loses HP and applies both aura RES multiplier and flat skill reduction', () => {
  const h = run('ifrit', { enemyDefs: { e: dummy('e', { res: 50 }), fly: dummy('fly', { motion: 'FLY', res: 50 }) } });
  const u = ready(h), e = enemy(h), fly = enemy(h, [10, 6], 'fly'); h.run(0.2); close(e.s.res, 30); close(fly.s.res, 30);
  cast(u); const hp = u.hp, enemyHp = e.hp, flyHp = fly.hp; h.run(1);
  close(u.hp, hp - u.s.maxHp * 0.02); close(e.s.res, 24); close(fly.hp, flyHp);
  close(enemyHp - e.hp, u.s.atk * 1.1 * 0.76);
  const burns = h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritBurn')); assert.equal(burns.length, 1);
  assert.equal(burns[0].dmg.isAttack, false); assert.ok(burns[0].dmg.tags.includes('dot')); done(h);
});

test('Ifrit X damage increases continuously with distance (0 / 2 / 4 / beyond) for attacks and burn damage', () => {
  const h = run('ifrit', { module: 'uniequip_002_ifrit' }), u = ready(h);
  for (const [distance, factor] of [[0, 1], [2, 1.05], [4, 1.1], [5, 1.1]]) {
    const e = enemy(h, [10, 4 + distance]);
    for (const tags of [[], ['dot', 'ifritScorch'], ['dot', 'ifritBurn']]) {
      const hp = e.hp; h.b.dealDamage(u, e, { type: 'arts', amount: 100, tags }); close(hp - e.hp, 100 * factor);
    }
  }
  done(h);
});

test('Ifrit S3 is interrupted by hard control, while its last RES debuff expires after one second', () => {
  for (const status of ['stun', 'freeze', 'sleep']) {
    const h = run('ifrit'), u = ready(h), e = enemy(h); h.run(0.1); cast(u); h.run(1);
    assert.ok(e.findBuff(`ifrit:burn:${u.id}`));
    h.b.applyStatus(u, status, { duration: 2, source: e }); assert.equal(u.skill.active, false);
    assert.ok(e.findBuff(`ifrit:burn:${u.id}`), 'last pulse debuff is not removed early');
    const hp = u.hp, n = h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritBurn')).length;
    h.run(1.1); close(u.hp, hp); assert.ok(!e.findBuff(`ifrit:burn:${u.id}`));
    assert.equal(h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritBurn')).length, n); done(h);
  }
});

test('Ifrit X burn persists after retreat but loses the on-field distance bonus', () => {
  const h = run('ifrit', { skill: 1, module: 'uniequip_002_ifrit' }), u = ready(h), e = enemy(h, [10, 8]);
  cast(u); h.b.forceAttack(u, [e]); h.run(1);
  let ticks = h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritScorch'));
  assert.equal(ticks.length, 1); close(ticks[0].amount, u.s.atk * 0.33 * 1.1);
  h.b.retreat(u, { reason: 'test', permanent: true }); h.run(1.1);
  ticks = h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritScorch'));
  close(ticks[1].amount, u.s.atk * 0.33); done(h);
});

test('Ifrit talent returns 2 SP at six seconds; advanced X probabilistic +5 is real and cannot feed active skills', () => {
  const record = advancedRecord('ifrit', 'uniequip_002_ifrit', r => Object.assign(r.talents[1].bb, {
    'ifrit_e_002[dice_sp].prob': 0.3, 'ifrit_e_002[dice_sp].interval': 6, 'ifrit_e_002[dice_sp].sp': 5,
  }));
  for (const success of [false, true]) {
    const h = run('ifrit', { record }), u = ready(h); h.b.rng.chance = p => p === 0.3 && success;
    h.run(6); const gains = h.hooksOf('spGain').filter(c => c.unit === u && c.reason.startsWith('ifrit'));
    assert.equal(gains.reduce((a, c) => a + c.amount, 0), success ? 7 : 2);
    cast(u); const n = gains.length; h.run(6);
    assert.equal(h.hooksOf('spGain').filter(c => c.unit === u && c.reason.startsWith('ifrit')).length, n); done(h);
  }
});

test('Ifrit Delta uses 8% actual arts damage for the real burn gauge, including S2 DOT, and respects shields', () => {
  const h = run('ifrit', { module: 'uniequip_003_ifrit', enemyDefs: { e: dummy('e', { res: 50 }) } }), u = ready(h), e = enemy(h);
  h.run(0.2); close(e.s.res, 30);
  h.b.dealDamage(u, e, { type: 'arts', amount: 1000, tags: ['dot', 'ifritScorch'] }); close(e.elem.burn, 700 * 0.08);
  h.b.addBuff(e, { key: 'shield', shield: 500 });
  h.b.dealDamage(u, e, { type: 'arts', amount: 1000, isAttack: true }); close(e.elem.burn, 900 * 0.08);
  const before = e.elem.burn; h.b.dealDamage(u, e, { type: 'phys', amount: 1000 }); close(e.elem.burn, before);
  h.b.retreat(u, { reason: 'test', permanent: true });
  h.b.dealDamage(u, e, { type: 'arts', amount: 1000, tags: ['dot', 'ifritScorch'] }); close(e.elem.burn, before); done(h);
});

test('Ifrit Delta fills 1000-point gauge and causes a real 7000 elemental burst; Lv1 has no higher-level rider', () => {
  const h = run('ifrit', { module: 'uniequip_003_ifrit' }), u = ready(h), e = enemy(h);
  const hp = e.hp; h.b.dealDamage(u, e, { type: 'arts', amount: 12500, isAttack: true });
  assert.ok(e.findBuff('burnBurst')); close(hp - e.hp, 12500 + 7000);
  assert.equal(h.hooksOf('elementBurst').filter(c => c.target === e).length, 1);
  assert.equal(h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritModuleBurst')).length, 0); done(h);
});

test('Ifrit advanced Delta adds elemental HP damage during burn burst to normal attacks and S3, without gauge recursion', () => {
  const record = advancedRecord('ifrit', 'uniequip_003_ifrit', r => {
    r.talents.push({ index: -1, name: '', hidden: true, fromModule: true, bb: { element_atk_scale: 0.5 } });
  });
  const h = run('ifrit', { record }), u = ready(h), e = enemy(h);
  h.b.dealDamage(u, e, { type: 'element', element: 'burn', amount: 1000 });
  h.b.dealDamage(u, e, { type: 'arts', amount: 100, isAttack: true });
  h.b.dealDamage(u, e, { type: 'arts', amount: 100, tags: ['dot', 'ifritBurn'] });
  h.b.dealDamage(u, e, { type: 'arts', amount: 100, tags: ['dot', 'ifritScorch'] });
  const extra = h.hooksOf('damaged').filter(c => c.dmg?.tags?.includes('ifritModuleBurst'));
  assert.equal(extra.length, 2);
  for (const c of extra) { close(c.amount, u.s.atk * 0.5); assert.equal(c.type, 'elemental'); assert.ok(c.dmg.tags.includes('dot')); }
  assert.equal(h.hooksOf('elementBurst').length, 1); done(h);
});
