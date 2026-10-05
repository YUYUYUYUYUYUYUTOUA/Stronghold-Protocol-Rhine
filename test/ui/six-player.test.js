import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SEATS, PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { normalizeSeats, roomFacts } from '../../public/js/screens/room.js';
import { difficultyInfo } from '../../public/js/screens/lobby.js';
import { seatHue } from '../../public/js/ui/components.js';
import { PlayerAvatar } from '../../public/js/ui/gameComponents.js';
import { sortedPlayers, normalizeDraft, normalizeResult, prepCamera, homeFieldId, cycleField, fieldLabel } from '../../public/js/ui/gameLogic.js';
import { observeTarget, teammateProgress, cameraLayers } from '../../public/js/battle/observe.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';

const players = () => Array.from({ length: 6 }, (_, seat) => ({
  playerId: `p${seat}`, seat, name: `博士${seat + 1}`, alive: true, connected: true, ready: true, lp: 12,
}));

test('the sixth room seat keeps identity and blocks start until ready and connected', () => {
  const seats = players();
  const room = { mode: 'coop', hostId: 'p0', seats };
  seats[5].ready = false;
  const sixth = roomFacts(room, 'p5');
  assert.equal(MAX_SEATS, 6);
  assert.equal(sixth.mine.playerId, 'p5');
  assert.equal(sixth.mine.seat, 5);
  assert.equal(sixth.emptySeats, 0);
  assert.equal(roomFacts(room, 'p0').canStart, false);
  seats[5].ready = true;
  assert.equal(roomFacts(room, 'p0').canStart, true);
  assert.equal(roomFacts(room, 'p0').readyHumans, 6);
  seats[5].connected = false;
  assert.equal(roomFacts(room, 'p0').canStart, false);
  room.seats = seats.slice(0, 5);
  assert.equal(normalizeSeats(room)[5], null);
  assert.equal(roomFacts(room, 'p0').emptySeats, 1);
  assert.equal(normalizeSeats({ mode: 'solo', seats }).length, 1);
});

test('sixth AI fills capacity and contributes to the room BAN count without human readiness', () => {
  const seats = players();
  seats[5] = { ...seats[5], isBot: true, ready: false, connected: false };
  const facts = roomFacts({ mode: 'coop', hostId: 'p0', seats }, 'p0');
  assert.equal(facts.occupied.length, 6);
  assert.equal(facts.humans.length, 5);
  assert.equal(facts.readyHumans, 5);
  assert.equal(facts.canStart, true);
  assert.deepEqual(difficultyInfo('coop', 'NORMAL', facts.occupied.length).openingBans, { core: 2, addon: 4 });
});

test('lobby BAN notes are conditional until a room supplies its occupied member count', () => {
  const lobby = difficultyInfo('coop', 'NORMAL');
  assert.deepEqual(lobby.openingBans, { core: 4, addon: 4 });
  assert.match(lobby.openingBanNote, /5 人（含 AI）时核心 3；6 人（含 AI）时核心 2/);
  for (const count of [5, 6]) {
    const room = difficultyInfo('coop', 'NORMAL', count);
    const core = count === 6 ? 2 : 3;
    assert.deepEqual(room.openingBans, { core, addon: 4 });
    assert.equal(room.openingBanNote, `开局 BAN：核心 ${core} / 附加 4`);
    assert.deepEqual(difficultyInfo('coop', 'FUNNY', count).openingBans, { core: 0, addon: 1 });
  }
  assert.deepEqual(difficultyInfo('coop', 'NORMAL', 4).openingBans, { core: 4, addon: 4 });
  const solo = difficultyInfo('solo', 'NORMAL', 6);
  assert.deepEqual(solo.openingBans, { core: 4, addon: 4 });
  assert.doesNotMatch(solo.openingBanNote, /[56] 人/);
});

test('all six room and match avatars use distinct stable seat colours', () => {
  const colours = players().map((p) => seatHue(p.seat));
  assert.equal(new Set(colours).size, 6);
  for (const p of players()) assert.equal(PlayerAvatar({ player: p }).props.style, `--seat-hue:${seatHue(p.seat)}`);
});

test('draft and complete result reports include the sixth member in seat order', () => {
  const pub = { players: players().reverse(), teamLp: 17 };
  const ordered = sortedPlayers(pub);
  const draft = normalizeDraft({ turn: 5, picks: ['a', 'b', 'c', 'd', 'e'] }, ordered);
  assert.equal(draft.turnPid, 'p5');
  assert.equal(draft.order.length, 6);
  assert.equal(draft.done, false);
  const completed = normalizeDraft({ turn: 6, picks: ['a', 'b', 'c', 'd', 'e', 'f'] }, ordered);
  assert.equal(completed.done, true);
  assert.equal(completed.picks.get('p5'), 'f');
  const result = normalizeResult({ players: pub.players.map((p) => ({
    playerId: p.playerId, stats: { bossDamage: p.seat + 1 },
    lineup: [{ id: `chess-${p.seat}` }], bonds: [{ bondId: `bond-${p.seat}`, layers: 1, active: true }],
    title: 'comment_1', trophies: p.seat + 1, reward: p.seat * 10,
  })) }, pub);
  assert.deepEqual(result.players.map((p) => p.playerId), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  const sixth = result.players[5];
  assert.equal(sixth.stats.bossDamage, 6);
  assert.equal(sixth.lp, 17);
  assert.deepEqual(sixth.lineup, [{ id: 'chess-5' }]);
  assert.deepEqual(sixth.bonds, [{ bondId: 'bond-5', layers: 1, active: true }]);
  assert.deepEqual(sixth.title, { id: 'comment_1' });
  assert.equal(sixth.trophies, 6);
  assert.equal(sixth.reward, 50);
});

test('normal-field teammate progress and switching reach all six fields', () => {
  const pub = {
    players: players(), fields: players().map((p) => ({ fieldId: `n:${p.playerId}`, kind: 'normal', players: [p.playerId], live: true,
      progress: { killed: p.seat + 1, total: 8, done: false } })),
  };
  assert.deepEqual(teammateProgress(pub, 'p0').map((p) => p.playerId), ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(teammateProgress(pub, 'p0')[4].killed, 6);
  assert.equal(cycleField(pub.fields, 'n:p4'), 'n:p5');
  assert.equal(cycleField(pub.fields, 'n:p5'), 'n:p0');
  assert.equal(cycleField(pub.fields, 'n:p0', -1), 'n:p5');
});

test('six survivors have three boss pairs and the sixth player uses the right board', () => {
  const pub = { phase: PHASE.FINAL_ASSAULT, round: 14, bossRound: 14, hiddenRound: 15, players: players(), fields: [
    { fieldId: 'b:0', kind: 'boss', players: ['p0', 'p1'], live: true },
    { fieldId: 'b:1', kind: 'boss', players: ['p2', 'p3'], live: true },
    { fieldId: 'b:2', kind: 'boss', players: ['p4', 'p5'], live: true },
  ] };
  assert.equal(prepCamera(pub, 'p4').opts.side, 'L');
  assert.equal(prepCamera(pub, 'p5').opts.side, 'R');
  assert.equal(homeFieldId(pub, 'p5'), 'b:2');
  assert.equal(fieldLabel(pub.fields[2], pub, 'p0'), '博士5 · 博士6');
  assert.deepEqual(cameraLayers(pub.fields[2], pub, 'p5').map((l) => ({ key: l.key, self: l.self })), [
    { key: 'L', self: false }, { key: 'ALL', self: false }, { key: 'R', self: true },
  ]);
  assert.match(observeTarget(pub.players[5], pub, 'p0').reason, /另一组/);
  pub.players[0].alive = false;
  assert.deepEqual(observeTarget(pub.players[5], pub, 'p0'), { fieldId: 'b:2' });
  assert.equal(cycleField(pub.fields, 'b:1'), 'b:2');
  assert.equal(cycleField(pub.fields, 'b:2'), 'b:0');
});

for (const kind of ['unite', 'boss']) {
  test(`client ${kind} progress reports retain all six players`, async () => {
    const counts = Object.fromEntries(players().map((p) => [p.playerId, p.seat + 1]));
    const sent = [];
    let now = 1000;
    const battle = {
      time: 0, tickCount: 0, finished: false,
      sharedBoss: kind === 'boss' ? { cum: 21, byPlayer: counts } : null,
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
        battleProgress: () => ({ gt: battle.time, killed: 0, total: 21, done: false, leaks: 0, left: counts }),
      } }),
    });
    try {
      await runner.onStart({ battleId: `six-${kind}`, fieldId: `${kind}:0`, kind, authoritative: true, speed: 1, spec: { players: players() } });
      now += 40;
      runner._frame();
      const progress = sent.find((m) => m.t === 'b.progress');
      assert.ok(progress);
      assert.equal(validateC2S(progress), null);
      assert.deepEqual(kind === 'boss' ? progress.by : progress.left, counts);
    } finally { runner.dispose(); }
  });
}
