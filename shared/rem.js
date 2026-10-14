// Owner-approved Rim Billiton first-pass balance, 2026-10-13. No enemy difficulty multipliers.
export const REM_BOND = 'remShip';
export const REM_POOLS = Object.freeze([
  Object.freeze({ child: 45, miner: 45, chef: 10 }),
  Object.freeze({ child: 36, miner: 36, chef: 20, enthusiast: 8 }),
  Object.freeze({ child: 35, miner: 35, chef: 20, enthusiast: 10 }),
]);
export const REM_LIMITS = Object.freeze([6, 12, 16]);
export const REM_INTERVALS = Object.freeze([10, 8, 6]);
export const REM_BATCHES = Object.freeze([1, 2, 3]);
export const REM_OPENING = Object.freeze([2, 2, 3]);
export function remStage(bond) { return bond?.active ? [3, 6, 9].filter(n => Number(bond.count) >= n).length : 0; }
/** Exactly one 2% combination trial per slot; chef exclusion only renormalizes the subsequent pool. */
export function remPick(rng, stage, chefAvailable = true) {
  if (rng() < 0.02) return 'combined';
  const pool = Object.entries(REM_POOLS[Math.max(0, Math.min(2, stage - 1))]).filter(([type]) => type !== 'chef' || chefAvailable);
  const total = pool.reduce((sum, [, n]) => sum + n, 0);
  let value = rng() * total;
  for (const [type, n] of pool) { value -= n; if (value < 0) return type; }
  return pool[pool.length - 1][0];
}
