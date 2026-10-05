// Pure scenario input and BattleSpec v1 construction for the isolated browser laboratory.
// Records are the already loaded raw data dictionaries for the selected profile, never a server singleton.
import { GEO } from './constants.js';
import { computeBonds, tierFor } from './bondsMeta.js';
import { resolveRecordLoadout } from './loadoutRecord.js';
import { RHINE_BOND, rhineCapacity, rhineDevice } from './rhineResearch.js';

const DIRS = new Set(['UP', 'RIGHT', 'DOWN', 'LEFT']);
const STAT_LIMITS = Object.freeze({ maxHp: [1, 1e8], atk: [0, 1e6], def: [0, 1e6], res: [0, 100], moveSpeed: [0, 20] });
const STAT_MODS = Object.freeze({ maxHp: 'hpMul', atk: 'atkMul', def: 'defMul', res: 'resMul', moveSpeed: 'speedMul' });
const optional = (value, fallback) => value === undefined ? fallback : value;
const own = (map, id) => typeof id === 'string' && map && Object.hasOwn(map, id) && map[id] && typeof map[id] === 'object' ? map[id] : null;
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const object = (v, path) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'expected an object');
  return v;
};
const number = (v, path, min, max, integer = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    fail(path, `expected ${integer ? 'an integer' : 'a finite number'} in ${min}..${max}`);
  }
  return v;
};
const uid = (v, path) => {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  return fail(path, 'expected a positive safe integer');
};
function jsonInput(v, path = 'scenario', seen = new Set(), depth = 0) {
  if (depth > 20) fail(path, 'JSON nesting is too deep');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail(path, 'NaN and Infinity are not JSON numbers'); return; }
  if (!v || typeof v !== 'object' || (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))) fail(path, 'expected JSON data');
  if (seen.has(v)) fail(path, 'cyclic JSON is not supported');
  seen.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) jsonInput(v[i], `${path}[${i}]`, seen, depth + 1);
  } else for (const [key, value] of Object.entries(v)) jsonInput(value, `${path}.${key}`, seen, depth + 1);
  seen.delete(v);
}
function known(records, type, id, path) {
  const rec = own(records?.[type], id);
  if (!rec) fail(path, `unknown ${type} id ${String(id)}`);
  return rec;
}
function profileId(id, profile, path) {
  if (profile === 'vanilla' && /^(?:chess_rhine_|token_rhine_|chess_item_rhine_)/.test(id)) fail(path, 'Rhine extension data is unavailable in vanilla');
}
function position(entry, path) {
  return { row: number(entry.row, `${path}.row`, GEO.NORMAL_RECT.r0, GEO.NORMAL_RECT.r1, true),
    col: number(entry.col, `${path}.col`, GEO.NORMAL_RECT.c0, GEO.NORMAL_RECT.c1, true) };
}
function stageId(records) {
  if (own(records?.stages, 'act1autochess_m02')) return 'act1autochess_m02';
  if (own(records?.stages, 'act1autochess_m07')) return 'act1autochess_m07';
  const id = Object.keys(records?.stages ?? {}).sort().find((key) => own(records.stages, key));
  if (!id) fail('records.stages', 'at least one stage is required');
  return id;
}

/** A detached, validated JSON scenario. Empty rosters are valid; placement ignores population and terrain limits. */
export function normalizeLabScenario(input, records) {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { fail('scenario', 'invalid JSON'); }
  }
  jsonInput(input); object(input, 'scenario'); object(records, 'records');
  const version = optional(input.version, 1);
  if (version !== 1) fail('version', 'unsupported scenario version');
  const profile = optional(input.profile, 'rhine');
  if (profile !== 'rhine' && profile !== 'vanilla') fail('profile', 'expected rhine or vanilla');
  const chosenStage = optional(input.stageId, stageId(records));
  known(records, 'stages', chosenStage, 'stageId');
  const seed = number(optional(input.seed, 1), 'seed', 1, 0xffffffff, true);
  const round = number(optional(input.round, 1), 'round', 1, 16, true);
  const unitsIn = optional(input.units, []), enemiesIn = optional(input.enemies, []), bondsIn = optional(input.bonds, {});
  if (!Array.isArray(unitsIn) || unitsIn.length > 44) fail('units', 'expected at most 44 units');
  if (!Array.isArray(enemiesIn) || enemiesIn.length > 600) fail('enemies', 'expected at most 600 entries');
  object(bondsIn, 'bonds');
  const seen = new Set(), cells = new Set();
  const unique = (value, path) => {
    const id = uid(value, path), key = String(id);
    if (seen.has(key)) fail(path, `duplicate uid ${key}`);
    seen.add(key); return id;
  };
  const units = unitsIn.map((entry, i) => {
    const path = `units[${i}]`; object(entry, path);
    const id = entry.id;
    profileId(id, profile, `${path}.id`);
    const chess = own(records.chess, id), token = own(records.tokens, id);
    if (!chess && !token) fail(`${path}.id`, `unknown unit id ${String(id)}`);
    if (chess && token) fail(`${path}.id`, 'ambiguous unit id');
    const pos = position(entry, path), cell = `${pos.row},${pos.col}`;
    if (cells.has(cell)) fail(path, `unit tile ${cell} is already occupied`);
    cells.add(cell);
    const dir = optional(entry.dir, 'RIGHT');
    if (!DIRS.has(dir)) fail(`${path}.dir`, 'expected UP, RIGHT, DOWN or LEFT');
    const equipment = optional(entry.items, []);
    if (!Array.isArray(equipment) || equipment.length > 64) fail(`${path}.items`, 'expected an equipment id array of at most 64 items');
    const items = equipment.map((item, j) => {
      profileId(item, profile, `${path}.items[${j}]`);
      const rec = known(records, 'items', item, `${path}.items[${j}]`);
      if (rec.itemType && rec.itemType !== 'EQUIP') fail(`${path}.items[${j}]`, 'expected equipment');
      return item;
    });
    const out = { uid: unique(entry.uid, `${path}.uid`), id, ...pos, dir, skillIndex: null, moduleId: null, items };
    if (chess) {
      const lo = resolveRecordLoadout(chess, entry);
      if (entry.skillIndex != null && (!Number.isInteger(entry.skillIndex) || entry.skillIndex !== lo.skillIndex)) fail(`${path}.skillIndex`, 'unavailable skill slot');
      if (entry.moduleId != null && entry.moduleId !== 'none' && entry.moduleId !== lo.moduleId) fail(`${path}.moduleId`, 'unavailable module');
      if (entry.moduleId != null && entry.moduleId !== 'none' && !chess.isGolden) fail(`${path}.moduleId`, 'modules require an elite operator');
      out.skillIndex = lo.skillIndex;
      out.moduleId = lo.moduleId;
      if (entry.stage != null) fail(`${path}.stage`, 'stage belongs to research tokens');
    } else {
      if (items.length || entry.skillIndex != null || entry.moduleId != null) fail(path, 'tokens have no equipment or operator loadout');
      if (rhineDevice(id)) out.stage = number(optional(entry.stage, 0), `${path}.stage`, 0, 2, true);
      else if (entry.stage != null) fail(`${path}.stage`, 'stage belongs to research tokens');
    }
    return out;
  });
  let enemyTotal = 0;
  const enemies = enemiesIn.map((entry, i) => {
    const path = `enemies[${i}]`; object(entry, path);
    known(records, 'enemies', entry.enemyKey, `${path}.enemyKey`);
    const pos = position(entry, path), count = number(optional(entry.count, 1), `${path}.count`, 1, 30, true);
    enemyTotal += count;
    const statsIn = optional(entry.stats, {}); object(statsIn, `${path}.stats`);
    const stats = {};
    for (const [key, value] of Object.entries(statsIn)) {
      if (!Object.hasOwn(STAT_LIMITS, key)) fail(`${path}.stats.${key}`, 'unsupported enemy stat');
      stats[key] = number(value, `${path}.stats.${key}`, ...STAT_LIMITS[key]);
    }
    return { uid: unique(entry.uid, `${path}.uid`), enemyKey: entry.enemyKey, ...pos, count, stats };
  });
  if (enemyTotal > 600) fail('enemies', 'total count exceeds the simulation limit of 600');
  const bonds = {};
  for (const [id, state] of Object.entries(bondsIn)) {
    known(records, 'bonds', id, `bonds.${id}`); object(state, `bonds.${id}`);
    if (profile === 'vanilla' && id === RHINE_BOND) fail(`bonds.${id}`, 'Rhine research is unavailable in vanilla');
    bonds[id] = { layers: number(optional(state.layers, 0), `bonds.${id}.layers`, 0, 999, true),
      count: state.count == null ? null : number(state.count, `bonds.${id}.count`, 0, 20, true) };
  }
  return { version: 1, profile, stageId: chosenStage, seed, round, units, enemies, bonds };
}

// The exact interface consumed by computeBonds. This is a raw-record view, not a second counting implementation.
function bondData(records) {
  const chess = (id) => own(records.chess, id);
  return {
    chess, item: (id) => own(records.items, id), bond: (id) => own(records.bonds, id),
    baseIdOf: (id) => { const rec = chess(id); return rec?.baseId || (rec?.isGolden ? id.replace(/_b$/, '_a') : id); },
    isGolden: (id) => !!(chess(id) ?? own(records.items, id))?.isGolden,
    bondIds: Object.keys(records.bonds ?? {}).sort((a, b) => ((records.bonds[a].identifier ?? 99) - (records.bonds[b].identifier ?? 99)) || (a < b ? -1 : 1)),
    modeInactiveBonds: new Set(),
  };
}
function computedBonds(scenario, records) {
  const gd = bondData(records), state = { board: new Map(), hand: [], layers: {}, bondCountBonus: {} };
  for (const u of scenario.units) if (own(records.chess, u.id)) {
    state.board.set(`${u.row},${u.col}`, { kind: 'chess', id: u.id, items: u.items.map((id) => ({ id })) });
  }
  for (const [id, b] of Object.entries(scenario.bonds)) state.layers[id] = b.layers;
  const initial = computeBonds(gd, state);
  for (const [id, b] of Object.entries(scenario.bonds)) if (b.count !== null) {
    state.bondCountBonus[id] = b.count - initial[id].count + (initial[id].harmony ?? 0);
  }
  const result = computeBonds(gd, state);
  for (const [id, b] of Object.entries(scenario.bonds)) if (b.count !== null) {
    const tier = tierFor(gd.bond(id), b.count);
    result[id] = { count: b.count, active: tier >= 1, tier, layers: b.layers };
  }
  return result;
}
/** Every real bond state, including inactive bonds; layers alone never activate a bond. */
export function labBonds(scenario, records) { return computedBonds(normalizeLabScenario(scenario, records), records); }

function endTile(stage) {
  const legend = stage.tiles ?? stage.legend ?? {};
  for (let row = 9; row <= 12; row++) for (let col = 0; col <= 10; col++) {
    const glyph = stage.rows?.[row]?.[col], tile = own(legend, glyph);
    if (glyph === 'E' || tile?.tileKey === 'tile_end' || tile?.special === 'end') return [row, col];
  }
  fail('stageId', 'stage has no normal-field destination');
}
/** A real JSON BattleSpec v1; callers set Battle.autoFinish=false after creation. */
export function buildLabSpec(input, records) {
  const s = normalizeLabScenario(input, records), bonds = computedBonds(s, records), routes = [], enemyOverrides = {};
  const end = endTile(records.stages[s.stageId]);
  for (const enemy of s.enemies) {
    for (const key of Object.keys(enemy.stats)) (enemyOverrides[enemy.enemyKey] ??= { stats: {} }).stats[key] = 1;
  }
  const spawns = s.enemies.map((enemy, i) => {
    const rec = records.enemies[enemy.enemyKey], mods = {};
    // A common positive base makes absolute per-entry values work even when the authored stat was zero.
    for (const key of Object.keys(enemyOverrides[enemy.enemyKey]?.stats ?? {})) {
      const value = enemy.stats[key] ?? rec.stats?.[key] ?? (key === 'maxHp' ? 1 : 0);
      mods[STAT_MODS[key]] = value;
    }
    routes.push({ motion: rec.stats?.motion === 'FLY' || rec.isFlyEnemy ? 'FLY' : 'WALK', start: [enemy.row, enemy.col], end: [...end], checkpoints: [] });
    return { time: 0, enemyKey: enemy.enemyKey, routeIndex: i, pos: [enemy.row, enemy.col], count: enemy.count,
      interval: 0, mods, tag: `lab:${enemy.uid}`, ownerPlayerId: 'lab', sourcePlayerId: null };
  });
  const capacity = s.profile === 'rhine' ? rhineCapacity(bonds[RHINE_BOND]) : 0;
  const player = { playerId: 'lab', seat: 0, side: 'L', colOffset: 0, coords: 'field', bonds, bandId: null, playerEffects: [],
    units: s.units.map((u) => own(records.chess, u.id)
      ? { uid: u.uid, kind: 'chess', chessId: u.id, row: u.row, col: u.col, dir: u.dir,
        ...(u.skillIndex == null ? {} : { skillIndex: u.skillIndex }), ...(u.moduleId == null ? {} : { moduleId: u.moduleId }), items: [...u.items] }
      : { uid: u.uid, kind: 'token', tokenId: u.id, row: u.row, col: u.col, dir: u.dir, ownerUid: null,
        ...(rhineDevice(u.id) ? { research: true, researchKey: rhineDevice(u.id).key } : {}) }) };
  if (s.profile === 'rhine') player.research = { unlocked: true, active: capacity > 0, capacity, layers: bonds[RHINE_BOND]?.layers ?? 0, hand: [],
    devices: s.units.filter((u) => rhineDevice(u.id)).map((u) => ({ key: rhineDevice(u.id).key, tokenId: u.id, uid: u.uid, stage: u.stage, points: 0, onBoard: true })) };
  return { v: 1, battleId: 'lab', fieldId: 'lab', kind: 'normal', seed: s.seed, modeId: 'mode_single_normal', round: s.round,
    stageId: s.stageId, rect: { ...GEO.NORMAL_RECT }, timeLimit: 3600, players: [player], spawns, routes,
    flags: { startOpCooldown: 0 }, enemyOverrides, waveId: null, bossId: null, content: 'full', boss: null };
}

/** Six distinct Rhine operators and two research devices; vanilla starts with a regular unmodified squad. */
export function defaultLabScenario(records, profile = 'rhine') {
  if (profile !== 'rhine' && profile !== 'vanilla') fail('profile', 'expected rhine or vanilla');
  const selectedStage = stageId(records), stage = records.stages[selectedStage];
  let preferred = profile === 'rhine'
    ? ['chess_rhine_mayer_a', 'chess_rhine_ifrit_a', 'chess_rhine_astgenne_a', 'chess_rhine_dorothy_a', 'chess_char_5_11_a', 'chess_char_4_21_a']
    : ['chess_char_4_17_a', 'chess_char_1_08_a', 'chess_char_4_22_a', 'chess_char_3_01_a', 'chess_char_2_02_a', 'chess_char_1_14_a'];
  if (profile === 'vanilla' && preferred.some((id) => !own(records.chess, id))) {
    preferred = Object.keys(records.chess ?? {}).sort().filter((id) => { const c = records.chess[id]; return c.visible && !c.isGolden && !/^chess_rhine_/.test(id); }).slice(0, 6);
  }
  if (preferred.length < 6) fail('records.chess', 'six ordinary operators are required for the default squad');
  const slots = [[11, 5], [10, 3], [11, 3], [10, 5], [11, 4], [10, 4]];
  const units = preferred.map((id, i) => ({ uid: i + 1, id, row: slots[i][0], col: slots[i][1], dir: 'RIGHT', items: [] }));
  if (profile === 'rhine') units.push({ uid: 7, id: 'token_rhine_medical', row: 10, col: 6, stage: 0 },
    { uid: 8, id: 'token_rhine_energy', row: 11, col: 6, stage: 2 });
  const enemyKey = own(records.enemies, 'enemy_1000_gopro_2') ? 'enemy_1000_gopro_2'
    : Object.keys(records.enemies ?? {}).sort().find((id) => records.enemies[id]?.rank === 'NORMAL' && !records.enemies[id]?.tokenOnly);
  if (!enemyKey) fail('records.enemies', 'a regular enemy is required for the default target');
  const end = endTile(stage);
  const enemies = [{ uid: 9, enemyKey, row: end[0] === 10 ? 11 : 10, col: 7, count: 1,
    stats: { maxHp: 1e7, atk: 0, def: 0, res: 0, moveSpeed: 0 } }];
  return normalizeLabScenario({ version: 1, profile, stageId: selectedStage, seed: 1, round: 1, units, enemies,
    bonds: profile === 'rhine' ? { [RHINE_BOND]: { layers: 100, count: null } } : {} }, records);
}
