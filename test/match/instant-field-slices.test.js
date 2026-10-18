// Virtual hosts yield between complete master ticks without changing simulation time or field ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FieldRunner, HARD_CAP_SECONDS, HEADLESS_SLICE_MS, emptyPerPlayer } from '../../server/match/fields.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { resultDigest } from '../../server/sim/spec.js';
import { TICK } from '../../server/sim/constants.js';
import { Match } from '../../server/match/Match.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { DATA, makeMatch } from './harness.js';

function fixture(budget = Infinity, { instant = true, hp = 57, weights = [2, 3], throwAt = null } = {}) {
  const scheduler = new VirtualScheduler({ start: 1234, instantCombat: instant });
  const state = { clock: 0, trace: [], sent: [], errors: [], done: 0, pool: { hp } };
  const m = {
    sched: scheduler, headlessSliceMs: budget, gameSpeed: 2, paused: false,
    later: (ms, fn) => scheduler.setTimeout(fn, ms), cancel: h => scheduler.clearTimeout(h),
    guard: fn => fn(),
    markPublic() {}, watchersOf: () => ['observer'],
    sendTo: (id, msg) => state.sent.push([id, structuredClone(msg)]),
    reportError: (label, error) => state.errors.push([label, error.message]),
  };
  const fields = ['a', 'b'].map((id, index) => {
    const battle = {
      fieldId: id, time: 0, tickCount: 0, finished: false, reason: null, damage: 0, events: [],
      step() {
        state.trace.push(['step', id, this.tickCount + 1]);
        if (throwAt?.[id] === this.tickCount + 1) throw new Error(`broken ${id}`);
        this.tickCount++; this.time = this.tickCount * TICK; state.clock += 3;
        const damage = Math.min(state.pool.hp, weights[index]);
        state.pool.hp -= damage; this.damage += damage;
        this.events.push(['fx', 'shared-pool', index, this.tickCount, { hp: state.pool.hp, damage }]);
        if (state.pool.hp <= 0) { this.finished = true; this.reason = 'cleared'; }
      },
      forceEnd(reason) { state.trace.push(['force', id, reason]); this.finished = true; this.reason = reason; },
      drainEvents() { const out = this.events; this.events = []; return out; },
      snapshot() { return { t: this.time, fieldId: id, poolHp: state.pool.hp, tick: this.tickCount }; },
      result() {
        const player = { ...emptyPerPlayer(), damageDealt: this.damage, total: 1, killed: this.reason === 'cleared' ? 1 : 0 };
        return { reason: this.reason, time: this.time, total: 1, killed: player.killed, perPlayer: { [id]: player } };
      },
    };
    return { fieldId: id, kind: 'boss', players: [id], battle };
  });
  const runner = new FieldRunner(m, fields, {
    onTick: r => state.trace.push(['master', r.ticks, state.pool.hp]),
    onDone: () => state.done++,
  });
  // Only the private budget clock is controlled; simulation time still comes from the real VirtualScheduler.
  runner._runInstant = runner._runInstant.bind(runner, () => state.clock);
  return { m, fields, runner, scheduler, state };
}

function outcome(f) {
  return {
    ticks: f.runner.ticks, time: f.scheduler.now(), poolHp: f.state.pool.hp,
    trace: f.state.trace, frames: f.state.sent, errors: f.state.errors, done: f.state.done,
    results: f.fields.map(field => f.runner.resultOf(field)),
    digests: f.fields.map(field => resultDigest(f.runner.resultOf(field)).hash),
  };
}

function run(budget, options) {
  const f = fixture(budget, options); f.runner.start(); f.scheduler.runAll();
  assert.equal(f.scheduler.pending(), 0);
  return f;
}

test('finite instant slices yield only between complete master ticks, preserving order, events and shared-pool results', () => {
  const once = run(Infinity), sliced = fixture(8);
  sliced.runner.start();
  let between;
  sliced.scheduler.setTimeout(() => {
    between = { ticks: sliced.runner.ticks, fields: sliced.fields.map(f => f.battle.tickCount), done: sliced.runner.done, now: sliced.scheduler.now() };
  }, 0);
  assert.equal(sliced.scheduler.runNext(), true);
  assert.equal(sliced.runner.done, false);
  assert.equal(sliced.runner.ticks, 2, 'two complete 6-unit-cost master ticks exhaust the 8-unit budget');
  assert.deepEqual(sliced.fields.map(f => f.battle.tickCount), [2, 2], 'a slice never divides the two-field tick');
  assert.equal(sliced.scheduler.nextAt(), 1234, 'continuation does not advance the virtual clock');
  sliced.scheduler.runAll();
  assert.deepEqual(between, { ticks: 2, fields: [2, 2], done: false, now: 1234 }, 'an unrelated callback executes between unfinished slices');
  assert.deepEqual(outcome(sliced), outcome(once));
  assert.equal(sliced.state.done, 1);
  assert.ok(sliced.scheduler.executed > once.scheduler.executed);
});

test('ordinary virtual matches retain Infinity and one-callback instant completion', () => {
  const h = makeMatch({ fake: true });
  try {
    assert.equal(h.m.sched.instant, true);
    assert.equal(h.m.headlessSliceMs, Infinity);
  } finally { h.m.dispose(); }
  const f = fixture(undefined);
  f.runner.start(); f.scheduler.runNext();
  assert.equal(f.runner.done, true);
  assert.equal(f.state.done, 1);
  assert.equal(f.scheduler.pending(), 0);
  assert.equal(f.scheduler.now(), 1234);
});

test('stopping an unfinished instant runner cancels continuation and never ends or steps it again', () => {
  const f = fixture(8); f.runner.start(); f.scheduler.runNext();
  const before = structuredClone(outcome(f));
  assert.ok(f.runner.instantTimer);
  f.runner.stop();
  assert.equal(f.runner.instantTimer, null);
  assert.equal(f.scheduler.pending(), 0);
  f.scheduler.runAll();
  f.runner._runInstant(() => f.state.clock);
  assert.deepEqual(outcome(f), before);
  assert.equal(f.state.done, 0);
});

test('forceAll between slices cancels continuation, preserves field order and calls onDone once', () => {
  const f = fixture(8); f.runner.start(); f.scheduler.runNext();
  const ticks = f.runner.ticks;
  f.runner.forceAll('forced');
  assert.equal(f.runner.instantTimer, null);
  assert.equal(f.scheduler.pending(), 0);
  f.scheduler.runAll(); f.runner.forceAll('forced'); f.runner.start();
  assert.equal(f.runner.ticks, ticks);
  assert.equal(f.state.done, 1);
  assert.deepEqual(f.state.trace.filter(row => row[0] === 'force'), [['force', 'a', 'forced'], ['force', 'b', 'forced']]);
});

test('finite slices keep the exact hard tick cap and never turn a budget yield into timeout', () => {
  const cap = Math.ceil(HARD_CAP_SECONDS / TICK);
  const f = fixture(8, { hp: 1, weights: [0, 0] });
  f.runner.ticks = cap - 3; f.runner.start(); f.scheduler.runNext();
  assert.equal(f.runner.ticks, cap - 1);
  assert.equal(f.runner.done, false);
  assert.deepEqual(f.state.trace.filter(row => row[0] === 'force'), []);
  f.scheduler.runAll();
  assert.equal(f.runner.ticks, cap);
  assert.equal(f.state.done, 1);
  assert.deepEqual(f.state.trace.filter(row => row[0] === 'force'), [['force', 'a', 'timeout'], ['force', 'b', 'timeout']]);
  assert.equal(f.scheduler.pending(), 0);
});

test('a broken field remains isolated and finite slices keep the synchronous error/result trace', () => {
  const options = { throwAt: { a: 2 } };
  const once = run(Infinity, options), sliced = run(8, options);
  assert.deepEqual(outcome(sliced), outcome(once));
  assert.deepEqual(sliced.state.errors, [['field a step', 'broken a']]);
  assert.equal(sliced.state.done, 1);
});

test('paced runners keep their interval clock and live Match retains its existing budget', () => {
  const f = fixture(8, { instant: false });
  f.runner.start();
  assert.equal(f.runner.instantTimer, null);
  assert.ok(f.runner.interval);
  f.scheduler.runNext();
  assert.equal(f.runner.ticks, 2, 'existing 2x pacing still advances two ticks per 1/30-second interval');
  assert.ok(f.scheduler.now() > 1234);
  f.runner.stop(); assert.equal(f.scheduler.pending(), 0);
  const live = new Match({ data: DATA, roomCode: 'LIVE', mode: 'solo', difficulty: 'NORMAL',
    seats: [{ seat: 0, playerId: 'p', name: 'P', isBot: false, connected: true }], send() {}, broadcast() {}, onEnd() {} });
  try {
    assert.equal(live.sched.virtual, false);
    assert.equal(live.sched.instant, false);
    assert.equal(live.headlessSliceMs, HEADLESS_SLICE_MS);
  } finally { live.dispose(); }
});

test('only virtual hosts default to finite budget after composed data initialization; explicit overrides remain effective', { timeout: 30000 }, async () => {
  const files = Object.fromEntries(Object.entries(DATA).map(([key, value]) => [key, Buffer.from(JSON.stringify(value))]));
  const hashInput = { app: 'virtual-budget-test', sim: 'a'.repeat(64),
    data: Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, createHash('sha256').update(bytes).digest('hex')])), plugins: [], settings: {} };
  const set = { cs: contentHashOf(hashInput), hashInput, plugins: [], scripts: [] };
  const contents = { get: () => set, dataBytes: () => files };
  for (const [virtualTime, matchOptions, expected] of [
    [true, {}, { virtual: true, instant: true, budget: HEADLESS_SLICE_MS }],
    [true, { headlessSliceMs: 3 }, { virtual: true, instant: true, budget: 3 }],
    [false, {}, { virtual: false, instant: false, budget: null }],
  ]) {
    const logs = [];
    const log = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (...args) => logs.push([level, ...args.map(String)])]));
    const hosts = createMatchHosts({ contents, log, options: { virtualTime, matchOptions,
      matchModule: fileURLToPath(new URL('./fixtures/virtualBudgetMatch.js', import.meta.url)) } });
    let end;
    const done = new Promise(resolve => { end = resolve; });
    const proxy = hosts.create(set.cs, { roomCode: 'BUDGET', seats: [], onEnd: end, send() {}, broadcast() {} });
    try {
      proxy.start();
      const summary = await done;
      assert.equal(summary.victory, false, JSON.stringify({ summary, logs }));
      assert.deepEqual(summary.probe, expected, JSON.stringify(logs));
    } finally { proxy.dispose(); hosts.close(); }
  }
});
