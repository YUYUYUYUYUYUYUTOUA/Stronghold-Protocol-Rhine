// Echo's reactive pulse must not erase counter/reflect origin and re-arm that same counter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants, hashOf } from '../helpers/battleHarness.js';
import { echoHit } from '../../server/sim/content/bosses.js';

const ECHO = 'enemy_9023_acdums', MLY = 'chess_char_5_19_a';
const has = (c, tag) => c.dmg?.tags?.includes(tag);
function field(ids = [MLY]) {
  const h = makeBattle({ units: ids.map((chessId, i) => ({ chessId, row: 10, col: 5 - i })),
    autoFinish: false, seed: 731, captureNoisy: true });
  h.step();
  for (const u of h.b.allyUnits) { u.base.maxHp = 1e8; u.hp = 1e8 - 1000; u.markDirty(); }
  const e = h.spawn(ECHO, { pos: [10, 5], mods: { hpMul: 100, speedMul: 0 } });
  return { h, b: h.b, e, u: h.b.allyUnits[0] };
}
function clean(h) { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); }
const hpHits = h => h.hooksOf('damaged').filter(c => c.type !== 'element');

test('Mlynar/Echo: one ordinary hit keeps one reflection and two pulses; independent later hits still work', () => {
  const { h, b, u, e } = field();
  for (let i = 1; i <= 2; i++) {
    const before = e.hp;
    b.dealDamage(u, e, { amount: 1, type: 'true' });
    assert.equal(before - e.hp, 2, 'initial hit and the one legal reflected hit both remove one hit-count HP');
    assert.equal(hpHits(h).filter(c => c.source === u && has(c, 'reflect')).length, i);
    const pulses = hpHits(h).filter(c => c.source === e);
    assert.equal(pulses.length, 2 * i);
    assert.equal(pulses.filter(c => has(c, 'reflect')).length, i);
    assert.equal(e.mem.ab.strikes, 2 * i, 'both pulses count for the form change');
    clean(h);
  }
});

for (const tag of ['counter', 'reflect']) test(`Echo preserves ${tag} through HP and elemental pulse, without copying unrelated attack tags`, () => {
  const { h, b, u, e } = field();
  const tags = ['skill', 'chain', tag];
  b.dealDamage(u, e, { amount: 1, type: 'true', isAttack: true, tags });
  assert.equal(e.hp, e.s.maxHp - 1, 'no new Mlynar reflection');
  const pulses = h.hooksOf('damaged').filter(c => c.source === e);
  assert.deepEqual(pulses.map(c => c.type).sort(), ['arts', 'element']);
  for (const c of pulses) {
    assert.deepEqual(c.dmg.tags, ['enemyAbility', tag]);
    assert.equal(c.dmg.isAttack, false);
  }
  assert.deepEqual(tags, ['skill', 'chain', tag], 'the triggering DamageInfo stays unchanged');
  clean(h);
});

test('pipe/string scripted strike remains an ordinary pulse and allows one reflection', () => {
  const { h, b, u, e } = field();
  echoHit(b, e);
  assert.equal(e.hp, e.s.maxHp - 1, 'only Mlynar reflected hit removes Echo HP');
  assert.equal(hpHits(h).filter(c => c.source === u && has(c, 'reflect')).length, 1);
  assert.equal(hpHits(h).filter(c => c.source === e).length, 2);
  clean(h);
});

test('each Kazimierz ally keeps its legal reflection; a reflected pulse cannot fan it into another cycle', () => {
  const { h, b, u, e } = field([MLY, MLY]);
  b.dealDamage(u, e, { amount: 1, type: 'true' });
  assert.equal(hpHits(h).filter(c => has(c, 'reflect') && c.target === e).length, 2);
  assert.equal(e.hp, e.s.maxHp - 3);
  assert.equal(e.mem.ab.strikes, 3);
  clean(h);
});

test('sourceless credited counter derivatives keep Echo damage, but cannot reopen reflection', () => {
  const { h, b, u, e } = field();
  b.dealDamage(u, e, { amount: 1, type: 'true', sourceless: true, tags: ['counter'] });
  assert.equal(e.hp, e.s.maxHp - 1);
  assert.equal(hpHits(h).filter(c => c.source === e).length, 1);
  clean(h);
});

test('the final Echo hit still settles kill/death exactly once, without a depth guard swallowing bookkeeping', () => {
  const { h, b, u, e } = field(); e.hp = 1;
  b.dealDamage(u, e, { amount: 1, type: 'true' });
  assert.equal(e.alive, false);
  assert.equal(h.hooksOf('death').filter(c => c.unit === e).length, 1);
  assert.equal(h.hooksOf('kill').filter(c => c.victim === e).length, 1);
  clean(h);
});

function passengerField(withVendla) {
  const ids = ['chess_char_6_05_a', ...(withVendla ? ['chess_char_1_06_a'] : [])];
  const f = field(ids), { h, b, u, e } = f;
  if (withVendla) {
    const v = b.allyUnits[1]; v.base.maxHp = 10000; v.hp = 9000; v.markDirty();
    v.skill.sp = v.skill.spCost; v.skill.charges = Math.max(1, v.skill.charges);
    assert.equal(v.skill.activate('manual'), true);
    assert.equal(v.mem.protege, u);
  }
  b.dealDamage(u, e, { amount: 1, type: 'arts', isAttack: true, tags: ['skill', 'storm'] });
  return f;
}

test('Passenger alone is a normal trigger; Vendla counter is the recursive link, and its trait heal remains intact', () => {
  const alone = passengerField(false);
  assert.equal(alone.e.hp, alone.e.s.maxHp - 1);
  assert.equal(hpHits(alone.h).filter(c => c.source === alone.e).length, 1);
  clean(alone.h);
  const { h, b, e } = passengerField(true), v = b.allyUnits[1];
  const counters = hpHits(h).filter(c => c.source === v && has(c, 'counter'));
  assert.equal(counters.length, 1, 'one counter for the protected ally');
  assert.equal(e.hp, e.s.maxHp - 2);
  assert.ok(h.hooksOf('heal').some(c => c.source === v && c.target === v.mem.protege && c.amount > 0), 'counter trait heal is not suppressed');
  clean(h);
});

test('Passenger storms, two Echoes and Vendla retain multi-hit/chain damage and replay identically', () => {
  const run = () => {
    const { h, b, u, e } = passengerField(true);
    h.spawn(ECHO, { pos: [10, 6], mods: { hpMul: 100, speedMul: 0 } });
    u.skill.sp = u.skill.spCost; u.skill.charges = Math.max(1, u.skill.charges);
    assert.equal(u.skill.activate('manual'), true);
    h.run(12);
    const storm = hpHits(h).filter(c => c.source === u && has(c, 'storm'));
    assert.ok(storm.length > 4, 'multiple timed storm hits still run');
    assert.ok(new Set(storm.map(c => c.target.id)).size > 1, 'chain still reaches multiple Echoes');
    assert.ok(e.mem.ab.strikes >= 0);
    clean(h);
    return { events: hashOf(h.events), snapshot: h.snapshot(), result: h.result() };
  };
  assert.deepEqual(run(), run());
});

for (const reactive of [false, true]) test(`Bubble/spring arts barrier preserves counter origin (${reactive ? 'counter input' : 'ordinary input'})`, () => {
  const { h, b, u, e: unused } = field(['chess_char_2_08_a']); b.kill(unused);
  u.skill.sp = u.skill.spCost; u.skill.charges = Math.max(1, u.skill.charges);
  assert.equal(u.skill.activate('manual'), true);
  const spring = h.spawn('enemy_9018_actrpa', { pos: [10, 5], mods: { hpMul: 100, speedMul: 0 } });
  b.dealDamage(u, spring, { amount: 1, type: 'phys', tags: reactive ? ['counter'] : [] });
  const thorns = hpHits(h).filter(c => c.source === u && c.target === spring && has(c, 'counter'));
  assert.equal(thorns.length, 1, 'one supplied or one legally triggered Bubble counter, never a ping-pong chain');
  const reflected = hpHits(h).filter(c => c.source === spring && has(c, 'springCounter'));
  assert.equal(reflected.length, reactive ? 1 : 2);
  assert.equal(reflected.filter(c => has(c, 'counter')).length, 1);
  assert.ok(reflected.every(c => c.amount > 0), 'preserve barrier damage instead of cancelling it');
  clean(h);
});
