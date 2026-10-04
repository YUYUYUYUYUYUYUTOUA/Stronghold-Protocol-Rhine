import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { normalizeSeats, roomFacts } from '../../public/js/screens/room.js';
import { seatHue } from '../../public/js/ui/components.js';
import { PlayerAvatar } from '../../public/js/ui/gameComponents.js';
import { sortedPlayers, normalizeDraft, normalizeResult, prepCamera, homeFieldId, cycleField, fieldLabel } from '../../public/js/ui/gameLogic.js';
import { observeTarget, teammateProgress, cameraLayers } from '../../public/js/battle/observe.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';

const players = () => Array.from({ length: 5 }, (_, seat) => ({
  playerId: `p${seat}`, seat, name: `博士${seat + 1}`, alive: true, connected: true, ready: true, lp: 12,
}));

test('fifth room seat retains its identity and participates in readiness and connection gates', () => {
  const seats = players();
  const room = { mode: 'coop', hostId: 'p0', seats };
  seats[4].ready = false;
  const fifth = roomFacts(room, 'p4');
  assert.equal(fifth.mine.playerId, 'p4');
  assert.equal(fifth.mine.seat, 4);
  assert.equal(fifth.emptySeats, 0);
  assert.equal(roomFacts(room, 'p0').canStart, false, 'the fifth guest is still deciding');
  seats[4].ready = true;
  assert.equal(roomFacts(room, 'p0').canStart, true);
  assert.equal(roomFacts(room, 'p0').readyHumans, 5);
  seats[4].connected = false;
  assert.equal(roomFacts(room, 'p0').canStart, false, 'the fifth guest is disconnected');
  room.seats = seats.slice(0, 4);
  assert.equal(normalizeSeats(room)[4], null, 'a four-member room has a usable fifth empty seat');
  assert.equal(roomFacts(room, 'p0').emptySeats, 1);
  assert.equal(normalizeSeats({ mode: 'solo', seats }).length, 1, 'solo stays single-seat');
});

test('fifth avatar has a distinct seat colour in the room and match', () => {
  const colours = players().map((p) => seatHue(p.seat));
  assert.equal(new Set(colours).size, 5);
  for (const p of players()) assert.equal(PlayerAvatar({ player: p }).props.style, `--seat-hue:${seatHue(p.seat)}`);
});

test('draft and results include the fifth member in seat order', () => {
  const pub = { players: players().reverse(), teamLp: 17 };
  const ordered = sortedPlayers(pub);
  const draft = normalizeDraft({ turn: 4, picks: ['a', 'b', 'c', 'd'] }, ordered);
  assert.equal(draft.turnPid, 'p4');
  assert.equal(draft.order.length, 5);
  assert.equal(draft.done, false, 'the last member still has a choice');
  const result = normalizeResult({ players: pub.players.map((p) => ({ playerId: p.playerId, stats: { bossDamage: p.seat + 1 } })) }, pub);
  assert.deepEqual(result.players.map((p) => p.playerId), ['p0', 'p1', 'p2', 'p3', 'p4']);
  assert.equal(result.players[4].stats.bossDamage, 5);
  assert.equal(result.players[4].lp, 17, 'the fifth member sees the shared final LP');
});

test('normal-field progress and switching reach all five fields', () => {
  const pub = {
    players: players(), fields: players().map((p) => ({ fieldId: `n:${p.playerId}`, kind: 'normal', players: [p.playerId], live: true,
      progress: { killed: p.seat + 1, total: 8, done: false } })),
  };
  assert.deepEqual(teammateProgress(pub, 'p0').map((p) => p.playerId), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(cycleField(pub.fields, 'n:p3'), 'n:p4');
  assert.equal(cycleField(pub.fields, 'n:p4'), 'n:p0');
  assert.equal(cycleField(pub.fields, 'n:p0', -1), 'n:p4');
});

test('fifth survivor has the lone third boss field and an eliminated spectator can reach it', () => {
  const pub = { phase: PHASE.FINAL_ASSAULT, round: 14, bossRound: 14, hiddenRound: 15, players: players(), fields: [
    { fieldId: 'b:0', kind: 'boss', players: ['p0', 'p1'], live: true },
    { fieldId: 'b:1', kind: 'boss', players: ['p2', 'p3'], live: true },
    { fieldId: 'b:2', kind: 'boss', players: ['p4'], live: true },
  ] };
  assert.equal(prepCamera(pub, 'p4').opts.side, 'L');
  assert.equal(homeFieldId(pub, 'p4'), 'b:2');
  assert.equal(fieldLabel(pub.fields[2], pub, 'p0'), '博士5');
  assert.deepEqual(cameraLayers(pub.fields[2], pub, 'p4'), [], 'a lone board needs no empty partner tab');
  assert.match(observeTarget(pub.players[4], pub, 'p0').reason, /另一组/);
  pub.players[0].alive = false;
  assert.deepEqual(observeTarget(pub.players[4], pub, 'p0'), { fieldId: 'b:2' });
  assert.equal(cycleField(pub.fields, 'b:1'), 'b:2');
  assert.equal(cycleField(pub.fields, 'b:2'), 'b:0');
});

for (const kind of ['unite', 'boss']) {
  test(`client ${kind} progress includes the fifth player's contribution`, async () => {
    const counts = Object.fromEntries(players().map((p) => [p.playerId, p.seat + 1]));
    const sent = [];
    let now = 1000;
    const battle = {
      time: 0, tickCount: 0, finished: false,
      sharedBoss: kind === 'boss' ? { cum: 15, byPlayer: counts } : null,
      step() { this.tickCount++; this.time = this.tickCount / 30; },
      snapshot() { return { t: this.time, units: [] }; },
      fieldMeta() { return { units: [] }; },
      drainEvents() { return []; },
      forceEnd() { this.finished = true; },
    };
    const runner = createBattleRunner({
      net: { send(t, fields) { sent.push({ t, ...fields }); } }, store: { patch() {} }, doc: null,
      now: () => now, raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {},
      loadSim: async () => ({ ds: {}, spec: {
        createBattleFromSpec: () => battle, attachLpMeter: () => ({ lp: 0 }), uniteLeft: () => counts,
        battleProgress: () => ({ gt: battle.time, killed: 0, total: 15, done: false, leaks: 0, left: counts }),
      } }),
    });
    try {
      await runner.onStart({ battleId: `five-${kind}`, fieldId: `${kind}:0`, kind, authoritative: true, speed: 1, spec: { players: players() } });
      now += 40;
      runner._frame();
      const progress = sent.find((m) => m.t === 'b.progress');
      assert.ok(progress, 'the client emitted a real progress message');
      assert.equal(validateC2S(progress), null);
      assert.deepEqual(kind === 'boss' ? progress.by : progress.left, counts, 'all five members survived serialization');
    } finally { runner.dispose(); }
  });
}
