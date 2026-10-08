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
import { arrange, rhineBotRecord, rhineLaserExposure } from '../../server/match/bot.js';
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
function nineSetup() {
  const data = fixture();
  const extra = Object.values(data.chess).filter(c => c.visible && !c.isGolden && !IDS.includes(c.chessId)).slice(0, 2).map(c => c.chessId);
  for (const id of extra) for (const c of [data.chess[id], data.chess[data.chess[id].goldenId]].filter(Boolean)) {
    c.bonds = [RHINE_BOND]; c.tokens = []; c.garrisonIds = []; c.position = 'MELEE';
  }
  data.chess[IDS[1]].bonds.push('maniShip');
  const h = setup({ data }), ps = h.ps('p_0');
  const pieces = [...IDS, ...extra].map(id => give(h.m, ps, id, 'board', freeTile(ps)));
  return { h, ps, pieces };
}

test('Rhine thresholds unlock a separate reserve, capacity 1/2, and harmony adds only one virtual member', () => {
  const h = setup(), ps = h.ps('p_0');
  member(h, ps, 0); member(h, ps, 1);
  assert.equal(ps.researchView().unlocked, false);
  member(h, ps, 2);
  assert.equal(ps.researchView().capacity, 1);
  assert.equal(ps.research.hand.filter(Boolean).length, 2);
  assert.deepEqual([device(ps, 'laser').uid, device(ps, 'laser').locked, device(ps, 'laser').minCount, device(ps, 'laser').maxStage], [null, true, 9, 0]);
  assert.deepEqual(deploy(h, ps, 'medical'), { ok: true });
  assert.equal(deploy(h, ps, 'energy').error, ERR.BOARD_FULL);
  member(h, ps, 3); member(h, ps, 4); member(h, ps, 5);
  assert.equal(ps.researchView().capacity, 2);
  assert.deepEqual(deploy(h, ps, 'energy'), { ok: true });
  assert.equal(deploy(h, ps, 'laser').error, ERR.BAD_TARGET);
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

test('Rhine count nine deploys all three types; dropping to eight recalls the laser before legal devices and preserves its UID', () => {
  const { h, ps, pieces } = nineSetup();
  assert.equal(ps.bonds[RHINE_BOND].count, 9);
  assert.equal(ps.researchView().capacity, 3);
  // Insert the laser first: loss of the gate must recall this one rather than the last legal device.
  for (const key of ['laser', 'medical', 'energy']) assert.deepEqual(deploy(h, ps, key), { ok: true });
  const laserUid = device(ps, 'laser').uid;
  ps.research.points.laser = 4; ps.research.stages.laser = 1;
  assert.equal(ps.battleInput().research.devices.filter(d => d.onBoard).length, 3);
  checkInvariants(h.m);
  assert.deepEqual(ps.move(pieces[7].uid, { area: 'hand', idx: 0 }), { ok: true });
  assert.equal(ps.researchView().capacity, 2);
  assert.equal(ps.researchView().devices.filter(d => d.onBoard).length, 2);
  assert.deepEqual([device(ps, 'laser').stage, device(ps, 'laser').points], [0, 0]);
  assert.equal(device(ps, 'laser').onBoard, false);
  assert.equal(device(ps, 'laser').locked, true);
  assert.equal(device(ps, 'laser').uid, laserUid);
  assert.equal(device(ps, 'medical').onBoard, true);
  assert.equal(device(ps, 'energy').onBoard, true);
  assert.equal(ps.research.hand.filter(Boolean).length, 1);
  assert.equal(deploy(h, ps, 'laser').error, ERR.BAD_TARGET);
  const [row, col] = freeTile(ps);
  assert.deepEqual(ps.move(pieces[7].uid, { area: 'board', row, col }), { ok: true });
  assert.equal(device(ps, 'laser').uid, laserUid);
  assert.deepEqual(deploy(h, ps, 'laser'), { ok: true });
  assert.equal(ps.researchView().devices.filter(d => d.onBoard).length, 3);
  checkInvariants(h.m);
});

test('eight Rhine members cannot forge laser deployment through a board swap, reorientation or battle input', () => {
  const { h, ps, pieces } = nineSetup();
  try {
    deploy(h, ps, 'medical'); deploy(h, ps, 'energy');
    const uid = device(ps, 'laser').uid;
    assert.deepEqual(ps.move(pieces[7].uid, { area: 'hand', idx: 0 }), { ok: true });
    assert.equal(ps.bonds[RHINE_BOND].count, 8);
    assert.equal(deploy(h, ps, 'laser').error, ERR.BAD_TARGET);
    // A malformed restored board still cannot use g.move to keep/reorder the now-locked card.
    const laser = ps.find(uid).piece;
    ps.research.hand[2] = null;
    const [row, col] = freeTile(ps), key = `${row},${col}`;
    ps.board.set(key, laser);
    const chess = [...ps.board.values()].find(p => p.kind === 'chess');
    assert.equal(ps.move(chess.uid, { area: 'board', row, col }).error, ERR.BAD_TILE);
    assert.equal(ps.move(uid, { area: 'board', row, col }, 'RIGHT').error, ERR.BAD_TARGET);
    assert.equal(ps.move(uid, { area: 'board', row, col }, 'UP').error, ERR.BAD_TARGET);
    assert.equal(ps.move(device(ps, 'energy').uid, { area: 'board', row, col }).error, ERR.BAD_TILE);
    const input = ps.battleInput();
    assert.equal(input.units.some(u => u.tokenId === 'token_rhine_laser'), false);
    assert.equal(input.research.devices.find(d => d.key === 'laser').locked, true);
    assert.equal(input.research.devices.filter(d => d.onBoard).length, 2);
    assert.equal(ps.find(uid).area, 'research');
    // Omitting the research flag cannot turn a device ID into a deployable ordinary summon.
    const [forgedRow, forgedCol] = freeTile(ps);
    ps.board.set(`${forgedRow},${forgedCol}`, { ...laser, uid: 999999, research: false });
    assert.equal(ps.battleInput().units.some(u => u.tokenId === 'token_rhine_laser'), false);
    assert.equal(device(ps, 'laser').uid, uid);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('the single-stage laser never earns research, including stale stages, points and synthetic participant state', () => {
  const { h, ps } = nineSetup();
  try {
    deploy(h, ps, 'laser');
    ps.research.stages.laser = 2; ps.research.points.laser = 4;
    const view = ps.researchView();
    assert.deepEqual([view.devices[2].stage, view.devices[2].points, view.devices[2].maxStage], [0, 0, 0]);
    assert.deepEqual([view.devices[2].locked, view.devices[2].minCount], [false, 9]);
    ps.freezeResearch(ps.battleInput());
    assert.deepEqual(ps.research.participants, []);
    ps.research.participants.push('laser');
    assert.equal(ps.settleResearch(true), true);
    assert.deepEqual([ps.research.stages.laser, ps.research.points.laser], [0, 0]);
    for (const success of [true, false]) {
      h.m.round++; ps.freezeResearch(ps.battleInput()); ps.settleResearch(success);
      assert.deepEqual([device(ps, 'laser').stage, device(ps, 'laser').points], [0, 0]);
    }
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('older unlocked ecology states retain medical/energy identity without generating a duplicate or an early laser', () => {
  const h = setup(), ps = h.ps('p_0');
  try {
    IDS.forEach((_, i) => member(h, ps, i));
    deploy(h, ps, 'medical');
    const medicalUid = device(ps, 'medical').uid, energyUid = device(ps, 'energy').uid;
    ps.research.points.medical = 3; ps.research.stages.energy = 1; ps.research.points.energy = 4;
    const legacy = ps.newPiece('token', 'token_rhine_ecology', { research: true, researchKey: 'ecology', ownerUid: null });
    ps.research.hand[2] = legacy;
    ps.research.stages.ecology = 2; ps.research.points.ecology = 0;
    const [row, col] = freeTile(ps);
    ps.board.set(`${row},${col}`, legacy);
    for (let i = 0; i < 3; i++) ps.recompute();
    assert.equal(device(ps, 'medical').uid, medicalUid);
    assert.equal(device(ps, 'energy').uid, energyUid);
    assert.deepEqual([device(ps, 'medical').points, device(ps, 'energy').stage, device(ps, 'energy').points], [3, 1, 4]);
    assert.equal(ps.find(legacy.uid), null);
    assert.equal(device(ps, 'laser').uid, null);
    assert.equal(device(ps, 'laser').locked, true);
    assert.deepEqual([...ps.board.values(), ...ps.research.hand.filter(Boolean)].filter(p => p.research).map(p => p.id).sort(), ['token_rhine_energy', 'token_rhine_medical']);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('bot device estimates use merged medical control/healing, energy stages and a capped pulse rate, and single-target drill ramp', () => {
  const h = setup(), ps = h.ps('p_0');
  try {
    IDS.forEach((_, i) => member(h, ps, i));
    ps.layers[RHINE_BOND] = 10;
    const medical = ps.find(device(ps, 'medical').uid).piece, energy = ps.find(device(ps, 'energy').uid).piece;
    for (const [stage, scale, targets] of [[0, 0.75, 1], [1, 0.75, 2], [2, 1, 3]]) {
      ps.research.stages.medical = stage;
      const rec = rhineBotRecord(h.m, ps, medical);
      assert.equal(rec.stats.atk, 340 * scale);
      assert.equal(rec.stats.bat, 3);
      assert.equal(rec._rhineSlow, 0.5);
      assert.equal(rec._rhineHeal, targets * scale * (stage ? 1.25 : 1));
      assert.equal(rec._rhineBind > 0, stage === 2);
      assert.equal(rec.rangeGrid.length, stage === 2 ? 29 : 13);
    }
    for (const [stage, scale] of [[0, 1.8], [1, 2.4], [2, 3]]) {
      ps.research.stages.energy = stage;
      assert.equal(rhineBotRecord(h.m, ps, energy).stats.atk, 340 * scale);
    }
    const crowded = { ...ps, board: new Map(Array.from({ length: 40 }, (_, i) => [String(i), { kind: 'chess' }])) };
    assert.equal(rhineBotRecord(h.m, crowded, energy).stats.bat, 1.5);
    const laser = { id: 'token_rhine_laser', research: true, researchKey: 'laser' };
    const laserRec = rhineBotRecord(h.m, ps, laser);
    assert.equal(laserRec.stats.atk, 510);
    assert.equal(laserRec._rhineLaser, true);
    assert.equal(rhineLaserExposure(510, 0, 1e6), 0);
    assert.equal(rhineLaserExposure(510, 20, 1e6), 15300);
    assert.equal(rhineLaserExposure(510, 40, 1e6), 135700);
  } finally { h.m.dispose(); }
});

test('autoplay keeps the deployed Rhine census at nine before placing all three devices', () => {
  const { h, ps, pieces } = nineSetup();
  try {
    const outsider = Object.values(h.m.gd.raw.chess).find(c => c.visible && c.isGolden && c.tier === 6 && !c.bonds.includes(RHINE_BOND));
    give(h.m, ps, outsider.chessId);
    arrange(h.m, ps);
    assert.equal(ps.bonds[RHINE_BOND].count, 9);
    assert.equal(device(ps, 'laser').onBoard, true);
    assert.equal(ps.researchView().devices.filter(d => d.onBoard).length, 3);
    const uid = device(ps, 'laser').uid;
    const empty = ps.hand.findIndex(p => !p);
    assert.deepEqual(ps.move(pieces[7].uid, { area: 'hand', idx: empty }), { ok: true });
    assert.equal(device(ps, 'laser').locked, true);
    arrange(h.m, ps);
    assert.equal(ps.bonds[RHINE_BOND].count, 9);
    assert.equal(device(ps, 'laser').uid, uid);
    assert.equal(device(ps, 'laser').onBoard, true);
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
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
  for (const key of ['medical', 'energy', 'laser']) assert.deepEqual(deploy(h, ps, key), { ok: true });
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
  assert.equal(ps.research.hand.filter(Boolean).length, 2);
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
  assert.equal(ps.research.hand.filter(Boolean).length, 2);
  assert.equal(device(ps, 'medical').points, 3);
  assert.equal(device(ps, 'medical').stage, 1);
  assert.equal(device(ps, 'energy').points, 0);
  assert.equal(device(ps, 'energy').stage, 2);
  assert.equal(deploy(h, ps, 'medical').error, ERR.BAD_TARGET);
  assert.deepEqual(ps.move(pieces[2].uid, { area: 'board', row: freeTile(ps)[0], col: freeTile(ps)[1] }), { ok: true });
  assert.equal(ps.researchView().active, true);
  assert.equal(new Set(ps.research.hand.filter(Boolean).map((p) => p.uid)).size, 2);
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
  ps.research.stages.medical = 2;
  ps.research.points.energy = 4;
  arrange(h.m, ps);
  assert.equal(device(ps, 'medical').onBoard, true);
  assert.equal(ps.researchView().devices.filter((d) => d.onBoard).length, 1);
  const uid = device(ps, 'medical').uid;
  ps.hand = Object.keys(h.m.gd.raw.items).slice(0, ps.hand.length).map((id) => ps.newPiece('item', id));
  arrange(h.m, ps);
  assert.equal(device(ps, 'medical').uid, uid);
  assert.equal(device(ps, 'medical').onBoard, true);
  assert.equal(ps.hand.filter(Boolean).length, 10);
  assert.equal(device(ps, 'medical').points, 0);
  assert.equal(device(ps, 'medical').stage, 2);
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

test('a research token retains its device identity alongside the upstream unite SP carry', () => {
  const h = setup(), ps = h.ps('p_0');
  try {
    IDS.slice(0, 3).forEach((_, i) => member(h, ps, i)); deploy(h, ps, 'medical');
    const uid = device(ps, 'medical').uid;
    const input = ps.battleInput({ carry: new Map([[uid, { sp: 40 }]]), reached: true });
    const token = input.units.find((u) => u.uid === uid);
    assert.equal(token.kind, 'token');
    assert.equal(token.research, true);
    assert.equal(token.researchKey, 'medical');
    assert.deepEqual(token.carryState, { sp: 40 });
    const spec = buildBattleSpec({ players: [input], kind: 'unite', battleId: 'rhine-unite-carry' });
    assert.deepEqual(spec.players[0].units.find((u) => u.uid === uid), token, 'JSON battle input keeps both fields');
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
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

for (const hidden of [false, true]) for (const mixed of [false, true]) {
  test(`${hidden ? 'hidden' : 'final'} boss research excludes failed fields${mixed ? ' even when another field wins' : ' from failure growth'}`, () => {
    const h = setup({ mode: 'coop', difficulty: hidden ? 'NORMAL' : 'FUNNY', humans: 4,
      script: (b) => b.kind === 'boss' || b.kind === 'hidden'
        ? (mixed && b.fieldId !== 'b1' ? { bossDps: 1e9 } : { throwInCtor: true }) : {} });
    try {
      for (const ps of h.m.players.values()) {
        IDS.slice(0, 3).forEach((_, i) => member(h, ps, i));
        assert.deepEqual(deploy(h, ps, 'medical'), { ok: true });
      }
      h.m.round = hidden ? h.m.gd.hiddenRound : 14;
      h.m.bossId = 'boss_1'; h.m.hiddenBossId = hidden ? 'boss_1' : null;
      if (hidden) {
        h.m.teamLp = [...h.m.players.values()].reduce((sum, ps) => sum + ps.lp, 0);
        for (const ps of h.m.players.values()) ps.lpAtFinal = ps.lp;
      }
      h.m.startFinalAssault(hidden);
      h.runToEnd();
      assert.equal(h.m.fields.length, 2);
      let failedPlayers = 0, actualPlayers = 0;
      for (const field of h.m.fields) for (const pid of field.players) {
        const ps = h.ps(pid), synthetic = field.battle.result().synthetic === true;
        assert.equal(device(ps, 'medical').points, synthetic ? 0 : 2, `${pid} research follows their actual field`);
        assert.equal(ps.research.settled.has(h.m.round), !synthetic, `${pid} synthetic results do not settle research`);
        if (synthetic) failedPlayers++; else actualPlayers++;
      }
      assert.equal(failedPlayers, mixed ? 2 : 4);
      assert.equal(actualPlayers, mixed ? 2 : 0);
    } finally { h.m.dispose(); }
  });
}

test('Ptilopsis research trait counts duplicate real pieces but excludes the harmony virtual member', () => {
  const data = fixture(), registry = new MetaRegistry(); registerMeta(registry);
  data.garrisons.garrison_rhine_test = { garrisonId: 'garrison_rhine_test', eventType: 'SERVER_PREP_FIN', effectKey: 'RHINE_RESEARCH_BY_MEMBER', bb: { layer: 2 }, bbStr: { conditionkey: 'character_target_inboard' } };
  data.chess[IDS[2]].garrisonIds = ['garrison_rhine_test'];
  data.chess[IDS[1]].bonds.push('maniShip');
  const eliteData = structuredClone(data);
  eliteData.garrisons.garrison_rhine_test.bb.layer = 4;
  const h = setup({ data, registry }), ps = h.ps('p_0');
  member(h, ps, 0); member(h, ps, 1); member(h, ps, 2);
  h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
  assert.equal(ps.layers[RHINE_BOND], 6);
  // Bond thresholds still use distinct names, but the research trait counts every real copy.
  give(h.m, ps, data.chess[IDS[0]].goldenId, 'board', freeTile(ps));
  assert.equal(ps.bonds[RHINE_BOND].count, 4, 'three real members plus the one harmony bonus');
  const elite = setup({ data: eliteData, registry }), elitePs = elite.ps('p_0');
  member(elite, elitePs, 0); member(elite, elitePs, 1); member(elite, elitePs, 2);
  give(elite.m, elitePs, eliteData.chess[IDS[0]].goldenId, 'board', freeTile(elitePs));
  elite.m.dispatch(elitePs, 'onPrepEnd', { round: 1 });
  assert.equal(elitePs.layers[RHINE_BOND], 16, 'four actual copies each give the elite four layers');
  assert.equal(h.m.gd.raw.garrisons.garrison_rhine_test.bb.layer, 2, 'another match cannot change the normal profile');
});
