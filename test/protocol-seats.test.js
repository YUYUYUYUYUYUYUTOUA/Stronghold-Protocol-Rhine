import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SEATS } from '../shared/constants.js';
import { RESULT_LIMITS, isBattleResult, validateC2S } from '../shared/protocol.js';

const playerMap = (count, value) => Object.fromEntries(Array.from({ length: count }, (_, seat) => [`p_${seat}`, value(seat)]));
const resultFor = (count) => ({
  reason: 'cleared', time: 1,
  perPlayer: playerMap(count, () => ({ killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, unitsEnd: [] })),
});

test('room.removeBot accepts the fifth seat and rejects indexes outside the five-seat room', () => {
  assert.equal(MAX_SEATS, 5);
  assert.equal(validateC2S({ t: 'room.removeBot', seat: 4 }), null);
  for (const seat of [-1, 5, 4.5, '4']) {
    assert.equal(validateC2S({ t: 'room.removeBot', seat }), 'bad field seat');
  }
});

test('battle results accept five player records, reject a sixth, and still validate the fifth record', () => {
  assert.equal(RESULT_LIMITS.players, MAX_SEATS);
  const five = resultFor(5);
  assert.equal(isBattleResult(five), true);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'battle_5', result: five }), null);
  const six = resultFor(6);
  assert.equal(isBattleResult(six), false);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'battle_6', result: six }), 'bad field result');
  five.perPlayer.p_4.killed = 1; // the fifth record must obey killed <= total too
  assert.equal(isBattleResult(five), false);
});

test('battle progress accepts five attribution and leak counters, rejects six or a bad fifth counter', () => {
  const progress = {
    t: 'b.progress', battleId: 'battle_5', gt: 1, killed: 0, total: 0,
    by: playerMap(5, (seat) => seat * 10), left: playerMap(5, (seat) => seat),
  };
  assert.equal(validateC2S(progress), null);
  assert.equal(validateC2S({ ...progress, by: playerMap(6, () => 0) }), 'bad field by');
  assert.equal(validateC2S({ ...progress, left: playerMap(6, () => 0) }), 'bad field left');
  assert.equal(validateC2S({ ...progress, by: { ...progress.by, p_4: -1 } }), 'bad field by');
  assert.equal(validateC2S({ ...progress, left: { ...progress.left, p_4: 1.5 } }), 'bad field left');
});
