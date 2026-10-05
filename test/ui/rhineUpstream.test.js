// The Rhine extension must use the upstream 0.1.1 bond UI without losing its extra member sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bondMembers, grantedBonds, harmonyMembers, morphPairings, modeOffBonds, summonRange,
  placementContext, boardTargets, canPlace } from '../../public/js/ui/gameLogic.js';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { RHINE_BOND, RHINE_DEVICES, rhineCapacity } from '../../shared/rhineResearch.js';
import { renderInfo } from '../../public/js/render/app.js';
import { resolveDetail, ChessDetail, BondChips } from '../../public/js/ui/detailPanel.js';
import { data } from '../../public/js/data.js';

const load = name => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));
const chess = load('chess'), items = load('items'), bonds = load('bonds'), config = load('config'), tokens = load('tokens');
const getChess = id => chess[id] || null, getItem = id => items[id] || null;
const gd = { chess: getChess, item: getItem, bond: id => bonds[id], bondIds: Object.keys(bonds),
  baseIdOf: id => chess[id]?.baseId || id, isGolden: id => !!chess[id]?.isGolden, modeInactiveBonds: new Set() };
const iso = Object.values(items).find(it => it.canGiveBond && !it.isGolden).id;
const terminal = 'chess_item_rhine_terminal_a';
const normal = Object.values(chess).filter(c => c.visible && !c.isGolden);
const member = name => normal.find(c => c.name === name).chessId;
const stranger = normal.find(c => !c.bonds.includes(RHINE_BOND) && !c.bonds.includes('maniShip')).chessId;
const boardPiece = (id, i, equipment = []) => ({ id, uid: i + 1, kind: 'chess', row: 9, col: i,
  items: equipment.map((item, j) => ({ id: item, uid: 100 + i * 2 + j })) });
const privFor = board => ({ board, hand: [], temp: [] });

globalThis.fetch = async url => {
  const name = String(url).split('/').pop().replace(/\.json$/, '');
  try { return { ok: true, status: 200, json: async () => load(name) }; }
  catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
await data.loadAll('chess', 'bonds', 'items', 'assets', 'garrisons');

function* walk(node) {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  yield* walk(node.props?.children);
}

test('renderer metadata retains research shutdown separately from the breakthrough when joining a battle', () => {
  const unit = { id: 500, kind: 'token', side: 'ally', defId: 'token_rhine_ecology', researchStage: 2 };
  for (const active of [true, false]) {
    const info = renderInfo({ ...unit, researchActive: active });
    assert.equal(info.researchStage, 2);
    assert.equal(info.researchActive, active, 'false is an explicit shutdown rather than absent metadata');
  }
  for (const invalid of [undefined, null, 'false', 0, 1]) {
    assert.equal(renderInfo({ ...unit, researchActive: invalid }).researchActive, undefined);
  }
});

test('clicking a teammate rendered on the canvas retains equipment and the Rhine morph-granted chip', () => {
  // render/app emits this exact `unit` in pieceClick; game.js uses it directly instead of looking up field meta.
  const raw = { id: 501, kind: 'op', side: 'ally', ownerId: 'p2', defId: stranger,
    items: [iso, terminal, null, 1, { id: terminal }, ''] };
  const event = { unitId: raw.id, unit: renderInfo(raw) };
  assert.deepEqual(event.unit.items, [iso, terminal], 'the renderer carries only nonempty item IDs');
  assert.notEqual(event.unit.items, raw.items, 'the view does not alias the network array');
  const detail = resolveDetail({ kind: 'unit', ...event }, new Map());
  assert.equal(detail.piece, null, 'a teammate has no piece in the observing player\'s private board');
  assert.deepEqual(detail.unitItems, [iso, terminal]);
  const card = ChessDetail({ ...detail, bonds: [{ bondId: RHINE_BOND, count: 3, active: true, tier: 1 }] });
  const chips = [...walk(card)].find(node => node.type === BondChips);
  assert.ok(chips.props.bondIds.includes(RHINE_BOND));
  assert.ok(chips.props.granted.includes(RHINE_BOND));
  const equipment = [...walk(card)].filter(node => node.props?.itemId);
  assert.deepEqual(equipment.map(node => node.props.itemId), [iso, terminal], 'both equipped items reach the read-only rows');
  const empty = resolveDetail({ kind: 'unit', unit: renderInfo({ ...raw, items: undefined }) }, new Map());
  assert.equal(empty.unitItems, null);
});

test('Rhine 3/6 thresholds include harmony once and show converted members in the upstream popup model', () => {
  const scenarios = [
    { names: ['梅尔', '缪尔赛思'], expected: 3, capacity: 1 },
    { names: ['梅尔', '缪尔赛思', '白面鸮', '塞雷娅'], converted: true, expected: 6, capacity: 2 },
  ];
  for (const s of scenarios) {
    const board = s.names.map((name, i) => boardPiece(member(name), i));
    if (s.converted) board.push(boardPiece(stranger, board.length, [iso, terminal]));
    const state = computeBonds(gd, { board: new Map(board.map(p => [`${p.row},${p.col}`, p])), hand: [], layers: {} });
    const entry = state[RHINE_BOND];
    assert.equal(entry.count, s.expected);
    assert.equal(entry.harmony, 1);
    assert.equal(rhineCapacity(entry), s.capacity);
    const priv = privFor(board);
    const members = bondMembers(bonds[RHINE_BOND], priv, [], getChess, getItem).filter(m => m.onBoard);
    assert.equal(members.length + entry.harmony, entry.count, 'the visible members plus the explicit harmony row explain the total');
    assert.deepEqual(harmonyMembers(priv, getChess).map(c => c.name), ['缪尔赛思']);
    if (s.converted) {
      const converted = members.find(m => m.id === stranger);
      assert.equal(converted.granted, true);
      assert.deepEqual(converted.items, [iso, terminal]);
    }
  }
});

test('upstream morph equipment descriptions discover both Rhine terminal qualities and no extra grant from the mainframe', () => {
  const rows = morphPairings(Object.values(items), Object.values(bonds), { carried: [iso, terminal] });
  const rhine = rows.find(r => r.bondId === RHINE_BOND);
  assert.ok(rhine && rhine.worn);
  assert.equal(rhine.items.length, 1, 'normal and elite terminal share one family row');
  assert.equal(rhine.items[0].name, '莱茵实验终端');
  assert.deepEqual(grantedBonds([iso, 'chess_item_rhine_terminal_b'], getItem), [RHINE_BOND]);
  assert.deepEqual(grantedBonds([iso, 'chess_item_rhine_mainframe_a'], getItem), []);
  assert.equal(modeOffBonds(config.modes.mode_single_funny).has(RHINE_BOND), false);
});

test('upstream owner-range placement rules do not constrain independent research devices', () => {
  const stage = load('stages').act2autochess_m01;
  const devices = RHINE_DEVICES.map((d, i) => ({ id: d.tokenId, uid: 200 + i, kind: 'token', research: true }));
  const priv = { board: [], hand: [], temp: [], deployCap: 0, deployCount: 0,
    research: { capacity: 1, hand: devices } };
  const ctx = placementContext({ priv, stage, editable: true, getChess, getItem, getToken: id => tokens[id] });
  for (const p of devices) {
    assert.notEqual(tokens[p.id].ownerRange, true);
    assert.equal(summonRange(ctx, p), null);
    const targets = boardTargets(ctx, p.uid).legal;
    assert.ok(targets.length > 1);
    for (const [row, col] of [targets[0], targets.at(-1)]) assert.ok(canPlace(ctx, p.uid, { area: 'board', row, col }).ok);
  }
});
