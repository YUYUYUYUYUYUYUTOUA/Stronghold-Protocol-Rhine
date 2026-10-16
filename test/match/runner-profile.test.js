import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleRunner, loadBrowserSim, SIM_DATA_FILES } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as spec from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { DATA, makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { InPageSimHost } from '../../public/js/battle/simHost.js';

const ds = new DataSource(DATA, null);
function start() {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 8124, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans(); h.m.start(); h.run(() => h.m.phase === PHASE.COMBAT);
  const msg = h.lastTo('p_0', 'b.start'); h.m.dispose(); return msg;
}
function rig(loadSim) {
  const store = createStore(initialState);
  const runner = createBattleRunner({ store, loadSim, net: { on() { return () => {}; }, send() {}, request() { return Promise.resolve({t:'ok'}); } },
    now: () => 0, raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {}, doc: null });
  return { store, runner };
}

test('runner keeps separate profile caches, clears previous battles and cancels an old in-flight profile load', async () => {
  const loads = []; let releaseRhine;
  const { store, runner } = rig(({ rhineEnabled, dataBase }) => {
    loads.push({ rhineEnabled, dataBase });
    return rhineEnabled ? new Promise(resolve => { releaseRhine = resolve; }) : Promise.resolve({ spec, ds });
  });
  const msg = start();
  const first = runner.onStart({ ...msg, rhineEnabled: true });
  await Promise.resolve();
  store.set({ room: { rhineEnabled: false } });
  await runner.onStart({ ...msg, battleId: 'vanilla_1', rhineEnabled: false });
  releaseRhine({ spec, ds }); await first;
  assert.deepEqual([...runner._entries.keys()], ['vanilla_1']);
  assert.equal(runner.stats().battles, 1, 'superseded Rhine data never builds a battle');
  assert.deepEqual(loads, [{ rhineEnabled: true, dataBase: '/data/' }, { rhineEnabled: false, dataBase: '/data/vanilla/' }]);
  await runner.onStart({ ...msg, battleId: 'rhine_2', rhineEnabled: true });
  assert.deepEqual([...runner._entries.keys()], ['rhine_2']);
  await runner.onStart({ ...msg, battleId: 'vanilla_2', rhineEnabled: false });
  assert.deepEqual([...runner._entries.keys()], ['vanilla_2']);
  assert.equal(loads.length, 2, 'both ready profiles are reused');
  runner.dispose();
});

test('browser sim loader selects the full vanilla dataset and never replaces an already loaded DataSource', async () => {
  const seen = [];
  const base = new URL('../../server/sim/', import.meta.url).href;
  const fetchFn = async url => {
    seen.push(url); const name = url.split('/').at(-1).replace('.json','');
    const value = structuredClone(DATA[name] || {});
    value.profileProbe = url.includes('/vanilla/') ? 'vanilla' : 'rhine';
    return { ok: true, json: async () => value };
  };
  const rhine = await loadBrowserSim({ base, fetchFn });
  const vanilla = await loadBrowserSim({ base, rhineEnabled: false, fetchFn });
  assert.deepEqual(seen.slice(SIM_DATA_FILES.length), SIM_DATA_FILES.map(n => `/data/vanilla/${n}.json`));
  assert.equal(rhine.ds.contentData.bonds.profileProbe, 'rhine');
  assert.equal(vanilla.ds.contentData.bonds.profileProbe, 'vanilla');
  assert.ok(Object.isFrozen(vanilla.ds.contentData.bonds));
});

test('an authoritative catch-up cannot revive after leaving or switching away and back to the same profile', async () => {
  for (const switchBack of [false, true]) {
    const frames = [], store = createStore(initialState);
    const runner = createBattleRunner({ store, loadSim: async () => ({spec, ds}), net: {on() { return () => {}; }, send() {}},
      now: () => 0, raf: fn => { frames.push(fn); return frames.length; }, caf() {}, setInterval: () => 1, clearInterval() {}, doc: null });
    const pending = runner.onStart({...start(), rhineEnabled: true, elapsed: 5});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(frames.length, 'the initial catch-up yielded before it could show the battle');
    if (switchBack) { store.set({room:{rhineEnabled:false}}); store.set({room:{rhineEnabled:true}}); }
    else runner.clear();
    for (const fn of frames.splice(0)) fn(0);
    await pending;
    assert.equal(runner._entries.size, 0, 'cleared authority stays cleared');
    runner.dispose();
  }
});

const settleWarm = () => new Promise(resolve => setImmediate(resolve));
function warmRig({ loadGate = null, contentGate = null, loadError = null, scripts = [] } = {}) {
  let content = { cs: 'a'.repeat(64), data: DATA, scripts }, consent = true;
  const hosts = [], sent = [], store = createStore(initialState);
  const runner = createBattleRunner({ store, vanillaCs: () => 'b'.repeat(64), simContent: () => content,
    contentFor: async () => contentGate ? contentGate : content, scriptConsent: () => consent,
    net: { on: () => () => {}, request: (kind, fields) => { sent.push({ kind, ...fields }); return Promise.resolve(); } },
    raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {}, now: () => 0, doc: null,
    createHost: () => {
      const host = new InPageSimHost({ loadSim: async () => ({ spec, ds }) });
      host.remote = true; host.loads = 0; host.starts = 0; host.stops = 0;
      const load = host.load.bind(host), build = host.start.bind(host), stop = host.stop.bind(host);
      host.load = async (...args) => { host.loads++; if (loadGate) await loadGate; if (loadError) throw loadError; return load(...args); };
      host.start = (...args) => { host.starts++; return build(...args); };
      host.stop = () => { host.stops++; stop(); };
      hosts.push(host);
      return host;
    } });
  const room = (extra = {}) => ({ code: 'WARM', inMatch: true, rhineEnabled: true, content: { vanilla: false, cs: content?.cs }, ...extra });
  const publish = (phase = 'INFO_CHECK', round = 0) => store.set({ room: { ...(store.get().room || room()), inMatch: true },
    match: { public: { phase, round, combatMode: 'client', rhineEnabled: store.get().room?.rhineEnabled ?? true } } });
  const lobby = (publicLobby = false) => store.set({ room: { ...(store.get().room || room()), inMatch: false },
    match: { public: publicLobby ? { phase: 'LOBBY', round: 0, combatMode: 'client' } : null } });
  return { store, runner, hosts, sent, publish, lobby,
    setContent(value) { content = value; }, getContent: () => content, setConsent(value) { consent = value; },
    async start(id = 'warm-battle') {
      const msg = start();
      return runner.onStart({ ...msg, battleId: id, spec: { ...msg.spec, battleId: id, cs: content.cs }, rhineEnabled: store.get().room.rhineEnabled });
    },
  };
}

test('production preparation loads one unused Worker realm across setup phases, consumes it once and replaces it next round', async t => {
  const r = warmRig(); t.after(() => r.runner.dispose());
  r.publish(); await settleWarm();
  assert.equal(r.hosts.length, 1); assert.equal(r.hosts[0].loads, 1);
  assert.equal(r.hosts[0].starts, 0); assert.equal(r.hosts[0].battle, null); assert.equal(r.hosts[0].spec, undefined);
  assert.equal(r.runner.state(), null); assert.deepEqual(r.sent, []);
  for (const phase of ['BAND_DRAFT', 'BATTLE_CHECK', 'ROUND_START', 'SP_DRAFT', 'PREP']) {
    r.publish(phase, phase === 'BAND_DRAFT' || phase === 'BATTLE_CHECK' ? 0 : 1); await settleWarm();
  }
  assert.equal(r.hosts.length, 1, 'setup round 0 and first prep retain the same unused realm');
  assert.equal(r.hosts[0].stops, 0);
  r.publish('COMBAT', 1); await r.start();
  assert.equal(r.hosts.length, 1); assert.equal(r.hosts[0].loads, 1); assert.equal(r.hosts[0].starts, 1);
  assert.equal(r.runner._entries.get('warm-battle').host, r.hosts[0]);
  r.publish('PREP', 2); await settleWarm();
  assert.equal(r.hosts[0].stops, 1); assert.equal(r.hosts.length, 2); assert.equal(r.hosts[1].starts, 0);
  r.publish('COMBAT', 2); await r.start('round-two');
  assert.equal(r.hosts[1].loads, 1); assert.equal(r.hosts[1].starts, 1);
  assert.notEqual(r.hosts[0].battle, r.hosts[1].battle, 'a used realm never becomes the next battle host');
});

test('same-phase room, profile, content, checked-data and consent changes invalidate idle Workers', async t => {
  for (const change of ['room', 'profile', 'content', 'unchecked', 'consent']) {
    const r = warmRig({ scripts: change === 'consent' ? [{ execution: 'trusted' }] : [] });
    t.after(() => r.runner.dispose());
    r.publish('PREP', 1); await settleWarm();
    assert.equal(r.hosts.length, 1);
    if (change === 'room') r.store.patch('room', { code: 'OTHER' });
    if (change === 'profile') r.store.set({ room: { ...r.store.get().room, rhineEnabled: false }, match: { public: { phase: 'PREP', round: 1, rhineEnabled: false } } });
    if (change === 'content') { r.setContent({ ...r.getContent(), cs: 'c'.repeat(64) }); r.store.patch('room', { content: { vanilla: false, cs: r.getContent().cs } }); }
    if (change === 'unchecked') { r.setContent(null); r.store.patch('ui', { unrelated: true }); }
    if (change === 'consent') { r.setConsent(false); r.store.patch('ui', { unrelated: true }); }
    await settleWarm();
    assert.equal(r.hosts[0].stops, 1, change);
    assert.equal(r.hosts.length, ['unchecked', 'consent'].includes(change) ? 1 : 2, change);
    r.runner.dispose();
  }
});

test('a late content lookup cannot create a Worker after leaving, dispose, or entering combat', async t => {
  for (const action of ['leave', 'dispose', 'combat']) {
    let resolveContent;
    const gate = new Promise(resolve => { resolveContent = resolve; });
    const r = warmRig({ contentGate: gate }); t.after(() => r.runner.dispose());
    r.publish('PREP', 1); await settleWarm();
    if (action === 'leave') r.store.set({ room: null, match: { public: null } });
    if (action === 'dispose') r.runner.dispose();
    if (action === 'combat') r.publish('COMBAT', 1);
    resolveContent(r.getContent()); await settleWarm();
    assert.equal(r.hosts.length, 0, action);
    assert.deepEqual(r.sent, []);
  }
});

test('a failed idle warmup is recorded once, does not retry in the same round, and retries once next round', async t => {
  const r = warmRig({ loadError: new Error('real warm-load failure') }); t.after(() => r.runner.dispose());
  r.publish('PREP', 1); await settleWarm();
  assert.equal(r.runner.stats().errors, 1); assert.equal(r.hosts.length, 1); assert.deepEqual(r.sent, []);
  for (let i = 0; i < 3; i++) { r.store.patch('ui', { tick: i }); await settleWarm(); }
  assert.equal(r.hosts.length, 1); assert.equal(r.runner.stats().errors, 1);
  r.publish('COMBAT', 1); await r.start();
  assert.equal(r.hosts.length, 1); assert.equal(r.hosts[0].starts, 0); assert.equal(r.runner.stats().errors, 1);
  assert.equal(r.sent.filter(message => message.kind === 'b.progress').length, 0);
  assert.equal(r.sent.filter(message => message.kind === 'b.result').length, 1, 'the existing no-cs takeover signal is not a claimed result');
  assert.equal(r.sent[0].cs, undefined);
  r.publish('PREP', 2); await settleWarm();
  assert.equal(r.hosts.length, 2); assert.equal(r.runner.stats().errors, 2);
});

test('revoked native consent prevents a warmed, still-loading or cold cached realm from starting', async t => {
  for (const timing of ['ready', 'loading', 'loading-observed', 'cold']) {
    let resolveLoad;
    const gate = timing.startsWith('loading') ? new Promise(resolve => { resolveLoad = resolve; }) : null;
    const r = warmRig({ loadGate: gate, scripts: [{ execution: 'trusted' }] }); t.after(() => r.runner.dispose());
    if (timing === 'cold') await r.runner.ensureSim(r.getContent().cs);
    else { r.publish('PREP', 1); await settleWarm(); }
    if (timing.startsWith('loading')) {
      r.publish('COMBAT', 1);
      const starting = r.start(); await settleWarm();
      r.setConsent(false);
      if (timing === 'loading-observed') {
        r.store.patch('ui', { consentChanged: true });
        r.setConsent(true); // a cancelled pending entry cannot revive even if consent is granted again
      }
      resolveLoad(); await starting;
    } else {
      r.setConsent(false);
      r.publish('COMBAT', 1); await r.start();
    }
    assert.ok(r.hosts.every(host => host.starts === 0), timing);
    assert.equal(r.runner.stats().battles, 0, timing);
    assert.equal(r.sent.filter(message => message.kind === 'b.progress').length, 0, timing);
    assert.equal(r.sent.filter(message => message.kind === 'b.result' && message.cs).length, 0, timing);
  }
});

test('a pending checked-room lobby Worker survives setup and the first actual round jump to 14 without reloading', async t => {
  for (const publicLobby of [false, true]) {
    let resolveLoad;
    const gate = new Promise(resolve => { resolveLoad = resolve; });
    const r = warmRig({ loadGate: gate }); t.after(() => r.runner.dispose());
    r.lobby(publicLobby); await settleWarm();
    assert.equal(r.hosts.length, 1, 'the real room lobby starts loading before INFO_CHECK');
    const host = r.hosts[0];
    assert.equal(host.loads, 1); assert.equal(host.starts, 0); assert.equal(host.spec, undefined);
    for (const [phase, round] of [['INFO_CHECK', 0], ['BAND_DRAFT', 0], ['ROUND_START', 14], ['PREP', 14], ['PREP', 15]]) {
      r.publish(phase, round); await settleWarm();
      assert.equal(r.hosts.length, 1, `${phase}/${round} retains the original pending realm`);
      assert.equal(host.stops, 0); assert.equal(host.loads, 1);
    }
    r.publish('COMBAT', 15);
    const starting = r.start('jump-fourteen'); await settleWarm();
    assert.equal(host.starts, 0, 'claim waits for the original in-flight load');
    assert.equal(r.hosts.length, 1); assert.deepEqual(r.sent, []);
    resolveLoad(); await starting;
    assert.equal(host.loads, 1, 'claim never restarts load or its watchdog');
    assert.equal(host.starts, 1); assert.equal(r.runner._entries.get('jump-fourteen').host, host);
    assert.equal(r.runner.stats().errors, 0);
  }
});

test('an unused lobby realm is isolated from the next match after RESULT or an observed room match exit', async t => {
  for (const resultFrame of [false, true]) {
    const r = warmRig(); t.after(() => r.runner.dispose());
    r.lobby(); await settleWarm();
    r.publish('INFO_CHECK', 0); await settleWarm();
    const previous = r.hosts[0];
    if (resultFrame) {
      r.publish('RESULT', 14); await settleWarm();
      assert.equal(previous.stops, 1); assert.equal(r.hosts.length, 1);
      r.store.patch('room', { inMatch: false }); await settleWarm();
      assert.equal(r.hosts.length, 1, 'a stale RESULT cannot create the next candidate');
    }
    r.lobby(); await settleWarm();
    assert.equal(previous.stops, 1); assert.equal(previous.starts, 0);
    assert.equal(r.hosts.length, 2, 'the new lobby receives a fresh never-used realm');
    const next = r.hosts[1];
    assert.notEqual(previous, next); assert.equal(next.spec, undefined); assert.equal(next.starts, 0);
    r.publish('INFO_CHECK', 0); r.publish('PREP', 14); await settleWarm();
    assert.equal(r.hosts.length, 2); assert.equal(next.stops, 0);
    r.publish('COMBAT', 14); await r.start('next-match');
    assert.equal(next.starts, 1); assert.equal(r.runner._entries.get('next-match').host, next);
  }
});

test('a failed lobby slot is not retried in setup and can retry only once at each subsequent preparation round', async t => {
  const r = warmRig({ loadError: new Error('unchanged real load failure') }); t.after(() => r.runner.dispose());
  r.lobby(); await settleWarm();
  assert.equal(r.hosts.length, 1); assert.equal(r.runner.stats().errors, 1);
  for (const phase of ['INFO_CHECK', 'BAND_DRAFT', 'BATTLE_CHECK']) { r.publish(phase, 0); await settleWarm(); }
  assert.equal(r.hosts.length, 1); assert.equal(r.runner.stats().errors, 1);
  for (const phase of ['ROUND_START', 'SP_DRAFT', 'PREP']) { r.publish(phase, 14); await settleWarm(); }
  assert.equal(r.hosts.length, 2); assert.equal(r.runner.stats().errors, 2);
  for (let i = 0; i < 3; i++) { r.store.patch('ui', { tick: i }); await settleWarm(); }
  assert.equal(r.hosts.length, 2); assert.deepEqual(r.sent, []);
  r.publish('PREP', 15); await settleWarm();
  assert.equal(r.hosts.length, 3); assert.equal(r.runner.stats().errors, 3, 'earlier warmup errors remain counted');
});

test('an older deferred lobby attempt cannot create or replace a newer round candidate', async t => {
  let resolveContent;
  const gate = new Promise(resolve => { resolveContent = resolve; });
  const r = warmRig({ contentGate: gate }); t.after(() => r.runner.dispose());
  r.lobby(); await settleWarm();
  r.publish('INFO_CHECK', 0); r.publish('ROUND_START', 14); await settleWarm();
  resolveContent(r.getContent()); await settleWarm();
  assert.equal(r.hosts.length, 1, 'only the latest attempt creates its one candidate');
  assert.equal(r.hosts[0].loads, 1); assert.equal(r.hosts[0].stops, 0);
  r.publish('PREP', 15); await settleWarm();
  assert.equal(r.hosts.length, 1, 'a healthy unused candidate also survives the next round');
  assert.deepEqual(r.sent, []);
});
