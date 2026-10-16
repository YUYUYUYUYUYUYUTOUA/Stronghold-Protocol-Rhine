// Exact, read-only opening-BAN audit. Run explicitly; this is not part of the per-test hot path.
// node tools/audit-opening-pool.mjs [--mode mode_multi_normal] [--seats 1] [--data data]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GameData } from '../server/match/gamedata.js';
import { isOpeningShopChess, openingTierCounts, OPENING_TIER_FLOOR } from '../server/match/pool.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UPSTREAM_PIN = 'c24e17eec3af1e6dedfa9935a6d15245cf2f4586';
const RHINE_BASELINE = '45d962f7d10f6d81cc000e2d49f145d131545529';
const MAX_COMBINATIONS = 2_000_000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function choose(n, k) {
  k = Math.min(k, n - k);
  let total = 1;
  for (let i = 1; i <= k; i++) total = total * (n - k + i) / i;
  return Math.round(total);
}

function* combinations(values, count, from = 0, picked = []) {
  if (!count) { yield picked.slice(); return; }
  for (let i = from; i <= values.length - count; i++) {
    picked.push(values[i]);
    yield* combinations(values, count - 1, i + 1, picked);
    picked.pop();
  }
}

function stats() {
  return { count: 0, min: Array(6).fill(Infinity), max: Array(6).fill(0), sum: Array(6).fill(0) };
}

function addStats(target, counts) {
  target.count++;
  for (let tier = 0; tier < 6; tier++) {
    target.min[tier] = Math.min(target.min[tier], counts[tier]);
    target.max[tier] = Math.max(target.max[tier], counts[tier]);
    target.sum[tier] += counts[tier];
  }
}

function finishStats(target) {
  if (!target.count) return { count: 0, min: null, max: null, mean: null };
  return {
    count: target.count, min: target.min, max: target.max,
    mean: target.sum.map(n => Number((n / target.count).toFixed(6))),
  };
}

function setup(gd) {
  const requested = gd.bans(gd.difficulty);
  const staticOff = [...gd.modeInactiveBonds].filter(id => gd.bond(id)).sort();
  const eligible = gd.bondIds.filter(id => Number(gd.bond(id)?.weight) > 0 && !gd.modeInactiveBonds.has(id));
  const core = eligible.filter(id => gd.bond(id).isCore);
  const addon = eligible.filter(id => !gd.bond(id).isCore);
  const drawn = { core: Math.min(requested.core, core.length), addon: Math.min(requested.addon, addon.length) };
  const roster = gd.visibleChess.filter(id => isOpeningShopChess(gd, id));
  return { requested, staticOff, core, addon, drawn, roster };
}

function signature(gd) {
  const state = setup(gd);
  return JSON.stringify({
    ...state,
    roster: state.roster.map(id => [id, gd.tierOf(id), gd.chess(id).bonds]),
  });
}

function audit(gd) {
  const state = setup(gd);
  const total = choose(state.core.length, state.drawn.core) * choose(state.addon.length, state.drawn.addon);
  if (!Number.isSafeInteger(total) || total > MAX_COMBINATIONS) {
    throw new Error(`${gd.modeId}: ${total} combinations exceed the explicit audit limit ${MAX_COMBINATIONS}`);
  }
  const all = stats(), accepted = stats();
  let firstAccepted = null, firstRejected = null;
  for (const core of combinations(state.core, state.drawn.core)) {
    for (const addon of combinations(state.addon, state.drawn.addon)) {
      const drawn = [...core, ...addon].sort();
      // Reuse the runtime helper, including its positive-cap and tier 1..6 eligibility rules.
      const counts = openingTierCounts(gd, [...state.staticOff, ...drawn]);
      addStats(all, counts);
      if (counts.every(n => n >= OPENING_TIER_FLOOR)) {
        addStats(accepted, counts);
        firstAccepted ||= { drawn, counts };
      } else firstRejected ||= { drawn, counts };
    }
  }
  if (all.count !== total) throw new Error(`${gd.modeId}: enumeration count mismatch`);
  return {
    mode: gd.modeId, startingPlayerCount: gd.startingPlayerCount,
    requestedBans: state.requested, effectiveBans: state.drawn,
    eligibleBonds: { core: state.core.length, addon: state.addon.length },
    staticOff: state.staticOff,
    sharedSpecies: state.roster.length,
    sharedSpeciesByTier: openingTierCounts(gd, []),
    beforeRandomBansByTier: openingTierCounts(gd, state.staticOff),
    all: finishStats(all), accepted: finishStats(accepted),
    rejected: all.count - accepted.count,
    acceptanceRate: accepted.count / all.count,
    firstAccepted, firstRejected,
  };
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--help') {
      console.log('node tools/audit-opening-pool.mjs [--mode MODE] [--seats 1..6] [--data DIRECTORY]');
      return;
    }
    if (!['--mode', '--seats', '--data'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${key}`);
    }
    options[key.slice(2)] = args[++i];
  }
  const seats = Number(options.seats ?? 1);
  if (!Number.isInteger(seats) || seats < 1 || seats > 6) throw new Error('--seats must be an integer from 1 to 6');
  const dataDir = options.data ? path.resolve(options.data) : path.join(ROOT, 'data');
  const data = {}, fileSha256 = {};
  for (const name of ['config', 'chess', 'bonds']) {
    const bytes = fs.readFileSync(path.join(dataDir, `${name}.json`));
    fileSha256[`${name}.json`] = sha256(bytes);
    data[name] = JSON.parse(bytes);
  }
  const modes = options.mode ? [options.mode] : ['mode_multi_normal', 'mode_single_funny'];
  const cases = modes.map(mode => {
    if (!Object.hasOwn(data.config.modes, mode)) throw new Error(`Unknown mode: ${mode}`);
    const gd = new GameData(data, mode, seats);
    const result = audit(gd);
    // Check which shipped mode/seat cases have exactly the same roster, bans and inactive bonds.
    const key = signature(gd);
    result.equivalentCases = [];
    for (const [id, config] of Object.entries(data.config.modes)) {
      if (!config.inScope) continue;
      const matchingSeats = [];
      for (let n = 1; n <= (config.type === 'MULTI' ? 6 : 1); n++) {
        if (signature(new GameData(data, id, n)) === key) matchingSeats.push(n);
      }
      if (matchingSeats.length) result.equivalentCases.push({ mode: id, startingPlayerCounts: matchingSeats });
    }
    return result;
  });
  const asbestos = Object.values(data.chess).filter(c => c.charId === 'char_378_asbest' && !c.isGolden)
    .map(c => ({ id: c.chessId, bonds: c.bonds }));
  console.log(JSON.stringify({
    upstream: { tag: 'v0.3.0', commit: UPSTREAM_PIN }, rhineBaseline: RHINE_BASELINE,
    fileSha256, inputSha256: sha256(JSON.stringify(fileSha256)),
    tierFloor: OPENING_TIER_FLOOR, maxCombinations: MAX_COMBINATIONS, asbestos, cases,
  }, null, 2));
  if (cases.some(result => result.accepted.count === 0)) process.exitCode = 1;
}

try { main(); } catch (error) {
  console.error(`[opening-pool audit] ${error.message}`);
  process.exitCode = 1;
}
