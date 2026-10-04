import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_BANS, applyOpeningBans } from '../../shared/openingBans.js';
import { GameData } from '../../server/match/gamedata.js';
import { drawDisabledBonds, SharedPool } from '../../server/match/pool.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA, makeMatch } from './harness.js';

const NEW_CHESS = ['chess_rhine_astgenne_a', 'chess_rhine_dorothy_a'];
const modes = Object.entries(DATA.config.modes);

test('Rhine opening overlay is idempotent, preserves the subset rule and leaves training unbanned', () => {
  const config = { bans: { NORMAL: { core: 3, addon: 4 }, rule: 'all bonds must be off' } };
  applyOpeningBans(config);
  const once = structuredClone(config);
  applyOpeningBans(config);
  assert.deepEqual(config, once, 'running the overlay twice never adds another slot');
  assert.equal(config.bans.rule, 'all bonds must be off');
  assert.deepEqual(config.bans.NORMAL, { core: 4, addon: 4 });
  assert.deepEqual(config.bans.FUNNY, { core: 1, addon: 1 });
  assert.deepEqual(config.bans.TRAINING, { core: 0, addon: 0 });
  for (const difficulty of Object.keys(OPENING_BANS)) {
    assert.deepEqual(DATA.config.bans[difficulty], OPENING_BANS[difficulty], difficulty);
  }
  assert.deepEqual(new GameData({}, 'unknown').bans('NORMAL'), { core: 4, addon: 4 }, 'partial-data fallback agrees');
});

test('every rotating mode retains five undrawn core bonds; new operators obey the existing all-bonds ban rule', () => {
  for (const [modeId, mode] of modes) {
    const gd = new GameData(DATA, modeId);
    const expected = OPENING_BANS[mode.difficulty];
    for (let seed = 1; seed <= 100; seed++) {
      const bans = drawDisabledBonds(gd, createRng(seed));
      const drawn = new Set(bans.drawn), off = new Set([...bans.drawn, ...bans.staticOff]);
      const cores = gd.bondIds.filter(id => gd.bond(id).isCore && gd.bond(id).weight > 0 && !gd.modeInactiveBonds.has(id));
      assert.equal(cores.filter(id => drawn.has(id)).length, expected.core, `${modeId}: core draws`);
      assert.equal(bans.drawn.length, expected.core + expected.addon, `${modeId}: total slots`);
      if (mode.difficulty === 'TRAINING') assert.deepEqual(bans.banned, []);
      else assert.equal(cores.filter(id => !drawn.has(id)).length, 5, `${modeId}: five full core rosters`);
      const pool = new SharedPool(gd, { banned: bans.banned });
      for (const id of NEW_CHESS) {
        const chess = gd.chess(id);
        assert.ok(chess && chess.visible, `${id}: new visible operator`);
        assert.equal(pool.has(id), !chess.bonds.every(b => off.has(b)), `${modeId}, seed ${seed}: ${id}`);
      }
      assert.equal(pool.has('chess_rhine_dorothy_a'), !off.has('rhineShip'), 'Rhine-only Dorothy follows the core rotation');
      assert.equal(pool.has('chess_rhine_astgenne_a'), !(off.has('rhineShip') && off.has('preciShip')), 'Precision can keep Astgenne in the pool');
      for (let level = 1; level <= 6; level++) {
        const id = pool.roll(createRng(seed * 10 + level), { maxTier: level });
        assert.ok(id && pool.has(id) && gd.tierOf(id) <= level, `${modeId}: legal shop roll at ${level}`);
      }
    }
  }
});

function averagePool(data, modeId, seeds = 1000) {
  const gd = new GameData(data, modeId), sums = { total: 0, tiers: Array(7).fill(0) };
  for (let seed = 1; seed <= seeds; seed++) {
    const bans = drawDisabledBonds(gd, createRng(seed));
    const pool = new SharedPool(gd, { banned: bans.banned });
    sums.total += pool.entries.size;
    for (const entry of pool.entries.values()) sums.tiers[entry.tier]++;
  }
  return { total: sums.total / seeds, tiers: sums.tiers.map(n => n / seeds) };
}

test('the extra rotating slot keeps mean per-tier roster depth close to the previous Rhine release', () => {
  const previous = { ...DATA, chess: { ...DATA.chess }, config: structuredClone(DATA.config) };
  for (const id of NEW_CHESS) { delete previous.chess[id]; delete previous.chess[id.replace(/_a$/, '_b')]; }
  previous.config.bans.FUNNY = { core: 0, addon: 1 };
  for (const difficulty of ['NORMAL', 'HARD', 'ABYSS']) previous.config.bans[difficulty] = { core: 3, addon: 4 };
  for (const modeId of ['mode_multi_normal', 'mode_multi_funny']) {
    const before = averagePool(previous, modeId), after = averagePool(DATA, modeId);
    assert.ok(after.total <= before.total + 1, `${modeId}: adding operators does not expand the mean pool`);
    assert.ok(Math.abs(after.total - before.total) < 5, `${modeId}: comparable total depth ${before.total} -> ${after.total}`);
    for (let tier = 1; tier <= 6; tier++) {
      assert.ok(Math.abs(after.tiers[tier] - before.tiers[tier]) < 1.5,
        `${modeId}: tier ${tier} depth ${before.tiers[tier]} -> ${after.tiers[tier]}`);
    }
  }
});

test('the match publishes the extra slot and its banned list agrees with the shared pool', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    const h = makeMatch({ mode: 'coop', difficulty, humans: 1, seed: 31 }).start();
    const pub = h.m.publicView(), expected = OPENING_BANS[difficulty];
    assert.equal(pub.drawnDisabledBonds.length, expected.core + expected.addon);
    assert.deepEqual([...pub.bannedChess].sort(), [...h.m.pool.banned].sort());
    assert.equal(h.m.pool.entries.size + pub.bannedChess.length, 118);
    h.m.dispose();
  }
});

function combinations(ids, count) {
  const result = [];
  function add(start, selected) {
    if (selected.length === count) { result.push(selected.slice()); return; }
    for (let i = start; i <= ids.length - (count - selected.length); i++) {
      selected.push(ids[i]); add(i + 1, selected); selected.pop();
    }
  }
  add(0, []);
  return result;
}

test('every possible rotation preserves at least eight operators at every tier', () => {
  // NORMAL/HARD/ABYSS share a rotation table; the two FUNNY modes share their static exclusions.
  for (const [modeId, cases] of [['mode_multi_normal', 41580], ['mode_multi_funny', 36]]) {
    const gd = new GameData(DATA, modeId), counts = gd.bans(gd.difficulty);
    const eligible = gd.bondIds.filter(b => gd.bond(b).weight > 0 && !gd.modeInactiveBonds.has(b));
    const cores = combinations(eligible.filter(b => gd.bond(b).isCore), counts.core);
    const addons = combinations(eligible.filter(b => !gd.bond(b).isCore), counts.addon);
    assert.equal(cores.length * addons.length, cases, `${modeId}: complete enumeration`);
    const minima = Array(7).fill(Infinity);
    for (const core of cores) for (const addon of addons) {
      const off = new Set([...core, ...addon, ...gd.modeInactiveBonds]);
      const byTier = Array(7).fill(0);
      for (const id of gd.visibleChess) {
        const chess = gd.chess(id);
        if (!chess.bonds.length || !chess.bonds.every(b => off.has(b))) byTier[chess.tier]++;
      }
      for (let tier = 1; tier <= 6; tier++) minima[tier] = Math.min(minima[tier], byTier[tier]);
    }
    for (let tier = 1; tier <= 6; tier++) assert.ok(minima[tier] >= 8, `${modeId}: tier ${tier} minimum ${minima[tier]}`);
  }
});
