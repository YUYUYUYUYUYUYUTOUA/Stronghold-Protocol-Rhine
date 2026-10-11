// Six-seat milestone rewards are a separate system supply, never reservations in the finite shop stock.
export const ROUND_BEACON_ITEM = 'chess_item_5_04_e_a';
export function isMilestoneBeacon(piece) {
  return piece?.id === ROUND_BEACON_ITEM && [10, 12, 14].includes(piece.meta?.sixPlayerBeaconRound);
}
export function milestoneBeaconRound(match, itemId, source) {
  return source === 'sixPlayerBeacon' && itemId === ROUND_BEACON_ITEM && !match.isSolo &&
    match.startingPlayerCount === 6 && [10, 12, 14].includes(match.round) ? match.round : null;
}
