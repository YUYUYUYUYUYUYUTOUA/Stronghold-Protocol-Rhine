import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleRunner, loadBrowserSim, SIM_DATA_FILES } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as spec from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { DATA, makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

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
