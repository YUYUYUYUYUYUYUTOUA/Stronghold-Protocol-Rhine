import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { getDataProfile } from '../../server/data.js';
import { give, legalTileFor, makeMatch } from './harness.js';

const BEACON = 'chess_item_5_04_e_a';
const QUIET = { info() {}, warn() {}, error() {} };
const held = (ps) => [...ps.hand, ...ps.temp, ...ps.board.values()].filter(Boolean);
const beacons = (ps) => held(ps).filter((p) => p.kind === 'item' && p.id === BEACON);

for (const rhine of [true, false]) {
  test(`${rhine ? 'Rhine' : 'vanilla'} six-seat match supplies one ordinary beacon per surviving player before R10/R12/R14 prep`, () => {
    const h = makeMatch({ humans: 6, difficulty: 'HARD', data: getDataProfile(rhine, { log: QUIET }), rhineEnabled: rhine, fake: true, seed: 8643 }).start();
    try {
      assert.equal(h.m.publicView().dataProfile, rhine ? 'rhine' : 'vanilla');
      for (const round of [10, 12, 14]) {
        h.toPrep(round - 1);
        const before = new Map(h.m.order.map((ps) => [ps.playerId, beacons(ps).length]));
        h.toPrep(round);
        for (const ps of h.m.order) {
          assert.equal(beacons(ps).length, before.get(ps.playerId) + 1, `${ps.playerId}, R${round}`);
          const piece = beacons(ps).at(-1);
          assert.equal(h.m.gd.item(piece.id).name, '信标');
          assert.equal(h.m.gd.item(piece.id).isGolden, false);
          assert.ok(ps.privateView().hand.some((p) => p?.uid === piece.uid), 'the supply reaches the real private view');
        }
        h.invariants();
      }
      assert.equal(h.logs.error.length, 0);
      assert.equal(h.m.dispatcher.errors, 0);
    } finally { h.m.dispose(); }
  });
}

test('one-to-five starting seats and solo never receive the six-seat round supply', () => {
  for (const mode of ['coop', 'solo']) for (const count of (mode === 'solo' ? [1] : [1, 2, 3, 4, 5])) {
    const h = makeMatch({ mode, humans: count, fake: true, seed: 22 }).start();
    try {
      h.toPrep(1);
      for (const round of [10, 12, 14]) {
        h.m.startRound(round);
        assert.ok(h.m.order.every((ps) => beacons(ps).length === 0), `${mode}, ${count} seats, R${round}`);
      }
    } finally { h.m.dispose(); }
  }
});

test('AI starting seats count; eliminated and departed players are skipped without removing the remaining seats eligibility', () => {
  const h = makeMatch({ humans: 2, bots: 4, fake: true, seed: 87 }).start();
  try {
    h.toPrep(1);
    h.ps('ai_0').eliminate(9);
    h.m.onLeave('p_1');
    h.m.startRound(10);
    assert.equal(h.m.startingPlayerCount, 6);
    for (const ps of h.m.order) assert.equal(beacons(ps).length, ps.alive ? 1 : 0, ps.playerId);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('reconnect, full state resync and repeated round entry cannot duplicate a milestone beacon', () => {
  const h = makeMatch({ humans: 6, fake: true, seed: 19 }).start();
  try {
    h.toPrep(1);
    h.m.startRound(10);
    const before = new Map(h.m.order.map((ps) => [ps.playerId, beacons(ps).map((p) => p.uid)]));
    h.m.onDisconnect('p_0');
    h.m.onReconnect('p_0');
    h.m.onReconnect('p_0');
    h.m.startRound(10);
    for (const ps of h.m.order) assert.deepEqual(beacons(ps).map((p) => p.uid), before.get(ps.playerId), ps.playerId);
    h.m.startRound(11);
    for (const ps of h.m.order) assert.deepEqual(beacons(ps).map((p) => p.uid), before.get(ps.playerId), 'other rounds have no extra supply');
    h.m.startRound(12);
    assert.ok(h.m.order.every((ps) => beacons(ps).length === 2), 'a later milestone still awards its own supply');
  } finally { h.m.dispose(); }
});

test('a full hand receives the beacon in temp and can use it during the same prep', () => {
  const h = makeMatch({ humans: 6, fake: true, seed: 24 }).start();
  try {
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.bandId = null;
    for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_1_03_e_b');
    h.m.startRound(10);
    const beacon = ps.temp.find((p) => p?.id === BEACON);
    assert.ok(beacon, 'hand overflow reaches the existing temp inventory');
    assert.equal(ps.tempDue(beacon), ps.prepsEnded, 'usable throughout this prep, not prematurely expired');
    assert.ok(ps.privateView().temp.some((p) => p?.uid === beacon.uid));
    h.runToPhase(PHASE.PREP, 10);
    assert.ok(ps.find(beacon.uid), 'the transition into prep retains the supply');
    h.invariants();
  } finally { h.m.dispose(); }
});

test('both inventories full retain their contents and report the existing reward warning only once for that milestone', () => {
  const h = makeMatch({ humans: 6, fake: true, seed: 27 }).start();
  try {
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.bandId = null;
    for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_1_03_e_b');
    for (let i = 0; i < ps.temp.length; i++) ps._putTemp(i, ps.newPiece('item', 'chess_item_1_03_e_b'));
    const before = held(ps).map((p) => p.uid);
    h.m.startRound(10);
    assert.equal(beacons(ps).length, 0);
    assert.deepEqual(held(ps).map((p) => p.uid), before, 'an overflowing reward must not evict an owned item');
    const warnings = () => h.allTo('p_0', 'm.toast').filter((msg) => JSON.stringify(msg).includes('整备区已满，获得的装备已销毁'));
    assert.equal(warnings().length, 1, 'the ordinary reward overflow warning is delivered');
    ps.hand[0] = null;
    h.m.startRound(10);
    assert.equal(beacons(ps).length, 0, 'making room does not grant the same milestone a second time');
    assert.equal(warnings().length, 1);
    h.m.startRound(12);
    assert.equal(beacons(ps).length, 1, 'full inventory at R10 does not swallow a later normal reward');
  } finally { h.m.dispose(); }
});

test('a round-supplied beacon can replace a six-tier core and send its original operator to the best matching teammate next prep', () => {
  const h = makeMatch({ humans: 6, difficulty: 'HARD', fake: true, seed: 45 }).start();
  try {
    h.toPrep(10);
    const m = h.m, sender = h.ps('p_0'), receiver = h.ps('p_1');
    const core = m.gd.visibleChess.find((id) => {
      const c = m.gd.chess(id);
      return c.tier === 6 && m.pool.left(id) > 0 && c.bonds?.length;
    });
    assert.ok(core, 'an unbanned core is available');
    const bond = m.gd.chess(core).bonds[0];
    const mate = m.gd.visibleChess.find((id) => id !== core && m.gd.chess(id).bonds.includes(bond) && legalTileFor(m, receiver, id));
    assert.ok(mate);
    give(m, receiver, mate, 'board', legalTileFor(m, receiver, mate));
    const target = give(m, sender, core);
    const beacon = beacons(sender)[0];
    assert.deepEqual(m.handle(sender.playerId, { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid }), { ok: true });
    assert.equal(sender.find(target.uid), null, 'the sending operator is consumed by the normal beacon');
    assert.equal(sender.find(beacon.uid), null, 'the supplied beacon is consumed once');
    const offer = sender.offers.at(-1);
    assert.equal(offer.slots.length, 2);
    assert.ok(offer.slots.every((slot) => m.gd.chess(slot.id).tier === 6), 'sender receives the existing same-tier recruitment choice');
    assert.equal(held(receiver).some((p) => m.gd.baseIdOf(p.id) === core), false, 'gift is deferred until next round');
    h.toPrep(11);
    assert.equal(held(receiver).filter((p) => p.kind === 'chess' && m.gd.baseIdOf(p.id) === core).length, 1, 'core arrives at the matching teammate');
    const gifts = sender.effects.filter((e) => e.key === 'effect:builtin_gift');
    assert.equal(gifts.length, 0);
    h.invariants();
  } finally { h.m.dispose(); }
});

for (const rhine of [true, false]) for (const golden of [false, true]) {
  test(`${rhine ? 'Rhine' : 'vanilla'} R14 reward beacon immediately transfers the original ${golden ? 'elite' : 'normal'} core, with overflow and a gift notice`, () => {
    const h = makeMatch({ humans: 6, difficulty: 'HARD', data: getDataProfile(rhine, { log: QUIET }), rhineEnabled: rhine, fake: true, seed: 45 }).start();
    try {
      h.toPrep(14);
      const m = h.m, sender = h.ps('p_0'), receiver = h.ps('p_1');
      const core = m.gd.visibleChess.find((id) => m.gd.chess(id).tier === 6 && m.pool.left(id) >= 3 && m.gd.chess(id).bonds?.length);
      assert.ok(core);
      const bond = m.gd.chess(core).bonds[0];
      const mate = m.gd.visibleChess.find((id) => id !== core && m.gd.chess(id).bonds.includes(bond) && legalTileFor(m, receiver, id));
      assert.ok(mate);
      give(m, receiver, mate, 'board', legalTileFor(m, receiver, mate));
      for (let i = 0; i < receiver.hand.length; i++) receiver.hand[i] ||= receiver.newPiece('item', 'chess_item_1_03_e_b');
      const original = golden ? m.gd.goldenIdOf(core) : core;
      const target = give(m, sender, original);
      const beacon = beacons(sender).find((p) => p.meta.sixPlayerBeaconRound === 14);
      assert.ok(beacon);
      assert.equal(sender.pieceView(beacon).giftTiming, 'immediate', 'only the R14 supply exposes its timing to the client');
      assert.deepEqual(m.handle(sender.playerId, { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid }), { ok: true });
      const gift = receiver.temp.find((p) => p?.kind === 'chess' && p.id === original);
      assert.ok(gift, 'same prep immediate gift uses the recipient temp inventory when their hand is full');
      assert.equal(gift.id, original);
      assert.equal(m.gd.chess(gift.id).isGolden, golden, 'upstream original-operator semantics retain elite status');
      assert.equal(gift.poolCopies, golden ? m.gd.goldenCopies : 1, 'the gift retains the original pool-copy count');
      assert.equal(receiver.tempDue(gift), receiver.prepsEnded, 'gift remains usable in R14 preparation');
      assert.ok(receiver.privateView().temp.some((p) => p?.uid === gift.uid));
      assert.ok(h.allTo(receiver.playerId, 'm.ticker').some((msg) => msg.type === 'CHAR_GIFT' && msg.text.includes(m.gd.chess(original).name)), 'receiver is told which core arrived');
      assert.equal(sender.find(target.uid), null);
      assert.equal(sender.find(beacon.uid), null);
      assert.equal(sender.offers.at(-1).slots.length, 2);
      assert.ok(sender.offers.at(-1).slots.every((s) => m.gd.chess(s.id).tier === 6));
      assert.ok(!sender.effects.some((e) => e.id === `gift:${beacon.uid}`), 'immediate gift does not leave a second next-round transfer');
      m.onReconnect(sender.playerId);
      m.onReconnect(receiver.playerId);
      assert.equal(receiver.temp.filter((p) => p?.id === original).length, 1, 'resync cannot duplicate delivery');
      h.invariants();
    } finally { h.m.dispose(); }
  });
}

test('an ordinary bought beacon and a saved R10 supply used in R14 both retain next-round transfer timing', () => {
  for (const kind of ['bought', 'savedR10', 'savedR12']) {
    const h = makeMatch({ humans: 6, difficulty: 'HARD', fake: true, seed: 45 }).start();
    try {
      h.toPrep(14);
      const m = h.m, sender = h.ps('p_0');
      const core = m.gd.visibleChess.find((id) => m.gd.chess(id).tier === 6 && m.pool.left(id) > 0 && m.gd.chess(id).bonds?.length);
      const target = give(m, sender, core);
      const beacon = kind === 'bought'
        ? sender.acquireItem(BEACON, { source: 'buy' })
        : beacons(sender).find((p) => p.meta.sixPlayerBeaconRound === (kind === 'savedR10' ? 10 : 12));
      assert.ok(beacon);
      assert.equal(sender.pieceView(beacon).giftTiming, undefined);
      assert.deepEqual(m.handle(sender.playerId, { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid }), { ok: true });
      assert.ok(!m.order.filter((ps) => ps !== sender).some((ps) => held(ps).some((p) => p.kind === 'chess' && p.id === core)), kind);
      const queued = sender.effects.find((e) => e.id === `gift:${beacon.uid}`);
      assert.equal(queued?.key, 'effect:builtin_gift', kind);
      assert.equal(queued.params.chessId, core);
      assert.equal(sender.offers.at(-1).slots.length, 2);
      h.invariants();
    } finally { h.m.dispose(); }
  }
});

test('a six-seat R10 reward still sends the original elite after its sender is eliminated', () => {
  const h = makeMatch({ humans: 6, difficulty: 'HARD', fake: true, seed: 45 }).start();
  try {
    h.toPrep(10);
    const m = h.m, sender = h.ps('p_0'), receiver = h.ps('p_1');
    const core = m.gd.visibleChess.find((id) => m.gd.chess(id).tier === 6 && m.pool.left(id) >= 3 && m.gd.chess(id).bonds?.length);
    assert.ok(core);
    const bond = m.gd.chess(core).bonds[0];
    const mate = m.gd.visibleChess.find((id) => id !== core && m.gd.chess(id).bonds.includes(bond) && legalTileFor(m, receiver, id));
    assert.ok(mate);
    give(m, receiver, mate, 'board', legalTileFor(m, receiver, mate));
    const original = m.gd.goldenIdOf(core);
    const target = give(m, sender, original);
    const beacon = beacons(sender).find((p) => p.meta.sixPlayerBeaconRound === 10);
    assert.deepEqual(m.handle(sender.playerId, { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid }), { ok: true });
    const pending = sender.effects.find((e) => e.id === `gift:${beacon.uid}`);
    assert.equal(pending.params.chessId, original);
    assert.deepEqual(pending.params.bonds, m.gd.chess(original).bonds);
    sender.eliminate(10);
    m.startRound(11);
    const gift = held(receiver).find((p) => p.kind === 'chess' && p.id === original);
    assert.ok(gift, 'the eliminated sender still dispatches its pending reward gift');
    assert.equal(gift.poolCopies, m.gd.goldenCopies);
    assert.ok(!sender.effects.some((e) => e.id === pending.id));
    assert.equal(m.startingPlayerCount, 6, 'elimination never changes the fixed starting-seat rules');
    h.invariants();
  } finally { h.m.dispose(); }
});

test('a full R14 recipient keeps the immediate elite gift pending and receives it even after the sender is eliminated', () => {
  const h = makeMatch({ humans: 6, difficulty: 'HARD', fake: true, seed: 45 }).start();
  try {
    h.toPrep(14);
    const m = h.m, sender = h.ps('p_0'), receiver = h.ps('p_1');
    const core = m.gd.visibleChess.find((id) => m.gd.chess(id).tier === 6 && m.pool.left(id) >= 3 && m.gd.chess(id).bonds?.length);
    assert.ok(core);
    const bond = m.gd.chess(core).bonds[0];
    const mate = m.gd.visibleChess.find((id) => id !== core && m.gd.chess(id).bonds.includes(bond) && legalTileFor(m, receiver, id));
    assert.ok(mate);
    give(m, receiver, mate, 'board', legalTileFor(m, receiver, mate));
    for (let i = 0; i < receiver.hand.length; i++) receiver.hand[i] ||= receiver.newPiece('item', 'chess_item_1_03_e_b');
    for (let i = 0; i < receiver.temp.length; i++) receiver.temp[i] ||= receiver.newPiece('item', 'chess_item_1_03_e_b');
    const original = m.gd.goldenIdOf(core);
    const target = give(m, sender, original);
    const beacon = beacons(sender).find((p) => p.meta.sixPlayerBeaconRound === 14);
    const before = held(receiver).map((p) => p.uid);
    assert.deepEqual(m.handle(sender.playerId, { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid }), { ok: true });
    assert.deepEqual(held(receiver).map((p) => p.uid), before, 'failed delivery never evicts the recipient inventory');
    const pending = sender.effects.find((e) => e.id === `gift:${beacon.uid}`);
    assert.equal(pending?.params.chessId, original, 'full inventories retain the original elite for retry');
    assert.ok(h.allTo(receiver.playerId, 'm.toast').some((msg) => JSON.stringify(msg).includes('整备区已满')));
    receiver.hand[0] = null;
    sender.eliminate(14);
    m.startRound(15);
    const gift = held(receiver).find((p) => p.kind === 'chess' && p.id === original);
    assert.ok(gift);
    assert.equal(gift.poolCopies, m.gd.goldenCopies);
    assert.ok(!sender.effects.some((e) => e.id === pending.id), 'successful retry removes the gift once');
    m.onReconnect(receiver.playerId);
    assert.equal(held(receiver).filter((p) => p.kind === 'chess' && p.id === original).length, 1);
    h.invariants();
  } finally { h.m.dispose(); }
});
