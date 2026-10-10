import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { SharedPool } from '../server/match/pool.js';
import { generateDraft } from '../server/match/choices.js';
import { makeMatch } from './match/harness.js';
import { KAZDEL_EQUIPMENT } from '../shared/kazdel.js';
import { addKazdelArt } from '../tools/assets/kazdel-plan.mjs';
import { readFileSync } from 'node:fs';
import { itemIconUrl } from '../public/js/assets.js';
import { pieceBondIds, morphPairings } from '../public/js/ui/gameLogic/bonds.js';
import { pieceBonds, computeBonds } from '../server/match/bondsMeta.js';

const data = getData(), gd = new GameData(data, 'mode_single_normal');
const item = (key, gold = false) => `${KAZDEL_EQUIPMENT[key].key}_${gold ? 'b' : 'a'}`;

test('Kazdel equipment icons resolve through the client manifest and survive asset rebuilds', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
  const rebuilt = addKazdelArt({});
  for (const key of Object.keys(KAZDEL_EQUIPMENT)) for (const gold of [false, true]) {
    const record = data.items[item(key, gold)], path = `/art/kazdel/${key}-v2.png`;
    assert.equal(itemIconUrl(manifest, record), path); assert.equal(itemIconUrl(rebuilt, record), path);
    assert.equal(readFileSync(new URL(`../public${path}`, import.meta.url)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});

test('Kazdel equipment: approved stats, universal eligibility and two-copy normal upgrade', () => {
  for (const [key, r] of Object.entries(KAZDEL_EQUIPMENT)) for (const gold of [false, true]) {
    const it = data.items[item(key, gold)], effect = data.effects[it.effectId];
    assert.equal(it.tier, r.tier); assert.equal(it.price, gold ? 5 : r.price);
    assert.equal(it.isGolden, gold); assert.equal(it.mergeable, !gold);
    assert.equal(it.upgradeNum, gold ? 0 : 2); assert.equal(it.upgradeChessId, gold ? null : item(key, true));
    assert.equal(it.baseId, item(key)); assert.equal(it.goldenId, item(key, true));
    assert.deepEqual(it.buffs, effect.buffs); assert.equal(it.desc, effect.desc);
    assert.deepEqual(it.buffs[0].bb, { max_hp: r.hp[gold ? 1 : 0], atk: r.attack[gold ? 1 : 0] });
    assert.equal(it.requiresBondId, null); assert.equal(it.giveBondId, key === 'sigil' ? 'kazdelShip' : null); assert.equal(it.canGiveBond, false);
    if (key === 'blade') assert.deepEqual(it.buffs[1].bb, { damage_bonus: .2, combo_damage_bonus: .35 });
    else assert.equal(it.buffs.length, 1);
  }
});

test('Kazdel equipment: real shop rolls and free supply/shop drafts include only normal equipment', () => {
  const pool = new SharedPool(gd);
  for (const [key, r] of Object.entries(KAZDEL_EQUIPMENT)) {
    const id = item(key), list = gd.shopItemsByTier[r.tier];
    assert.ok(list.includes(id)); assert.ok(!list.includes(item(key, true)));
    let call = 0;
    const roll = () => ++call === 1 ? 1 - Number.EPSILON : (list.indexOf(id) + .5) / list.length;
    assert.equal(pool.rollItem(roll, r.tier), id, 'normal shop can draw the new equipment');
    for (const family of ['supply', 'shop']) {
      const eligible = family === 'supply' ? list : Object.keys(gd.shopItemsByTier).map(Number).sort((a,b) => a-b).flatMap(t => gd.shopItemsByTier[t]);
      const raw = { ...data, choices: { ...data.choices, schedule: { [gd.modeId]: { rounds: { 3: {
        families: [{ family, weight: 1 }], cards: 3, supplyTiers: [r.tier, r.tier], events: {},
      } } } } } };
      const draft = generateDraft(new GameData(raw, gd.modeId), () => (eligible.indexOf(id) + .5) / eligible.length, 3);
      assert.equal(draft.family, family);
      assert.ok(draft.cards.every(c => c.id === id && c.price === 0));
    }
  }
});

test('Kazdel equipment: acquiring two copies merges once and normal upgrade effects preserve the golden link', () => {
  for (const key of Object.keys(KAZDEL_EQUIPMENT)) {
    const h = makeMatch({ mode: 'solo', fake: true }).start(); h.toPrep(1);
    const ps = h.ps('p_0'), first = ps.acquireItem(item(key));
    assert.equal(first.id, item(key));
    const merged = ps.acquireItem(item(key));
    assert.equal(merged.id, item(key, true)); assert.equal(ps.stats.itemMerges, 1);
    assert.equal(ps.find(first.uid), null);
    const next = ps.acquireItem(item(key));
    assert.equal(ps.upgradeItem(next), true); assert.equal(next.id, item(key, true));
    assert.equal(ps.upgradeItem(next), false, 'an elite item cannot upgrade again');
    h.invariants();
  }
});

test('Sigil/isomorph all four qualities grant exactly one membership, preserve old bonds and reach only 3/6 tiers', () => {
  const outsider = Object.values(data.chess).find(c => c.visible && !c.isGolden && !c.bonds.includes('kazdelShip') && !c.bonds.includes('maniShip'));
  const natives = data.bonds.kazdelShip.visibleMembers;
  for (const gold of [false, true]) for (const iso of ['chess_item_6_09_e_a', 'chess_item_6_09_e_b']) {
    const piece = { kind: 'chess', id: outsider.chessId, items: [{ id: item('sigil', gold) }, { id: iso }] };
    assert.deepEqual(pieceBonds(gd, piece), [...outsider.bonds, 'kazdelShip']);
    assert.deepEqual(pieceBondIds(outsider, piece.items, id => data.items[id]), pieceBonds(gd, piece));
    const pairing = morphPairings(Object.values(data.items), Object.values(data.bonds), { carried: piece.items }).find(b => b.bondId === 'kazdelShip');
    assert.equal(pairing.worn, true); assert.deepEqual(pairing.items.map(i => i.name), ['舍身刻印']);
    for (const count of [3, 6, 9]) {
      const board = new Map(natives.slice(0, count - 1).map((id, i) => [String(i), { kind: 'chess', id, items: [] }]));
      board.set('extra', piece);
      board.set('duplicate', { ...piece, id: outsider.goldenId });
      const ps = { board, hand: [], layers: {} };
      const state = computeBonds(gd, ps).kazdelShip;
      assert.equal(state.count, count); assert.equal(state.tier, count >= 6 ? 2 : 1);
      piece.items = [{ id: iso }]; board.delete('duplicate');
      assert.equal(computeBonds(gd, ps).kazdelShip.count, count - 1);
      assert.deepEqual(pieceBonds(gd, piece), outsider.bonds);
      piece.items = [{ id: item('sigil', gold) }, { id: iso }];
    }
    for (const items of [[{ id: item('sigil', gold) }], [{ id: item('blade', gold) }, { id: iso }]]) {
      assert.deepEqual(pieceBonds(gd, { ...piece, items }), outsider.bonds);
    }
    const native = { ...piece, id: natives[0] };
    assert.equal(pieceBonds(gd, native).filter(b => b === 'kazdelShip').length, 1);
    assert.match(data.items[iso].desc, /舍身刻印.*卡兹戴尔/);
  }
});

