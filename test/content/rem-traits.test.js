import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { install } from '../../server/sim/content/rem_traits.js';
import { gameData } from '../../server/sim/content/support/index.js';
import { performAttack } from '../../server/sim/ai.js';

function fixture(specs, { round = 1, layers = 0 } = {}) {
  const chess = {}, units = [], kits = {};
  const names = { JACINTA: 'jcinta', MULBERRY: 'glider', WARMY: 'warmy', CLICK: 'tmslot', SAVAGE: 'savage', ASBESTOS: 'asbest', SANDRECKONER: 'thumpy', RAY: 'ray' };
  for (const [i, spec] of specs.entries()) {
    const [key, elite = false] = spec;
    const id = `test_rem_${i}_a`;
    chess[id] = chessRec({ id, golden: elite, rangeGrid: [[0,0],[0,1],[0,2],[1,0],[-1,0]], stats: { atk: 100, maxHp: 1000, blockCnt: 0 } });
    chess[id].garrisonIds = names[key] ? [`garrison_rem_${names[key]}_${elite ? 'b' : 'a'}`] : [];
    units.push({ chessId: id, uid: String(i), row: 10, col: 4 + i, dir: 'RIGHT' });
    kits[id] = () => ({ trait: { noAttack: true }, skill: null });
  }
  const h = makeBattle({ units, defs: { chess, enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, speed: 0 }) } }, kits,
    content: 'none', round, bonds: { remShip: { active: true, count: 3, layers } }, autoFinish: false });
  install(h.b);
  h.step();
  const spawn = (unit, type = 'miner') => h.b.emit('remSpawned', { unit, type, ownerId: unit.ownerId, source: 'test' });
  return { h, spawn, u: i => h.unit(String(i)) };
}
test('Rem Jacinta casts once; Sandreckoner first summons after full interval; both bypass regular cap', () => {
  const { h, u } = fixture([['JACINTA', true], ['SANDRECKONER', true]]);
  const calls = [];
  h.b.remSummon = (...args) => calls.push(args);
  h.b.emit('skillStart', { unit: u(0) });
  assert.deepEqual(calls[0], ['p1', 2, { poolStage: 1, source: 'jacinta', capMode: 'extra' }]);
  h.run(5.8); assert.equal(calls.length, 1);
  h.run(.3); assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['p1', 2, { source: 'sandreckoner', capMode: 'extra' }]);
  assert.deepEqual(h.b.errors, []);
});
test('Rem Mulberry strongest copy regenerates every five seconds from entry, without stacking', () => {
  const { h, spawn, u } = fixture([['MULBERRY'], ['MULBERRY', true], ['NONE']]);
  const unit = u(2); unit.hp = 500; spawn(unit);
  h.run(4.9); assert.equal(unit.hp, 500);
  h.run(.2); assert.equal(unit.hp, 600);
  h.run(5); assert.equal(unit.hp, 700);
  assert.deepEqual(h.b.errors, []);
});
test('Rem passage counts a distinct unit once; armor upgrades to strongest and persists outside adjacency', () => {
  const { h, spawn, u } = fixture([['SAVAGE'], ['ASBESTOS', true], ['NONE']]);
  const unit = u(2); unit.tileC = unit.x = 5; spawn(unit);
  assert.equal(u(0).s.atk, 101);
  assert.equal(unit.s.def, unit.base.def + 40);
  assert.equal(unit.s.res, unit.base.res + 6);
  h.run(.2); assert.equal(u(0).s.atk, 101);
  unit.tileC = unit.x = 9; h.run(.2); assert.equal(unit.s.def, unit.base.def + 40);
  unit.tileC = unit.x = 5; h.run(.2); assert.equal(u(0).s.atk, 101);
  assert.deepEqual(h.b.errors, []);
});
test('Rem Warmy counts each successful reinforcement, caps at 16/32 and resets next round', () => {
  for (const elite of [false, true]) {
    const increment = elite ? 2 : 1, cap = elite ? 32 : 16;
    let layers = 7;
    for (const round of [1, 2]) {
      const { h, spawn } = fixture([['WARMY'], ['WARMY', elite], ['NONE']], { round, layers });
      const total = () => h.b.getPlayer('p1').bonds.remShip.layers;
      const create = () => {
        const unit = h.b.spawnToken('p1', 'token_rem_miner', 11, 3, { def: { stats: { maxHp:1000, atk:0, blockCnt:0 } }, kit: { trait: { noAttack:true } } });
        assert.ok(unit); unit.remType='miner'; return unit;
      };
      for (let i=0;i<17;i++) {
        const unit=create(); spawn(unit);
        assert.equal(total(), layers+Math.min(i+1,16)*increment, `round ${round}, spawn ${i+1}`);
        spawn(unit); spawn({...unit});
        assert.equal(total(), layers+Math.min(i+1,16)*increment, 'same event or cloned replay cannot double-count');
        h.b.retreat(unit, { permanent:true });
      }
      assert.equal(total(), layers+cap);
      layers=total(); assert.deepEqual(h.b.errors, []);
    }
  }
});

test('Rem Warmy ignores failed, unregistered and teammate spawn events', () => {
  const {h,spawn,u}=fixture([['WARMY'],['NONE']]);
  const total=()=>h.b.getPlayer('p1').bonds.remShip.layers;
  h.b.emit('remSpawned',{unit:null,type:'miner',ownerId:'p1'});
  spawn({...u(1),kind:'token',remType:'miner',id:999999});
  const unit=h.b.spawnToken('p1','token_rem_miner',11,3,{def:{stats:{maxHp:1000,atk:0,blockCnt:0}},kit:{trait:{noAttack:true}}});
  unit.remType='miner'; unit.ownerId='p2'; spawn(unit);
  h.b.emit('remSpawned',{unit,type:'miner',ownerId:'p1'});
  assert.equal(total(),0);
  unit.ownerId='p1'; spawn(unit); assert.equal(total(),0, 'replaying a teammate spawn after ownership mutation cannot count');
  h.b.retreat(unit,{permanent:true});
  const own=h.b.spawnToken('p1','token_rem_miner',11,3,{def:{stats:{maxHp:1000,atk:0,blockCnt:0}},kit:{trait:{noAttack:true}}});
  own.remType='miner'; spawn(own); assert.equal(total(),1);
  assert.deepEqual(h.b.errors,[]);
});
test('Rem Ray extras target owned blocked enemies only, omit main target, and S1 stays single transaction', () => {
  const { h, spawn, u } = fixture([['RAY'], ['NONE']]);
  const ray = u(0), ally = u(1); spawn(ally);
  const a = h.spawn('dummy', { pos: [10, 5] });
  const b = h.spawn('dummy', { pos: [10, 6] });
  h.step();
  b.blockedBy = ally;
  const attacks = ray.stats.attacks;
  performAttack(h.b, ray, { ...ray.profile, attack: 'melee', projectile: 'none' }, [a]);
  assert.equal(b.s.maxHp - b.hp, 50);
  assert.equal(ray.stats.attacks, attacks + 1);
  performAttack(h.b, ray, { ...ray.profile, attack: 'melee', tags: ['ray:special'] }, [a]);
  assert.equal(b.s.maxHp - b.hp, 50);
  ally.ownerId = 'other';
  performAttack(h.b, ray, { ...ray.profile, attack: 'melee' }, [a]);
  assert.equal(b.s.maxHp - b.hp, 50);
  assert.deepEqual(h.b.errors, []);
});

test('Rem Ray native S3 retains one bullet and one trance increment while enhancing extra arrows and binding', () => {
  const h = makeBattle({ units: [
    { uid: 1, diy: { slot: 6, charId: 'char_4117_ray', skillIndex: 2, uniEquipId: null }, row: 10, col: 3 },
    { uid: 2, chessId: 'chess_char_3_02_a', row: 10, col: 5 },
  ], defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, speed: 0 }) } }, autoFinish: false, captureNoisy: true });
  const ray = h.unit(1), blocker = h.unit(2);
  ray.def = { ...ray.def, raw: { ...ray.def.raw, garrisonIds: ['garrison_rem_ray_a'] } };
  install(h.b);
  h.step();
  h.b.emit('remSpawned', { unit: blocker, type: 'miner', ownerId: 'p1' });
  const a = h.spawn('dummy', { pos: [10, 5] });
  const b = h.spawn('dummy', { pos: [10, 6] });
  ray.atkCd = 100; h.step(); b.blockedBy = blocker;
  ray.skill.activate('test', { free: true });
  ray.mem.rayFill = false; ray.trait.ammo = 8; ray.atkCd = 0;
  const stacks = ray.mem.rayStacks;
  h.step();
  assert.equal(ray.trait.ammo, 7);
  assert.equal(ray.mem.rayStacks, stacks + 1);
  assert.ok(b.hp < b.s.maxHp);
  assert.ok(b.s.flags.bind);
  assert.equal(h.hooksOf('damaged').filter(c => c.source === ray && c.target === b && c.dmg.tags?.includes('rem:ray')).length, 1);
  assert.ok(a.alive); assert.deepEqual(h.b.errors, []);
});

test('Rem Click guides only nearby owned reinforcements within their range and preserves blocking target', () => {
  const { h, spawn, u } = fixture([['CLICK', true], ['NONE']]);
  const click = u(0), ally = u(1); spawn(ally);
  const first = h.spawn('dummy', { pos: [10, 6] });
  const marked = h.spawn('dummy', { pos: [10, 7] });
  click.mem.remMarkedTarget = marked; h.step();
  assert.equal(ally.s.aspd, 120);
  const ctx = { attacker: ally, targets: [first], profile: ally.profile };
  h.b.emit('beforeAttack', ctx); assert.equal(ctx.targets[0], marked);
  first.blockedBy = ally; ally.blocking.push(first);
  const blocked = { attacker: ally, targets: [first], profile: ally.profile };
  h.b.emit('beforeAttack', blocked); assert.equal(blocked.targets[0], first);
  click.mem.remMarkedTarget = null; h.step(); assert.equal(ally.s.aspd, 100);
  assert.deepEqual(h.b.errors, []);
});

test('Rem actual normal and elite garrison records retain literal trait numbers and install independently', () => {
  const expected = {
    jcinta: [{ count: 1 }, { count: 2 }], glider: [{ interval: 5, heal_ratio: .05 }, { interval: 5, heal_ratio: .1 }],
    warmy: [{ layer: 1, max_layer: 16 }, { layer: 2, max_layer: 32 }],
    tmslot: [{ attack_speed: 10 }, { attack_speed: 20 }],
    savage: [{ atk: .01, max_atk: .3 }, { atk: .02, max_atk: .6 }],
    asbest: [{ def: 20, res: 3 }, { def: 40, res: 6 }],
    thumpy: [{ interval: 12, count: 2 }, { interval: 6, count: 2 }], ray: [{ atk_scale: .5 }, { atk_scale: .7 }],
  };
  for (const [name, values] of Object.entries(expected)) for (const [index, bb] of values.entries()) {
    const id = `garrison_rem_${name}_${index ? 'b' : 'a'}`;
    const g = gameData().garrisons[id];
    assert.deepEqual(g.bb, bb, id);
    const { h } = fixture([[g.effectKey.slice(4), !!index], ['NONE']]);
    h.run(.2); assert.deepEqual(h.b.errors, [], id);
  }
});

test('Warmy shipped language descriptions match current 16/32 source records', async () => {
  const { readFile } = await import('node:fs/promises');
  const { applyRecordOverlay } = await import('../../shared/i18nData.js');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const overlay = JSON.parse(await readFile(new URL(`../../data/i18n/${lang}.json`, import.meta.url), 'utf8'));
    const ui = JSON.parse(await readFile(new URL(`../../public/i18n/${lang}.json`, import.meta.url), 'utf8'));
    for (const [suffix, cap] of [['a', 16], ['b', 32]]) {
      const id = `garrison_rem_warmy_${suffix}`, source = gameData().garrisons[id];
      const record = overlay.files.garrisons[id];
      assert.ok(record, `${lang}: ${id}`);
      assert.equal(applyRecordOverlay(source, record).stale, 0);
      assert.equal(record.desc, ui[source.desc]);
      assert.ok(record.desc.includes(String(cap)));
      assert.equal(record.descRaw, record.desc);
    }
  }
});


test('Warmy counts real generation of all types and sources only after successful landing', async () => {
  const rem = await import('../../server/sim/content/rem.js');
  const {h}=fixture([['WARMY'],['NONE']]); rem.install(h.b);
  const state=h.b.remState.get('p1'); state.gate=[11,3];
  const total=()=>h.b.getPlayer('p1').bonds.remShip.layers;
  const spawnToken=h.b.spawnToken;
  h.b.spawnToken=()=>null;
  assert.equal(h.b.remSummon('p1',1,{source:'jacinta'}),1);
  h.step(); assert.equal(total(),0); assert.equal(state.queue.length,1,'failed creation remains queued');
  h.b.spawnToken=spawnToken;
  h.step(); assert.equal(total(),1); assert.equal(state.queue.length,0);
  h.b.retreat(state.units.at(-1),{permanent:true});
  for(const source of ['regular','jacinta','sandreckoner','bus']) {
    assert.equal(h.b.remSummon('p1',1,{source}),1); h.step();
    h.b.retreat(state.units.at(-1),{permanent:true});
  }
  assert.equal(total(),5,'all accepted summon sources count');
  for(const type of ['child','miner','combined','chef','enthusiast','food','bus','boss']) {
    const previous=total(); state.queue.push({type,source:'test'}); h.step();
    assert.equal(total(),previous+1,type); h.b.retreat(state.units.at(-1),{permanent:true});
  }
  assert.deepEqual(h.b.errors,[]);
});
