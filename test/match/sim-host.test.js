import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { InPageSimHost, WorkerSimHost } from '../../public/js/battle/simHost.js';
import { loadBrowserSim } from '../../public/js/battle/simLoader.js';
import { createWorkerWarmup } from '../../public/js/battle/workerWarmup.js';
import { forkSandbox } from '../../server/match/host/childHost.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import { validateC2S } from '../../shared/protocol.js';
import { fixtureSet, fixtureSpec, scriptSet as makeScriptSet, operatorScript } from '../helpers/simHostFixture.js';

export function nodePort(child = false) {
  const worker = child ? forkSandbox(fileURLToPath(new URL('../helpers/simChildNode.mjs', import.meta.url)))
    : new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
  const port = { postMessage: m => child ? worker.send(m) : worker.postMessage(m), terminate: () => child ? worker.kill('SIGKILL') : worker.terminate() };
  worker.on('message', data => port.onmessage?.({ data })); worker.on('error', e => port.onerror?.(e));
  if (child) worker.stderr.on('data', d => process.stderr.write(d));
  return port;
}
const remote = options => new WorkerSimHost({ workerFactory: () => nodePort(), ...options });
const local = () => new InPageSimHost({ loadSim: content => loadBrowserSim({ ...content, base: new URL('../../server/sim/', import.meta.url).href }) });

test('cold load has its own budget; install keeps the short watchdog; stop settles pending calls', async () => {
  const commands = [];
  let port, terminated = 0;
  const host = new WorkerSimHost({ timeoutMs: 30, loadTimeoutMs: 300, workerFactory: () => (port = {
    terminate: () => terminated++, postMessage: m => {
      commands.push(m.method);
      if (m.method === 'load') setTimeout(() => port.onmessage({ data: { id: m.id, value: { install: true } } }), 80);
    },
  }) });
  const start = performance.now();
  await assert.rejects(host.load('a', { cs: 'a', data: {} }), e => e.code === 'PLUGIN_WORKER_TIMEOUT');
  assert.deepEqual(commands, ['load', 'install']); assert.equal(terminated, 1);
  assert.ok(performance.now() - start >= 100);
  const another = new WorkerSimHost({ workerFactory: () => ({ terminate() {}, postMessage() {} }) });
  const waiting = assert.rejects(another.rpc('step', [8]), e => e.code === 'PLUGIN_WORKER_STOPPED');
  another.stop(); await waiting; assert.equal(another.pending.size, 0);
});

test('runner on a real Worker reports its simulated cs and cached detail stats; pause and clear preserve ownership', async t => {
  const set = fixtureSet(), spec = { ...fixtureSpec(), cs: set.cs }, sent = [];
  let now = 1000;
  const runner = createBattleRunner({ net: { on: () => () => {}, send: (kind, fields) => {
    assert.equal(validateC2S({ t: kind, ...fields }), null); sent.push({ kind, ...fields });
  }, request: (kind, fields) => { assert.equal(validateC2S({ t: kind, rid: 1, ...fields }), null); sent.push({ kind, ...fields }); return Promise.resolve(); } },
  store: createStore(initialState), contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
  createHost: (_, onFailure) => remote({ onFailure }), raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {}, now: () => now, doc: null });
  t.after(() => runner.dispose());
  await runner.onStart({ battleId: 'probe', fieldId: 'n:p1', authoritative: true, spec });
  const e = runner._entries.get('probe'); assert.equal(e.host.remote, true); assert.equal(e.battle.step, undefined);
  runner.setPaused(true); now += 2000; runner._frame(); assert.equal(e.battle.tickCount, 0); runner.setPaused(false);
  for (let i = 0; i < 20 && !e.done; i++) {
    now += 1000; runner._frame();
    while (e.stepping) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(e.done, true);
  const results = sent.filter(m => m.kind === 'b.result'); assert.equal(results.length, 1); assert.equal(results[0].cs, set.cs);
  assert.ok(sent.some(m => m.kind === 'b.progress'));
  const id = runner.unitIdOf(1, 'p1'); assert.ok(id != null); assert.equal(runner.unitStats(id), null);
  while (e.host.statsPending.size) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(runner.unitStats(id).id, id);
  runner.clear(); assert.equal(e.host.stopped, true); assert.equal(runner.state(), null);
});

test('data set: Worker and in-page snapshots/events/results match every batch; bounds, stats, owners', async t => {
  const a = local(), b = remote(); t.after(() => b.stop());
  const set = fixtureSet(), spec = fixtureSpec();
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  assert.equal(await b.rpc('bounds'), 120, 'Worker installed the official snapshot, not plugin data');
  assert.deepEqual(b.battle.snapshot(), a.battle.snapshot()); a.battle.drainEvents(); b.battle.drainEvents();
  while (!a.battle.finished) {
    const x = a.step(8, { slice: 3 }), y = await b.step(8, { slice: 3 });
    assert.deepEqual(y.snap, x.snap); assert.deepEqual(y.ev, x.ev); assert.deepEqual(y.slices, x.slices);
  }
  assert.deepEqual(b.compactResult(), a.compactResult({}));
  assert.equal(b.compactResult().errors, 0);
  assert.ok(b.compactResult().total > 0, 'fixture fields real scheduled enemies');
  assert.deepEqual(b.ownerOps('p1'), a.ownerOps('p1'));
  const id = a.battle.allyUnits[0].id;
  assert.deepEqual(await b.rpc('unitStats', [id]), a.unitStats(id));
  assert.equal(typeof globalThis.lockdown, 'undefined', 'data/vanilla never install SES in the main realm');
});

test('script operator: permission child and Worker have byte-identical ev/results', async t => {
  const a = new WorkerSimHost({ workerFactory: () => nodePort(true) }), b = remote(), native = remote();
  t.after(() => { a.stop(); b.stop(); native.stop(); });
  const set = makeScriptSet(operatorScript), spec = fixtureSpec();
  const nativeSet = makeScriptSet(operatorScript,'trusted');
  await native.load(nativeSet.cs,nativeSet);await native.start(spec);
  await a.load(set.cs, set); await b.load(set.cs, set); await a.start(spec); await b.start(spec);
  await a.step(1); await b.step(1);await native.step(1);
  const stats = await b.rpc('unitStats', [b.battle.allyUnits[0].id]);
  assert.ok(stats, 'script operator is in the battle');
  const vanilla = local(); await vanilla.load(set.cs, { ...set, scripts: [] }); vanilla.start(spec); vanilla.step(1);
  assert.notDeepEqual(stats, vanilla.unitStats(vanilla.battle.allyUnits[0].id), 'the sandbox kit really changes the operator');
  vanilla.stop();
  while (!a.battle.finished) {
    const x = await a.step(8), y = await b.step(8), z = await native.step(8);
    assert.equal(JSON.stringify(y.ev), JSON.stringify(x.ev)); assert.equal(JSON.stringify(y.snap), JSON.stringify(x.snap));
    assert.equal(JSON.stringify(z.ev),JSON.stringify(x.ev));assert.equal(JSON.stringify(z.snap),JSON.stringify(x.snap));
  }
  assert.equal(JSON.stringify(b.compactResult()), JSON.stringify(a.compactResult()));
  assert.equal(JSON.stringify(native.compactResult()),JSON.stringify(a.compactResult()));
});

test('runner: true infinite script and slow data step terminate, stop reports and request server takeover', { timeout: 15000 }, async t => {
  for (const scripts of [true, false]) {
    const set = { ...fixtureSet(), ...(scripts ? makeScriptSet('export default function(){while(true){}}') : { data: { ...fixtureSet().data, __slow: true } }) };
    const sent = [], toasts = [];
    const runner = createBattleRunner({ net: { on: () => () => {}, request: (kind, fields) => {
      assert.equal(validateC2S({ t: kind, rid: 1, ...fields }), null); sent.push({ kind, ...fields }); return Promise.resolve();
    } }, store: createStore(initialState), contentFor: async () => set, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
    createHost: (_, onFailure) => remote({ onFailure }), raf: () => 1, caf: () => {}, setInterval: () => 1, clearInterval: () => {},
    toast: text => toasts.push(text), now: () => Date.now(), doc: null });
    t.after(() => runner.dispose());
    let alive = 0; const pulse = setInterval(() => alive++, 30);
    const start = Date.now();
    await runner.onStart({ battleId: 'hang', fieldId: 'n:p1', authoritative: true, spec: { ...fixtureSpec(), cs: set.cs }, elapsed: scripts ? 0 : 3 });
    clearInterval(pulse);
    assert.ok(alive > 25, 'parent remains responsive'); assert.ok(Date.now() - start >= 1900);
    assert.equal(toasts.length, 1); assert.equal(sent.length, 1); assert.equal(sent[0].cs, undefined);
    assert.equal(runner.state(), null);
  }
});

test('Worker overhead budget (8-tick batches, 240 ticks)', async t => {
  const set = fixtureSet(), spec = fixtureSpec();
  const a = local(), b = remote(); t.after(() => b.stop());
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  const t0 = performance.now();
  for (let n = 0; n < 30; n++) { const p = a.step(8); p.snap; p.ev; }
  const localMs = performance.now() - t0, t1 = performance.now();
  for (let n = 0; n < 30; n++) await b.step(8);
  const remoteMs = performance.now() - t1;
  t.diagnostic(JSON.stringify({ ticks: 240, localMs, workerMs: remoteMs, overheadMsPerTick: (remoteMs - localMs) / 240 }));
  assert.ok(remoteMs < 2000, '240 ticks fit inside a batch watchdog budget on this fixture');
});

function controlledWarmup() {
  const hosts = [], failures = [];
  const pool = createWorkerWarmup({ createHost: (sim, onFailure) => {
    let resolve, reject;
    const loaded = new Promise((yes, no) => { resolve = yes; reject = no; });
    const host = { sim, loadCalls: [], stopCalls: 0,
      load(cs, content) { this.loadCalls.push({ cs, content }); return loaded; },
      stop() { this.stopCalls++; },
      resolve() { resolve(host); }, reject, fail: onFailure,
    };
    hosts.push(host);
    return host;
  }, onFailure: (error, owner) => failures.push({ error, owner }) });
  return { pool, hosts, failures };
}

test('Worker warmup starts one load and atomically transfers pending or ready ownership', async () => {
  const { pool, hosts, failures } = controlledWarmup();
  const sim = { cs: 'first', content: { data: {} } }, owner = { battleId: 'first' };
  const pending = pool.prepare('profile:first', sim);
  assert.equal(pending.key, 'profile:first');
  assert.equal(pending.host, hosts[0]);
  assert.equal(pending.owner, null);
  assert.equal(pending.error, null);
  assert.equal(pending.cancelled, false);
  assert.deepEqual(hosts[0].loadCalls, [{ cs: sim.cs, content: sim.content }], 'prepare starts the actual host load synchronously');
  assert.equal(pool.prepare('profile:first', sim), pending);
  assert.equal(hosts.length, 1, 'the same profile/content shares its single in-flight load');
  assert.equal(pool.take('different', owner), null);
  const claims = await Promise.all([0, 1].map(() => Promise.resolve().then(() => pool.take('profile:first', owner))));
  assert.deepEqual(claims, [pending, null], 'only one concurrent caller claims the pending Worker');
  assert.equal(pending.owner, owner);
  pool.clear();
  assert.equal(hosts[0].stopCalls, 0, 'clearing the pool cannot stop a claimed battle host');
  hosts[0].resolve();
  assert.equal(await pending.ready, hosts[0]);

  const next = pool.prepare('profile:first', sim);
  assert.notEqual(next.host, pending.host, 'a claimed realm is never returned for the next battle');
  assert.equal(hosts.length, 2);
  hosts[1].resolve();
  assert.equal(await next.ready, hosts[1]);
  const nextOwner = { battleId: 'second' };
  assert.equal(pool.take('profile:first', nextOwner), next);
  assert.equal(next.owner, nextOwner);
  assert.equal(pool.take('profile:first', owner), null, 'a ready Worker also has exactly one owner');
  pool.clear();
  assert.deepEqual(hosts.map(host => host.stopCalls), [0, 0]);
  assert.deepEqual(failures, []);
});

test('Worker warmup clears idle hosts across content changes and late loads cannot revive them', async () => {
  const { pool, hosts, failures } = controlledWarmup();
  const first = pool.prepare('profile:old', { cs: 'old', content: { data: {} } });
  const second = pool.prepare('profile:new', { cs: 'new', content: { data: {} } });
  assert.equal(first.cancelled, true);
  assert.equal(hosts[0].stopCalls, 1);
  hosts[0].resolve(); // Deliberately emulate a completion already queued before cancellation.
  await Promise.allSettled([first.ready]);
  assert.equal(pool.take('profile:old', {}), null);
  assert.equal(pool.prepare('profile:new', hosts[1].sim), second, 'the stale completion cannot replace the new idle slot');
  hosts[1].resolve();
  await second.ready;
  pool.clear();
  pool.clear();
  assert.equal(second.cancelled, true);
  assert.equal(hosts[1].stopCalls, 1, 'clearing a ready idle slot stops it once');
  assert.equal(pool.take('profile:new', {}), null);

  const cancelled = pool.prepare('profile:cancelled', { cs: 'cancelled', content: { data: {} } });
  pool.clear();
  const stopped = Object.assign(new Error('load stopped during profile change'), { code: 'PLUGIN_WORKER_STOPPED' });
  hosts[2].reject(stopped);
  await assert.rejects(cancelled.ready, error => error === stopped);
  assert.equal(pool.take('profile:cancelled', {}), null);
  assert.deepEqual(failures, [], 'an intentional cancellation is not a warmup failure');
});

test('Worker warmup retains failures without retry, reports them once and preserves a claimed owner', async () => {
  const { pool, hosts, failures } = controlledWarmup();
  const sim = { cs: 'failed', content: { data: {} } };
  const idle = pool.prepare('profile:failed', sim);
  const firstError = Object.assign(new Error('worker boot failed'), { code: 'PLUGIN_WORKER_FAILED' });
  hosts[0].fail(firstError);
  hosts[0].reject(firstError);
  await new Promise(resolve => setImmediate(resolve)); // Its original promise must already have a rejection handler.
  await assert.rejects(idle.ready, error => error === firstError);
  hosts[0].fail(firstError);
  assert.equal(idle.error, firstError);
  assert.ok(hosts[0].stopCalls > 0);
  assert.deepEqual(failures, [{ error: firstError, owner: null }]);
  assert.equal(pool.prepare('profile:failed', sim), idle);
  assert.equal(hosts.length, 1, 'failed idle slots do not create automatic retry loops');
  assert.equal(pool.take('profile:failed', {}), idle);

  const claimed = pool.prepare('profile:claimed', { cs: 'claimed', content: { data: {} } });
  const owner = { battleId: 'owns-pending-load' };
  assert.equal(pool.take('profile:claimed', owner), claimed);
  const secondError = Object.assign(new Error('worker install failed'), { code: 'PLUGIN_WORKER_FAILED' });
  hosts[1].fail(secondError);
  hosts[1].reject(secondError);
  await assert.rejects(claimed.ready, error => error === secondError);
  hosts[1].fail(secondError);
  assert.equal(claimed.error, secondError);
  assert.deepEqual(failures, [{ error: firstError, owner: null }, { error: secondError, owner }]);
  assert.equal(pool.take('profile:claimed', {}), null);
});

test('a real warmed Worker installs before Battle and matches a fresh isolated realm', { timeout: 15000 }, async t => {
  const source = `export default function setup(sp) {
    let builds = 0;
    sp.kits.register('chess_char_1_01_a', () => {
      builds += 1;
      return { skill: { kind: 'passive', mods: { atkFlat: builds * 13 } } };
    });
  }`;
  const set = makeScriptSet(source), sim = { cs: set.cs, content: set }, spec = fixtureSpec();
  const failures = [], hosts = [];
  const pool = createWorkerWarmup({ createHost: (_, onFailure) => {
    const host = remote({ onFailure }); hosts.push(host); return host;
  }, onFailure: (error, owner) => failures.push({ error, owner }) });
  t.after(() => { pool.clear(); hosts.forEach(host => host.stop()); });
  const slot = pool.prepare('sandbox:' + set.cs, sim);
  const warmed = await slot.ready;
  assert.equal(warmed.spec, undefined, 'warmup must not construct or start a Battle');
  assert.equal(warmed.packet, undefined);
  assert.equal(warmed.pending.size, 0, 'both the actual load and script install RPC have completed');
  assert.equal(warmed.stopped, false);
  assert.equal(pool.take(slot.key, { battleId: spec.battleId }), slot);

  // Keep the comparison independent of the warmup helper: the existing fresh-host path loads normally.
  const fresh = remote();
  hosts.push(fresh);
  await fresh.load(set.cs, set);
  assert.notEqual(fresh, warmed, 'a different battle receives a new Worker and module realm');
  assert.equal(fresh.spec, undefined);
  assert.equal(fresh.packet, undefined);
  await warmed.start(spec);
  await fresh.start(spec);
  assert.deepEqual(warmed.battle.snapshot(), fresh.battle.snapshot());
  const initialEvents = warmed.battle.drainEvents();
  assert.deepEqual(fresh.battle.drainEvents(), initialEvents);
  let firstStats;
  while (!warmed.battle.finished) {
    const a = await warmed.step(8, { slice: 3 }), b = await fresh.step(8, { slice: 3 });
    assert.deepEqual(b.snap, a.snap);
    assert.deepEqual(b.ev, a.ev);
    assert.deepEqual(b.slices, a.slices);
    if (!firstStats) {
      const id = warmed.battle.allyUnits[0].id;
      firstStats = await warmed.rpc('unitStats', [id]);
      assert.deepEqual(await fresh.rpc('unitStats', [id]), firstStats);
    }
  }
  assert.deepEqual(fresh.compactResult(), warmed.compactResult());
  assert.equal(warmed.compactResult().errors, 0);
  assert.ok(warmed.compactResult().total > 0);

  // Demonstrate that the probe detects actual retained closure state if a realm were reused.
  await warmed.start(spec);
  await warmed.step(8);
  const reusedStats = await warmed.rpc('unitStats', [warmed.battle.allyUnits[0].id]);
  assert.ok(reusedStats.atk > firstStats.atk, 'the same realm retains the script counter, unlike the next fresh Worker');
  assert.deepEqual(failures, []);
});

test('true infinite setup in an idle warmup is killed by the unchanged install watchdog', { timeout: 15000 }, async t => {
  const set = makeScriptSet('export default function setup(){while(true){}}');
  const failures = [], hosts = [];
  const pool = createWorkerWarmup({ createHost: (_, onFailure) => {
    const host = remote({ onFailure }); hosts.push(host); return host;
  }, onFailure: (error, owner) => failures.push({ error, owner }) });
  t.after(() => { pool.clear(); hosts.forEach(host => host.stop()); });
  let pulses = 0;
  const pulse = setInterval(() => pulses++, 30);
  t.after(() => clearInterval(pulse));
  const at = performance.now(), slot = pool.prepare('sandbox:infinite', { cs: set.cs, content: set });
  assert.equal(slot.host.timeoutMs, 2000);
  assert.equal(slot.host.loadTimeoutMs, 15000);
  await assert.rejects(slot.ready, error => error.code === 'PLUGIN_WORKER_TIMEOUT'
    && /install exceeded 2000 ms/.test(error.message));
  clearInterval(pulse);
  assert.ok(performance.now() - at >= 1900);
  assert.ok(pulses > 25, 'a truly blocked setup cannot block the parent event loop');
  assert.equal(slot.host.stopped, true);
  assert.equal(slot.host.pending.size, 0);
  assert.equal(slot.host.spec, undefined);
  assert.equal(slot.host.packet, undefined);
  assert.equal(failures.length, 1, 'host failure plus rejected load reports only once');
  assert.equal(failures[0].error, slot.error);
  assert.equal(failures[0].owner, null);
  assert.equal(pool.prepare(slot.key, { cs: set.cs, content: set }), slot);
  assert.equal(hosts.length, 1, 'an infinite idle setup is not automatically retried');
});

test('Worker warmup retry flags keep a healthy pending or ready realm and its original load promise', async () => {
  const { pool, hosts, failures } = controlledWarmup();
  const key = 'same-profile:same-content', sim = { cs: 'same-content', content: { data: {} } };
  const slot = pool.prepare(key, sim), originalLoad = slot.ready;
  for (let round = 1; round <= 3; round++) {
    assert.equal(pool.prepare(key, sim, { retryFailed: true }), slot, `round ${round} keeps a healthy pending realm`);
    assert.equal(slot.ready, originalLoad, 'round transitions cannot reset the pending load or its watchdog');
    assert.equal(pool.prepare(key, sim), slot, 'ordinary updates also keep the pending slot');
  }
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].loadCalls.length, 1, 'the original host load starts only once across round-style updates');
  assert.equal(hosts[0].stopCalls, 0);
  hosts[0].resolve();
  assert.equal(await originalLoad, hosts[0]);
  assert.equal(pool.prepare(key, sim, { retryFailed: true }), slot, 'the completed unused realm also survives the next round');
  assert.equal(slot.ready, originalLoad);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].stopCalls, 0);
  assert.equal(slot.cancelled, false);
  const owner = { battleId: 'first-real-battle' };
  assert.equal(pool.take(key, owner), slot);
  assert.equal(slot.owner, owner);
  pool.clear();
  assert.equal(hosts[0].stopCalls, 0, 'a claimed realm remains owned by its battle');
  assert.deepEqual(failures, []);
});

test('Worker warmup retries only a failed slot on request and ignores late errors from its cancelled predecessor', async () => {
  const { pool, hosts, failures } = controlledWarmup();
  const key = 'profile:retryable', sim = { cs: 'retryable', content: { data: {} } };
  const failed = pool.prepare(key, sim);
  const firstError = Object.assign(new Error('original load timed out'), { code: 'PLUGIN_WORKER_TIMEOUT' });
  hosts[0].fail(firstError);
  assert.equal(failed.error, firstError);
  for (let update = 0; update < 3; update++) {
    assert.equal(pool.prepare(key, sim), failed, 'ordinary updates retain the failure without an automatic retry');
    assert.equal(pool.prepare(key, sim, { retryFailed: false }), failed);
  }
  assert.equal(hosts.length, 1);
  const replacement = pool.prepare(key, sim, { retryFailed: true });
  assert.notEqual(replacement, failed);
  assert.notEqual(replacement.host, failed.host);
  assert.equal(failed.cancelled, true);
  assert.equal(hosts.length, 2);
  assert.deepEqual(hosts[1].loadCalls, [{ cs: sim.cs, content: sim.content }]);
  assert.equal(pool.prepare(key, sim, { retryFailed: true }), replacement, 'the permitted retry is immediately a healthy pending slot');

  // The old host's load rejection may arrive after its failure callback and after the replacement exists.
  hosts[0].reject(firstError);
  await assert.rejects(failed.ready, error => error === firstError);
  hosts[0].fail(Object.assign(new Error('late old Worker event'), { code: 'PLUGIN_WORKER_FAILED' }));
  assert.deepEqual(failures, [{ error: firstError, owner: null }]);
  assert.equal(replacement.error, null);
  assert.equal(replacement.cancelled, false);
  assert.equal(hosts[1].stopCalls, 0);
  assert.equal(pool.prepare(key, sim), replacement, 'late failures cannot displace or poison the replacement');
  hosts[1].resolve();
  assert.equal(await replacement.ready, hosts[1]);
  assert.equal(pool.take(key, { battleId: 'after-retry' }), replacement);
  assert.equal(pool.take(key, {}), null);
  pool.clear();
  assert.equal(hosts[1].stopCalls, 0);
});
