import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RHINE_ADDITIONS } from '../tools/rhine-data.mjs';
import { GameData } from '../server/match/gamedata.js';
import { SharedPool } from '../server/match/pool.js';
import { createRng } from '../server/sim/rng.js';
import { DATA } from './match/harness.js';

test('Rhine Magallan is tier IV in the generator, shop and both normal/elite records', () => {
  assert.equal(RHINE_ADDITIONS.find((c) => c.key === 'magallan').tier, 4);
  const gd = new GameData(DATA, 'mode_multi_hard');
  for (const suffix of ['a', 'b']) {
    const id = `chess_rhine_magallan_${suffix}`;
    const c = gd.chess(id);
    const grade = c.isGolden ? 'golden' : 'normal';
    const status = DATA.config.economy.chessStatus[4][grade];
    assert.equal(c.tier, 4);
    assert.equal(c.price, DATA.config.economy.chessPrice[4][grade]);
    assert.deepEqual(Object.fromEntries(['phase', 'level', 'skillLevel', 'equipLevel'].map((k) => [k, c.status[k]])), Object.fromEntries(['phase', 'level', 'skillLevel', 'equipLevel'].map((k) => [k, status[k]])));
  }
  const pool = new SharedPool(gd);
  const onlyMagallan = { filter: (id) => id === 'chess_rhine_magallan_a' };
  assert.equal(pool.roll(createRng(4), { ...onlyMagallan, maxTier: 3 }), null);
  assert.equal(pool.roll(createRng(4), { ...onlyMagallan, maxTier: 4 }), 'chess_rhine_magallan_a');
  assert.equal(gd.poolCopies('chess_rhine_magallan_a'), DATA.config.economy.poolCopies[4] * 2);
});
