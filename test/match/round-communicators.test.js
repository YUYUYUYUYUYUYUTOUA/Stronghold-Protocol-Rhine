import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataProfile } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { ROUND_COMMUNICATOR_ITEM as ITEM, independentItemCopies } from '../../server/match/systemSupply.js';
import { makeMatch, DATA, give, legalTileFor } from './harness.js';

const held = (ps) => [...ps.hand, ...ps.temp, ...ps.board.values()].filter(Boolean)
  .flatMap(p => [p, ...(p.items || [])]);
const supplied = (ps) => held(ps).reduce((n, p) => n + independentItemCopies(ps.gd, p), 0);

test('five/six starting seats add one operator shop slot at every level and preserve equipment slots', () => {
  for (const count of [1, 2, 3, 4, 5, 6]) for (let level = 1; level <= 6; level++) {
    const base = new GameData(DATA, 'mode_multi_normal', 4).shopSlots(level);
    assert.deepEqual(new GameData(DATA, 'mode_multi_normal', count).shopSlots(level),
      { chess: base.chess + (count >= 5 ? 1 : 0), item: base.item });
  }
  const h = makeMatch({ humans: 5, fake: true }).start();
  try {
    h.toPrep(1);
    assert.equal(h.ps('p_0').shop.slots.filter(s => s?.kind === 'chess').length, 4);
    h.ps('p_4').eliminate(1);
    assert.equal(h.m.gd.shopSlots(1).chess, 4, 'the starting roster remains fixed after an elimination');
  } finally { h.m.dispose(); }
});

for (const rhine of [true, false]) test(`${rhine ? 'Rhine' : 'original'} R3/R7 supply reaches all six alive players outside the five-copy item stock`, () => {
  const h = makeMatch({ humans: 6, fake: true, data: getDataProfile(rhine), rhineEnabled: rhine }).start();
  try {
    h.toPrep(1);
    const m = h.m, owner = h.ps('p_0');
    for (let i = 0; i < m.itemPool.cap(ITEM); i++) assert.ok(owner.acquireItem(ITEM));
    assert.equal(m.itemPool.held(ITEM), 5);
    assert.equal(owner.acquireItem(ITEM), null);
    assert.equal(owner.acquireItem(ITEM, { source: 'roundCommunicator' }), null, 'a different round cannot bypass stock');
    for (const round of [3, 7]) {
      h.toPrep(round);
      for (const ps of m.order) assert.equal(supplied(ps), round === 3 ? 1 : 2, ps.playerId);
      assert.equal(m.itemPool.held(ITEM), 5, 'system copies stay independent through mixed and all-system merges');
      assert.equal(m.itemPool.left(ITEM), 0);
      assert.equal(m.itemPool.debtOf(ITEM), 0);
      const before = m.order.map(ps => held(ps).map(p => p.uid));
      m.onReconnect('p_0');
      m.enterPrep();
      assert.deepEqual(m.order.map(ps => held(ps).map(p => p.uid)), before, 'reconnect and repeated prep entry never duplicate a supply');
    }
    h.invariants();
  } finally { h.m.dispose(); }
});

test('system copies do not repay debt when consumed, while ordinary copies still do', () => {
  const h = makeMatch({ humans: 2, fake: true }).start();
  try {
    h.toPrep(3);
    const m = h.m, ps = h.ps('p_0');
    const item = held(ps).find(p => p.id === ITEM && independentItemCopies(ps.gd, p) === 1);
    m.itemPool.owe(ITEM, 2);
    assert.equal(ps.releaseItemStock(item), 0);
    assert.equal(m.itemPool.debtOf(ITEM), 2);
    assert.equal(ps.releaseItemStock(ps.newPiece('item', ITEM)), 1);
    assert.equal(m.itemPool.debtOf(ITEM), 1);
  } finally { h.m.dispose(); }
});

test('the R3 supply keeps overflowing hand/temp contents and skips eliminated players', () => {
  const h = makeMatch({ humans: 3, fake: true }).start();
  try {
    h.toPrep(1);
    const ps = h.ps('p_0');
    for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_6_01_m');
    for (let i = 0; i < 5; i++) ps._putTemp(i, ps.newPiece('item', 'chess_item_6_01_m'));
    const before = held(ps).map(p => p.uid);
    h.ps('p_2').eliminate(2);
    h.m.startRound(3);
    h.runToPhase('PREP', 3);
    assert.equal(supplied(ps), 1);
    assert.equal(supplied(h.ps('p_1')), 1);
    assert.equal(supplied(h.ps('p_2')), 0);
    for (const uid of before) assert.ok(ps.find(uid), `overflow keeps piece ${uid}`);
    const item = ps.temp.find(p => p?.id === ITEM);
    assert.ok(item);
    assert.equal(ps.tempDue(item), ps.prepsEnded, 'the supply remains usable for this whole prep');
    h.invariants();
  } finally { h.m.dispose(); }
});

test('a system communicator still draws only remaining shared copies and excludes banned operators', () => {
  const h = makeMatch({ humans: 2, fake: true, seed: 33 }).start();
  try {
    h.toPrep(3);
    const m = h.m, ps = h.ps('p_0');
    const targetId = [...m.pool.entries.keys()].find(id => m.gd.tierOf(id) === 1);
    const target = give(m, ps, targetId, 'board', legalTileFor(m, ps, targetId));
    const item = held(ps).find(p => p.id === ITEM);
    for (const [id, e] of m.pool.entries) m.pool.take(id, Math.max(0, e.left));
    const before = ps.allChess().map(p => p.uid);
    assert.deepEqual(ps.equip(item.uid, target.uid), { ok: true });
    assert.deepEqual(ps.allChess().map(p => p.uid), before, 'empty shared pool yields no operator and never overdraws');
    assert.equal(ps.find(item.uid), null, 'the ordinary communicator is consumed');
    assert.equal(m.itemPool.held(ITEM), 0);
  } finally { h.m.dispose(); }
});
