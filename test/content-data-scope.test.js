import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../server/sim/Battle.js';
import { DataSource } from '../server/sim/simdata.js';
import { MetaRegistry } from '../server/match/effectsMeta.js';
import { withGameData, scopedGameData } from '../server/sim/content/support/dataScope.js';
import { gameData, setGameData, bondRecord, itemRecord, garrisonRecord, isCoreBond } from '../server/sim/content/support/index.js';
import { DATA, makeMatch, give } from './match/harness.js';
import { chessRec, flatStage, flatRoutes } from './helpers/battleHarness.js';

const ITEM = 'chess_item_1_01_e_a';
const GAR = 'garrison_128_a';
const OP = 'scope_operator_a';
const MANI = 'scope_mani_a';
const QUIET = { error() {}, warn() {}, info() {} };
function profile({ base, perLayer, item, layers, core }) {
  const data = structuredClone(DATA);
  Object.assign(data.bonds.yanShip.buffs[0].bb, { base_atk: base, atk_per_stack: perLayer });
  data.bonds.yanShip.isCore = core;
  data.items[ITEM].buffs[0].bb.atk = item;
  data.items[ITEM].params.atk = item;
  data.garrisons[GAR].bb.bond_add_count = layers;
  data.garrisons[GAR].bbStr.bond_id = 'yanShip';
  data.chess[OP] = { ...chessRec({ id: OP, bonds: ['yanShip'], stats: { atk: 1000 }, skill: null }), garrisonIds: [GAR] };
  data.chess[MANI] = chessRec({ id: MANI, bonds: ['maniShip'], stats: { atk: 1000 }, skill: null });
  return data;
}
const makeProfiles = () => [
  profile({ base: 0.1, perLayer: 0.01, item: 0.2, layers: 2, core: true }),
  profile({ base: 0.4, perLayer: 0.03, item: 0.7, layers: 7, core: false }),
];
function battle(data, extraContent = []) {
  return new Battle({
    data: new DataSource(data), stage: flatStage(), routes: flatRoutes(),
    kind: 'normal', content: 'full', seed: 771, timeLimit: 60, autoFinish: false,
    logger: QUIET, extraContent,
    players: [{ playerId: 'p', units: [
      { uid: 1, chessId: OP, row: 10, col: 4, items: [ITEM] },
      { uid: 2, chessId: MANI, row: 10, col: 5 },
    ], bonds: {
      yanShip: { active: true, count: 3, tier: 1, layers: 1 },
      maniShip: { active: true, count: 1, tier: 1, layers: 0 },
    } }],
  });
}
const op = (b, id = OP) => b.allyUnits.find((u) => u.defId === id);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('two real full-content battles interleave different bond/item/garrison records and core-bond caches', () => {
  const [a, b] = makeProfiles();
  const first = battle(a), second = battle(b);
  second.step(); first.step();
  close(op(first).s.atk, 1310);
  close(op(second).s.atk, 2130);
  close(op(first, MANI).s.atk, 1110);
  close(op(second, MANI).s.atk, 1000);
  first.emit('skillStart', { unit: op(first) });
  second.emit('skillStart', { unit: op(second) });
  assert.equal(first.getPlayer('p').bonds.yanShip.layers, 3);
  assert.equal(second.getPlayer('p').bonds.yanShip.layers, 8);
  for (let i = 0; i < 30; i++) { second.step(); first.step(); }
  close(op(first).s.atk, 1330);
  close(op(second).s.atk, 2340);
  close(op(first, MANI).s.atk, 1130);
  close(op(second, MANI).s.atk, 1000);
  assert.deepEqual(first.result().perPlayer.p.layerGains, { yanShip: 2 });
  assert.deepEqual(second.result().perPlayer.p.layerGains, { yanShip: 7 });
  assert.equal(first.errorCount, 0);
  assert.equal(second.errorCount, 0);
  assert.equal(scopedGameData(), null);
});

test('nested battle hooks, throwing hooks and scheduled callbacks restore the enclosing and default data', () => {
  const [a, b] = makeProfiles();
  const fallback = { bonds: { fallback: { isCore: true } }, items: {}, garrisons: {} };
  setGameData(fallback);
  try {
    const first = battle(a), second = battle(b);
    const seen = [];
    second.on('scope_probe', () => {
      seen.push(itemRecord(ITEM).params.atk);
      assert.strictEqual(gameData(), b);
      throw new Error('expected nested hook failure');
    });
    second.on('scope_probe', () => seen.push(garrisonRecord(GAR).bb.bond_add_count));
    first.on('scope_probe', () => {
      assert.strictEqual(gameData(), a);
      second.emit('scope_probe', {});
      assert.strictEqual(gameData(), a);
      seen.push(itemRecord(ITEM).params.atk);
    });
    first.emit('scope_probe', {});
    assert.deepEqual(seen, [0.7, 7, 0.2]);
    assert.equal(second.errorCount, 1);
    assert.strictEqual(gameData(), fallback);
    second.after(0, () => {
      assert.strictEqual(gameData(), b);
      assert.equal(isCoreBond('yanShip'), false);
      throw new Error('expected scheduled callback failure');
    });
    second.after(0, () => seen.push(bondRecord('yanShip').buffs[0].bb.base_atk));
    withGameData(a, () => {
      second.step();
      assert.strictEqual(gameData(), a);
      assert.equal(isCoreBond('yanShip'), true);
    });
    assert.deepEqual(seen, [0.7, 7, 0.2, 0.4]);
    assert.equal(second.errorCount, 2);
    assert.strictEqual(gameData(), fallback);
    assert.equal(scopedGameData(), null);
    assert.throws(() => withGameData(a, () => withGameData(new DataSource(b), () => { throw new Error('scope failure'); })), /scope failure/);
    assert.strictEqual(gameData(), fallback);
  } finally { setGameData(null); }
});

test('constructor content installation scopes lookups and restores an outer scope after an install error', () => {
  const [a, b] = makeProfiles();
  withGameData(a, () => {
    const probes = [];
    const nested = battle(b, [{ install(inner) {
      probes.push(garrisonRecord(GAR).bb.bond_add_count);
      assert.strictEqual(gameData(), b);
      assert.strictEqual(inner.data.contentData, b);
      throw new Error('expected install error');
    } }]);
    assert.deepEqual(probes, [7]);
    assert.equal(nested.errorCount, 1);
    assert.strictEqual(gameData(), a);
  });
  assert.equal(scopedGameData(), null);
});

test('actual MetaHandler dispatch, dynamic garrison hook selection and direct choices use the match profile across nesting/errors', () => {
  const [a, b] = makeProfiles();
  const ra = new MetaRegistry(), rb = new MetaRegistry();
  const ha = makeMatch({ mode: 'solo', data: a, registry: ra, fake: true }).start();
  const hb = makeMatch({ mode: 'solo', data: b, registry: rb, fake: true }).start();
  try {
    ha.toPrep(1); hb.toPrep(1);
    const pa = ha.ps('p_0'), pb = hb.ps('p_0');
    give(ha.m, pa, OP); give(hb.m, pb, OP);
    const seen = [];
    ra.global('scope_outer', { onPrepEnd(ctx) {
      assert.strictEqual(gameData(), a);
      ctx.addFunds(Math.round(itemRecord(ITEM).params.atk * 100));
      hb.m.dispatch(pb, 'onPrepEnd', {});
      assert.strictEqual(gameData(), a);
    } });
    rb.global('scope_throw', { onPrepEnd() {
      assert.strictEqual(gameData(), b);
      throw new Error('expected meta handler failure');
    } });
    rb.global('scope_tail', { onPrepEnd(ctx) { ctx.addFunds(Math.round(itemRecord(ITEM).params.atk * 100)); } });
    for (const [reg, data, label] of [[ra, a, 'a'], [rb, b, 'b']]) {
      reg.garrison('act1autochess_gar_event_useskill', {
        garrisonHooks() {
          assert.strictEqual(gameData(), data);
          seen.push(label + ':hooks');
          return ['onPrepEnd'];
        },
        onPrepEnd(ctx) {
          assert.strictEqual(gameData(), data);
          ctx.addFunds(garrisonRecord(GAR).bb.bond_add_count);
        },
      });
      reg.choice('scope_pick', { onChoicePick(ctx) {
        assert.strictEqual(gameData(), data);
        ctx.addFunds(garrisonRecord(GAR).bb.bond_add_count);
      } });
    }
    const fa = pa.funds, fb = pb.funds;
    ha.m.dispatch(pa, 'onPrepEnd', {});
    assert.equal(pa.funds - fa, 22);
    assert.equal(pb.funds - fb, 77);
    assert.deepEqual(seen, ['b:hooks', 'a:hooks']);
    assert.equal(hb.m.dispatcher.errors, 1);
    assert.equal(ha.m.dispatcher.errors, 0);
    withGameData(a, () => {
      assert.equal(hb.m.dispatcher.runKey(pb, 'choice:scope_pick', 'onChoicePick', { kind: 'choice' }, {}), true);
      assert.strictEqual(gameData(), a);
    });
    assert.equal(pb.funds - fb, 84);
    assert.equal(ha.m.dispatcher.depth, 0);
    assert.equal(hb.m.dispatcher.depth, 0);
    assert.equal(scopedGameData(), null);
  } finally { ha.m.dispose(); hb.m.dispose(); }
});
