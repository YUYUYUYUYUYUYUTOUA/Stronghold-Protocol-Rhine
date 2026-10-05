import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, DATA } from './harness.js';
import { equipItems, itemTarget, rhineItemSynergy } from '../../server/match/bot.js';
import { RHINE_BOND, RHINE_CHARACTERS as C, RHINE_EQUIPMENT as E } from '../../shared/rhineResearch.js';

const chess = (charId) => Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.charId === charId).chessId;
function prep() {
  const h = makeMatch({ mode: 'solo', fake: true }).start().toPrep();
  const ps = h.ps('p_0'); ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
  return { h, m: h.m, ps };
}

test('Rhine equipment bot pairs both items on a Rhine carrier, regardless of hand order and generic DPS preference', () => {
  for (const order of [['terminal', 'mainframe'], ['mainframe', 'terminal']]) {
    const { h, m, ps } = prep();
    const rhine = give(m, ps, chess(C.saria), 'board', [10, 4]);
    const outsider = give(m, ps, chess('char_416_zumama'), 'board', [10, 5]);
    for (const key of order) giveItem(m, ps, `${E[key].key}_a`);
    equipItems(m, ps);
    assert.deepEqual(rhine.items.map((it) => it.id).sort(), [`${E.mainframe.key}_a`, `${E.terminal.key}_a`].sort());
    assert.equal(outsider.items.length, 0);
    assert.deepEqual(h.logs.error, []); m.dispose();
  }
});

test('Rhine equipment bot uses an existing partner and never treats a full carrier as available synergy', () => {
  const { m, ps } = prep();
  const rhine = give(m, ps, chess(C.saria), 'board', [10, 4]);
  give(m, ps, chess(C.silence), 'board', [11, 4]);
  give(m, ps, chess(C.ptilopsis), 'board', [12, 4]);
  ps.layers[RHINE_BOND] = 50; ps.recompute();
  const t = giveItem(m, ps, `${E.terminal.key}_a`); assert.equal(ps.equip(t.uid, rhine.uid).ok, true);
  const paired = rhineItemSynergy(m, ps, `${E.mainframe.key}_a`);
  assert.ok(paired > 5);
  giveItem(m, ps, `${E.mainframe.key}_b`); equipItems(m, ps);
  assert.ok(rhine.items.some((it) => it.id === `${E.mainframe.key}_b`));
  assert.ok(rhineItemSynergy(m, ps, `${E.mainframe.key}_a`) < paired);
  assert.equal(rhineItemSynergy(m, ps, 'chess_item_1_01_e_a'), 0);
  m.dispose();
});

test('Rhine equipment bot values mainframe growth beyond 100 layers while standalone terminal ASPD stays capped', () => {
  const { h, m, ps } = prep();
  const rhine = give(m, ps, chess(C.saria), 'board', [10, 4]);
  give(m, ps, chess(C.silence), 'board', [11, 4]);
  give(m, ps, chess(C.ptilopsis), 'board', [12, 4]);
  const score = (key, layers) => {
    ps.layers[RHINE_BOND] = layers; ps.recompute();
    return rhineItemSynergy(m, ps, `${E[key].key}_a`);
  };
  const mainframe100 = score('mainframe', 100), mainframe400 = score('mainframe', 400);
  assert.ok(mainframe400 > mainframe100);
  assert.ok(score('mainframe', 999) > mainframe400);
  assert.equal(score('terminal', 100), score('terminal', 400), 'terminal alone has no uncapped effect');
  const mf = giveItem(m, ps, `${E.mainframe.key}_a`);
  assert.equal(ps.equip(mf.uid, rhine.uid).ok, true);
  const paired100 = score('terminal', 100), paired400 = score('terminal', 400);
  assert.ok(paired400 > paired100, 'pairing doubles the uncapped mainframe contribution');
  assert.ok(score('terminal', 999) > paired400);
  assert.deepEqual(h.logs.error, []); m.dispose();
});

test('Rhine equipment bot leaves a full transformed carrier intact and chooses a free deployed Rhine member', () => {
  const { h, m, ps } = prep();
  const transformed = give(m, ps, chess('char_416_zumama'), 'board', [10, 5]);
  const morphId = Object.values(DATA.items).find((it) => it.canGiveBond && !it.isGolden).id;
  for (const id of [morphId, `${E.terminal.key}_a`]) {
    const it = giveItem(m, ps, id);
    assert.equal(ps.equip(it.uid, transformed.uid).ok, true);
  }
  const original = transformed.items.map((it) => it.id);
  const rhine = give(m, ps, chess(C.saria), 'board', [10, 4]);
  const item = giveItem(m, ps, `${E.mainframe.key}_a`);
  assert.equal(itemTarget(m, ps, item), rhine);
  equipItems(m, ps);
  assert.deepEqual(transformed.items.map((it) => it.id), original);
  assert.ok(rhine.items.some((it) => it.id === item.id));
  assert.deepEqual(h.logs.error, []); m.dispose();
});

test('Rhine equipment bot ignores benched partners and retains generic fallback with no available Rhine carrier', () => {
  const { h, m, ps } = prep();
  const bench = give(m, ps, chess(C.saria));
  const partner = giveItem(m, ps, `${E.terminal.key}_a`);
  assert.equal(ps.equip(partner.uid, bench.uid).ok, true);
  const outsider = give(m, ps, chess('char_416_zumama'), 'board', [10, 5]);
  const item = giveItem(m, ps, `${E.mainframe.key}_a`);
  assert.equal(itemTarget(m, ps, item), outsider);
  equipItems(m, ps);
  assert.deepEqual(bench.items.map((it) => it.id), [partner.id]);
  assert.ok(outsider.items.some((it) => it.id === item.id));
  assert.deepEqual(h.logs.error, []); m.dispose();
});
