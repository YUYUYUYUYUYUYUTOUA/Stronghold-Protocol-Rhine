import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { acquireTargets, effectiveProfile } from '../../server/sim/ai.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { soulBaseline } from '../../server/sim/content/kazdel/souls.js';

const K = 'kazdelShip';
const idOf = elite => `chess_kazdel_logos_${elite ? 'b' : 'a'}`;
const close = (a, b, label = 'value') => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
const present = u => u.alive && u.deployed && !u.removed;
function field({ elite = false, layers = 20, skillIndex = 0, defs = {}, ...opts } = {}) {
  const h = makeBattle({ autoFinish: false, timeLimit: 300, seed: 714,
    hooks: ['attack', 'damaged', 'skillStart'], captureNoisy: true,
    defs: { ...defs, enemies: { logos_dummy: enemyRec({ key: 'logos_dummy', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }), ...defs.enemies } },
    bonds: { [K]: { active: true, count: 3, layers } },
    units: [{ chessId: idOf(elite), uid: 'logos', row: 10, col: 4, skillIndex, moduleId: 'none' }], ...opts });
  h.step();
  const u = h.unit('logos');
  u.skill.setTrigger('NEVER'); u.atkCd = 100;
  return { h, u };
}
function targets(h, n = 4) {
  const foes = Array.from({ length: n }, (_, i) => h.spawn('logos_dummy', { pos: [10, 5 + i * .1] }));
  h.step(); // Refresh Battle's real enemy index before selecting the attack.
  return foes;
}
const done = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

for (const elite of [false, true]) {
  test(`Logos ${elite ? 'elite' : 'ordinary'} living preset gains its existing layer attack and ${elite ? 3 : 2} ordinary targets`, () => {
    const { h, u } = field({ elite }), foes = targets(h), count = elite ? 3 : 2;
    close(u.s.atk, u.base.atk + 20 * (elite ? 2 : 1), 'living layer ATK');
    const chosen = acquireTargets(h.b, u, effectiveProfile(u));
    assert.equal(chosen.length, count);
    assert.ok(h.b.forceAttack(u, chosen)); u.profile.noAttack = true; h.run(2);
    const attack = h.hooksOf('attack').find(e => e.attacker === u);
    assert.equal(attack.targets.length, count, 'an actual ordinary attack carries the expected target list');
    const hit = h.hooksOf('damaged').filter(e => e.source === u && e.dmg.isAttack);
    assert.equal(new Set(hit.map(e => e.target)).size, count, 'the real projectiles hit each selected target');
    assert.ok(chosen.every(e => e.hp < e.s.maxHp));
    assert.equal(foes.length, 4); done(h);
  });
}

for (const elite of [false, true]) {
  const grade = elite ? 'elite' : 'ordinary', k = elite ? 2 : 1, count = elite ? 3 : 2;
  test(`Logos ${grade} refreshes its current owner layers without stacking through hiding and redeployment`, () => {
    const { h, u } = field({ elite }), b = h.b.getPlayer('p1').bonds[K];
    for (const layers of [20, 50, 50, 0, 20]) {
      b.layers = layers; h.step(45);
      close(u.s.atk, u.base.atk + k * layers, 'a refreshed flat layer bonus');
      assert.equal(u.profile.maxTargets, count);
    }
    u.hidden = true; h.step(); close(u.s.atk, u.base.atk, 'hidden body loses its on-field bonus');
    u.hidden = false; h.step(); close(u.s.atk, u.base.atk + 20 * k, 'returning body restores one bonus');
    h.b.retreat(u); close(u.s.atk, u.base.atk, 'withdrawal clears the body bonus');
    assert.equal(u.kazdelSoulUnit, undefined, 'voluntary retreat produces no soul');
    b.layers = 40;
    assert.ok(h.b.redeploy(u, { free: true }));
    close(u.s.atk, u.base.atk + 40 * k, 'redeploy uses the latest layer count immediately');
    assert.equal(u.profile.maxTargets, count); done(h);
  });

  for (const skillIndex of [0, 2]) {
    test(`Logos ${grade} S${skillIndex + 1} uses the layer ATK in actual native skill damage once`, () => {
      const main = [];
      for (const withTrait of [false, true]) {
        const raw = structuredClone(getDefaultSource().rawChess(idOf(elite)));
        if (!withTrait) raw.garrisonIds = [];
        const { h, u } = field({ elite, skillIndex, defs: { chess: { [idOf(elite)]: raw } } });
        const e = targets(h, 1)[0];
        u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
        close(u.s.atk, (u.base.atk + (withTrait ? 20 * k : 0)) * (1 + u.skill.bb.atk), 'active native skill ATK');
        assert.ok(h.b.forceAttack(u, [e])); u.profile.noAttack = true; h.run(2);
        const hits = h.hooksOf('damaged').filter(c => c.source === u && c.target === e && c.dmg.isAttack);
        assert.equal(hits.length, 1, 'one actual attack projectile lands on the target');
        main.push(hits[0].amount);
        done(h);
      }
      // Native T2 adds the same flat arts amount in both fields. The difference
      // therefore isolates the approved layer bonus after the native ATK buff.
      const raw = getDefaultSource().getChess(idOf(elite), { skillIndex, moduleId: 'none' });
      close(main[1] - main[0], 20 * k * (1 + raw.skill.bb.atk), 'actual skill damage difference');
    });
  }

  test(`Logos ${grade} keeps native S2 lock-one and S3 three-target overrides`, () => {
    for (const skillIndex of [1, 2]) {
      const { h, u } = field({ elite, skillIndex }); targets(h);
      u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
      const selected = acquireTargets(h.b, u, effectiveProfile(u));
      assert.equal(selected.length, skillIndex === 2 ? 3 : count);
      assert.ok(h.b.forceAttack(u, selected)); u.profile.noAttack = true; h.run(2);
      const attacks = h.hooksOf('attack').filter(c => c.attacker === u);
      assert.equal(attacks.length, 1);
      const expected = skillIndex === 1 ? 1 : 3;
      assert.equal(attacks[0].targets.length, expected, 'native lock/targeting governs the actual attack');
      const hit = h.hooksOf('damaged').filter(c => c.source === u && c.dmg.isAttack);
      assert.equal(new Set(hit.map(c => c.target)).size, expected, 'real native hits keep the native target count');
      u.skill.end('test'); u.profile.noAttack = false;
      assert.equal(acquireTargets(h.b, u, effectiveProfile(u)).length, count, 'the ordinary target count resumes afterwards');
      done(h);
    }
  });

  test(`Logos ${grade} turns into the unchanged soul, refreshes, returns and dies again without double inheritance`, () => {
    const { h, u } = field({ elite }), bond = h.b.getPlayer('p1').bonds[K];
    // The permanent modifier still belongs to the inherited A0. The new body
    // trait and its native temporary skill must each stay outside that baseline.
    h.b.addBuff(u, { key: 'bond:logos-test', persist: true, mods: { atkFlat: 40, atkPct: .25 } });
    const inherited = (u.base.atk + 40) * 1.25;
    close(soulBaseline(u).atk, inherited, 'body-only trait is excluded while the body is still alive');
    close(u.s.atk, (u.base.atk + 40 + 20 * k) * 1.25, 'the living trait uses the ordinary flat ATK pipeline once');
    u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
    close(soulBaseline(u).atk, inherited, 'temporary native skill is also excluded');
    h.b.kill(u);
    const first = u.kazdelSoulUnit;
    assert.ok(present(first)); assert.equal(first.ownerUnit, u);
    close(first.s.atk, .8 * inherited + (3 + k) * 20, 'unchanged soul ATK at birth');
    assert.equal(first.profile.maxTargets, count);
    for (const layers of [40, 40, 60]) {
      bond.layers = layers; h.step(15);
      close(first.s.atk, .8 * inherited + (3 + k) * layers, 'repeated soul refresh is not cumulative');
    }
    assert.ok(h.b.redeploy(u, { free: true }));
    assert.equal(first.alive, false, 'the successful body return removes the old soul');
    close(u.s.atk, (u.base.atk + 40 + 60 * k) * 1.25, 'returning body gets one current bonus');
    assert.equal(u.profile.maxTargets, count);
    h.b.kill(u);
    const second = u.kazdelSoulUnit;
    assert.ok(present(second)); assert.notEqual(second, first);
    close(second.s.atk, .8 * inherited + (3 + k) * 60, 'second birth still excludes the live-body trait');
    assert.equal(second.profile.maxTargets, count); done(h);
  });
}

test('Logos ordinary multitarget trait needs no activated covenant, while inactive layers grant no ATK', () => {
  const { h, u } = field({ bonds: { [K]: { active: false, count: 1, layers: 20 } } });
  close(u.s.atk, u.base.atk);
  targets(h); assert.equal(acquireTargets(h.b, u, effectiveProfile(u)).length, 2);
  h.b.kill(u); assert.equal(u.kazdelSoulUnit, undefined, 'the trait does not widen inactive soul eligibility');
  done(h);
});

test('same character without the preset trait, DIY Logos, a Logos stand-in and other operators receive no live Logos bonus', () => {
  const ds = getDefaultSource(), preset = structuredClone(ds.rawChess(idOf(false)));
  preset.garrisonIds = [];
  const standId = 'chess_test_logos_standin';
  const stand = { ...structuredClone(preset), chessId: standId, baseId: standId, goldenId: null,
    chessType: 'NORMAL', charId: 'char_230_savage',
    backup: { charId: 'char_4133_logos', skillIndex: 0, uniEquipId: null } };
  const { h, u } = field({ layers: 60, defs: { chess: { [idOf(false)]: preset, [standId]: stand } }, units: [
    { uid: 'logos', chessId: idOf(false), row: 10, col: 4, skillIndex: 0, moduleId: 'none' },
    { uid: 'diy', diy: { slot: 'chess_char_5_diy1_a', charId: 'char_4133_logos', skillIndex: 0, uniEquipId: null }, row: 10, col: 6 },
    { uid: 'stand', chessId: standId, standIn: true, row: 11, col: 4 },
    { uid: 'other', chessId: 'chess_char_1_05_a', row: 11, col: 6 },
  ] });
  assert.equal(u.def.charId, 'char_4133_logos');
  assert.equal(h.unit('diy').def.charId, 'char_4133_logos');
  assert.equal(h.unit('stand').def.charId, 'char_4133_logos');
  assert.equal(h.unit('stand').def.standInFor, 'char_230_savage', 'the real stand-in resolver was used');
  for (const unit of h.allies()) {
    unit.skill.setTrigger('NEVER'); unit.atkCd = 100;
    close(unit.s.atk, unit.base.atk, `${unit.uid} keeps its native ATK`);
    if (unit.def.charId === 'char_4133_logos') assert.equal(unit.profile.maxTargets ?? 1, 1);
  }
  targets(h); assert.equal(acquireTargets(h.b, u, effectiveProfile(u)).length, 1);
  done(h);
});

test('two owners use only their own current layers for living Logos and the resulting soul', () => {
  const { h, u } = field({ kind: 'unite', players: [
    { playerId: 'p1', coords: 'field', bonds: { [K]: { active: true, count: 3, layers: 10 } },
      units: [{ uid: 'logos', chessId: idOf(false), row: 10, col: 4, skillIndex: 0, moduleId: 'none' }] },
    { playerId: 'p2', coords: 'field', bonds: { [K]: { active: true, count: 3, layers: 30 } },
      units: [{ uid: 'logos2', chessId: idOf(true), row: 10, col: 12, skillIndex: 0, moduleId: 'none' }] },
  ] }), other = h.unit('logos2');
  close(u.s.atk, u.base.atk + 10); close(other.s.atk, other.base.atk + 60);
  h.b.getPlayer('p1').bonds[K].layers = 50; h.step();
  close(u.s.atk, u.base.atk + 50); close(other.s.atk, other.base.atk + 60, 'other owner layers are unaffected');
  h.b.kill(u);
  close(u.kazdelSoulUnit.s.atk, .8 * u.base.atk + 4 * 50);
  close(other.s.atk, other.base.atk + 60); done(h);
});
