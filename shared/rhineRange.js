// Research auras use Euclidean distance, independently of facing. Tile centres are a placement aid;
// the clipped circle is the actual boundary (moving enemies need not stand at tile centres).
import { RHINE_BALANCE as B, rhineDevice, rhineStage } from './rhineResearch.js';
import { GEO } from './constants.js';

export function researchRange(piece) {
  const def = rhineDevice(typeof piece === 'string' ? piece : piece?.id ?? piece?.tokenId ?? piece?.defId);
  if (!def) return null;
  const stage = rhineStage(piece?.stage ?? piece?.researchStage);
  const radius = B.radius + (def.key === 'ecology' && stage >= 2 ? 1 : 0);
  const grid = [];
  for (let r = -radius; r <= radius; r++) for (let c = -radius; c <= radius; c++) {
    if (Math.hypot(r, c) <= radius + 1e-9) grid.push([r, c]);
  }
  return { key: def.key, radius, grid, stage };
}

export function researchRangeText(piece) {
  const range = researchRange(piece);
  if (!range) return '';
  if (range.key === 'medical') return `圆形半径 ${B.radius} 格；治疗本方干员及可受治疗的召唤物。突破不扩大范围。`;
  if (range.key === 'energy') return `充能干员与主目标均在圆形半径 ${B.radius} 格内；突破Ⅰ起，溅射主目标周围半径 ${B.energySpreadRadius} 格，可波及装置范围外。`;
  return `当前圆形半径 ${range.radius} 格；原型及突破Ⅰ为 ${B.radius} 格，突破Ⅱ为 ${B.radius + 1} 格。每 ${B.ecologyInterval} 秒开启 ${B.ecologyDuration} 秒。`;
}

/** Polygon clipped to a tile's square. Coordinates throughout are [column, row]. */
function clip(poly, axis, edge, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ai = sign * (a[axis] - edge) >= -1e-10, bi = sign * (b[axis] - edge) >= -1e-10;
    if (ai) out.push(a);
    if (ai !== bi) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** A smooth circle cut into tile-top polygons, so raised terrain and map edges clip it correctly. */
export function circleRangeSections(row, col, radius, bounds = { r0: 0, r1: GEO.ROWS - 1, c0: 0, c1: GEO.COLS - 1 }) {
  if (![row, col, radius].every(Number.isFinite) || !(radius > 0) || radius > 10) return [];
  const circle = Array.from({ length: 128 }, (_, i) => {
    const a = i * Math.PI / 64;
    return [col + radius * Math.cos(a), row + radius * Math.sin(a)];
  });
  const out = [];
  for (let r = Math.max(bounds.r0, Math.ceil(row - radius - .5)); r <= Math.min(bounds.r1, Math.floor(row + radius + .5)); r++) {
    for (let c = Math.max(bounds.c0, Math.ceil(col - radius - .5)); c <= Math.min(bounds.c1, Math.floor(col + radius + .5)); c++) {
      let polygon = circle;
      for (const [axis, edge, sign] of [[0,c-.5,1],[0,c+.5,-1],[1,r-.5,1],[1,r+.5,-1]]) polygon = clip(polygon, axis, edge, sign);
      if (polygon.length < 3) continue;
      // Only the original circle's edges get a strong outline; tile clipping edges remain invisible.
      const arcs = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const tileEdge = Math.abs(a[0]-b[0]) < 1e-9 && (Math.abs(a[0]-c+.5)<1e-9 || Math.abs(a[0]-c-.5)<1e-9)
          || Math.abs(a[1]-b[1]) < 1e-9 && (Math.abs(a[1]-r+.5)<1e-9 || Math.abs(a[1]-r-.5)<1e-9);
        if (!tileEdge) arcs.push([a,b]);
      }
      out.push({ row: r, col: c, polygon, arcs });
    }
  }
  return out;
}
