import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { RESONATOR, liveResonators, triggerResonator } from '../../server/sim/content/kits/rhineNew.js';
const ds = getDefaultSource();
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
const traps = (h, u = h.unit('owner')) => liveResonators(h.b, u);
const hits = h => h.hooksOf('damaged').filter(c => c.dmg.tags?.includes('dorothyTrap'));

for (const [name, count, mod] of [['astgenne', 2, 'uniequip_002_halo'], ['dorothy', 3, 'uniequip_002_doroth']]) {
  for (const elite of [false, true]) for (let skillIndex = 0; skillIndex < count; skillIndex++) {
    for (const moduleId of elite ? [mod, 'none'] : [null]) test(`${name}: ${elite ? 'elite' : 'normal'} S${skillIndex + 1} / ${moduleId ?? 'base'} authored kit`, () => {
      const h = run(name, { elite, units: [{ chessId: cid(name, elite), uid: 'owner', row: 10, col: 4, skillIndex, moduleId }] });
      const u = h.unit('owner'); assert.equal(u.kit.skillSource, 'skills'); assert.equal(u.def.loadout.skillIndex, skillIndex);
      assert.equal(u.skill.id, `skchr_${name === 'astgenne' ? 'halo' : 'doroth'}_${skillIndex + 1}`);
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

for (const elite of [false, true]) test(`Dorothy: ${elite ? '5' : '4'} total field cap includes automatic and pre-placed traps; stock caps`, () => {
  const limit = elite ? 5 : 4;
  const cells = [[9, 4], [9, 5], [10, 5], [11, 4], [11, 5], [10, 6]];
  const h = run('dorothy', { elite, units: [{ chessId: cid('dorothy', elite), uid: 'owner', row: 10, col: 4 },
    ...cells.map(([row, col], i) => ({ kind: 'token', tokenId: RESONATOR, ownerUid: 'owner', uid: `trap${i}`, row, col }))] });
  const u = h.unit('owner'); assert.equal(traps(h).length, limit); assert.equal(u.mem.dorothyStock, 0);
  for (let i = 0; i < 10; i++) cast(u);
  assert.equal(traps(h).length, limit); assert.equal(u.mem.dorothyStock, limit); assert.ok(u.s.flags.noSp);
  const sp = u.skill.sp; u.skill.gainSp(99, 'gift'); h.run(2); assert.equal(u.skill.sp, sp); valid(h);
});

test('Dorothy: automatic deployment makes two free traps; hostile ground cells are not used for replenishment', () => {
  const h = run('dorothy'), u = h.unit('owner'); assert.equal(traps(h).length, 2); assert.equal(u.mem.dorothyStock, 4);
  for (const key of u.rangeKeys) { const r = Math.floor(key / 21), c = key % 21; if (!traps(h).some(t => t.tileR === r && t.tileC === c)) h.spawn('e', { pos: [r, c] }); }
  cast(u); assert.equal(traps(h).length, 2); valid(h);
});

for (const skillIndex of [0, 1, 2]) test(`Dorothy S${skillIndex + 1}: native damage/status, Dreamer timing, and one research gain for multi-hit trap`, () => {
  const h = run('dorothy', { bonds: { rhineShip: { ...active } },
    units: [{ chessId: cid('dorothy'), uid: 'owner', row: 10, col: 4, skillIndex }] });
  const u = h.unit('owner'), t = traps(h)[0]; const e = h.spawn('e', { pos: [t.tileR, t.tileC] });
  const other = h.spawn('e', { pos: [t.tileR, t.tileC + 1] }); const before = u.s.atk;
  assert.equal(triggerResonator(h.b, t, e), true);
  assert.equal(triggerResonator(h.b, t, e), false);
  assert.equal(gain(h).rhineShip, 2); assert.equal(u.mem.dorothyDream, 1);
  const d = hits(h); assert.equal(d.length, skillIndex === 0 ? 1 : 2);
  close(d[0].dmg.amount, before * (skillIndex === 2 ? 1 : 1.02) * [3.3, 2.3, 2.5][skillIndex]);
  assert.equal(d[0].type, skillIndex === 2 ? 'arts' : 'phys');
  if (skillIndex === 0) assert.ok(e.findBuff(`dorothy:def:${u.id}`));
  if (skillIndex === 1) { assert.ok(e.s.flags.bind); assert.ok(other.s.flags.bind); close(e.findBuff('bind').duration, 2); }
  if (skillIndex === 2) assert.ok(e.findBuff('sluggish'));
  assert.ok(!t.alive); valid(h);
});

test('Dorothy S2: its one-victim bind is longer; flying enemies neither trigger nor receive trap effects', () => {
  const h = run('dorothy', { units: [{ chessId: cid('dorothy'), uid: 'owner', row: 10, col: 4, skillIndex: 1 }] });
  h.unit('owner').atkCd = 999;
  const t = traps(h)[0], fly = h.spawn('fly', { pos: [t.tileR, t.tileC] }); h.run(0.2);
  assert.ok(t.alive); const e = h.spawn('e', { pos: [t.tileR, t.tileC] }); h.step(1);
  close(e.findBuff('bind').duration, 3.5); assert.equal(fly.hp, fly.s.maxHp); valid(h);
});

test('Dorothy S3: delay chains count each actually detonated physical trap once; dead queued traps do not count', () => {
  const h = run('dorothy', { bonds: { rhineShip: { ...active } }, units: [
    { chessId: cid('dorothy'), uid: 'owner', row: 10, col: 3 },
    ...[[10, 5], [10, 6], [10, 7], [11, 6]].map(([row, col], i) => ({ kind: 'token', tokenId: RESONATOR, ownerUid: 'owner', uid: `t${i}`, row, col }))] });
  const first = h.unit('t0'), queued = h.unit('t1'), removed = h.unit('t2');
  const e = h.spawn('e', { pos: [10, 5] }); triggerResonator(h.b, first, e);
  assert.equal(gain(h).rhineShip, 2); assert.equal(queued.mem.dorothyQueued, queued.deploySeq);
  h.b.retreat(removed, { reason: 'retreat', permanent: true });
  h.run(1.9); assert.equal(gain(h).rhineShip, 2);
  h.run(0.2); assert.equal(gain(h).rhineShip, 4); assert.ok(!queued.alive);
  h.run(2.1); assert.equal(gain(h).rhineShip, 6, 'final connected fourth trap detonates once; withdrawn trap does not');
  assert.equal(h.hooksOf('trapTriggered').length, 3); valid(h);
});

test('Dorothy: TRP-Y selects double damage on placement, persists in fieldMeta, and does not double research', () => {
  const h = run('dorothy', { elite: true, bonds: { rhineShip: { ...active } }, setup(b) { b.rng.chance = p => p > 0; } });
  const t = traps(h)[0], u = h.unit('owner'); assert.equal(t.form, 'dorothyCritical');
  assert.equal(h.b.fieldMeta().units.find(x => x.id === t.id).form, 'dorothyCritical');
  const before = u.s.atk, e = h.spawn('e', { pos: [t.tileR, t.tileC] }); triggerResonator(h.b, t, e);
  close(hits(h)[0].dmg.amount, before * 2.8 * 2); assert.equal(gain(h).rhineShip, 4); valid(h);
  const plain = run('dorothy', { elite: true, units: [{ chessId: cid('dorothy', true), uid: 'owner', row: 10, col: 4, moduleId: 'none' }], setup(b) { b.rng.chance = p => p > 0; } });
  assert.ok(traps(plain).every(x => x.form === 'dorothyNormal')); valid(plain);
});

test('Dorothy: consumed cells rearm from stock only after redeploy delay and not under an occupying ground enemy', () => {
  const h = run('dorothy', { units: [{ chessId: cid('dorothy'), uid: 'owner', row: 10, col: 4, skillIndex: 0 }] });
  const t = traps(h)[0], u = h.unit('owner'), seq = t.deploySeq, e = h.spawn('e', { pos: [t.tileR, t.tileC] });
  triggerResonator(h.b, t, e); h.run(5.5); assert.ok(!t.alive); assert.equal(u.mem.dorothyStock, 4);
  e.hidden = true; e.x = 10; e.y = 12; h.run(0.5);
  assert.ok(t.alive); assert.ok(t.deploySeq > seq); assert.equal(u.mem.dorothyStock, 3); assert.ok(!u.s.flags.noSp); valid(h);
});

test('Dorothy: withdrawal and owner departure give no research; every attached trap disappears with its owner', () => {
  const h = run('dorothy', { bonds: { rhineShip: { ...active } } }); const u = h.unit('owner'), [a, c] = traps(h);
  h.b.retreat(a, { reason: 'retreat', permanent: true }); assert.deepEqual(gain(h), {});
  h.b.retreat(u); assert.ok(!c.alive); assert.equal(c.removeReason, 'ownerGone'); assert.deepEqual(gain(h), {}); valid(h);
});

for (const elite of [false, true]) test(`Dorothy: actual trap consumptions reach exactly ${elite ? 48 : 24} research and Dreamer caps at ten`, () => {
  const h = run('dorothy', { elite, bonds: { rhineShip: { ...active } },
    units: [{ chessId: cid('dorothy', elite), uid: 'owner', row: 10, col: 4, skillIndex: 0, moduleId: 'none' }] });
  const u = h.unit('owner'), e = h.spawn('e', { pos: [12, 9] });
  for (let i = 0; i < 20; i++) {
    e.x = 9; e.y = 12;
    const t = h.b.spawnToken(u, RESONATOR, 12, 7); assert.ok(t?.alive);
    e.x = 7; e.y = 12; triggerResonator(h.b, t, e);
    assert.equal(gain(h).rhineShip, Math.min(i + 1, 12) * (elite ? 4 : 2));
  }
  assert.equal(u.mem.dorothyDream, 10);
  close(u.findBuff('dorothy:dreamer').mods.atkMul, 1.2); valid(h);
});

test('Dorothy: same-name copies have separate trap ownership and research budgets', () => {
  const h = run('dorothy', { bonds: { rhineShip: { ...active } }, units: [
    { chessId: cid('dorothy'), uid: 'owner', row: 10, col: 3, skillIndex: 0 },
    { chessId: cid('dorothy'), uid: 'copy', row: 11, col: 3, skillIndex: 0 }] });
  const first = h.unit('owner'), second = h.unit('copy'), e = h.spawn('e', { pos: [12, 9] });
  for (const u of [first, second]) for (let i = 0; i < 13; i++) {
    e.x = 9; e.y = 12; const t = h.b.spawnToken(u, RESONATOR, 12, 7);
    e.x = 7; e.y = 12; triggerResonator(h.b, t, e);
  }
  assert.equal(gain(h).rhineShip, 48); assert.equal(first.mem.dorothyDream, 10); assert.equal(second.mem.dorothyDream, 10); valid(h);
});

test('Dorothy: runtime cap resists oversized injected token limits; direct spawns reject an occupied enemy tile', () => {
  const raw = ds.rawToken(RESONATOR), excessive = structuredClone(raw);
  excessive.deployLimit = excessive.stats.deployLimit = 999;
  for (const v of Object.values(excessive.variants)) { v.count = 999; v.stats.deployLimit = 999; }
  const h = run('dorothy', { defs: { tokens: { [RESONATOR]: excessive }, enemies: { e: enemy('e') } } }), u = h.unit('owner');
  for (const [r, c] of [[9, 6], [9, 7], [10, 7], [11, 7], [12, 7]]) h.b.spawnToken(u, RESONATOR, r, c);
  assert.equal(traps(h).length, 4);
  const e = h.spawn('e', { pos: [12, 9] }); const denied = h.b.spawnToken(u, RESONATOR, 12, 9);
  assert.ok(denied && !denied.alive); assert.equal(denied.removeReason, 'invalidPlacement');
  assert.ok(e.alive); valid(h);
});

test('Dorothy: disappeared enemies do not reserve their former cell; stealth ground enemies still prevent placement', () => {
  const h = run('dorothy'), u = h.unit('owner'), e = h.spawn('e', { pos: [12, 8] });
  e.hidden = true;
  const allowed = h.b.spawnToken(u, RESONATOR, 12, 8); assert.ok(allowed?.alive, 'disappearance is not ground occupancy');
  h.b.retreat(allowed, { reason: 'test', permanent: true });
  e.hidden = false; h.b.addBuff(e, { key: 'test:stealth', flags: { stealth: true } });
  const denied = h.b.spawnToken(u, RESONATOR, 12, 8); assert.ok(denied && !denied.alive);
  assert.equal(denied.removeReason, 'invalidPlacement'); valid(h);
});

test('Dorothy S3: an old queued chain cannot detonate a new deployment on that cell', () => {
  const h = run('dorothy', { bonds: { rhineShip: { ...active } }, units: [
    { chessId: cid('dorothy'), uid: 'owner', row: 10, col: 3 },
    ...[[10, 5], [10, 6]].map(([row, col], i) => ({ kind: 'token', tokenId: RESONATOR, ownerUid: 'owner', uid: `t${i}`, row, col }))] });
  const first = h.unit('t0'), queued = h.unit('t1');
  for (const t of traps(h)) if (t !== first && t !== queued) h.b.retreat(t, { reason: 'test', permanent: true });
  const e = h.spawn('e', { pos: [10, 5] }); triggerResonator(h.b, first, e);
  const old = queued.deploySeq; assert.equal(queued.mem.dorothyQueued, old);
  triggerResonator(h.b, queued, null, { chain: true }); assert.equal(gain(h).rhineShip, 4);
  h.b.redeploy(queued); assert.ok(queued.alive); assert.ok(queued.deploySeq > old);
  h.run(2.2); assert.ok(queued.alive); assert.equal(gain(h).rhineShip, 4); valid(h);
});

for (const kind of ['unite', 'boss', 'hidden']) test(`new Rhine battle traits do not grant layers in ${kind}`, () => {
  // Synthetic normal-field rect preserves the same tile arrangement while the real battle kind disables layers.
  const h = run('dorothy', { kind, rect: { r0: 9, r1: 12, c0: 2, c1: 10 }, bonds: { rhineShip: { ...active }, preciShip: { ...active } },
    units: [{ chessId: cid('dorothy'), uid: 'owner', row: 10, col: 4, abs: true }, { chessId: cid('astgenne'), uid: 'star', row: 11, col: 4, abs: true }] });
  cast(h.unit('star')); const t = traps(h)[0], e = h.spawn('e', { pos: [t.tileR, t.tileC] }); triggerResonator(h.b, t, e);
  assert.deepEqual(gain(h), {}); valid(h);
});
