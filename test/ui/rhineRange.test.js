import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchRange, researchRangeText, circleRangeSections } from '../../shared/rhineRange.js';
import { RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { GEO } from '../../shared/constants.js';
import { bodyInRadius } from '../../server/sim/body.js';
import { previewGrid } from '../../public/js/ui/facing.js';
import { showRange } from '../../public/js/ui/facingWheel.js';
import { bossPrepField, circleToDisp, IDENTITY } from '../../public/js/render/prepfield.js';
import { TileField } from '../../public/js/render/tiles.js';
import { TokenDetail } from '../../public/js/ui/detailPanel.js';

const device = (key, stage = 0) => ({ kind: 'token', id: RHINE_DEVICES.find(d => d.key === key).tokenId, research: true, stage });
const area = poly => Math.abs(poly.reduce((sum, a, i) => {
  const b = poly[(i + 1) % poly.length];
  return sum + a[0] * b[1] - a[1] * b[0];
}, 0)) / 2;
const full = { r0: 0, r1: 18, c0: 0, c1: 20 };

test('device previews match the battle radius, including the boundary, at every breakthrough', () => {
  for (const key of ['medical', 'energy', 'ecology']) for (const stage of [0, 1, 2]) {
    const piece = device(key, stage), range = researchRange(piece);
    assert.equal(range.radius, key === 'ecology' && stage === 2 ? 3 : 2);
    assert.equal(range.grid.length, range.radius === 3 ? 29 : 13);
    assert.deepEqual(previewGrid({ getToken: () => ({ rangeGrid: [[0, 0]] }) }, piece), range.grid,
      'the legacy one-square token grid must not override the current breakthrough');
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      assert.equal(range.grid.some(([r, c]) => r === y && c === x), bodyInRadius({ x, y }, 0, 0, range.radius));
    }
    assert.ok(bodyInRadius({ x: range.radius, y: 0 }, 0, 0, range.radius));
    assert.equal(bodyInRadius({ x: range.radius, y: .01 }, 0, 0, range.radius), false);
  }
});

test('stage is normalized and battle researchStage metadata also selects the larger circle', () => {
  assert.equal(researchRange(device('ecology', 9)).radius, 3);
  assert.equal(researchRange(device('ecology', -1)).radius, 2);
  assert.equal(researchRange(device('ecology', NaN)).radius, 2);
  assert.equal(researchRange({ defId: device('ecology').id, researchStage: 2 }).radius, 3);
  assert.equal(researchRange({ kind: 'chess', id: 'ordinary' }), null);
});

test('preplacement needs no facing, changing facing does not rotate the circle, and cleanup clears it', () => {
  const calls = [], view = { highlightTiles: (...args) => calls.push(args) };
  const range = researchRange(device('ecology'));
  const style = { group: 'researchPreview', color: 0x00ff00 };
  let first;
  for (const dir of [null, 'UP', 'RIGHT', 'DOWN', 'LEFT']) {
    const tiles = showRange(view, range.grid, 10, 6, dir, style, range.radius);
    if (!first) first = tiles;
    assert.deepEqual(tiles, first);
    assert.deepEqual(calls.at(-1)[1].circle, { row: 10, col: 6, radius: 2 });
  }
  const mature = researchRange(device('ecology', 2));
  assert.equal(showRange(view, mature.grid, 10, 6, 'LEFT', style, mature.radius).length, 29);
  assert.equal(calls.at(-1)[1].circle.radius, 3);
  showRange(view, null, 0, 0, null, style);
  assert.deepEqual(calls.at(-1), [[], style]);
  assert.deepEqual(showRange(view, [[0, 0], [0, 1]], 10, 6, 'UP', style), [[10, 6], [11, 6]],
    'ordinary directional previews retain the existing contract');
  assert.equal(calls.at(-1)[1].circle, undefined);
});

test('smooth circle sections cover the Euclidean disc, never square corners or outside cells', () => {
  for (const radius of [2, 3]) {
    const sections = circleRangeSections(10, 6, radius, full);
    const discArea = sections.reduce((sum, s) => sum + area(s.polygon), 0);
    assert.ok(Math.abs(discArea - Math.PI * radius ** 2) / discArea < .001);
    for (const s of sections) for (const [x, y] of s.polygon) {
      assert.ok(Math.hypot(x - 6, y - 10) <= radius + 1e-9);
      assert.ok(Math.abs(x - s.col) <= .5 + 1e-9 && Math.abs(y - s.row) <= .5 + 1e-9);
    }
    assert.ok(sections.some(s => s.arcs.length));
    assert.equal(sections.some(s => s.row === 10 + radius && s.col === 6 + radius), false);
  }
  assert.deepEqual(circleRangeSections(10, 6, NaN), []);
  assert.deepEqual(circleRangeSections(10, 6, -2), []);
});

test('map clipping excludes reserve rows and off-map regions; boss mirroring changes only the centre', () => {
  const circle = { row: 10, col: 2, radius: 3 };
  const normal = circleToDisp(IDENTITY, circle);
  assert.deepEqual(normal.bounds, GEO.NORMAL_RECT);
  const sections = circleRangeSections(normal.row, normal.col, normal.radius, normal.bounds);
  for (const { row, col, polygon } of sections) {
    assert.ok(row >= 9 && row <= 12 && col >= 0 && col <= 10);
    for (const [x, y] of polygon) assert.ok(x >= -.5 && x <= 10.5 && y >= 8.5 && y <= 12.5);
  }
  assert.ok(sections.reduce((sum, s) => sum + area(s.polygon), 0) < Math.PI * 9);
  const left = circleToDisp(bossPrepField('L'), { row: 10, col: 6, radius: 3 });
  const right = circleToDisp(bossPrepField('R'), { row: 10, col: 6, radius: 3 });
  assert.deepEqual(left, { row: 3, col: 6, radius: 3, bounds: GEO.BOSS_RECT });
  assert.deepEqual(right, { row: 3, col: 14, radius: 3, bounds: GEO.BOSS_RECT });
  const lArea = circleRangeSections(left.row, left.col, left.radius, left.bounds).reduce((sum, s) => sum + area(s.polygon), 0);
  const rArea = circleRangeSections(right.row, right.col, right.radius, right.bounds).reduce((sum, s) => sum + area(s.polygon), 0);
  assert.ok(Math.abs(lArea - rArea) < 1e-9);
});

test('renderer draws clipped circles on terrain tops, replaces them at breakthrough, and clears old graphics', () => {
  class Graphics {
    constructor() { this.polygons = []; this.lines = []; }
    clear() { this.polygons = []; this.lines = []; }
    lineStyle() {} beginFill() {} endFill() {}
    drawPolygon(points) { this.polygons.push(points); }
    moveTo(x, y) { this.from = [x, y]; }
    lineTo(x, y) { this.lines.push([this.from, [x, y]]); }
  }
  const rendered = Object.create(TileField.prototype);
  Object.assign(rendered, {
    highlights: new Map(), hlGfx: new Graphics(), rowSurfaces: new Map(), P: { Graphics }, _p: {},
    cam: { project(x, y, z, out = {}) { out.x = x; out.y = y + z; return out; }, scaleAt: () => 40 },
    heightAt: row => row === 11 ? 1 : 0,
    surfaceLayer(row) {
      if (!this.rowSurfaces.has(row)) this.rowSurfaces.set(row, { addChildAt() {} });
      return this.rowSurfaces.get(row);
    },
  });
  const show = radius => rendered.setHighlights([[10, 6]], { group: 'selRange', circle: { row: 10, col: 6, radius, bounds: GEO.NORMAL_RECT } });
  show(2);
  const prototypeSections = rendered.highlights.get('selRange').circle.length;
  const raised = rendered.rowSurfaces.get(11)._hl;
  assert.ok(raised.polygons.length > 0 && raised.polygons.flat().every((n, i) => i % 2 === 0 || n >= 11.5));
  assert.ok(rendered.hlGfx.lines.length > 0);
  show(3);
  assert.ok(rendered.highlights.get('selRange').circle.length > prototypeSections);
  rendered.setHighlights([[10, 6]], { group: 'selRange' });
  assert.equal(rendered.highlights.get('selRange').circle, null);
  assert.equal(rendered.hlGfx.polygons.length, 1, 'switching to an ordinary unit removes the old circle');
  assert.equal(raised.polygons.length, 0);
  rendered.setHighlights([], { group: 'selRange' });
  assert.equal(rendered.highlights.size, 0);
  assert.equal(rendered.hlGfx.polygons.length, 0);
});

test('descriptions distinguish charge/target range from splash and explain ecology timing', () => {
  assert.match(researchRangeText(device('medical')), /半径 2 格.*本方干员.*召唤物/);
  assert.match(researchRangeText(device('energy')), /充能干员与主目标.*半径 2 格.*突破Ⅰ.*半径 1 格.*范围外/);
  assert.match(researchRangeText(device('ecology', 2)), /当前圆形半径 3 格.*突破Ⅱ为 3 格.*每 8 秒开启 4 秒/);
});

// Inspect component nodes without a DOM: this verifies the label decision, not screenshot rendering.
function textNodes(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textNodes).join(' ');
  if (typeof node !== 'object') return String(node);
  return [node.props?.k, textNodes(node.props?.children)].filter(Boolean).join(' ');
}
test('research token details label fallback attack as base, while live attack stays live', () => {
  const token = { tokenId: device('medical').id, name: '医疗装置', stats: { atk: 300 } };
  const base = textNodes(TokenDetail({ token }));
  assert.match(base, /基础攻击/);
  assert.match(base, /未计入科研层数、装备与梅尔加成/);
  const live = textNodes(TokenDetail({ token, live: { atk: 372 } }));
  assert.equal(live.includes('基础攻击'), false);
});
