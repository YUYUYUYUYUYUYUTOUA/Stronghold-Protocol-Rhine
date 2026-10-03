// render/prepfield.js — where the prep board is shown (research 09 §1.2, DESIGN §3 / §15): normally the own board
// (rows 7–12, the stage grid as is); in the Final Assault / Hidden Core prep the player's pieces stand on THEIR half of
// the boss field — the sim's mapping (server/match/finalAssault.js bossFieldPlacement, sim Battle.mapTile / mapDir):
// board rows ≥ 7 → row − 7 (board 9–12 → boss 2–5, the bench row 7 → 0, the temp row 8 → 1); the right-hand player
// (side 'R') is mirrored col c → 20 − c with RIGHT ↔ LEFT (UP / DOWN unchanged, ConvertChessPositionInfoToBossMap).
// Pieces only ever stand on rows ≥ 7; other board rows (range tiles reaching past the field) shift the same way, so a
// DOWN range below the bench falls off the grid (row < 0) instead of landing on the boss rows, and `tilesToDisp` drops
// every tile that is not on the boss field (rows 0–6) — e.g. an UP range past the top wall onto the normal board.
//
// The view keeps every public coordinate in BOARD space (the server's, g.move targets, canPlace, highlightTiles,
// tileScreen, holdPiece, setPieceDir): only what is drawn and picked goes through this transform. Pure functions.
import { GEO } from '../../../shared/constants.js';

/** Circular range: transform the centre only; clip to the simulated field, never the reserve rows. */
export function circleToDisp(xf, circle) {
  if (!circle) return null;
  const p = xf.toDisp(circle.row, circle.col);
  return { ...circle, ...p, bounds: xf.kind === 'bossPrep' ? GEO.BOSS_RECT : GEO.NORMAL_RECT };
}

/** Board row → display (boss-field) row: row − 7 (server/match/board.js BOARD_ROWS_ABOVE_BOSS is +7, the inverse). */
export const BOSS_ROW_SHIFT = -7;
export const MAX_COL = 20;

const MIRROR = Object.freeze({ RIGHT: 'LEFT', LEFT: 'RIGHT', UP: 'UP', DOWN: 'DOWN' });

/** RIGHT ↔ LEFT (UP / DOWN unchanged); unknown values pass through. */
export function mirrorDir(d) {
  return typeof d === 'string' && MIRROR[d.toUpperCase()] ? MIRROR[d.toUpperCase()] : d;
}

/** The identity transform (normal prep). */
export const IDENTITY = Object.freeze({
  kind: 'board', side: 'L', mirror: false,
  toDisp: (row, col) => ({ row, col }),
  toBoard: (row, col) => ({ row, col }),
  dirToDisp: (d) => d,
  dirToBoard: (d) => d,
});

/**
 * Transform of the Final Assault prep on side 'L' | 'R' of the boss field. `toBoard` returns null for display tiles
 * that are not on the player's half of the boss rows (0–5) — nothing of the board is there.
 */
export function bossPrepField(side) {
  const R = side === 'R';
  const lo = R ? 10 : 0, hi = R ? MAX_COL : 10;
  return Object.freeze({
    kind: 'bossPrep', side: R ? 'R' : 'L', mirror: R,
    toDisp: (row, col) => ({ row: row + BOSS_ROW_SHIFT, col: R ? MAX_COL - col : col }),
    toBoard: (row, col) => {
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 5 || col < lo || col > hi) return null;
      return { row: row - BOSS_ROW_SHIFT, col: R ? MAX_COL - col : col };
    },
    dirToDisp: (d) => (R ? mirrorDir(d) : d),
    dirToBoard: (d) => (R ? mirrorDir(d) : d),
  });
}

/** Last display row of the boss field band (rows 0–5 + the wall row 6) in the Final Assault prep. */
export const BOSS_DISP_MAX_ROW = 6;

/**
 * Map a list of board tiles ([[r,c]] or [{row,col}]) to display tiles ([[r,c]]). In the Final Assault prep tiles that
 * do not land on the boss field (display rows 0–6, cols 0–20) are dropped.
 */
export function tilesToDisp(xf, tiles) {
  const out = [];
  if (!Array.isArray(tiles)) return out;
  const boss = xf && xf.kind === 'bossPrep';
  for (const t of tiles) {
    const r = Array.isArray(t) ? t[0] : t?.row, c = Array.isArray(t) ? t[1] : t?.col;
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    const d = xf.toDisp(r, c);
    if (boss && (d.row < 0 || d.row > BOSS_DISP_MAX_ROW || d.col < 0 || d.col > MAX_COL)) continue;
    out.push([d.row, d.col]);
  }
  return out;
}
