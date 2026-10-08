import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placementContext, canPlace, dropIntent, indexPieces, boardTargets } from '../../public/js/ui/gameLogic.js';
import { retreatSlot, underframeActions } from '../../public/js/ui/facing.js';
import { researchTileAt, researchProgress, researchRangeSummary, laserProgressText } from '../../public/js/ui/rhineDock.js';
import { summonDeployHint } from '../../public/js/ui/detailPanel.js';
import { RHINE_DEVICES, rhineAttack, rhineStage } from '../../shared/rhineResearch.js';
const stage = JSON.parse(readFileSync(new URL('../../data/stages.json', import.meta.url))).act2autochess_m01;
const device = (index) => ({ uid: 100 + index, kind: 'token', id: RHINE_DEVICES[index].tokenId, research: true });
const priv = (capacity = 1, board = []) => ({
  board, hand: Array(10).fill(null), temp: [], deployCap: 1, deployCount: 1,
  research: { capacity, hand: RHINE_DEVICES.map((_, i) => board.some(p => p.uid === 100 + i) ? null : device(i)) },
});
const context = (p) => placementContext({ priv: p, stage, editable: true, getToken: () => ({ position: 'ALL' }) });
test('dedicated research slots are selectable; devices ignore population and need an active alliance', () => {
  const p = priv(); const ctx = context(p);
  assert.equal(indexPieces(p).get(100).area, 'research');
  const [row, col] = boardTargets(ctx, 100).legal[0];
  assert.ok(canPlace(ctx, 100, { area: 'board', row, col }).ok);
  assert.equal(canPlace(context(priv(0)), 100, { area: 'board', row, col }).ok, false);
});
test('3/6/9-member caps permit one/two/three devices, and a deployed device can move', () => {
  const initial = context(priv());
  const [a, b] = boardTargets(initial, 100).legal;
  const placed = { ...device(0), row: a[0], col: a[1] };
  const tile = { area: 'board', row: b[0], col: b[1] };
  assert.equal(canPlace(context(priv(1, [placed])), 101, tile).code, 'BOARD_FULL');
  assert.ok(canPlace(context(priv(2, [placed])), 101, tile).ok);
  assert.ok(canPlace(context(priv(1, [placed])), 100, tile).ok);
  assert.equal(canPlace(context(priv(2, [placed])), 101, { area: 'board', row: a[0], col: a[1] }).ok, false);
  const second = { ...device(1), row: b[0], col: b[1] };
  const [row, col] = boardTargets(context(priv(3, [placed, second])), 102).legal[0];
  assert.equal(canPlace(context(priv(2, [placed, second])), 102, { area: 'board', row, col }).code, 'BOARD_FULL');
  assert.equal(canPlace(context(priv(3, [placed, second])), 102, { area: 'board', row, col }).ok, true);
});
test('full ordinary bench never prevents recall, never offers sell, and ordinary pieces cannot enter research slots', () => {
  const p = priv(1, [{ ...device(0), row: 10, col: 3 }]);
  p.hand = Array.from({ length: 10 }, (_, i) => ({ uid: i, kind: 'chess', id: 'dummy' }));
  const ctx = context(p);
  assert.deepEqual(retreatSlot(ctx, 100), { area: 'research' });
  assert.deepEqual(dropIntent(ctx, 100, { area: 'hand', idx: 0 }), { t: 'g.move', fields: { uid: 100, to: { area: 'research' } } });
  assert.equal(underframeActions(ctx, 100).sell, null);
  assert.equal(canPlace(ctx, 0, { area: 'research' }).ok, false);
});
test('pointer hit detection uses projected board polygons and ignores empty screen', () => {
  const view = { tileScreen: (r, c) => r === 10 && c === 4 ? { poly: [[10, 10], [40, 10], [40, 30], [10, 30]] } : null };
  assert.deepEqual(researchTileAt(view, 25, 20), { area: 'board', row: 10, col: 4 });
  assert.equal(researchTileAt(view, 2, 20), null);
});
test('UI shows growth thresholds and research instructions without a fictional summon owner', () => {
  assert.match(researchProgress(1, 0), /1\/5/);
  assert.match(researchProgress(3, 1), /3\/5/);
  assert.match(researchProgress(0, 1), /0\/5/);
  assert.match(researchProgress(0, 2), /已完成/);
  assert.equal(rhineAttack(10), 340);
  assert.equal(rhineAttack(10, false), 340, 'Mayer now produces layers instead of a separate attack bonus');
  assert.equal(rhineStage(2), 2);
  assert.match(summonDeployHint({ tokenId: RHINE_DEVICES[0].tokenId }), /科研/);
});

test('dock range summaries separate nearby targeting from global charging and mature splash', () => {
  const energy = RHINE_DEVICES.find(d => d.key === 'energy').tokenId;
  assert.match(researchRangeSummary({ id: energy, stage: 0 }), /范围 13 格.*范围内充能.*全范围脉冲/);
  assert.match(researchRangeSummary({ id: energy, stage: 1 }), /选敌 29 格.*本方全场充能.*溅射半径 1/);
  assert.match(researchRangeSummary({ id: energy, stage: 2 }), /选敌 29 格.*本方全场充能.*钙质化 25 格/);
  assert.equal(researchRangeSummary({ id: energy, stage: 99 }), researchRangeSummary({ id: energy, stage: 2 }));
  const ecology = RHINE_DEVICES.find(d => d.key === 'medical').tokenId;
  assert.match(researchRangeSummary({ id: ecology, stage: 0 }), /范围 13 格.*半径 2.*持续减速 50%/);
  assert.match(researchRangeSummary({ id: ecology, stage: 2 }), /范围 29 格.*半径 3.*持续减速 50%/);
  assert.equal(researchRangeSummary({ id: 'unrelated' }), '');
  assert.match(researchRangeSummary({ id: 'token_rhine_laser', stage: 2 }), /全场锁定.*最大生命值/);
});

test('laser UI reports the gate and actual seconds of output without research progression', () => {
  assert.match(summonDeployHint({ tokenId: 'token_rhine_laser' }), /9名.*单级/);
  assert.doesNotMatch(summonDeployHint({ tokenId: 'token_rhine_laser' }), /研究进度|胜利|失败/);
  assert.match(laserProgressText(0), /等待目标.*150%/);
  assert.match(laserProgressText(10, 12, true), /锁定输出.*10\/20秒.*225%/);
  assert.match(laserProgressText(10.75, 12, true), /10\/20秒.*225%/, 'displayed damage follows the sim’s completed output seconds');
  assert.match(laserProgressText(20, 12, false), /输出暂停.*20\/20秒.*300%/);
  assert.match(laserProgressText(99, 12, true), /20\/20秒.*300%/);
});
