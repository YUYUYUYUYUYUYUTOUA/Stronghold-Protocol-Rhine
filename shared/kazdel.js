// Kazdel fan expansion. These values are shared by generated data, combat and the browser.
export const KAZDEL_BOND = 'kazdelShip';
export const KAZDEL_SOUL_TOKEN = 'token_kazdel_soul';
// Owner-approved equipment, 2026-10-10. Percentages use the ordinary additive stat pipeline.
export const KAZDEL_EQUIPMENT = Object.freeze({
  sigil: Object.freeze({ key: 'chess_item_kazdel_sigil', tier: 3, price: 2, hp: [-0.15, -0.20], attack: [0.25, 0.40] }),
  blade: Object.freeze({ key: 'chess_item_kazdel_blade', tier: 6, price: 4, hp: [-0.20, -0.25], attack: [0.40, 0.60],
    damageBonus: 0.20, comboDamageBonus: 0.35 }),
});
export const KAZDEL_CHARACTERS = Object.freeze({
  vigna: 'char_290_vigna', odda: 'char_4131_odda', meteorite: 'char_219_meteo',
  tinman: 'char_4151_tinman', paprika: 'char_4071_peper', hoederer: 'char_4088_hodrer',
  ines: 'char_4087_ines', mudrock: 'char_311_mudrok', logos: 'char_4133_logos', wisdel: 'char_1035_wisdel',
});
export const KAZDEL_BALANCE = Object.freeze({
  thresholds: Object.freeze([3, 6, 9]), bodyHpPerLayer: 10,
  soulHpRatio: 0.6, soulHpPerLayer: 10, soulAttackRatio: 0.8, soulAttackPerLayer: 3,
  soulsPerPiecePerBattle: null, // Unlimited: each real body death can create another soul.
});
export const KAZDEL_CANNON = Object.freeze({
  capacity: 15, chargePerSec: 1, chargePerLayer: 0.005, deathCharge: 3,
  minInterval: 3, warningDuration: 2, damageBase: 800, damagePerLayer: 15,
  radius: 2, friendlyFireStage: 2, friendlyFireRatio: 1,
});
/** Shared simulation/telegraph footprint: 5×5 minus four corners, clipped to the field. */
export function kazdelCannonTiles(x, y, bounds) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  const row = Math.round(y), col = Math.round(x), out = [], radius = KAZDEL_CANNON.radius;
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    if (Math.abs(dr) === radius && Math.abs(dc) === radius) continue;
    const r = row + dr, c = col + dc;
    if (!bounds || (r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1)) out.push([r, c]);
  }
  return out;
}
export const KAZDEL_GARRISON_KEYS = Object.freeze({
  vigna: 'KAZDEL_VIGNA_DEATH', odda: 'KAZDEL_ODDA_DEATH',
  meteorite: 'KAZDEL_METEORITE_SOUL_BLOCKED', tinman: 'KAZDEL_TINMAN_SOUL_AURA',
  paprika: 'KAZDEL_PAPRIKA_SOUL_HEAL', hoederer: 'KAZDEL_HOEDERER_DEATH',
  mudrock: 'KAZDEL_MUDROCK_SOUL_HP', logos: 'KAZDEL_LOGOS_SOUL_ATTACK', wisdel: 'KAZDEL_WISDEL_SOUL_DAMAGE',
});
/** Stage 0 is inactive; stages 1–3 correspond to the 3/6/9-member thresholds. */
export function kazdelStage(bond) {
  return bond?.active ? KAZDEL_BALANCE.thresholds.filter(n => Number(bond.count) >= n).length : 0;
}

/** Kazdel adds one core rotation slot; the Rhine-only baseline and seat reductions stay intact. */
export function applyKazdelOpeningBans(config) {
  config.bans ||= {};
  for (const [mode, core] of Object.entries({ FUNNY: 2, NORMAL: 5, HARD: 5, ABYSS: 5, TRAINING: 0 })) {
    config.bans[mode] = { ...config.bans[mode], core };
  }
  return config;
}
