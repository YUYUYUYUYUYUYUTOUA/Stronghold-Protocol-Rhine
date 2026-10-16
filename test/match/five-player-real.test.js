// One whole five-human production-mode match with the real simulation, real cards and unchanged data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFull } from './fullmatchRun.js';

test('five real client simulations traverse rounds 1–14 and settle all five players without rejections', () => {
  // Scenario-only LP prevents early elimination so the singleton boss field is exercised; game data are untouched.
  const { h, res } = runFull({ mode: 'coop', difficulty: 'NORMAL', humans: 5, bots: 0, seed: 15005, boostLp: 200 });
  assert.deepEqual(res.players.map((p) => p.playerId), ['p_0', 'p_1', 'p_2', 'p_3', 'p_4']);
  assert.ok(res.roundsPassed >= 13, `all normal rounds passed before Final Assault (${res.roundsPassed})`);
  for (const [pid, client] of h.clients) {
    const rounds = new Set(client.starts.filter((s) => !s.watch).map((s) => s.spec.round));
    for (let round = 1; round <= 14; round++) assert.ok(rounds.has(round), `${pid} participated in round ${round}`);
    assert.ok(client.log.some((msg) => msg.t === 'b.result'), `${pid} uploaded battle results`);
  }
  const bosses = [...h.clients].flatMap(([pid, client]) => client.starts
    .filter(s => !s.watch && s.spec.kind === 'boss').map(s => ({ pid, start: s })));
  assert.equal(new Set(bosses.map(({ start }) => start.fieldId)).size, 3, 'five players share two paired fields and one singleton');
  const singletons = bosses.filter(({ start }) => start.spec.players.length === 1);
  assert.equal(singletons.length, 1, 'upstream seeded pairing leaves exactly one singleton browser');
  assert.equal(singletons[0].start.authoritative, true);
  assert.equal(singletons[0].start.spec.players[0].playerId, singletons[0].pid, 'the singleton browser controls its own boss field');
});
