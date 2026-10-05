import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_BANS, applyOpeningBans, openingBanCounts } from '../../shared/openingBans.js';
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

test('five starting seats reduce core draws by one, six by two; other seats and training retain their base counts', () => {
  for (const [difficulty, base] of Object.entries(OPENING_BANS)) {
    for (let count = 1; count <= 6; count++) {
      const reduction = difficulty === 'TRAINING' ? 0 : count === 6 ? 2 : count === 5 ? 1 : 0;
      const expected = { core: Math.max(0, base.core - reduction), addon: base.addon };
      assert.deepEqual(openingBanCounts(difficulty, count), expected, `${difficulty}, ${count} seats`);
      assert.deepEqual(new GameData({}, `mode_multi_${difficulty.toLowerCase()}`, count).bans(difficulty), expected,
        `${difficulty}, ${count} seats: partial-data defaults`);
    }
  }
  const configured = { NORMAL: { core: 2, addon: 7 }, FUNNY: { core: 0, addon: 1 } };
  const before = structuredClone(configured);
  assert.deepEqual(openingBanCounts('NORMAL', 5, configured), { core: 1, addon: 7 });
  assert.deepEqual(openingBanCounts('NORMAL', 6, configured), { core: 0, addon: 7 });
  assert.deepEqual(openingBanCounts('FUNNY', 6, configured), { core: 0, addon: 1 }, 'core counts never become negative');
  assert.deepEqual(openingBanCounts('HARD', 6, { HARD: { core: -1, addon: '4' } }), { core: 2, addon: 4 }, 'invalid values use base defaults');
  assert.deepEqual(configured, before, 'effective counts never mutate configuration');
});

test('actual matches count occupied human and AI seats and publish the effective rotation and legal shared roster', () => {
  const baseBefore = structuredClone(DATA.config.bans);
  const rosters = [
    { humans: 1 }, { humans: 2 }, { humans: 3 }, { humans: 4 }, { humans: 5 }, { humans: 6 },
    { humans: 1, bots: 3 }, { humans: 1, bots: 4 }, { humans: 1, bots: 5 },
  ];
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) for (const roster of rosters) {
    const count = roster.humans + (roster.bots || 0);
    const h = makeMatch({ mode: 'coop', difficulty, ...roster, seed: 31 }).start();
    try {
      const m = h.m, pub = m.publicView();
      const reduction = count === 6 ? 2 : count === 5 ? 1 : 0;
      const expected = { core: Math.max(0, OPENING_BANS[difficulty].core - reduction), addon: OPENING_BANS[difficulty].addon };
      assert.equal(pub.startingPlayerCount, count);
      assert.deepEqual(pub.openingBans, expected, `${difficulty}, ${count} seats including ${roster.bots || 0} AI`);
      assert.deepEqual(m.gd.bans(difficulty), expected);
      assert.equal(pub.drawnDisabledBonds.filter(id => m.gd.bond(id).isCore).length, expected.core);
      assert.equal(pub.drawnDisabledBonds.filter(id => !m.gd.bond(id).isCore).length, expected.addon);
      const drawn = new Set(pub.drawnDisabledBonds), off = new Set(pub.disabledBonds);
      const coreRosters = m.gd.bondIds.filter(id => m.gd.bond(id).isCore && m.gd.bond(id).weight > 0 && !m.gd.modeInactiveBonds.has(id));
      assert.equal(coreRosters.filter(id => !drawn.has(id)).length, coreRosters.length - expected.core, 'enough undrawn core rosters remain');
      if (difficulty !== 'FUNNY') assert.equal(coreRosters.filter(id => !drawn.has(id)).length, 5 + reduction,
        'six seats retain one more core roster than five seats');
      assert.deepEqual([...pub.bannedChess].sort(), [...m.pool.banned].sort());
      for (const id of m.gd.visibleChess) {
        const bonds = m.gd.chess(id).bonds || [];
        const forbidden = bonds.length > 0 && bonds.every(b => off.has(b));
        assert.equal(m.pool.has(id), !forbidden, `${difficulty}, ${count} seats: ${id} pool eligibility`);
      }
      h.toPrep(1);
      for (const player of m.order) for (const slot of player.shop.slots) {
        if (slot.kind === 'chess') assert.ok(m.pool.has(slot.id), `${player.playerId}: shop excludes forbidden chess`);
      }
      h.invariants();
      assert.equal(m.errorCount, 0);
    } finally { h.m.dispose(); }
  }
  assert.deepEqual(DATA.config.bans, baseBefore, 'mixed-size matches leave shared base data untouched');
});

test('the opening roster is fixed across disconnect, elimination, quit and reconnect', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) for (const count of [5, 6]) {
    const h = makeMatch({ mode: 'coop', difficulty, humans: count, seed: 73 }).start();
    try {
      h.toPrep(1);
      const m = h.m;
      const before = m.publicView(), poolIds = [...m.pool.entries.keys()];
      m.onDisconnect('p_1');
      h.ps('p_2').lp = 0;
      h.ps('p_2').eliminate(1);
      m.onLeave(`p_${count - 1}`);
      m.onReconnect('p_1');
      const after = m.publicView();
      assert.equal(m.alivePlayers().length, count - 2, 'the live roster crossed the five-seat threshold');
      assert.equal(after.startingPlayerCount, count);
      assert.deepEqual(after.openingBans, before.openingBans);
      assert.deepEqual(m.gd.bans(difficulty), before.openingBans);
      assert.deepEqual(after.drawnDisabledBonds, before.drawnDisabledBonds, 'no mid-match reroll');
      assert.deepEqual(after.bannedChess, before.bannedChess);
      assert.deepEqual([...m.pool.entries.keys()], poolIds);
      assert.deepEqual(h.lastTo('p_1', 'm.public').openingBans, before.openingBans, 'resync reports original counts');
      after.openingBans.core = 99;
      assert.deepEqual(m.publicView().openingBans, before.openingBans, 'views cannot mutate match counts');
      h.invariants();
    } finally { h.m.dispose(); }
  }
});

test('guided training still draws no core or add-on bonds in the actual match', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'TRAINING', humans: 1, seed: 91 }).start();
  try {
    const pub = h.m.publicView();
    assert.deepEqual(pub.openingBans, { core: 0, addon: 0 });
    assert.deepEqual(pub.drawnDisabledBonds, []);
    assert.deepEqual(pub.bannedChess, []);
  } finally { h.m.dispose(); }
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

test('every possible base or five/six-seat rotation preserves at least eight operators at every tier', () => {
  // NORMAL/HARD/ABYSS share a rotation table; the two FUNNY modes share their static exclusions.
  for (const [modeId, count, cases] of [
    ['mode_multi_normal', 1, 41580], ['mode_multi_funny', 1, 36],
    ['mode_multi_normal', 5, 27720], ['mode_multi_normal', 6, 11880], ['mode_multi_funny', 6, 6],
  ]) {
    const gd = new GameData(DATA, modeId, count), counts = gd.bans(gd.difficulty);
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
