// Base rotation for one to four starting seats. A match with five or six occupied seats
// keeps one more core roster available; add-on draws and guided training are unchanged.
export const OPENING_BANS = Object.freeze({
  FUNNY: Object.freeze({ core: 1, addon: 1 }),
  NORMAL: Object.freeze({ core: 4, addon: 4 }),
  HARD: Object.freeze({ core: 4, addon: 4 }),
  ABYSS: Object.freeze({ core: 4, addon: 4 }),
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
  const extraCoreRoster = difficulty !== 'TRAINING' && (startingPlayerCount === 5 || startingPlayerCount === 6);
  return { core: Math.max(0, core - (extraCoreRoster ? 1 : 0)), addon };
}

/** Idempotent overlay, shared by incremental Rhine updates and a full upstream data rebuild. */
export function applyOpeningBans(config) {
  config.bans ||= {};
  for (const [difficulty, counts] of Object.entries(OPENING_BANS)) {
    config.bans[difficulty] = { ...config.bans[difficulty], ...counts };
  }
  return config;
}
