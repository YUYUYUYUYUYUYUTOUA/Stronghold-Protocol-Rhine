import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBattleSpec, compactResult, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { FakeBattle } from './fakeBattle.js';
import { validateC2S } from '../../shared/protocol.js';

const BAD_TICKS = [-1, NaN, Infinity, -Infinity, 0.5, 1e9 + 1, '30', null, true, {}, []];

function clientCombat(options = {}) {
  const h = makeMatch({ humans: 2, fake: true, clientCombat: true, clients: false, verify: 'off', ...options }).start();
  h.toPrep(1);
  h.drive(() => h.m.phase === 'COMBAT');
  return h;
}

function clientReport(h, playerId = 'p_0') {
  const field = h.m.fields.find(f => f.players.includes(playerId));
  const battle = createBattleFromSpec(field.spec, h.m.ds, { BattleClass: FakeBattle });
  while (!battle.finished) battle.step();
  const raw = compactResult(battle.result());
  // FakeBattle leaves field-level totals at placeholders; a real battle and the server whitelist sum its players.
  raw.killed = Object.values(raw.perPlayer).reduce((sum, player) => sum + player.killed, 0);
  raw.total = Object.values(raw.perPlayer).reduce((sum, player) => sum + player.total, 0);
  return { field, raw };
}

const message = (field, raw) => ({ t: 'b.result', battleId: field.battleId, result: raw });

// A deterministic test battle reports known elapsed survival work, independent of the content implementation.
function knownSurvivalTicks(battle) {
  const original = battle.result;
  battle.result = () => {
    const out = original.call(battle);
    if (out.perPlayer.p_0) out.perPlayer.p_0.remSurvivalTicks = 149;
    return out;
  };
  return {};
}

test('unite carries each helper own exact survival ticks, including fractional seconds, and the next round resets', () => {
  const h = makeMatch({ humans: 3, fake: true }).start();
  try {
    h.toPrep(1);
    const m = h.m;
    m.lastResults.set('p_0', { unitsEnd: [], remSurvivalTicks: 149, remAppearances: 999 });
    m.lastResults.set('p_1', { unitsEnd: [], remSurvivalTicks: 4500, remAppearances: 999 });
    m.lastResults.set('p_2', { unitsEnd: [], remSurvivalTicks: 6000 });
    const opts = uniteBattleOpts(m, { helpers: [h.ps('p_0'), h.ps('p_1')], leaked: [] }, 30);
    assert.deepEqual(opts.players.map(p => [p.playerId, p.remSurvivalTicks]), [['p_0', 149], ['p_1', 4500]]);
    assert.equal(opts.players.some(p => Object.hasOwn(p, 'remAppearances')), false);
    for (const ps of m.players.values()) assert.equal(m._normalOpts(ps).players[0].remSurvivalTicks, undefined);
    h.toPrep(2);
    for (const ps of m.players.values()) assert.equal(m._normalOpts(ps).players[0].remSurvivalTicks, undefined, 'new round starts fresh');
    assert.equal(m.errorCount, 0);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('unite carries only bounded positive integers and never converts old appearance counts into time', () => {
  const h = makeMatch({ humans: 2, fake: true }).start();
  try {
    h.toPrep(1);
    const opts = () => uniteBattleOpts(h.m, { helpers: [h.ps('p_0')], leaked: [] }, 30);
    for (const value of [undefined, 0, ...BAD_TICKS]) {
      h.m.lastResults.set('p_0', { unitsEnd: [], remSurvivalTicks: value, remAppearances: 1e9 });
      assert.equal(Object.hasOwn(opts().players[0], 'remSurvivalTicks'), false, String(value));
    }
    for (const value of [1, 30, 6000, 1e9]) {
      h.m.lastResults.set('p_0', { unitsEnd: [], remSurvivalTicks: value });
      assert.equal(opts().players[0].remSurvivalTicks, value);
    }
  } finally { h.m.dispose(); }
});

test('spec keeps survival time only for unite and strips retired time-independent growth and rally metadata', () => {
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    for (const ticks of [0, 1, 149, 1e9, ...BAD_TICKS]) {
      const input = { playerId: 'p_0', units: [], remSurvivalTicks: ticks, remAppearances: 99, remRally: { row: 10, col: 4 } };
      const spec = buildBattleSpec({ kind, players: [input] });
      const valid = kind === 'unite' && Number.isInteger(ticks) && ticks >= 0 && ticks <= 1e9;
      assert.equal(Object.hasOwn(spec.players[0], 'remSurvivalTicks'), valid, `${kind}: ${String(ticks)}`);
      if (valid) assert.equal(spec.players[0].remSurvivalTicks, ticks);
      assert.equal(Object.hasOwn(spec.players[0], 'remAppearances'), false);
      assert.equal(Object.hasOwn(spec.players[0], 'remRally'), false);
      assert.equal(input.remAppearances, 99, 'building a spec does not rewrite the source record');
      assert.deepEqual(input.remRally, { row: 10, col: 4 });
    }
  }
});

test('real lifecycle reports player-local survival ticks; compact wire and digest keep the exact outcome state', () => {
  const h = makeBattle({ content: 'none', players: [{ playerId: 'p_0', units: [] }, { playerId: 'p_1', units: [] }] });
  h.b.start();
  h.b.remState = new Map([['p_0', { survivalTicks: 149, appeared: 999 }], ['p_1', { survivalTicks: 6000, appeared: 1 }]]);
  h.b.forceEnd();
  const result = h.result(), wire = compactResult(result);
  assert.equal(result.perPlayer.p_0.remSurvivalTicks, 149);
  assert.equal(result.perPlayer.p_1.remSurvivalTicks, 6000);
  assert.equal(wire.perPlayer.p_0.remSurvivalTicks, 149);
  assert.equal(wire.perPlayer.p_1.remSurvivalTicks, 6000);
  assert.equal(Object.hasOwn(result.perPlayer.p_0, 'remAppearances'), false);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'survival', result: wire }), null);
  assert.equal(resultDigest(wire).hash, resultDigest(result).hash);
  const change = fields => ({ ...wire, perPlayer: { ...wire.perPlayer, p_0: { ...wire.perPlayer.p_0, ...fields } } });
  assert.notEqual(resultDigest(change({ remSurvivalTicks: 150 })).hash, resultDigest(wire).hash, 'one tick belongs in the verification digest');
  assert.equal(resultDigest(change({ remAppearances: 1e9, remRally: { row: 10, col: 4 } })).hash, resultDigest(wire).hash);
  assert.equal(Object.hasOwn(compactResult(change({ remAppearances: 1e9 })).perPlayer.p_0, 'remAppearances'), false);
  assert.deepEqual(h.b.errors, []);
});

test('wire and server whitelist accept zero/positive survival ticks, reject every invalid shape, and ignore old counters', () => {
  const h = clientCombat();
  try {
    const { field, raw } = clientReport(h);
    for (const ticks of [0, 1, 29, 30, 149, 4500, 6000, 1e9]) {
      raw.perPlayer.p_0.remSurvivalTicks = ticks;
      raw.perPlayer.p_0.remAppearances = 999;
      assert.equal(validateC2S(message(field, raw)), null, String(ticks));
      const valid = validateClientResult(field.spec, raw, { gd: h.m.gd });
      assert.equal(valid.ok, true, valid.reason);
      assert.equal(valid.result.perPlayer.p_0.remSurvivalTicks, ticks > 0 ? ticks : undefined);
      assert.equal(Object.hasOwn(valid.result.perPlayer.p_0, 'remAppearances'), false);
      const wire = compactResult(raw);
      assert.equal(wire.perPlayer.p_0.remSurvivalTicks, ticks > 0 ? ticks : undefined);
      assert.equal(resultDigest(valid.result).hash, resultDigest(wire).hash);
    }
    for (const bad of BAD_TICKS) {
      raw.perPlayer.p_0.remSurvivalTicks = bad;
      assert.ok(validateC2S(message(field, raw)), String(bad));
      assert.equal(validateClientResult(field.spec, raw, { gd: h.m.gd }).reason, 'reinforcement survival ticks');
      assert.equal(Object.hasOwn(compactResult(raw).perPlayer.p_0, 'remSurvivalTicks'), false);
    }
  } finally { h.m.dispose(); }
});

test('SP_VERIFY off still verifies a forged one-tick carry once across duplicate reports and reconnect', () => {
  const h = clientCombat({ headlessSliceMs: 0.01 });
  try {
    const { field, raw } = clientReport(h), m = h.m;
    raw.perPlayer.p_0.remSurvivalTicks = 1;
    const report = message(field, raw);
    assert.equal(validateC2S(report), null);
    assert.deepEqual(m.handle('p_0', report), { ok: true });
    const job = field.verifyJob;
    assert.ok(job, 'positive carry requires verification even before a full second is earned');
    assert.equal(field.done, false, 'unverified time cannot settle the field');
    assert.deepEqual(m.handle('p_0', report), { ok: true });
    m.onDisconnect('p_0');
    m.onReconnect('p_0');
    assert.equal(field.verifyJob, job, 'duplicate/reconnect cannot replace the verifier or start a takeover');
    assert.equal(h.lastTo('p_0', 'b.start').authoritative, false, 'reconnect receives a display replica while verification is pending');
    h.run(() => field.done);
    assert.equal(m.verifyStats.checked, 1);
    assert.equal(m.verifyStats.mismatches, 1);
    assert.equal(field.result.perPlayer.p_0.remSurvivalTicks, undefined, 'only the server outcome can feed unite');
    assert.equal(m.fields.find(f => f.players.includes('p_1')).done, false, 'other clients remain independent');
    assert.equal(m.errorCount, 0);
  } finally { h.m.dispose(); }
});

test('honest positive time is mandatorily verified and its partial second reaches the helper unchanged', () => {
  const h = clientCombat({ script: knownSurvivalTicks });
  try {
    const { field, raw } = clientReport(h), m = h.m;
    assert.equal(raw.perPlayer.p_0.remSurvivalTicks, 149);
    assert.deepEqual(m.handle('p_0', message(field, raw)), { ok: true });
    h.run(() => field.done);
    assert.equal(m.verifyStats.checked, 1);
    assert.equal(m.verifyStats.mismatches, 0);
    assert.equal(field.result.perPlayer.p_0.remSurvivalTicks, 149);
    const other = clientReport(h, 'p_1');
    assert.deepEqual(m.handle('p_1', message(other.field, other.raw)), { ok: true });
    assert.equal(m.lastResults.get('p_0').remSurvivalTicks, 149);
    const opts = uniteBattleOpts(m, { helpers: [h.ps('p_0')], leaked: [] }, 30);
    assert.equal(opts.players[0].remSurvivalTicks, 149);
    assert.equal(buildBattleSpec({ kind: 'unite', players: opts.players }).players[0].remSurvivalTicks, 149);
  } finally { h.m.dispose(); }
});

test('zero survival ticks do not trigger a carry verifier and cannot revive the retired appearance bonus', () => {
  const h = clientCombat();
  try {
    const { field, raw } = clientReport(h), m = h.m;
    raw.perPlayer.p_0.remSurvivalTicks = 0;
    raw.perPlayer.p_0.remAppearances = 1e9;
    assert.deepEqual(m.handle('p_0', message(field, raw)), { ok: true });
    assert.equal(field.done, true);
    assert.equal(m.verifyStats.checked, 0);
    assert.equal(field.verifyJob, null);
    assert.equal(Object.hasOwn(field.result.perPlayer.p_0, 'remSurvivalTicks'), false);
    assert.equal(Object.hasOwn(field.result.perPlayer.p_0, 'remAppearances'), false);
  } finally { h.m.dispose(); }
});
