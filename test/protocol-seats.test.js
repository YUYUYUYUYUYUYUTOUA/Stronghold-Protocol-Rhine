import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SEATS } from '../shared/constants.js';
import { RESULT_LIMITS, isBattleResult, validateC2S } from '../shared/protocol.js';

const playerMap = (count, value) => Object.fromEntries(Array.from({ length: count }, (_, seat) => [`p_${seat}`, value(seat)]));
const resultFor = (count) => ({
  reason: 'cleared', time: 1,
  perPlayer: playerMap(count, () => ({ killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, unitsEnd: [] })),
});

test('room.removeBot accepts the sixth seat and rejects indexes outside the six-seat room', () => {
  assert.equal(MAX_SEATS, 6);
  assert.equal(validateC2S({ t: 'room.removeBot', seat: 5 }), null);
  for (const seat of [-1, 6, 5.5, '5']) {
    assert.equal(validateC2S({ t: 'room.removeBot', seat }), 'bad field seat');
  }
});

test('battle results accept six player records, reject a seventh, and still validate the sixth record', () => {
  assert.equal(RESULT_LIMITS.players, MAX_SEATS);
  const six = resultFor(6);
  assert.equal(isBattleResult(six), true);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'battle_6', result: six }), null);
  const seven = resultFor(7);
  assert.equal(isBattleResult(seven), false);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'battle_7', result: seven }), 'bad field result');
  six.perPlayer.p_5.killed = 1; // Counted reinforcements can make killed exceed the scheduled total in 0.2.2.
  assert.equal(isBattleResult(six), true);
  six.perPlayer.p_5.killed = -1; // The sixth record still obeys the nonnegative integer limit.
  assert.equal(isBattleResult(six), false);
});

test('battle progress accepts six attribution and leak counters, rejects seven or a bad sixth counter', () => {
  const progress = {
    t: 'b.progress', battleId: 'battle_6', gt: 1, killed: 0, total: 0,
    by: playerMap(6, (seat) => seat * 10), left: playerMap(6, (seat) => seat),
  };
  assert.equal(validateC2S(progress), null);
  assert.equal(validateC2S({ ...progress, by: playerMap(7, () => 0) }), 'bad field by');
  assert.equal(validateC2S({ ...progress, left: playerMap(7, () => 0) }), 'bad field left');
  assert.equal(validateC2S({ ...progress, by: { ...progress.by, p_5: -1 } }), 'bad field by');
  assert.equal(validateC2S({ ...progress, left: { ...progress.left, p_5: 1.5 } }), 'bad field left');
});
