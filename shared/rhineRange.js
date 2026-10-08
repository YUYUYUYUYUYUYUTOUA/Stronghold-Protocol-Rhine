// Research auras cover complete board cells, independently of facing. Moving targets are tested
// against the cell containing their centre, so placement highlights and live effects share a boundary.
import { RHINE_BALANCE as B, rhineDevice, rhineStage, rhineDeviceStage } from './rhineResearch.js';
import { GEO } from './constants.js';
import { t } from './i18n.js';

// Saria's skchr_demkni_3 (rangeId x-3): a 25-cell diamond, not the 29-cell radius-3 circle.
// Keep a shared shape so the sim, low/high graphics and descriptions use the same mature pulse.
export const CALCIFICATION_GRID = Object.freeze(Array.from({ length: 7 }, (_, i) => i - 3)
  .flatMap(r => Array.from({ length: 7 }, (_, i) => i - 3)
    .filter(c => Math.abs(r) + Math.abs(c) <= 3).map(c => Object.freeze([r, c]))));

export function energyPulseRange(stage = 0) {
  if (rhineStage(stage) === 0) return { radius: B.radius, grid: null, tileBased: false, deviceCentered: true };
  const tileBased = rhineStage(stage) >= 2;
  return { radius: tileBased ? 3 : B.energySpreadRadius, grid: tileBased ? CALCIFICATION_GRID : null, tileBased };
}

export function researchRange(piece) {
  const def = rhineDevice(typeof piece === 'string' ? piece : piece?.id ?? piece?.tokenId ?? piece?.defId);
  if (!def) return null;
  const stage = rhineDeviceStage(def, piece?.stage ?? piece?.researchStage);
  if (def.key === 'laser') return { key: def.key, radius: 0, grid: [], stage, global: true };
  const radius = B.radius + ((def.key === 'medical' && stage >= 2 || def.key === 'energy' && stage >= 1) ? 1 : 0);
  const grid = [];
  for (let r = -radius; r <= radius; r++) for (let c = -radius; c <= radius; c++) {
    if (Math.hypot(r, c) <= radius + 1e-9) grid.push([r, c]);
  }
  return { key: def.key, radius, grid, stage };
}

/** Complete cell membership. A target crosses the boundary when its centre enters the next cell. */
export function researchContainsTile(body, x, y, radius) {
  if (![body?.x, body?.y, x, y, radius].every(Number.isFinite) || radius < 0 || radius > 10) return false;
  const cx = Math.floor(x + .5), cy = Math.floor(y + .5);
  const has = (row, col) => (row - cy) ** 2 + (col - cx) ** 2 <= radius ** 2 + 1e-9;
  const a = body.hitArea;
  if (!a || ![a.w, a.h, a.dx ?? 0, a.dy ?? 0].every(Number.isFinite) || !(a.w > 0 && a.h > 0)) {
    return has(Math.floor(body.y + .5), Math.floor(body.x + .5));
  }
  // Giant bosses occupy every cell their hit rectangle overlaps, like an operator's grid attack.
  // Merely touching a cell along an edge does not count as entering that cell.
  const bx = body.x + (a.dx ?? 0), by = body.y + (a.dy ?? 0);
  const r0 = Math.max(0, cy - radius, Math.floor(by - a.h / 2 + .5 + 1e-9));
  const r1 = Math.min(GEO.ROWS - 1, cy + radius, Math.ceil(by + a.h / 2 - .5 - 1e-9));
  const c0 = Math.max(0, cx - radius, Math.floor(bx - a.w / 2 + .5 + 1e-9));
  const c1 = Math.min(GEO.COLS - 1, cx + radius, Math.ceil(bx + a.w / 2 - .5 - 1e-9));
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) if (has(row, col)) return true;
  return false;
}

/** Absolute covered cells, clipped to the current battle field (never the reserve pads). */
export function researchRangeTiles(row, col, radius, bounds = GEO.NORMAL_RECT) {
  if (![row, col, radius].every(Number.isFinite) || radius < 0 || radius > 10) return [];
  const tiles = [];
  for (let r = Math.max(bounds.r0, Math.ceil(row - radius)); r <= Math.min(bounds.r1, Math.floor(row + radius)); r++) {
    for (let c = Math.max(bounds.c0, Math.ceil(col - radius)); c <= Math.min(bounds.c1, Math.floor(col + radius)); c++) {
      if (researchContainsTile({ x: c, y: r }, col, row, radius)) tiles.push([r, c]);
    }
  }
  return tiles;
}

export function researchRangeText(piece) {
  const range = researchRange(piece);
  if (!range) return '';
  if (range.key === 'medical') return t('覆盖半径 {radius} 格内的整格区域（{tiles} 格），敌人持续减速50%；治疗本方干员及可受治疗的召唤物，包括机械水獭。二级起范围内本方干员接受任意来源治疗均获得护盾，自然生命回复不触发。三级扩大范围并周期束缚。', { radius: range.radius, tiles: range.grid.length });
  if (range.key === 'energy') {
    const pulse = energyPulseRange(range.stage);
    const charging = range.stage >= 1 ? t('己方全场干员释放技能均可充能') : t('半径 {radius} 格内己方干员释放技能时充能', { radius: B.radius });
    if (range.stage === 0) return t('{charging}；3点充能发射后命中装置半径 {radius} 格内全部敌人（{tiles} 格），无目标时保留满充能。', { charging, radius: range.radius, tiles: range.grid.length });
    const splash = pulse.tileBased ? t('主目标所在格为中心的钙质化 {tiles} 格菱形', { tiles: pulse.grid.length }) : t('主目标周围实际半径 {radius} 格', { radius: pulse.radius });
    return t('{charging}；主目标须在装置半径 {radius} 格内（{tiles} 格）。溅射为{splash}，可波及装置选敌范围外。满充无目标时保留，敌人进入后释放。', { charging, radius: range.radius, tiles: range.grid.length, splash });
  }
  return t('全场攻击，选择面板最大生命值最高的敌人，锁定至其死亡或永久离场；只有一级，仅9莱茵生命可用。持续输出每秒增伤5%，20秒达到上限并开始每秒追加最大生命值0.5%的真实伤害；领袖按本战场分摊血量计算。');
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
