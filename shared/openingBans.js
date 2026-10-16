// Generated base rotation. One to four starting seats add one core and two add-on
// bans; five and six retain their previous one/two core reductions. Training stays zero.
export const OPENING_BANS = Object.freeze({
  FUNNY: Object.freeze({ core: 2, addon: 1 }),
  NORMAL: Object.freeze({ core: 5, addon: 4 }),
  HARD: Object.freeze({ core: 5, addon: 4 }),
  ABYSS: Object.freeze({ core: 5, addon: 4 }),
  TRAINING: Object.freeze({ core: 0, addon: 0 }),
});

/**
 * Effective opening draw counts for a fixed starting roster (humans and AI alike).
 * This is a pure view of the base configuration; runtime matches never rewrite build data.
 * @param {string} difficulty
 * @param {number} [startingPlayerCount=1] occupied seats when the match starts, not players still alive
 * @param {object} [configuredBans=OPENING_BANS] config.bans (partial entries use the base defaults)
 * @returns {{ core: number, addon: number }}
 */
export function openingBanCounts(difficulty, startingPlayerCount = 1, configuredBans = OPENING_BANS) {
  const defaults = Object.hasOwn(OPENING_BANS, difficulty) ? OPENING_BANS[difficulty] : { core: 0, addon: 0 };
  const configured = configuredBans && typeof configuredBans === 'object' && Object.hasOwn(configuredBans, difficulty)
    ? configuredBans[difficulty] : null;
  const core = Number.isInteger(configured?.core) && configured.core >= 0 ? configured.core : defaults.core;
  const addon = Number.isInteger(configured?.addon) && configured.addon >= 0 ? configured.addon : defaults.addon;
  const coreReduction = difficulty === 'TRAINING' ? 0 : startingPlayerCount === 6 ? 2 : startingPlayerCount === 5 ? 1 : 0;
  const smallLobby = difficulty !== 'TRAINING' && startingPlayerCount >= 1 && startingPlayerCount <= 4;
  return { core: Math.max(0, core - coreReduction) + (smallLobby ? 1 : 0), addon: addon + (smallLobby ? 2 : 0) };
}

/** Idempotent overlay, shared by incremental Rhine updates and a full upstream data rebuild. */
export function applyOpeningBans(config) {
  config.bans ||= {};
  for (const [difficulty, counts] of Object.entries(OPENING_BANS)) {
    config.bans[difficulty] = { ...config.bans[difficulty], ...counts };
  }
  return config;
}
