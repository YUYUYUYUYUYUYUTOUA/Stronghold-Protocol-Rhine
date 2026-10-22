import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as rem from '../../server/sim/content/rem.js';

function field(count, layers = 100) {
  const h = makeBattle({ content: 'generic', extraContent: [rem], autoFinish: false, timeLimit: 180,
    defs: { chess: { rem_op: chessRec({ id: 'rem_op', bonds: ['remShip'], skill: null,
      stats: { maxHp: 1000, atk: 100, cost: 0 } }) },
    enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, def: 1200, res: 30, speed: 0 }) } },
    units: [{ uid: 1, chessId: 'rem_op', row: 12, col: 8 }],
    bonds: { remShip: { active: count >= 3, count, layers } },
  });
  h.b.start();
  const s = h.b.remState.get('p1');
  for (const u of s.units) h.b.retreat(u, { permanent: true });
  s.queue = []; s.regular = s.food = s.bus = s.boss = -1e6;
  h.unit(1).profile.noAttack = true;
  return h;
}
const state = h => h.b.remState.get('p1');
function add(h, type, point = null) {
  const s = state(h), before = s.units.length;
  s.queue.push({ type, source: 'test' }); h.step();
  assert.equal(s.units.length, before + 1, `${type} really spawns`);
  const u = s.units.at(-1);
  if (point) assert.ok(h.b.relocate(u, ...point));
  h.b.addBuff(u, { key: 'test:hold', flags: { noMove: true }, persist: true });
  return u;
}
function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
}
function panel(u, expected, message) {
  for (const [i, stat] of ['maxHp', 'atk', 'def', 'res'].entries()) near(u.s[stat], expected[i], `${message} ${stat}`);
}
function clean(h) {
  assert.deepEqual(h.b.errors, []);
  assert.ok(checkInvariants(h.b));
}

// Literal panels at 100 layers. Stage zero deliberately ignores those layers.
const ordinaryPanels = {
  child: [[1200, 450, 100, 0], [2250, 682.5, 120, 5], [3300, 945, 150, 10], [4800, 1312.5, 180, 15]],
  miner: [[1800, 500, 200, 10], [3450, 780, 240, 15], [5060, 1080, 300, 20], [7360, 1500, 360, 25]],
  combined: [[1800, 1100, 1000, 10], [3450, 1560, 1200, 15], [5060, 2160, 1500, 20], [7360, 3000, 1800, 25]],
  chef: [[1600, 200, 150, 20], [3000, 325, 180, 25], [4400, 450, 225, 30], [6400, 625, 270, 35]],
  enthusiast: [[1800, 450, 200, 10], [3450, 682.5, 240, 15], [5060, 945, 300, 20], [7360, 1312.5, 360, 25]],
};

test('ordinary Rem panels apply exactly one 3/6/9 tier after layers and the full combination bonus', () => {
  for (const [type, panels] of Object.entries(ordinaryPanels)) for (const [stage, count] of [0, 3, 6, 9].entries()) {
    const h = field(count), u = add(h, type);
    panel(u, panels[stage], `${count} Rem ${type}`);
    near(u.hp, panels[stage][0], 'a new reinforcement has full scaled HP');
    assert.equal(u.s.aspd, 100);
    assert.equal(u.s.bat, type === 'child' ? 2.4 : 2.5);
    assert.equal(u.s.blockCnt, type === 'chef' ? 0 : 1);
    assert.equal(u.profile.dmgType, type === 'chef' ? 'arts' : 'phys');
    clean(h);
  }
});

test('vehicles scale only layer-based ATK, retaining their original HP, DEF and RES, with zero bus attack', () => {
  const attacks = { food: [1500, 2600, 3600, 5000], bus: [0, 0, 0, 0] };
  for (const [type, expected] of Object.entries(attacks)) for (const [stage, count] of [0, 3, 6, 9].entries()) {
    const h = field(count), u = add(h, type);
    near(u.s.atk, expected[stage], `${count} Rem ${type} ATK`);
    near(u.s.maxHp, count ? 1500 : 1200, 'vehicle HP receives layers but no tier multiplier');
    assert.equal(u.s.def, 100); assert.equal(u.s.res, 0);
    assert.equal(u.s.blockCnt, 0); assert.equal(u.profile.noAttack, true);
    assert.equal(u.s.bat, 2.4);
    const e = type === 'bus' ? h.spawn('dummy', { pos: [Math.round(u.y), Math.round(u.x)] }) : null;
    if (e) e.profile.noAttack = true;
    h.run(2); near(u.s.atk, expected[stage], 'unchanged layers never compound the tier');
    if (e) { assert.equal(e.hp, e.s.maxHp); assert.equal(u.stats.attacks, 0); }
    clean(h);
  }
});

test('vehicle layer refresh changes its original HP and scaled ATK without compounding or gaining tier defenses', () => {
  for (const [type, atk] of [['food', 6250], ['bus', 0]]) {
    const h = field(9), u = add(h, type);
    const e = h.spawn('dummy', { pos: [9, 3] }); e.profile.noAttack = true;
    h.b.dealDamage(e, u, { amount: .75 * u.s.maxHp, type: 'true', sourceless: true });
    near(u.hpRatio, .25, 'real damage establishes the vehicle injury');
    state(h).ps.bonds.remShip.layers = 200; h.step();
    near(u.s.maxHp, 1800, 'vehicle HP only follows its original layer formula');
    near(u.hp, 450, 'vehicle refresh retains 25% HP'); near(u.s.atk, atk, 'vehicle refreshed ATK');
    assert.equal(u.s.def, 100); assert.equal(u.s.res, 0);
    h.run(2); near(u.s.atk, atk, 'vehicle ATK never compounds'); near(u.hp, 450, 'vehicle refresh never heals');
    clean(h);
  }
});

test('boss receives one full owner-tier panel at every layer sample and refreshes injured HP without survival feedback', () => {
  const panels = [
    [0, [[1200, 1000, 100, 0], [1800, 1300, 120, 5], [2640, 1800, 150, 10], [3840, 2500, 180, 15]]],
    [100, [[1200, 1000, 100, 0], [2250, 1560, 120, 5], [3300, 2160, 150, 10], [4800, 3000, 180, 15]]],
    [300, [[1200, 1000, 100, 0], [3150, 2080, 120, 5], [4620, 2880, 150, 10], [6720, 4000, 180, 15]]],
    [999, [[1200, 1000, 100, 0], [6295.5, 3897.4, 120, 5], [9233.4, 5396.4, 150, 10], [13430.4, 7495, 180, 15]]],
  ];
  for (const [layers, tiers] of panels) for (const [stage, count] of [0, 3, 6, 9].entries()) {
    const h = field(count, layers), u = add(h, 'boss');
    panel(u, tiers[stage], `${count} Rem boss at ${layers} layers`);
    near(u.hp, tiers[stage][0], 'boss starts at its full scaled HP');
    assert.equal(u.isFlying, true); assert.equal(u.s.blockCnt, 0); assert.equal(u.profile.noAttack, true);
    assert.equal(u.s.aspd, 100); assert.equal(u.s.bat, 2.4);
    clean(h);
  }

  const h = field(9, 100), u = add(h, 'boss'), op = h.unit(1);
  const e = h.spawn('dummy', { pos: [9, 3] }); e.profile.noAttack = true;
  // Environmental damage reaches the boss's unchanged airborne identity.
  h.b.dealDamage(e, u, { amount: .75 * u.s.maxHp, type: 'true', sourceless: true });
  near(u.hp, 1200, 'actual damage leaves 25% of the S100 panel');
  state(h).ps.bonds.remShip.layers = 300; h.step();
  panel(u, [6720, 4000, 180, 15], 'approved nine-Rem S300 panel');
  near(u.hp, 1680, 'higher layers preserve injured HP ratio');
  h.step(30);
  assert.equal(state(h).survivalTicks, 31);
  near(op.s.atk, 102, 'the real surviving boss earns operator attack growth');
  near(op.s.maxHp, 1020, 'the real surviving boss earns operator HP growth');
  panel(u, [6720, 4000, 180, 15], 'operator growth never returns to the boss');
  near(u.hp, 1680, 'repeated refresh never heals or compounds boss HP');
  assert.equal(u.findBuff('rem:survival'), null);
  state(h).ps.bonds.remShip.layers = 0; h.step();
  panel(u, [3840, 2500, 180, 15], 'lower layers replace the full boss panel');
  near(u.hp, 960, 'lower layers preserve the same injured HP ratio');
  state(h).ps.bonds.remShip.layers = 300; h.step(30);
  panel(u, [6720, 4000, 180, 15], 'returning layers restore one panel without stacking tiers');
  near(u.hp, 1680, 'returning layers keep the injury');
  clean(h);
});

test('Jacinta chooses its requested pool but all actual stats use the owner stage, including stage zero', () => {
  for (const [count, poolStage, type, expected] of [
    [0, 3, 'enthusiast', ordinaryPanels.enthusiast[0]],
    [3, 3, 'enthusiast', ordinaryPanels.enthusiast[1]],
    [9, 1, 'chef', ordinaryPanels.chef[3]],
  ]) {
    const h = field(count), values = [.5, .95];
    h.b.rng = () => { assert.ok(values.length, 'one real combination trial and one pool draw'); return values.shift(); };
    const before = state(h).units.length;
    assert.equal(h.b.remSummon('p1', 1, { source: 'jacinta', poolStage }), 1);
    assert.equal(state(h).units.length, before + 1); assert.equal(values.length, 0);
    const u = state(h).units.at(-1);
    assert.equal(u.remType, type); assert.equal(u.remSource, 'jacinta'); assert.equal(u.remCounted, false);
    panel(u, expected, `owner ${count}, pool ${poolStage}`);
    clean(h);
  }
});

test('layer refresh preserves injured HP ratios and existing buffs without accumulating tier multipliers', () => {
  const changed = {
    child: [5760, 1500, 180, 15], miner: [8960, 1750, 360, 25], combined: [8960, 3250, 1800, 25],
    chef: [7680, 750, 270, 35], enthusiast: [8960, 1500, 360, 25],
  };
  for (const [type, expected] of Object.entries(changed)) {
    const h = field(9), u = add(h, type);
    h.b.addBuff(u, { key: 'test:external', mods: { atkFlat: 37 }, persist: true });
    const e = h.spawn('dummy', { pos: [9, 3] }); e.profile.noAttack = true;
    h.b.dealDamage(e, u, { amount: .6 * u.s.maxHp, type: 'true' });
    near(u.hpRatio, .4, 'real damage establishes the injury');
    state(h).ps.bonds.remShip.layers = 200; h.step();
    near(u.s.maxHp, expected[0], `${type} refreshed max HP`);
    near(u.hp, expected[0] * .4, `${type} preserved HP ratio`);
    near(u.s.atk, expected[1] + 37, 'external flat ATK is added after tier-scaled base');
    near(u.s.def, expected[2], 'refreshed DEF');
    h.run(2);
    near(u.s.maxHp, expected[0], 'repeated refresh keeps one tier');
    near(u.s.atk, expected[1] + 37, 'repeated refresh never adds another layer or flat buff');
    near(u.hpRatio, .4, 'no healing from repeated refresh');
    near(u.s.res, expected[3] + (type === 'chef' ? 15 : 0), 'only the unchanged chef aura can add RES');
    state(h).ps.bonds.remShip.layers = 100; h.step();
    near(u.s.maxHp, ordinaryPanels[type][3][0], 'layers can fall without retaining the higher panel');
    near(u.s.atk, ordinaryPanels[type][3][1] + 37, 'lower layer ATK replaces the higher base');
    near(u.hpRatio, .4, 'lower layers also preserve the injury ratio');
    clean(h);
  }
});

test('actual operator survival growth cannot feed back into reinforcement HP or attack', () => {
  for (const [count, pct] of [[6, 1], [9, 2]]) for (const type of [
    ...Object.keys(ordinaryPanels), 'food', 'bus', 'boss',
  ]) {
    const h = field(count), u = add(h, type), op = h.unit(1);
    const before = [u.s.maxHp, u.s.atk];
    assert.equal(state(h).survivalTicks, 0); h.step(30);
    assert.equal(state(h).survivalTicks, 30);
    near(op.s.maxHp, 1000 * (1 + pct / 100), 'operator gains actual survivor HP');
    near(op.s.atk, 100 * (1 + pct / 100), 'operator gains actual survivor attack');
    assert.deepEqual([u.s.maxHp, u.s.atk], before); assert.equal(u.findBuff('rem:survival'), null);
    clean(h);
  }
});

test('food collision uses scaled ATK once before physical DEF and still hits each enemy only once', () => {
  for (const [count, damage] of [[0, 300], [3, 1400], [6, 2400], [9, 3800]]) {
    const h = field(count), u = add(h, 'food', [10, 5]);
    const e = h.spawn('dummy', { pos: [10, 5] }); e.profile.noAttack = true;
    const hp = e.hp; h.step(); near(hp - e.hp, damage, `${count} Rem collision`);
    h.run(3); near(hp - e.hp, damage, 'same vehicle never repeats its collision damage');
    assert.equal(u.stats.attacks, 0); clean(h);
  }
});

test('chef aura and actual arts attack cadence remain fixed across tiers', () => {
  const samples = [];
  for (const [count, attack] of [[0, 200], [3, 325], [6, 450], [9, 625]]) {
    const h = field(count), u = add(h, 'chef', [10, 5]), op = h.unit(1);
    assert.ok(h.b.relocate(op, 10, 4));
    const e = h.spawn('dummy', { pos: [10, 6] }); e.profile.noAttack = true;
    const hits = [];
    h.b.on('damaged', ({ source, target, amount, type }) => {
      if (source !== u || target !== e) return;
      assert.equal(type, 'arts'); near(amount, attack * .7, 'real arts mitigation uses scaled ATK once');
      hits.push(h.b.tickCount);
    });
    h.run(10);
    assert.ok(hits.length >= 3, 'chef actually attacks repeatedly'); samples.push(hits);
    assert.equal(op.s.res, 15); assert.equal(op.s.aspd, 115);
    assert.equal(u.s.aspd, 115); assert.equal(u.s.bat, 2.5); assert.equal(u.s.blockCnt, 0);
    clean(h);
  }
  for (const hits of samples.slice(1)) assert.deepEqual(hits, samples[0], 'tiers never increase chef attack frequency');
});

test('enthusiast still needs ten seconds to charge and its actual attack stun lasts only 1.5 seconds', () => {
  for (const count of [0, 3, 6, 9]) {
    const h = field(count), u = add(h, 'enthusiast', [10, 5]);
    h.step(299); assert.ok(u.mem.remStun < 10); h.step(); near(u.mem.remStun, 10, 'ten-second charge');
    h.run(2); near(u.mem.remStun, 10, 'one charge is the storage limit');
    const e = h.spawn('dummy', { pos: [10, 6] }); e.profile.noAttack = true;
    assert.ok(h.runUntil(() => e.s.flags.stun, 3), 'an actual attack consumes the charge');
    assert.ok(u.stats.attacks >= 1); assert.ok(u.mem.remStun < 1);
    h.run(1.4); assert.equal(e.s.flags.stun, true);
    h.run(.2); assert.notEqual(e.s.flags.stun, true);
    clean(h);
  }
});
