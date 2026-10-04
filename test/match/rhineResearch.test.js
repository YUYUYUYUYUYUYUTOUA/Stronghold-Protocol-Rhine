import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';
import { MetaRegistry, makeCtx } from '../../server/match/effectsMeta.js';
import { registerMeta } from '../../server/sim/content/rhineMeta.js';
import { RHINE_BOND, RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { validateC2S } from '../../shared/protocol.js';
import { ERR } from '../../shared/constants.js';
import { canPlace, parseKey } from '../../server/match/board.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { FakeBattle } from './fakeBattle.js';
import { arrange } from '../../server/match/bot.js';
import { collectViolations } from '../../server/match/invariants.js';

// Independent of expansion authoring order: exercise the real match rules against six known, distinct members.
const IDS = ['chess_char_1_02_a', 'chess_char_2_02_a', 'chess_char_3_02_a', 'chess_char_4_21_a', 'chess_char_5_11_a', 'chess_char_6_11_a'];
function fixture() {
  const d = structuredClone(DATA);
  d.bonds[RHINE_BOND] = { bondId: RHINE_BOND, name: '莱茵生命', isCore: true, thresholds: [3, 6, 9], activeCount: 3, countMode: 'BOARD', weight: 0 };
  IDS.forEach((id, i) => {
    for (const c of [d.chess[id], d.chess[d.chess[id].goldenId]].filter(Boolean)) {
      c.bonds = [RHINE_BOND]; c.tier = i + 1; c.position = 'MELEE'; c.tokens = []; c.garrisonIds = [];
    }
  });
  for (const r of RHINE_DEVICES) d.tokens[r.tokenId] = { tokenId: r.tokenId, name: r.name, kind: 'summon', placeable: true, position: 'ALL', stats: { maxHp: 1, atk: 300, def: 0, res: 0, blockCnt: 0, bat: 1 } };
  return d;
}
function setup(o = {}) {
  const h = makeMatch({ mode: 'solo', fake: true, data: fixture(), registry: new MetaRegistry(), ...o }).start();
  h.toPrep(1).setStage('act2autochess_m01');
  for (const ps of h.m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
  }
  return h;
}
function freeTile(ps) {
  const [key] = [...ps.deployMap()].find(([k]) => !ps.board.has(k) && canPlace(ps.deployMap(), 'melee', ...parseKey(k)));
  return parseKey(key);
}
function member(h, ps, i) { return give(h.m, ps, IDS[i], 'board', freeTile(ps)); }
function device(ps, key) { return ps.researchView().devices.find((d) => d.key === key); }
function deploy(h, ps, key) {
  const [row, col] = freeTile(ps);
  return h.m.handle(ps.playerId, { t: 'g.move', uid: device(ps, key).uid, to: { area: 'board', row, col } });
}
function recall(h, ps, key, area = 'research') { return h.m.handle(ps.playerId, { t: 'g.move', uid: device(ps, key).uid, to: { area, idx: 0 } }); }

test('Rhine thresholds unlock a separate reserve, capacity 1/2, and harmony adds only one virtual member', () => {
  const h = setup(), ps = h.ps('p_0');
  member(h, ps, 0); member(h, ps, 1);
  assert.equal(ps.researchView().unlocked, false);
  member(h, ps, 2);
  assert.equal(ps.researchView().capacity, 1);
  assert.equal(ps.research.hand.filter(Boolean).length, 3);
  assert.deepEqual(deploy(h, ps, 'medical'), { ok: true });
  assert.equal(deploy(h, ps, 'energy').error, ERR.BOARD_FULL);
  member(h, ps, 3); member(h, ps, 4); member(h, ps, 5);
  assert.equal(ps.researchView().capacity, 2);
  assert.deepEqual(deploy(h, ps, 'energy'), { ok: true });
  assert.equal(deploy(h, ps, 'ecology').error, ERR.BOARD_FULL);
  checkInvariants(h.m);

  const data = fixture(); data.chess[IDS[1]].bonds.push('maniShip');
  const hh = setup({ data }), pp = hh.ps('p_0');
  member(hh, pp, 0); member(hh, pp, 1);
  assert.equal(pp.bonds[RHINE_BOND].count, 3);
  assert.equal(pp.researchView().capacity, 1);
  member(hh, pp, 2); member(hh, pp, 3); member(hh, pp, 4);
  assert.equal(pp.bonds[RHINE_BOND].count, 6);
  assert.equal(pp.researchView().capacity, 2);
});

test('Rhine count nine with eight actual members and harmony deploys all three types; dropping to eight recalls only excess', () => {
  const data = fixture();
  const extra = Object.values(data.chess).filter(c => c.visible && !c.isGolden && !IDS.includes(c.chessId)).slice(0, 2).map(c => c.chessId);
  for (const id of extra) for (const c of [data.chess[id], data.chess[data.chess[id].goldenId]].filter(Boolean)) {
    c.bonds = [RHINE_BOND]; c.tokens = []; c.garrisonIds = []; c.position = 'MELEE';
  }
  data.chess[IDS[1]].bonds.push('maniShip');
  const h = setup({ data }), ps = h.ps('p_0');
  const pieces = [...IDS, ...extra].map(id => give(h.m, ps, id, 'board', freeTile(ps)));
  assert.equal(ps.bonds[RHINE_BOND].count, 9);
  assert.equal(ps.researchView().capacity, 3);
  for (const key of ['medical', 'energy', 'ecology']) assert.deepEqual(deploy(h, ps, key), { ok: true });
  ps.research.points.ecology = 4; ps.research.stages.ecology = 1;
  assert.equal(ps.battleInput().research.devices.filter(d => d.onBoard).length, 3);
  checkInvariants(h.m);
  assert.deepEqual(ps.move(pieces[7].uid, { area: 'hand', idx: 0 }), { ok: true });
  assert.equal(ps.researchView().capacity, 2);
  assert.equal(ps.researchView().devices.filter(d => d.onBoard).length, 2);
  assert.deepEqual([device(ps, 'ecology').stage, device(ps, 'ecology').points], [1, 4]);
  assert.equal(ps.research.hand.filter(Boolean).length, 1);
  assert.equal(deploy(h, ps, 'ecology').error, ERR.BOARD_FULL);
  checkInvariants(h.m);
});

test('the shipped seven-member roster reaches Rhine nine through Muelsyse harmony and a terminal-isomorph recruit', () => {
  const h = makeMatch({ mode: 'solo', fake: true }).start(); h.toPrep(1).setStage('act2autochess_m01');
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
  const place = id => {
    const position = DATA.chess[id].position === 'RANGED' ? 'ranged' : 'melee';
    const tile = [...ps.deployMap()].find(([k]) => !ps.board.has(k) && canPlace(ps.deployMap(), position, ...parseKey(k)));
    return give(h.m, ps, id, 'board', parseKey(tile[0]));
  };
  for (const id of DATA.bonds[RHINE_BOND].visibleMembers.filter(id => !['char_135_halo', 'char_4048_doroth'].includes(DATA.chess[id].charId))) place(id);
  assert.equal(ps.bonds[RHINE_BOND].count, 8, 'seven real Rhine operators plus Muelsyse harmony');
  const recruitId = Object.values(DATA.chess).find(c => c.visible && !c.isGolden && !c.bonds.includes(RHINE_BOND)).chessId;
  const recruit = place(recruitId);
  for (const id of ['chess_item_rhine_terminal_a', 'chess_item_6_09_e_a']) {
    const it = ps.acquireItem(id);
    assert.deepEqual(ps.equip(it.uid, recruit.uid), { ok: true });
  }
  assert.equal(ps.bonds[RHINE_BOND].count, 9);
  assert.equal(ps.researchView().capacity, 3);
  for (const key of ['medical', 'energy', 'ecology']) assert.deepEqual(deploy(h, ps, key), { ok: true });
  assert.equal([...ps.board.values()].filter(p => p.kind === 'chess').length, 8);
  assert.equal(ps.battleInput().research.devices.filter(d => d.onBoard).length, 3);
  checkInvariants(h.m);
});

test('research cards never consume ordinary reserve slots, cannot be sold/equipped/destroyed, and reject unknown destinations', () => {
  const h = setup(), ps = h.ps('p_0');
  member(h, ps, 0); member(h, ps, 1); member(h, ps, 2);
  // Full ordinary hand must not stop research placement or recall (including old clients dropping to hand).
  const itemIds = Object.keys(h.m.gd.raw.items).slice(0, ps.hand.length);
  ps.hand = itemIds.map((id) => ps.newPiece('item', id));
  assert.deepEqual(deploy(h, ps, 'medical'), { ok: true });
  assert.deepEqual(recall(h, ps, 'medical', 'hand'), { ok: true });
  assert.equal(ps.research.hand.filter(Boolean).length, 3);
  const uid = device(ps, 'medical').uid;
  assert.equal(ps.sell(uid).error, ERR.BAD_TARGET);
  assert.equal(ps.destroy(uid).error, ERR.BAD_TARGET);
  assert.equal(ps.equip(ps.hand[0].uid, uid).error, ERR.BAD_TARGET);
  assert.equal(makeCtx(h.m, ps, { key: 'test' }, 'onPrepEnd').destroyPiece(uid), false);
  assert.equal(ps.move(uid, { area: 'moon' }).error, ERR.BAD_TARGET);
  assert.equal(ps.move(uid, { area: 'research', idx: 3 }).error, ERR.BAD_TARGET);
  assert.equal(validateC2S({ t: 'g.move', uid, to: { area: 'research', idx: 0 } }), null);
  assert.notEqual(validateC2S({ t: 'g.move', uid, to: { area: 'research', idx: 3 } }), null);
});

test('research devices obey upstream water and forbidden-tile legality without requiring a summoner', () => {
  const h = setup(), ps = h.ps('p_0');
  h.setStage('act2autochess_m04');
  member(h, ps, 0); member(h, ps, 1); member(h, ps, 2);
  const uid = device(ps, 'medical').uid;
  for (const row of [10, 11, 12]) assert.equal(ps.move(uid, { area: 'board', row, col: 6 }).error, ERR.BAD_TILE);
  ps.tileOverrides['12,10'] = 'none';
  assert.equal(ps.move(uid, { area: 'board', row: 12, col: 10 }).error, ERR.BAD_TILE);
  assert.equal(ps.find(uid).piece.ownerUid, null);
  assert.deepEqual(deploy(h, ps, 'medical'), { ok: true });
  ps.recompute();
  assert.equal(ps.find(uid).area, 'board');
  checkInvariants(h.m);
  h.m.dispose();
});

test('dropping 6→3→inactive recalls excess devices without losing points, duplicates or normal hand overflow', () => {
  const h = setup(), ps = h.ps('p_0');
  const pieces = IDS.map((_, i) => member(h, ps, i));
  deploy(h, ps, 'medical'); deploy(h, ps, 'energy');
  ps.research.points.medical = 3; ps.research.stages.medical = 1;
  ps.research.stages.energy = 2;
  assert.deepEqual(ps.move(pieces[5].uid, { area: 'hand', idx: 0 }), { ok: true });
  assert.equal(ps.researchView().devices.filter((d) => d.onBoard).length, 1);
  for (const [i, p] of pieces.slice(2, 5).entries()) assert.deepEqual(ps.move(p.uid, { area: 'hand', idx: i + 1 }), { ok: true });
  assert.equal(ps.researchView().active, false);
  assert.equal(ps.research.hand.filter(Boolean).length, 3);
  assert.equal(device(ps, 'medical').points, 3);
  assert.equal(device(ps, 'medical').stage, 1);
  assert.equal(device(ps, 'energy').points, 0);
  assert.equal(device(ps, 'energy').stage, 2);
  assert.equal(deploy(h, ps, 'medical').error, ERR.BAD_TARGET);
  assert.deepEqual(ps.move(pieces[2].uid, { area: 'board', row: freeTile(ps)[0], col: freeTile(ps)[1] }), { ok: true });
  assert.equal(ps.researchView().active, true);
  assert.equal(new Set(ps.research.hand.map((p) => p.uid)).size, 3);
  checkInvariants(h.m);
});

test('main battle freezes selected devices; each five-point breakthrough clears overflow, max stage stops growth and settlement is idempotent', () => {
  const h = setup(), ps = h.ps('p_0');
  IDS.slice(0, 3).forEach((_, i) => member(h, ps, i));
  deploy(h, ps, 'medical');
  // Ordinary previews and reserve shuffling do not participate in a main battle.
  ps.battleInput(); ps.battleInput();
  assert.equal(ps.settleResearch(true), false);
  ps.freezeResearch(ps.battleInput(), 'unite');
  assert.equal(ps.settleResearch(true), false);
  ps.freezeResearch(ps.battleInput(), 'normal');
  recall(h, ps, 'medical'); deploy(h, ps, 'energy');
  ps.freezeResearch(ps.battleInput(), 'normal');
  assert.equal(ps.settleResearch(false), true);
  assert.equal(ps.settleResearch(true), false);
  assert.equal(device(ps, 'medical').points, 1);
  assert.equal(device(ps, 'energy').points, 0);
  h.m.round++;
  recall(h, ps, 'energy'); deploy(h, ps, 'medical');
  ps.freezeResearch(ps.battleInput()); ps.settleResearch(false);
  assert.equal(device(ps, 'medical').points, 2);
  assert.equal(device(ps, 'medical').stage, 0);
  h.m.round++;
  ps.freezeResearch(ps.battleInput()); ps.settleResearch(true);
  assert.equal(device(ps, 'medical').points, 4);
  assert.equal(device(ps, 'medical').stage, 0);
  h.m.round++; ps.freezeResearch(ps.battleInput()); ps.settleResearch(true);
  assert.equal(device(ps, 'medical').stage, 1);
  assert.equal(device(ps, 'medical').points, 0, '4+2 breaks through and discards the extra point');
  assert.equal(ps.settleResearch(true), false);
  for (let i = 0; i < 3; i++) { h.m.round++; ps.freezeResearch(ps.battleInput()); ps.settleResearch(true); }
  assert.equal(device(ps, 'medical').stage, 2);
  assert.equal(device(ps, 'medical').points, 0);
  for (const success of [true, false, true]) { h.m.round++; ps.freezeResearch(ps.battleInput()); ps.settleResearch(success); }
  assert.equal(device(ps, 'medical').stage, 2);
  assert.equal(device(ps, 'medical').points, 0, 'max-level devices no longer accrue points');
  assert.equal(device(ps, 'energy').points, 0, 'unselected device never received progress');
  checkInvariants(h.m);
});

test('real match settlement credits only main battle, keeps each player separate and resync exposes research', () => {
  const h = setup({ mode: 'coop', humans: 2, script: (b) => b.kind === 'normal' ? { leaks: { p_0: 1 } } : {} });
  for (const ps of h.m.players.values()) {
    IDS.slice(0, 3).forEach((_, i) => member(h, ps, i));
    deploy(h, ps, ps.playerId === 'p_0' ? 'medical' : 'energy');
  }
  h.toPrep(2);
  const a = h.ps('p_0'), b = h.ps('p_1');
  assert.equal(device(a, 'medical').points, 1);
  assert.equal(device(a, 'energy').points, 0);
  assert.equal(device(b, 'energy').points, 2);
  assert.equal(device(b, 'medical').points, 0);
  h.m.onDisconnect('p_0'); h.m.onReconnect('p_0');
  h.m.onDisconnect('p_1'); h.m.onReconnect('p_1');
  assert.equal(h.lastTo('p_0', 'm.private').research.devices[0].points, 1);
  assert.equal(h.lastTo('p_1', 'm.private').research.devices[1].stage, 0);
  checkInvariants(h.m);
});

test('exactly five failures advance one stage; reconnect exposes the reset counter and preserved independent stage', () => {
  const h = setup(), ps = h.ps('p_0');
  IDS.slice(0, 3).forEach((_, i) => member(h, ps, i)); deploy(h, ps, 'medical');
  for (let i = 0; i < 5; i++) {
    if (i) h.m.round++;
    ps.freezeResearch(ps.battleInput());
    assert.equal(ps.settleResearch(false), true);
    assert.equal(device(ps, 'medical').points, i < 4 ? i + 1 : 0);
    assert.equal(device(ps, 'medical').stage, i < 4 ? 0 : 1);
  }
  recall(h, ps, 'medical');
  h.m.onDisconnect('p_0'); h.m.onReconnect('p_0');
  const view = h.lastTo('p_0', 'm.private');
  assert.deepEqual([view.research.devices[0].stage, view.research.devices[0].points], [1, 0]);
  assert.deepEqual([view.research.hand[0].stage, view.research.hand[0].points], [1, 0]);
  checkInvariants(h.m);
});

test('research invariants reject out-of-range stages, unconsumed breakthroughs and points at max level', () => {
  const h = setup(), ps = h.ps('p_0');
  IDS.slice(0, 3).forEach((_, i) => member(h, ps, i));
  ps.research.points.medical = 5;
  assert.ok(collectViolations(h.m).some((s) => s.includes('invalid research progress medical')));
  ps.research.points.medical = 1; ps.research.stages.medical = 2;
  assert.ok(collectViolations(h.m).some((s) => s.includes('invalid research progress medical')));
  ps.research.points.medical = 0; ps.research.stages.medical = 3;
  assert.ok(collectViolations(h.m).some((s) => s.includes('invalid research stage medical')));
  ps.research.stages.medical = 2;
  checkInvariants(h.m);
});

test('a failed battle construction does not award research for a synthetic empty victory', () => {
  const h = setup({ script: () => ({ throwInCtor: true }) }), ps = h.ps('p_0');
  IDS.slice(0, 3).forEach((_, i) => member(h, ps, i)); deploy(h, ps, 'medical');
  h.toPrep(2);
  assert.equal(device(ps, 'medical').points, 0);
  assert.equal(ps.research.settled.has(1), false);
});

test('autoplay deploys research from its dedicated reserve, prefers developed devices and can recall with a full ordinary hand', () => {
  const h = setup(), ps = h.ps('p_0');
  IDS.slice(0, 3).forEach((_, i) => member(h, ps, i));
  ps.research.stages.ecology = 2;
  ps.research.points.medical = 4;
  arrange(h.m, ps);
  assert.equal(device(ps, 'ecology').onBoard, true);
  assert.equal(ps.researchView().devices.filter((d) => d.onBoard).length, 1);
  const uid = device(ps, 'ecology').uid;
  ps.hand = Object.keys(h.m.gd.raw.items).slice(0, ps.hand.length).map((id) => ps.newPiece('item', id));
  arrange(h.m, ps);
  assert.equal(device(ps, 'ecology').uid, uid);
  assert.equal(device(ps, 'ecology').onBoard, true);
  assert.equal(ps.hand.filter(Boolean).length, 10);
  assert.equal(device(ps, 'ecology').points, 0);
  assert.equal(device(ps, 'ecology').stage, 2);
  checkInvariants(h.m);
});

test('cross-player requests and old board swaps cannot transfer devices or bypass the research capacity', () => {
  const h = setup({ mode: 'coop', humans: 2 }), a = h.ps('p_0'), b = h.ps('p_1');
  for (const ps of [a, b]) IDS.slice(0, 3).forEach((_, i) => member(h, ps, i));
  const foreign = device(a, 'medical').uid;
  assert.equal(h.m.handle(b.playerId, { t: 'g.move', uid: foreign, to: { area: 'research' } }).error, ERR.BAD_TARGET);
  assert.equal(h.m.handle(b.playerId, { t: 'g.sell', uid: foreign }).error, ERR.BAD_TARGET);
  deploy(h, a, 'medical');
  const chess = [...a.board.values()].find((p) => p.kind === 'chess');
  const chessLoc = a.find(chess.uid), [row, col] = parseKey(chessLoc.key);
  assert.deepEqual(a.move(foreign, { area: 'board', row, col }), { ok: true }, 'research may swap its own board tile with an operator');
  assert.equal(deploy(h, a, 'energy').error, ERR.BOARD_FULL);
  const newcomer = give(h.m, a, IDS[3]);
  const loc = a.find(foreign), [r, c] = parseKey(loc.key);
  assert.deepEqual(a.move(newcomer.uid, { area: 'board', row: r, col: c }), { ok: true }, 'operator replacing device returns it to research reserve');
  assert.equal(a.find(foreign).area, 'research');
  assert.deepEqual(deploy(h, a, 'energy'), { ok: true });
  assert.equal(deploy(h, a, 'medical').error, ERR.BOARD_FULL);
  assert.equal(device(b, 'medical').onBoard, false);
  checkInvariants(h.m);
});

test('research survives the actual BattleSpec JSON boundary and retains the opening stages', () => {
  const h = setup(), ps = h.ps('p_0');
  IDS.slice(0, 3).forEach((_, i) => member(h, ps, i)); deploy(h, ps, 'medical');
  ps.research.points.medical = 4;
  ps.research.stages.medical = 1;
  const opts = h.m._normalOpts(ps);
  const spec = buildBattleSpec({ ...opts, battleId: 'rhine-json' });
  ps.research.points.medical = 0;
  ps.research.stages.medical = 2;
  assert.equal(spec.players[0].research.devices[0].stage, 1);
  assert.equal(spec.players[0].research.devices[0].points, 4);
  assert.equal(spec.players[0].units.filter((u) => u.research).length, 1);
  assert.equal(spec.players[0].units.find((u) => u.research).ownerUid, null);
  const battle = createBattleFromSpec(spec, h.m.gd.raw, { BattleClass: FakeBattle });
  assert.equal(battle.opts.players[0].research.devices[0].stage, 1);
  assert.equal(battle.opts.players[0].research.devices[0].points, 4);
});

test('boss research grows once from the shared victory, not separately for each teammate or result callback', () => {
  const h = setup({ mode: 'coop', difficulty: 'FUNNY', humans: 2, script: (b) => b.kind === 'boss' ? { bossDps: 1e9 } : {} });
  h.toPrep(14);
  for (const ps of h.m.players.values()) {
    IDS.slice(0, 3).forEach((_, i) => member(h, ps, i)); deploy(h, ps, 'medical');
  }
  h.drive(() => h.m.phase === 'FINAL_ASSAULT');
  h.runToEnd();
  for (const ps of h.m.players.values()) {
    assert.equal(device(ps, 'medical').points, 2);
    assert.equal(ps.settleResearch(true), false);
  }
});

test('Ptilopsis research trait counts duplicate real pieces but excludes the harmony virtual member', () => {
  const data = fixture(), registry = new MetaRegistry(); registerMeta(registry);
  data.garrisons.garrison_rhine_test = { garrisonId: 'garrison_rhine_test', eventType: 'SERVER_PREP_FIN', effectKey: 'RHINE_RESEARCH_BY_MEMBER', bb: { layer: 2 }, bbStr: { conditionkey: 'character_target_inboard' } };
  data.chess[IDS[2]].garrisonIds = ['garrison_rhine_test'];
  data.chess[IDS[1]].bonds.push('maniShip');
  const h = setup({ data, registry }), ps = h.ps('p_0');
  member(h, ps, 0); member(h, ps, 1); member(h, ps, 2);
  h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
  assert.equal(ps.layers[RHINE_BOND], 6);
  // Bond thresholds still use distinct names, but the research trait counts every real copy.
  give(h.m, ps, data.chess[IDS[0]].goldenId, 'board', freeTile(ps));
  assert.equal(ps.bonds[RHINE_BOND].count, 4, 'three real members plus the one harmony bonus');
  const elite = h.m.gd.raw.garrisons.garrison_rhine_test;
  elite.bb.layer = 4;
  h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
  assert.equal(ps.layers[RHINE_BOND], 22);
});
