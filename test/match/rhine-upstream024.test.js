// The upstream stock model must include every approved extension identity and equipment pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { RHINE_EQUIPMENT } from '../../shared/rhineResearch.js';
import { KAZDEL_EQUIPMENT } from '../../shared/kazdel.js';

test('all Rhine/Kazdel operators share the upstream doubled co-op stock without changing solo capacities', () => {
  const solo = new GameData(DATA, 'mode_single_normal'), coop = new GameData(DATA, 'mode_multi_normal');
  const entries = Object.values(DATA.chess).filter(c => c.extension && c.visible && !c.isGolden);
  assert.ok(entries.length >= 12);
  for (const c of entries) {
    const expected = DATA.config.economy.poolCopiesOverrides?.[c.chessId] ?? DATA.config.economy.poolCopies[c.tier];
    assert.equal(solo.poolCopies(c.chessId), expected, c.chessId);
    assert.equal(coop.poolCopies(c.chessId), expected * 2, c.chessId);
  }
});
for (const spec of [...Object.values(RHINE_EQUIPMENT), ...Object.values(KAZDEL_EQUIPMENT)]) {
  test(`${spec.key}: actual shared stock includes auto-merged copies and releases eliminated ownership`, () => {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 24, fake: true }).start().toPrep();
    const m = h.m, a = h.ps('p_0'), b = h.ps('p_1'), id = `${spec.key}_a`;
    const cap = DATA.config.economy.itemPoolCopies[spec.tier];
    assert.equal(m.itemPool.cap(id), cap);
    for (let i = 0; i < cap; i++) assert.ok((i % 2 ? b : a).acquireItem(id), `copy ${i + 1}`);
    assert.equal(m.itemPool.left(id), 0);
    assert.equal(a.acquireItem(id), null, 'effects cannot bypass the finite stock');
    assert.equal(m.itemPool.held(id), cap, 'normal and auto-merged equipment consume the same total');
    b.eliminate(1);
    assert.equal(m.itemPool.left(id), Math.floor(cap / 2));
    assert.ok(a.acquireItem(id), 'released stock can be obtained again');
    checkInvariants(m); m.dispose();
  });
}

test('retired tier-III Ascalon cannot be acquired through stale custom card IDs', () => {
  const h = makeMatch({ mode: 'solo', fake: true }).start().toPrep();
  try {
    const ps = h.ps('p_0');
    for (const grade of ['a', 'b']) {
      const id = `chess_kazdel_ascalon_${grade}`;
      assert.equal(h.m.gd.chess(id), null);
      assert.equal(h.m.pool.has(id), false);
      assert.equal(ps.acquireChess(id), null);
    }
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});
