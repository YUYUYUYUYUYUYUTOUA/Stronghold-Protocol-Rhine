// Only actual Rem reinforcements opt out of ally tile occupancy. Other summons and operators keep their rules.
const IDS = new Set(['child', 'miner', 'combined', 'chef', 'enthusiast', 'food', 'bus', 'boss'].map(type => `token_rem_${type}`));

export function isRemMobile(unit) {
  return !!(unit?.remMobile && unit.side === 'ally' && unit.kind === 'token' && IDS.has(unit.defId));
}
