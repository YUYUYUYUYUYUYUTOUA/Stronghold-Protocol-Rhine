import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_BANS, applyOpeningBans, openingBanCounts } from '../../shared/openingBans.js';
import { GameData } from '../../server/match/gamedata.js';
import { drawDisabledBonds, SharedPool, openingTierCounts } from '../../server/match/pool.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA, makeMatch } from './harness.js';

const NEW_CHESS = ['chess_rhine_astgenne_a', 'chess_rhine_magallan_a'];
const modes = Object.entries(DATA.config.modes);

test('Rhine opening overlay is idempotent, preserves the subset rule and leaves training unbanned', () => {
  const config = { bans: { NORMAL: { core: 3, addon: 4 }, rule: 'all bonds must be off' } };
  applyOpeningBans(config);
  const once = structuredClone(config);
  applyOpeningBans(config);
  assert.deepEqual(config, once, 'running the overlay twice never adds another slot');
  assert.equal(config.bans.rule, 'all bonds must be off');
  assert.deepEqual(config.bans.NORMAL, { core: 5, addon: 4 });
  assert.deepEqual(config.bans.FUNNY, { core: 2, addon: 1 });
  assert.deepEqual(config.bans.TRAINING, { core: 0, addon: 0 });
  for (const difficulty of Object.keys(OPENING_BANS)) {
    assert.deepEqual(DATA.config.bans[difficulty], OPENING_BANS[difficulty], difficulty);
  }
  assert.deepEqual(new GameData({}, 'unknown').bans('NORMAL'), { core: 6, addon: 6 }, 'partial-data fallback agrees');
});

test('small starting rosters add one core and two add-on draws; five/six-seat reductions and training stay fixed', () => {
  for (const [difficulty, base] of Object.entries(OPENING_BANS)) {
    for (let count = 1; count <= 6; count++) {
      const reduction = difficulty === 'TRAINING' ? 0 : count === 6 ? 2 : count === 5 ? 1 : 0;
      const small = count <= 4 && difficulty !== 'TRAINING';
      const expected = { core: Math.max(0, base.core - reduction + (small ? 1 : 0)), addon: base.addon + (small ? 2 : 0) };
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
  assert.deepEqual(openingBanCounts('HARD', 6, { HARD: { core: -1, addon: '4' } }), { core: 3, addon: 4 }, 'invalid values use base defaults');
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
      const expected = openingBanCounts(difficulty, count, DATA.config.bans);
      assert.equal(pub.startingPlayerCount, count);
      assert.deepEqual(pub.openingBans, expected, `${difficulty}, ${count} seats including ${roster.bots || 0} AI`);
      assert.deepEqual(m.gd.bans(difficulty), expected);
      assert.equal(pub.drawnDisabledBonds.filter(id => m.gd.bond(id).isCore).length, expected.core);
      assert.equal(pub.drawnDisabledBonds.filter(id => !m.gd.bond(id).isCore).length, expected.addon);
      const drawn = new Set(pub.drawnDisabledBonds), off = new Set(pub.disabledBonds);
      const coreRosters = m.gd.bondIds.filter(id => m.gd.bond(id).isCore && m.gd.bond(id).weight > 0 && !m.gd.modeInactiveBonds.has(id));
      assert.equal(coreRosters.filter(id => !drawn.has(id)).length, coreRosters.length - expected.core, 'enough undrawn core rosters remain');
      if (difficulty !== 'FUNNY') assert.equal(coreRosters.filter(id => !drawn.has(id)).length, 6 + reduction - (count <= 4 ? 1 : 0),
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

test('small-roster rotations retain eight shared operators per tier and use the all-bonds ban rule', () => {
  for (const [modeId, mode] of modes) {
    const gd = new GameData(DATA, modeId);
    const expected = gd.bans(mode.difficulty);
    for (let seed = 1; seed <= 100; seed++) {
      const bans = drawDisabledBonds(gd, createRng(seed));
      const drawn = new Set(bans.drawn), off = new Set([...bans.drawn, ...bans.staticOff]);
      const cores = gd.bondIds.filter(id => gd.bond(id).isCore && gd.bond(id).weight > 0 && !gd.modeInactiveBonds.has(id));
      assert.equal(cores.filter(id => drawn.has(id)).length, expected.core, `${modeId}: core draws`);
      assert.equal(bans.drawn.length, expected.core + expected.addon, `${modeId}: total slots`);
      if (mode.difficulty === 'TRAINING') assert.deepEqual(bans.banned, []);
      else assert.ok(openingTierCounts(gd, off).every(n => n >= 8), `${modeId}: per-tier floor`);
      const pool = new SharedPool(gd, { banned: bans.banned });
      for (const id of NEW_CHESS) {
        const chess = gd.chess(id);
        assert.ok(chess && chess.visible, `${id}: new visible operator`);
        assert.equal(pool.has(id), !chess.bonds.every(b => off.has(b)), `${modeId}, seed ${seed}: ${id}`);
      }
      assert.equal(pool.has('chess_rhine_magallan_a'), !off.has('rhineShip'), 'Rhine-only Magallan follows the core rotation');
      assert.equal(pool.has('chess_rhine_astgenne_a'), !(off.has('rhineShip') && off.has('preciShip')), 'Precision can keep Astgenne in the pool');
      for (let level = 1; level <= 6; level++) {
        const id = pool.roll(createRng(seed * 10 + level), { maxTier: level });
        assert.ok(id && pool.has(id) && gd.tierOf(id) <= level, `${modeId}: legal shop roll at ${level}`);
      }
    }
  }
});

test('the match publishes the extra slot and its banned list agrees with the shared pool', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    const h = makeMatch({ mode: 'coop', difficulty, humans: 1, seed: 31 }).start();
    const pub = h.m.publicView(), expected = h.m.gd.bans(difficulty);
    assert.equal(pub.drawnDisabledBonds.length, expected.core + expected.addon);
    assert.deepEqual([...pub.bannedChess].sort(), [...h.m.pool.banned].sort());
    assert.equal(h.m.pool.entries.size + pub.bannedChess.length, 134);
    h.m.dispose();
  }
});

test('a repeated invalid draw reaches a finite valid fallback without weakening BAN counts', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const invalid = new Set(['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'egirShip', 'remShip',
    'preciShip', 'skillfulShip', 'arcaneShip', 'steadShip', 'deputShip', 'raidShip']);
  assert.equal(openingTierCounts(gd, invalid)[0], 7);
  let shuffles = 0;
  const rng = Object.assign(() => 0, { shuffle(a) { shuffles++; return a.sort((a, b) => Number(invalid.has(b)) - Number(invalid.has(a))); } });
  const bans = drawDisabledBonds(gd, rng);
  assert.equal(shuffles, 128, '64 bounded attempts, each with one shuffle per group');
  assert.equal(bans.drawn.length, 12);
  assert.ok(openingTierCounts(gd, [...bans.drawn, ...bans.staticOff]).every(n => n >= 8));
});

test('an impossible custom shared roster fails promptly instead of rerolling forever', () => {
  const chess = Object.fromEntries(Object.entries(DATA.chess).filter(([, c]) => c.tier !== 1));
  const gd = new GameData({ ...DATA, chess }, 'mode_multi_normal');
  const rng = Object.assign(() => { throw new Error('must not draw'); }, { shuffle() { throw new Error('must not draw'); } });
  assert.throws(() => drawDisabledBonds(gd, rng), /base shared pool has fewer than eight/);
});
