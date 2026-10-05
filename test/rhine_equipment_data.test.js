import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { SharedPool } from '../server/match/pool.js';
import { generateDraft } from '../server/match/choices.js';
import { pieceBonds } from '../server/match/bondsMeta.js';
import { makeMatch } from './match/harness.js';
import { RHINE_EQUIPMENT } from '../shared/rhineResearch.js';
import { addRhineArt } from '../tools/assets/rhine-plan.mjs';

const data = getData(), gd = new GameData(data, 'mode_single_normal');
const item = (key, gold = false) => `${RHINE_EQUIPMENT[key].key}_${gold ? 'b' : 'a'}`;

test('Rhine equipment: normal and elite effects preserve stats, uncapped mainframe growth and upgrade links', () => {
  assert.equal(Object.hasOwn(RHINE_EQUIPMENT.mainframe, 'attackCap'), false);
  assert.equal(Object.hasOwn(RHINE_EQUIPMENT.mainframe, 'comboAttackCap'), false);
  for (const [key, r] of Object.entries(RHINE_EQUIPMENT)) for (const gold of [false, true]) {
    const it = data.items[item(key, gold)], e = data.effects[it.effectId];
    assert.equal(it.itemType, 'EQUIP'); assert.equal(it.tier, r.tier); assert.equal(it.isGolden, gold);
    assert.equal(it.baseId, item(key)); assert.equal(it.goldenId, item(key, true));
    assert.equal(it.mergeable, !gold); assert.equal(it.upgradeNum, gold ? 0 : 2);
    assert.equal(it.upgradeChessId, gold ? null : item(key, true));
    assert.deepEqual(it.buffs, e.buffs); assert.equal(it.desc, e.desc);
    const stat = it.buffs.find(b => b.bbStr.key === 'attr_common_global_buff');
    const extra = it.buffs.find(b => b.bbStr.key === `rhine_${key}`);
    assert.deepEqual(stat.bb, key === 'terminal' ? { atk: gold ? .25 : .15 } : { max_hp: gold ? .70 : .45 });
    assert.deepEqual(extra.bb, key === 'terminal'
      ? { layer_step: 10, attack_speed: gold ? 3 : 2, max_attack_speed: gold ? 30 : 20 }
      : { atk_per_layer: 1, combo_atk_per_layer: 2 });
    assert.equal(it.canGiveBond, false);
    assert.equal(it.giveBondId, key === 'terminal' ? 'rhineShip' : null);
    assert.equal(it.requiresBondId, key === 'mainframe' ? 'rhineShip' : null);
  }
});

test('Rhine equipment: real shop rolls and free supply/shop drafts include only normal equipment', () => {
  const pool = new SharedPool(gd);
  for (const [key, r] of Object.entries(RHINE_EQUIPMENT)) {
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

test('Rhine equipment: acquiring two copies merges once and normal upgrade effects preserve the golden link', () => {
  for (const key of Object.keys(RHINE_EQUIPMENT)) {
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

test('Rhine equipment: terminal grants membership only with the isomorph, in either grade; mainframe never grants it', () => {
  const base = Object.values(data.chess).find(c => c.visible && !c.isGolden && !c.bonds.includes('rhineShip'));
  for (const gold of [false, true]) {
    const terminal = { id: item('terminal', gold) }, mainframe = { id: item('mainframe', gold) };
    for (const isoId of ['chess_item_6_09_e_a', 'chess_item_6_09_e_b']) {
      assert.ok(!pieceBonds(gd, { id: base.chessId, items: [terminal] }).includes('rhineShip'));
      assert.ok(pieceBonds(gd, { id: base.chessId, items: [terminal, { id: isoId }] }).includes('rhineShip'));
      assert.ok(!pieceBonds(gd, { id: base.chessId, items: [mainframe, { id: isoId }] }).includes('rhineShip'));
      assert.match(data.items[isoId].desc, /莱茵实验终端.*莱茵生命/);
      assert.equal(data.effects[data.items[isoId].effectId].desc, data.items[isoId].desc);
    }
  }
});

test('Rhine equipment: both transparent PNG icons are registered and survive an asset manifest rebuild', async () => {
  const assets = JSON.parse(await readFile(new URL('../data/assets.json', import.meta.url), 'utf8'));
  const rebuilt = addRhineArt({});
  for (const key of Object.keys(RHINE_EQUIPMENT)) {
    const icon = data.items[item(key)].iconId, path = `/art/rhine/${key}.png`;
    assert.equal(assets.items[icon], path); assert.equal(rebuilt.items[icon], path);
    const image = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.deepEqual([...image.subarray(0,8)], [137,80,78,71,13,10,26,10]);
    assert.equal(image[25], 6, 'RGBA PNG retains alpha');
    assert.ok(image.readUInt32BE(16) >= 128 && image.readUInt32BE(20) >= 128);
  }
});
