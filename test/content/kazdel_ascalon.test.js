import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { addDread } from '../../server/sim/content/kits/ops/op-ascln.js';

const K = 'kazdelShip';
const unit = (elite = false, col = 5) => ({ chessId: `chess_kazdel_ascalon_${elite ? 'b' : 'a'}`, row: 10, col, moduleId: 'none' });
function fixture(units = [unit()], opts = {}) {
  const h = makeBattle({ units, bonds: { [K]: { active: true, count: 3, layers: 0 } }, autoFinish: false,
    defs: { enemies: { holdTarget: enemyRec({ key: 'holdTarget', hp: 1e8, speed: .1, atk: 0 }) } }, ...opts });
  h.step();
  for (const u of h.b.allyUnits) u.profile.noAttack = true;
  return h;
}
const ticks = (h, n) => { for (let i = 0; i < n; i++) { h.b._buildEnemyIndex(); h.b.emit('tick', { dt: 1 / 30 }); } };
const layers = (h, id = 'p1') => h.b.getPlayer(id).bonds[K].layers;
const spawn = h => h.spawn('holdTarget', { pos: [10, 5] });

for (const elite of [false, true]) test(`Ascalon ${elite ? 'elite' : 'normal'} counts effective seconds, not targets; pauses and resumes at the 3s boundary`, () => {
  const h = fixture([unit(elite)]);
  ticks(h, 300); assert.equal(layers(h), 0);
  const a = spawn(h), b = spawn(h);
  ticks(h, 89); assert.equal(layers(h), 0);
  const mul = elite ? .7 : .8;
  assert.ok(Math.abs(a.s.moveSpeed - a.base.moveSpeed * mul) < 1e-9);
  a.hidden = b.hidden = true; ticks(h, 100); assert.equal(layers(h), 0);
  assert.equal(a.findBuff('kazdel:ascalonSlow'), null);
  a.hidden = b.hidden = false; ticks(h, 1); assert.equal(layers(h), elite ? 2 : 1);
  ticks(h, 90); assert.equal(layers(h), elite ? 4 : 2);
  assert.ok(checkInvariants(h.b));
});

test('Ascalon duplicate bodies use one strongest clock; native slow multiplies and body departure removes only the new aura', () => {
  const h = fixture([unit(false, 4), unit(true, 5), unit(true, 6)]), e = spawn(h);
  const [normal, elite, twin] = h.b.allyUnits;
  addDread(h.b, normal, e, { max_stack_cnt: 3, move_speed: -.18, debuff_duration: 25, interval: 1, atk_ratio: .1 });
  ticks(h, 90); assert.equal(layers(h), 2);
  assert.ok(Math.abs(e.s.moveSpeed / e.base.moveSpeed - .82 * .7) < 1e-9);
  elite.hidden = twin.hidden = true; ticks(h, 90); assert.equal(layers(h), 3);
  assert.ok(Math.abs(e.s.moveSpeed / e.base.moveSpeed - .82 * .8) < 1e-9);
  h.b.kill(normal); ticks(h, 90);
  assert.ok(normal.kazdelSoulUnit?.alive); assert.equal(layers(h), 3);
  assert.equal(e.findBuff('kazdel:ascalonSlow'), null, 'the soul inherits no body trait');
  assert.ok(checkInvariants(h.b));
});

test('Ascalon inactive bonds and forbidden fields never gain layers; static enemies and out-of-range enemies do not count', () => {
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    const h = fixture([unit()], { kind, rect: { r0: 0, r1: 18, c0: 0, c1: 20 },
      bonds: { [K]: { active: kind !== 'normal', count: 3, layers: 0 } } });
    spawn(h); ticks(h, 180); assert.equal(layers(h), 0, kind);
  }
  const h = fixture(), e = spawn(h); e.x = 15; ticks(h, 180); assert.equal(layers(h), 0);
  e.x = 5; e.base.moveSpeed = 0; e.markDirty(); ticks(h, 180); assert.equal(layers(h), 0);
});

test('Ascalon cooperation keeps owner clocks/layers separate without stacking identical slows', () => {
  const players = ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field',
    units: [unit(Boolean(seat), 5 + seat)], bonds: { [K]: { active: true, count: 3, layers: 0 } } }));
  const h = fixture([], { players }), e = spawn(h);
  ticks(h, 90);
  assert.equal(layers(h, 'p1'), 1); assert.equal(layers(h, 'p2'), 2);
  assert.ok(Math.abs(e.s.moveSpeed / e.base.moveSpeed - .7) < 1e-9);
  h.b.getPlayer('p2').units[0].hidden = true; ticks(h, 90);
  assert.equal(layers(h, 'p1'), 2); assert.equal(layers(h, 'p2'), 2);
  assert.ok(checkInvariants(h.b));
});
