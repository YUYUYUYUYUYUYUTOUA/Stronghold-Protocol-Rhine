import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import kits from '../../server/sim/content/kits/kazdel.js';
import { skillSpecSource } from '../../server/sim/content/index.js';

const ds = getDefaultSource();
const names = ['odd', 'meteorite', 'paprika', 'hoederer', 'logos', 'wisdel'];
const idOf = (key, elite = false) => `chess_kazdel_${key}_${elite ? 'b' : 'a'}`;
const dummy = enemyRec({ key: 'kazdelDummy', hp: 1e8, def: 0, res: 0, speed: 0 });
const run = (units, extra = {}) => makeBattle({ units, kits, defs: { enemies: { kazdelDummy: dummy } }, autoFinish: false, hooks: ['damaged', 'heal', 'skillStart'], captureNoisy: true, ...extra });
const done = h => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };

test('Kazdel preset native kits author every skill and selectable ordinary module in both forms', () => {
  for (const key of names) for (const elite of [false, true]) {
    const id = idOf(key, elite), raw = ds.rawChess(id);
    assert.ok(raw.skills.length >= 2, id);
    for (const sk of raw.skills) for (const moduleId of ['none', ...(raw.modules ?? []).map(m => m.uniEquipId)]) {
      const def = ds.getChess(id, { skillIndex: sk.index, moduleId });
      assert.equal(skillSpecSource(def, kits), 'skills', `${id}: ${sk.skillId}`);
      const h = run([{ chessId: id, row: 10, col: 4, skillIndex: sk.index, moduleId }]);
      h.step();
      const u = h.unit(id);
      assert.equal(u.skill.id, sk.skillId);
      assert.equal(u.kit.skillSource, 'skills');
      done(h);
    }
  }
});

test('Odda S2 lifts only secondary splash victims whose mass is at most 3', () => {
  const id = idOf('odd'), h = run([{ chessId: id, row: 10, col: 4, skillIndex: 1 }]);
  const u = h.unit(id); h.step();
  const primary = h.spawn('kazdelDummy', { pos: [10, 5] });
  const light = h.spawn('kazdelDummy', { pos: [10, 5.4] });
  const heavy = h.spawn('kazdelDummy', { pos: [10, 5.5] });
  heavy.base.massLevel = 4; heavy.markDirty();
  u.skill.gainSp(999, 'test'); u.skill.activate('test');
  h.b.forceAttack(u, [primary]);
  assert.equal(!!primary.findBuff('levitate'), false);
  assert.ok(light.findBuff('levitate'));
  assert.equal(!!heavy.findBuff('levitate'), false);
  done(h);
});

test('Meteorite S2 debuffs every enemy in the shell area and deals physical damage', () => {
  const id = idOf('meteorite'), h = run([{ chessId: id, row: 10, col: 4, skillIndex: 1 }]);
  const u = h.unit(id); h.step();
  const e = h.spawn('kazdelDummy', { pos: [10, 5] });
  h.step();
  u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
  assert.ok(e.findBuff('meteo:def'));
  assert.ok(e.hp < e.s.maxHp);
  assert.ok(h.hooksOf('damaged').some(c => c.source === u && c.dmg.tags.includes('meteo:shell')));
  done(h);
});

test('Meteorite critical shell retains its bonus across projectile flight and splash victims', () => {
  const id = idOf('meteorite'), raw = structuredClone(ds.rawChess(id));
  raw.talents = [{ index: 0, bb: { prob: 1, atk: 0.6 } }]; raw.garrisonIds = [];
  const h = run([{ chessId: id, row: 10, col: 4, skillIndex: 0 }], { defs: { chess: { [id]: raw }, enemies: { kazdelDummy: dummy } } });
  h.step(); const u = h.unit(id); u.skill.sp = 0;
  const a = h.spawn('kazdelDummy', { pos: [10, 5] }), b = h.spawn('kazdelDummy', { pos: [10, 5.3] });
  h.b.addBuff(u, { key: 'externalAttack', mods: { atkPct: 1 }, persist: true });
  const expected = u.s.atk * 1.6;
  h.b.forceAttack(u, [a]); h.run(.7);
  const hits = h.hooksOf('damaged').filter(c => c.source === u && c.dmg.isAttack);
  assert.ok(hits.some(c => c.target === a)); assert.ok(hits.some(c => c.target === b));
  for (const c of hits) assert.ok(Math.abs(c.amount - expected) < 1e-6, `${c.amount} vs ${expected}`);
  done(h);
});

test('Paprika S2 adds one chain target, changes low-HP threshold and restores the profile on ending', () => {
  const id = idOf('paprika'), patient = chessRec({ id: 'patient', hp: 10000, skill: null });
  const h = run([{ chessId: id, row: 10, col: 4, skillIndex: 1 }, { chessId: 'patient', row: 10, col: 5 }], { defs: { chess: { patient }, enemies: {} } });
  h.step(); const u = h.unit(id), a = h.unit('patient'); a.hp = a.s.maxHp * .5;
  const before = u.profile.heal.count;
  u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
  assert.equal(u.profile.heal.count, before + 1);
  const start = a.hp, amount = 100;
  h.b.heal(u, a, amount);
  assert.ok(a.hp - start > amount, 'S2 expands the talent to allies at 50% HP');
  u.skill.end('test'); assert.equal(u.profile.heal.count, before);
  done(h);
});
