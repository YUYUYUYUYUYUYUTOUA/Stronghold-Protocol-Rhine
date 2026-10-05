import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataProfile } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { computeBonds as legacyCompute } from '../server/match/bondsMeta.js';
import { computeBonds, tierFor } from '../shared/bondsMeta.js';
import { defaultLabScenario, normalizeLabScenario, buildLabSpec, labBonds } from '../shared/testLabScenario.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { buildDeployMap, canPlace, positionClass } from '../server/match/board.js';

const log = { info() {}, warn() {}, error() {} };
const rhine = getDataProfile(true, { log }), vanilla = getDataProfile(false, { log });
const clone = (v) => JSON.parse(JSON.stringify(v));
const blank = (records = rhine, profile = 'rhine') => ({ ...defaultLabScenario(records, profile), units: [], enemies: [], bonds: {} });
const unit = (id, uid = 1, row = 10, col = 3, extra = {}) => ({ uid, id, row, col, ...extra });
const native = (id) => Object.values(rhine.chess).find((c) => c.visible && !c.isGolden && c.bonds?.includes(id));
const start = (scenario, records = rhine) => {
  const b = createBattleFromSpec(buildLabSpec(scenario, records), records, { logger: log });
  b.autoFinish = false; b.step(); assert.deepEqual(b.errors, []); return b;
};

test('laboratory defaults deploy real six-member Rhine and vanilla squads with a durable stationary target', () => {
  for (const [profile, records] of [['rhine', rhine], ['vanilla', vanilla]]) {
    const s = defaultLabScenario(records, profile), spec = buildLabSpec(s, records), b = start(s, records);
    assert.equal(s.profile, profile);
    assert.deepEqual(s.units.map((u) => u.uid), profile === 'rhine' ? [1,2,3,4,5,6,7,8] : [1,2,3,4,5,6]);
    assert.equal(b.allyUnits.filter((u) => u.uid && u.alive).length, s.units.length);
    const map = buildDeployMap(records.stages[s.stageId]);
    for (const u of s.units) {
      const rec = records.chess[u.id] ?? records.tokens[u.id];
      assert.ok(canPlace(map, positionClass(rec, u.moduleId), u.row, u.col), `default ${u.id} is legally placed`);
    }
    assert.equal(b.enemies[0].s.maxHp, 1e7); assert.equal(b.enemies[0].s.atk, 0); assert.equal(b.enemies[0].s.moveSpeed, 0);
    assert.equal(b.enemies[0].tag, 'lab:9');
    assert.deepEqual(spec, buildBattleSpec(spec), 'laboratory emits the actual canonical BattleSpec v1 shape');
    if (profile === 'rhine') {
      assert.deepEqual(labBonds(s, records).rhineShip, { count: 6, tier: 2, active: true, layers: 100 });
      const devices = b.allyUnits.filter((u) => u.researchStage != null);
      assert.equal(devices.length, 2); assert.ok(devices.every((u) => u.researchActive));
      assert.equal(b.allyUnits.find((u) => u.uid === 8).researchStage, 2);
      assert.equal(b.allyUnits.find((u) => u.uid === 8).base.atk, 640, 'front Mayer contributes to the selected device');
    } else {
      assert.equal('research' in spec.players[0], false);
      assert.equal(labBonds(s, records).rhineShip, undefined);
      assert.ok(s.units.every((u) => !records.chess[u.id].isGolden && !/^chess_rhine_/.test(u.id)));
    }
  }
});

test('shared counting is the legacy export and lab automatic states match real GameData including transformations, harmony and duplicates', () => {
  assert.equal(legacyCompute, computeBonds, 'the compatibility shim introduces no duplicate counting implementation');
  const morph = Object.values(rhine.items).find((i) => i.canGiveBond && !i.isGolden).id;
  const yan = native('yanShip'), mani = native('maniShip');
  const plain = Object.values(rhine.chess).find((c) => c.visible && !c.isGolden && !c.bonds?.includes('rhineShip'));
  const s = blank();
  s.units = [unit(yan.chessId), unit(yan.goldenId, 2, 10, 4), unit(mani.chessId, 3, 10, 5),
    unit(plain.chessId, 4, 11, 3, { items: [morph, 'chess_item_rhine_terminal_a'] })];
  s.bonds = { yanShip: { layers: 999, count: null }, rhineShip: { layers: 31, count: null } };
  const normalized = normalizeLabScenario(s, rhine);
  const ps = { board: new Map(normalized.units.map((u) => [`${u.row},${u.col}`, { kind: 'chess', id: u.id, items: u.items.map((id) => ({ id })) }])),
    hand: [], layers: Object.fromEntries(Object.entries(s.bonds).map(([id, b]) => [id, b.layers])) };
  assert.deepEqual(labBonds(s, rhine), computeBonds(new GameData(rhine, 'mode_single_normal'), ps));
  assert.equal(labBonds(s, rhine).rhineShip.count, 3, 'Muelsyse and one transformed member, plus the real harmony bonus');
});

test('manual counts obey true upward/downward tiers, influence harmony, and layers alone never activate', () => {
  const s = blank();
  s.bonds = { rhineShip: { layers: 999, count: null } };
  assert.deepEqual(labBonds(s, rhine).rhineShip, { count: 0, active: false, tier: 0, layers: 999 });
  for (const count of [0, 2, 3, 6, 9, 20]) {
    s.bonds.rhineShip.count = count;
    assert.equal(labBonds(s, rhine).rhineShip.tier, tierFor(rhine.bonds.rhineShip, count));
    assert.equal(labBonds(s, rhine).rhineShip.count, count);
  }
  s.units = [unit(native('yanShip').chessId)];
  s.bonds = { maniShip: { layers: 0, count: 1 }, yanShip: { layers: 0, count: null } };
  assert.equal(labBonds(s, rhine).yanShip.count, 2, 'manual harmony activation contributes to real members');
  s.bonds.yanShip.count = 5;
  assert.equal(labBonds(s, rhine).yanShip.count, 5, 'manual count is exact rather than count plus harmony');
  for (const count of [0, 1, 2, 3, 20]) {
    s.bonds.soloShip = { count, layers: 7 };
    const result = labBonds(s, rhine).soloShip;
    assert.equal(result.tier, tierFor(rhine.bonds.soloShip, count));
    assert.equal(result.active, result.tier >= 1);
  }
});

test('operator slots and elite modules resolve through the actual record and are preserved in the running simulation', () => {
  const s = blank();
  s.units = [unit('chess_char_5_11_a', 1, 10, 3, { skillIndex: 2 }),
    unit('chess_rhine_mayer_b', 2, 11, 3, { skillIndex: 1, moduleId: 'none' })];
  const b = start(s);
  const ordinary = b.allyUnits.find((u) => u.uid === 1), elite = b.allyUnits.find((u) => u.uid === 2);
  assert.equal(ordinary.def.skill.index, 2);
  assert.equal(elite.def.skill.index, 1); assert.equal(elite.def.loadout.moduleId, 'none');
  const normalized = normalizeLabScenario(s, rhine);
  assert.equal(normalized.units[0].moduleId, null);
  assert.equal(normalized.units[1].moduleId, 'none');
});

test('per-entry absolute enemy attributes survive real spawn queuing even for duplicate keys and originally zero stats', () => {
  const s = blank(), key = defaultLabScenario(rhine).enemies[0].enemyKey;
  s.enemies = [
    { uid: 1, enemyKey: key, row: 10, col: 7, count: 2, stats: { maxHp: 12345, atk: 0, def: 271, res: 37, moveSpeed: 0 } },
    { uid: 2, enemyKey: key, row: 11, col: 8, count: 1, stats: { maxHp: 23456, atk: 782, def: 0, res: 0, moveSpeed: 0.125 } },
    { uid: 3, enemyKey: key, row: 9, col: 9, count: 1, stats: {} },
  ];
  const b = start(s);
  assert.equal(b.enemies.length, 4);
  for (const expected of s.enemies) {
    const enemies = b.enemies.filter((e) => e.tag === `lab:${expected.uid}`);
    assert.equal(enemies.length, expected.count);
    for (const enemy of enemies) for (const stat of ['maxHp','atk','def','res','moveSpeed']) {
      assert.equal(enemy.base[stat], expected.stats[stat] ?? rhine.enemies[key].stats[stat], `${expected.uid}.${stat}`);
    }
  }
  assert.equal(b.total, 4);
});

test('research selection consumes true counts and stage state without injecting operator attributes', () => {
  const s = defaultLabScenario(rhine);
  s.bonds.rhineShip = { count: 0, layers: 999 };
  const spec = buildLabSpec(s, rhine), b = start(s);
  assert.equal(spec.players[0].research.active, false); assert.equal(spec.players[0].research.capacity, 0);
  assert.equal(b.allyUnits.find((u) => u.uid === 8).researchStage, undefined);
  assert.equal(b.allyUnits.find((u) => u.uid === 2).findBuff('rhine:ifrit').mods.atkFlat, 0);
  assert.ok(spec.players[0].units.every((u) => !('stats' in u) && !('bonds' in u)));
});

test('default laboratory real skill activations charge and release the mature energy device against its target', () => {
  const s = defaultLabScenario(rhine);
  s.units.find((u) => u.uid === 2).skillIndex = 2;
  s.units.find((u) => u.uid === 5).skillIndex = 2;
  const b = start(s), pulses = [];
  b.on('damaged', (ctx) => { if (ctx.dmg.tags?.includes('rhinePulse')) pulses.push(ctx); });
  for (const uid of [3, 5, 2]) {
    assert.equal(b.allyUnits.find((u) => u.uid === uid).skill.activate('lab', { free: true }), true);
  }
  assert.equal(pulses.length, 1);
  assert.equal(pulses[0].target.tag, 'lab:9');
  assert.equal(b.getPlayer('lab').bonds.rhineShip.layers, 103, 'Astgenne retains her real first-cast research gain');
  assert.equal(pulses[0].dmg.amount, 649 * 1.2);
  assert.equal(b.allyUnits.find((u) => u.uid === 8).researchCharges, 0);
  assert.deepEqual(b.errors, []);
});

test('the same lab spec and profile restart with identical real engine state and events', () => {
  const s = defaultLabScenario(rhine), a = start(s), b = start(clone(s));
  for (let i = 0; i < 90; i++) { a.step(); b.step(); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.drainEvents(), b.drainEvents());
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('normalization and spec construction detach mutable input arrays and preserve loaded data', () => {
  const input = defaultLabScenario(rhine), before = JSON.stringify(input), enemyStats = JSON.stringify(rhine.enemies[input.enemies[0].enemyKey].stats);
  input.units[0].items.push('chess_item_rhine_terminal_a');
  const current = JSON.stringify(input), normalized = normalizeLabScenario(JSON.stringify(input), rhine), spec = buildLabSpec(input, rhine);
  normalized.units[0].items.length = 0; spec.players[0].units[0].items.length = 0; spec.enemyOverrides[input.enemies[0].enemyKey].stats.maxHp = 999;
  assert.equal(JSON.stringify(input), current);
  assert.equal(JSON.stringify(rhine.enemies[input.enemies[0].enemyKey].stats), enemyStats);
  assert.notEqual(current, before);
});

test('lab free placement ignores terrain/population restrictions but cannot overlap units', () => {
  const s = blank();
  s.units = Array.from({ length: 10 }, (_, i) => unit('chess_char_5_11_a', i + 1, 10, i));
  const b = start(s);
  assert.equal(b.allyUnits.filter((u) => u.uid && u.alive).length, 10);
  assert.equal(labBonds(s, rhine).rhineShip.count, 1, 'free duplicates do not forge real member counts');
  s.units[9].col = 0;
  assert.throws(() => normalizeLabScenario(s, rhine), /already occupied/);
});

test('malformed scenario IDs, coordinates, numeric ranges, slots and JSON values fail explicitly', () => {
  const cases = [
    [s => { s.version = 2; }, /version/], [s => { s.profile = 'other'; }, /profile/],
    [s => { s.stageId = 'missing'; }, /stageId/], [s => { s.units[0].id = '__proto__'; }, /unknown unit/],
    [s => { s.units[0].uid = 0; }, /positive safe integer/], [s => { s.units[0].uid = 'u1'; }, /positive safe integer/],
    [s => { s.enemies[0].uid = s.units[0].uid; }, /duplicate uid/],
    [s => { s.units[0].row = 8; }, /row/], [s => { s.units[0].col = 11; }, /col/],
    [s => { s.units[0].col = 3.5; }, /integer/], [s => { s.units[0].dir = 'NORTH'; }, /dir/],
    [s => { s.units[0].skillIndex = 9; }, /unavailable skill/],
    [s => { s.units[0].moduleId = 'not_a_module'; }, /unavailable module/],
    [s => { s.units[0].items = ['missing']; }, /unknown items/],
    [s => { s.units[0].items = null; }, /equipment id array/],
    [s => { s.units[6].items = ['chess_item_rhine_terminal_a']; }, /tokens have no equipment/],
    [s => { s.units[6].stage = 3; }, /stage/], [s => { s.units[0].stage = 0; }, /research tokens/],
    [s => { s.enemies[0].enemyKey = 'missing'; }, /unknown enemies/],
    [s => { s.enemies[0].row = 13; }, /row/],
    [s => { s.enemies[0].count = 0; }, /count/], [s => { s.enemies[0].count = 31; }, /count/],
    [s => { s.enemies[0].stats.maxHp = 0; }, /maxHp/], [s => { s.enemies[0].stats.maxHp = null; }, /maxHp/],
    [s => { s.enemies[0].stats.atk = -1; }, /atk/], [s => { s.enemies[0].stats.moveSpeed = Infinity; }, /Infinity/],
    [s => { s.enemies[0].stats.res = 101; }, /res/], [s => { s.enemies[0].stats.hp = 50; }, /unsupported enemy stat/],
    [s => { s.bonds.rhineShip.layers = 1000; }, /layers/], [s => { s.bonds.rhineShip.layers = 1.5; }, /integer/],
    [s => { s.bonds.rhineShip.count = 21; }, /count/], [s => { s.bonds.missing = { count: null, layers: 0 }; }, /unknown bonds/],
    [s => { s.seed = 0; }, /seed/], [s => { s.seed = NaN; }, /NaN/], [s => { s.seed = null; }, /seed/],
    [s => { s.round = 17; }, /round/], [s => { s.units = null; }, /units/],
    [s => { s.extra = { lost: NaN }; }, /NaN/], [s => { s.profile = 'vanilla'; }, /Rhine extension/],
  ];
  for (const [change, expected] of cases) {
    const s = clone(defaultLabScenario(rhine)); change(s);
    assert.throws(() => normalizeLabScenario(s, rhine), expected);
  }
  const cyclic = blank(); cyclic.self = cyclic;
  assert.throws(() => normalizeLabScenario(cyclic, rhine), /cyclic JSON/);
  assert.throws(() => normalizeLabScenario('{bad json}', rhine), /invalid JSON/);
  const sparse = blank(); sparse.units = new Array(1);
  assert.throws(() => normalizeLabScenario(sparse, rhine), /expected JSON data/);
  const tooMany = blank(), key = defaultLabScenario(rhine).enemies[0].enemyKey;
  tooMany.enemies = Array.from({ length: 21 }, (_, i) => ({ uid: i + 1, enemyKey: key, row: 10, col: 7, count: 30 }));
  assert.throws(() => normalizeLabScenario(tooMany, rhine), /total count/);
});
