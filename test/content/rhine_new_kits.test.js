import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
const cid = (name, elite = false) => `chess_rhine_${name}_${elite ? 'b' : 'a'}`;
const enemy = key => enemyRec({ key, hp: 1e8, atk: 0, speed: 0 });
const active = { count: 3, active: true, tier: 1, layers: 0 };
const gain = h => h.result().perPlayer.p1.layerGains;
const close = (a, c) => assert.ok(Math.abs(a - c) < 1e-6, `${a} ≈ ${c}`);
const valid = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };
function run(name, { elite = false, units, bonds = {}, ...opts } = {}) {
  const h = makeBattle({ autoFinish: false, timeLimit: 200, seed: 7, captureNoisy: true,
    hooks: ['damaged', 'trapTriggered', 'skillStart'], bonds,
    defs: { enemies: { e: enemy('e'), fly: enemyRec({ ...enemy('fly'), key: 'fly', hp: 1e8, atk: 0, speed: 0, motion: 'FLY' }) } },
    units: units ?? [{ chessId: cid(name, elite), uid: 'owner', row: 10, col: 4 }], ...opts });
  h.run(0.1); return h;
}
function cast(u) { u.skill.addCharge(1); assert.equal(u.skill.activate('test'), true); }

for (const [name, count, mod] of [['astgenne', 2, 'uniequip_002_halo'], ['magallan', 3, 'uniequip_002_mgllan']]) {
  for (const elite of [false, true]) for (let skillIndex = 0; skillIndex < count; skillIndex++) {
    for (const moduleId of elite ? [mod, 'none'] : [null]) test(`${name}: ${elite ? 'elite' : 'normal'} S${skillIndex + 1} / ${moduleId ?? 'base'} authored kit`, () => {
      const h = run(name, { elite, units: [{ chessId: cid(name, elite), uid: 'owner', row: 10, col: 4, skillIndex, moduleId }] });
      const u = h.unit('owner'); assert.equal(u.kit.skillSource, 'skills'); assert.equal(u.def.loadout.skillIndex, skillIndex);
      assert.equal(u.skill.id, `skchr_${name === 'astgenne' ? 'halo' : 'mgllan'}_${skillIndex + 1}`);
      valid(h);
    });
  }
}

test('Astgenne: chained base attack, two primary chains on S1, and CHA-Y removes chain attenuation', () => {
  for (const elite of [false, true]) {
    const h = run('astgenne', { elite }); const u = h.unit('owner');
    for (const pos of [[10, 5], [10, 6], [11, 5], [11, 6]]) h.spawn('e', { pos });
    const enemies = h.b.enemies; u.atkCd = 999;
    assert.equal(u.profile.chain.count, elite ? 4 : 3);
    cast(u); h.b.forceAttack(u, enemies.slice(0, 2)); h.run(0.4);
    const damage = h.hooksOf('damaged').filter(c => c.source === u);
    assert.equal(damage.length, 8, 'two independent four-enemy chains');
    const amounts = damage.map(c => c.amount);
    if (elite) amounts.forEach(v => close(v, amounts[0]));
    else assert.ok(Math.min(...amounts) < Math.max(...amounts));
    assert.ok(enemies.every(e => e.findBuff('sluggish'))); valid(h);
  }
});

test('Astgenne S2 expands range, attacks two targets, and grants its native ATK buff', () => {
  const h = run('astgenne', { units: [{ chessId: cid('astgenne'), uid: 'owner', row: 10, col: 4, skillIndex: 1 }] });
  const u = h.unit('owner'), before = u.s.atk, range = u.rangeKeys.length;
  cast(u); close(u.s.atk, before * 1.18); assert.ok(u.rangeKeys.length > range);
  assert.equal(u.skill.targetingOverride().maxTargets, 2); valid(h);
});

test('Astgenne zeal is deployment-relative, caps at five native stacks, and resets on redeploy', () => {
  const h = run('astgenne', { elite: true }), u = h.unit('owner');
  h.run(14.8); assert.equal(u.mem.astgenneZeal, 0);
  h.run(0.2); assert.equal(u.mem.astgenneZeal, 1); assert.equal(u.s.aspd, u.base.aspd + 4);
  h.run(75); assert.equal(u.mem.astgenneZeal, 5); assert.equal(u.s.aspd, u.base.aspd + 20);
  h.b.retreat(u); h.b.redeploy(u); assert.equal(u.mem.astgenneZeal, 0); assert.equal(u.s.aspd, u.base.aspd); valid(h);
});

test('Astgenne real casts grant both active bonds once per owner, including same-name copies', () => {
  const h = run('astgenne', { bonds: { rhineShip: { ...active }, preciShip: { ...active } },
    units: [{ chessId: cid('astgenne'), uid: 'owner', row: 10, col: 4 }, { chessId: cid('astgenne', true), uid: 'copy', row: 11, col: 4 }] });
  for (const uid of ['owner', 'copy']) { const u = h.unit(uid); cast(u); u.skill.end('test'); cast(u); }
  assert.deepEqual(gain(h), { rhineShip: 9, preciShip: 9 }); valid(h);
});
