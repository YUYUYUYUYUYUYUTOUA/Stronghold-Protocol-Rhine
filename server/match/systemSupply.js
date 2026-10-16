// System rewards keep their own copies across item merges; they never occupy or repay shared equipment stock.
import { isMilestoneBeacon } from './beaconSupply.js';

export const ROUND_COMMUNICATOR_ITEM = 'chess_item_2_06_e_a';
export const COMMUNICATOR_ROUNDS = Object.freeze([3, 7]);

export function communicatorSupplyRound(match, itemId, source) {
  return source === 'roundCommunicator' && itemId === ROUND_COMMUNICATOR_ITEM &&
    COMMUNICATOR_ROUNDS.includes(match.round) ? match.round : null;
}

export function independentItemCopies(gd, piece) {
  if (!piece || piece.kind !== 'item') return 0;
  const copies = gd.isGolden(piece.id) ? 2 : 1;
  if (isMilestoneBeacon(piece)) return copies;
  if (gd.baseIdOf(piece.id) !== ROUND_COMMUNICATOR_ITEM) return 0;
  return Math.min(copies, Math.max(0, Math.floor(piece.meta?.systemSupplyCopies || 0)));
}

export function sharedItemCopies(gd, piece) {
  return Math.max(0, (gd.isGolden(piece.id) ? 2 : 1) - independentItemCopies(gd, piece));
}
