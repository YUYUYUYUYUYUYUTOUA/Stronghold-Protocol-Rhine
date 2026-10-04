// Rhine is the ninth rotating core bond. One extra core draw keeps five full core rosters
// available in both standard (FUNNY) and NORMAL+ games. The guided training roster is unchanged.
export const OPENING_BANS = Object.freeze({
  FUNNY: Object.freeze({ core: 1, addon: 1 }),
  NORMAL: Object.freeze({ core: 4, addon: 4 }),
  HARD: Object.freeze({ core: 4, addon: 4 }),
  ABYSS: Object.freeze({ core: 4, addon: 4 }),
  TRAINING: Object.freeze({ core: 0, addon: 0 }),
});

/** Idempotent overlay, shared by incremental Rhine updates and a full upstream data rebuild. */
export function applyOpeningBans(config) {
  config.bans ||= {};
  for (const [difficulty, counts] of Object.entries(OPENING_BANS)) {
    config.bans[difficulty] = { ...config.bans[difficulty], ...counts };
  }
  return config;
}
