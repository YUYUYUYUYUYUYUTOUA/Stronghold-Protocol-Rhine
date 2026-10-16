// One whole six-human production-mode match with the real simulation, real cards and unchanged game data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFull } from './fullmatchRun.js';

test('six real client simulations traverse rounds 1–14 and settle every player without rejections', () => {
  // Scenario-only LP prevents early elimination so all three paired boss fields are exercised.
  const { h, res } = runFull({ mode: 'coop', difficulty: 'NORMAL', humans: 6, bots: 0, seed: 16005, boostLp: 200 });
  assert.deepEqual(res.players.map((p) => p.playerId), ['p_0', 'p_1', 'p_2', 'p_3', 'p_4', 'p_5']);
  assert.ok(res.roundsPassed >= 13, `all normal rounds passed before Final Assault (${res.roundsPassed})`);
  for (const [pid, client] of h.clients) {
    const rounds = new Set(client.starts.filter((s) => !s.watch).map((s) => s.spec.round));
    for (let round = 1; round <= 14; round++) assert.ok(rounds.has(round), `${pid} participated in round ${round}`);
    assert.ok(client.log.some((msg) => msg.t === 'b.result'), `${pid} uploaded normal battle results`);
  }
  const groups = new Map();
  for (const [pid, client] of h.clients) {
    const start = client.starts.find(s => !s.watch && s.spec.kind === 'boss' && s.spec.round === 14);
    assert.ok(start, `${pid} received its own paired boss field`);
    assert.ok(start.spec.players.some(p => p.playerId === pid));
    assert.deepEqual(start.spec.players.map(p => p.side), ['L', 'R']);
    if (!groups.has(start.fieldId)) groups.set(start.fieldId, []);
    groups.get(start.fieldId).push({ pid, start });
  }
  assert.equal(groups.size, 3);
  for (const entries of groups.values()) {
    assert.equal(entries.length, 2, 'both browsers receive each paired field');
    const pair = entries.map(({ pid }) => pid).sort();
    for (const { pid, start } of entries) {
      assert.deepEqual(start.spec.players.map(p => p.playerId).sort(), pair);
      assert.equal(start.authoritative, pid === pair[0], 'the lowest connected seat controls its actual seeded pair');
    }
  }
});
