import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfiledDataStore, CORE_DATA_FILES, PROFILE_CHANGE } from '../../public/js/data.js';
import { createStore } from '../../public/js/store.js';
import { createDataProfilePreparation, profileFromState } from '../../public/js/ui/dataProfile.js';
import { RhineToggle, roomProfileReady } from '../../public/js/screens/room.js';
import { installLoadoutSync, loadoutStore, loadoutPreferenceKey } from '../../public/js/ui/loadoutSync.js';
import { ChoiceView, cardPickable, spTap } from '../../public/js/ui/choiceOverlay.js';
import { checkLoadout } from '../../shared/protocol.js';

const response = (body) => ({ ok: true, status: 200, json: async () => body });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const baseId = 'chess_test_a';
const chess = (tier, extra = false) => ({
  [baseId]: { chessId: baseId, visible: true, tier, skills: [{ index: 0 }, { index: 1, isDefault: true }] },
  ...(extra ? { chess_rhine_a: { chessId: 'chess_rhine_a', tier: 5, visible: true, skills: [{ index: 0 }] } } : {}),
});
function deferredCache() {
  const calls = [];
  const resolvers = new Map();
  const cache = createProfiledDataStore({ retryDelays: [], fetch(url) {
    calls.push(url);
    return new Promise((resolve) => resolvers.set(url, resolve));
  } });
  return { cache, calls, finish: (url, body) => resolvers.get(url)(response(body)) };
}
function* walk(node) {
  if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
  if (!node || typeof node !== 'object') return;
  yield node;
  yield* walk(node.props?.children);
}
function fakeNet() {
  const listeners = new Map();
  return {
    status: 'online', sent: [],
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    emit(name, msg) { for (const fn of listeners.get(name) || []) fn(msg); },
    async request(name, fields) { this.sent.push({ t: name, ...fields }); return { t: 'ok' }; },
  };
}

test('profile caches share each in-flight download, retain both rosters and tiers, and keep art on shared URLs', async () => {
  const { cache, calls, finish } = deferredCache();
  const events = [];
  cache.subscribe((name) => events.push(name));
  const old = cache.load('chess');
  assert.equal(cache.load('chess'), old);
  const oldSnapshot = cache.snapshot();
  const art = cache.load('assets');
  cache.selectProfile(false);
  assert.equal(cache.lookup('chess', baseId), null, 'old profile is hidden immediately');
  const vanilla = cache.load('chess');
  assert.equal(cache.load('assets'), art, 'shared art has one download across profiles');
  finish('/data/chess.json', chess(3, true));
  await old;
  assert.deepEqual(events, [PROFILE_CHANGE], 'old in-flight completion cannot notify the active profile');
  assert.equal(cache.lookup('chess', baseId), null);
  assert.equal(oldSnapshot.lookup('chess', baseId).tier, 3, 'an async snapshot remains scoped to its captured profile');
  finish('/data/vanilla/chess.json', chess(2));
  finish('/data/assets.json', { chess: '/assets/chess.webp' });
  await Promise.all([vanilla, art]);
  assert.equal(cache.lookup('chess', baseId).tier, 2);
  assert.equal(cache.lookup('chess', 'chess_rhine_a'), null);
  assert.equal(cache.get('assets').chess, '/assets/chess.webp');
  const count = calls.length;
  cache.selectProfile(true);
  assert.equal(cache.lookup('chess', baseId).tier, 3);
  assert.equal(cache.lookup('chess', 'chess_rhine_a').tier, 5);
  await cache.load('chess');
  assert.equal(calls.length, count, 'returning to a loaded profile does not refetch it');
  assert.equal(cache.generation, 2);
});

test('a complete profile barrier waits for every required file and ignores an older generation resolving last', async () => {
  const { cache, finish } = deferredCache();
  const target = createStore({ ui: {} });
  const prepare = createDataProfilePreparation({ cache, target, files: ['chess', 'config'] });
  const rhine = prepare(true);
  assert.equal(prepare(true), rhine, 'concurrent room/public preparation shares the same barrier');
  const vanilla = prepare(false);
  finish('/data/vanilla/chess.json', chess(2));
  await tick();
  assert.equal(target.get().ui.dataReady, false, 'one loaded file cannot enable room controls');
  finish('/data/vanilla/config.json', { profile: 'vanilla' });
  assert.equal(await vanilla, true);
  assert.equal(roomProfileReady({ rhineEnabled: false }, target.get().ui, cache), true);
  finish('/data/chess.json', chess(3, true));
  finish('/data/config.json', { profile: 'rhine' });
  assert.equal(await rhine, false);
  assert.equal(target.get().ui.dataProfile, 'vanilla');
  assert.equal(target.get().ui.dataReady, true);
  assert.equal(roomProfileReady({ rhineEnabled: true }, target.get().ui, cache), false);
  assert.equal(await prepare(true), true, 'a complete cached profile can be restored immediately');
});

test('all 15 core files use the selected endpoint; a missing core file keeps controls blocked while optional art may be absent', async () => {
  const calls = [];
  const cache = createProfiledDataStore({ profile: false, retryDelays: [], fetch: async (url) => {
    calls.push(url);
    if (url === '/data/assets.json' || url === '/data/vanilla/waves.json') return { ok: false, status: 404 };
    return response({ profile: 'vanilla' });
  } });
  const target = createStore({ ui: {} });
  const prepare = createDataProfilePreparation({ cache, target, files: [...CORE_DATA_FILES, 'assets', 'local'] });
  assert.equal(await prepare(false), false);
  assert.equal(CORE_DATA_FILES.length, 15);
  for (const name of CORE_DATA_FILES) assert.ok(calls.includes(`/data/vanilla/${name}.json`));
  assert.ok(calls.includes('/data/local-assets.json'));
  assert.equal(cache.isReady('assets'), true, 'missing art retains normal fallback behavior');
  assert.equal(target.get().ui.dataReady, false);
  assert.match(target.get().ui.dataError, /waves/);
});

test('match profile wins for direct m.public restore, room profile controls a waiting room, and default is Rhine', () => {
  assert.equal(profileFromState({ match: { public: { rhineEnabled: false } } }), 'vanilla');
  assert.equal(profileFromState({ room: { inMatch: true, rhineEnabled: true }, match: { public: { rhineEnabled: false } } }), 'vanilla');
  assert.equal(profileFromState({ room: { inMatch: false, rhineEnabled: false }, match: { public: { rhineEnabled: true } } }), 'vanilla');
  assert.equal(profileFromState({}), 'rhine');
});

test('room toggle shows both shared states and only lets an online lobby host change them in solo or co-op', () => {
  for (const mode of ['solo', 'coop']) {
    const selected = [];
    const buttons = [...walk(RhineToggle({ room: { mode, rhineEnabled: true }, isHost: true, onPick: value => selected.push(value) }))].filter(n => n.type === 'button');
    assert.deepEqual(buttons.map(n => n.props['aria-pressed']), ['true', 'false']);
    buttons[0].props.onClick();
    buttons[1].props.onClick();
    assert.deepEqual(selected, [false]);
    for (const context of [{ isHost: false }, { isHost: true, busy: true }, { isHost: true, online: false }, { isHost: true, room: { mode, inMatch: true } }, { isHost: true, room: { mode, phase: 'PREP' } }]) {
      const locked = [...walk(RhineToggle({ room: { mode, rhineEnabled: false }, onPick: () => assert.fail('disabled toggle sent a request'), ...context }))].filter(n => n.type === 'button');
      assert.ok(locked.every(n => n.props.disabled));
      for (const button of locked) button.props.onClick();
    }
  }
});

test('profile-specific saved loadouts restore without contamination and resync against their own chess data', async () => {
  const originalStorage = globalThis.localStorage;
  const previousState = loadoutStore.get();
  const prefs = new Map([['sp.pref.loadout.vanilla', JSON.stringify({ v: 1, entries: { [baseId]: { skill: 0 }, chess_rhine_a: { skill: 1 } } })]]);
  globalThis.localStorage = { getItem: (key) => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value) };
  const cache = createProfiledDataStore({ retryDelays: [], fetch: async url => response(chess(url.includes('/vanilla/') ? 2 : 3, !url.includes('/vanilla/'))) });
  const net = fakeNet();
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  loadoutStore.set({ entries: { [baseId]: { skill: 0 } }, open: true, sel: baseId });
  const sync = installLoadoutSync({ net, cache, timers });
  try {
    await sync.flush();
    cache.selectProfile(false);
    assert.equal(loadoutStore.get().open, false);
    assert.equal(loadoutStore.get().sel, null);
    assert.equal(loadoutStore.get().profileId, 'vanilla');
    await sync.flush();
    assert.deepEqual(net.sent.at(-1).entries, { [baseId]: { skill: 0 } }, 'Rhine-only saved entries are filtered using vanilla records');
    assert.equal(checkLoadout(net.sent.at(-1).entries, id => cache.lookup('chess', id)).ok, true);
    loadoutStore.set({ entries: {} });
    await sync.flush();
    cache.selectProfile(true);
    assert.deepEqual(loadoutStore.get().entries, { [baseId]: { skill: 0 } }, 'Rhine choices return intact');
    await sync.flush();
    assert.equal(net.sent.at(-1).t, 'room.loadout');
    assert.deepEqual(net.sent.at(-1).entries, { [baseId]: { skill: 0 } });
    cache.selectProfile(false);
    assert.deepEqual(loadoutStore.get().entries, {}, 'vanilla edits were saved to the vanilla preference');
    assert.notEqual(loadoutPreferenceKey('rhine'), loadoutPreferenceKey('vanilla'));
  } finally {
    sync.dispose();
    loadoutStore.set(previousState);
    globalThis.localStorage = originalStorage;
  }
});

test('an old loadout await cannot send entries after a profile switch', async () => {
  const { cache, finish } = deferredCache();
  const net = fakeNet();
  const target = createStore({ entries: { [baseId]: { skill: 0 } }, open: false, sync: 'idle' });
  const sync = installLoadoutSync({ net, cache, target, timers: { setTimeout: () => 1, clearTimeout: () => {} } });
  try {
    const old = sync.flush();
    cache.selectProfile(false);
    const latest = sync.flush();
    finish('/data/chess.json', chess(3, true));
    await old;
    assert.equal(net.sent.length, 0);
    finish('/data/vanilla/chess.json', chess(2));
    await latest;
    assert.equal(net.sent.length, 1);
    assert.deepEqual(net.sent[0].entries, { [baseId]: { skill: 0 } });
  } finally { sync.dispose(); }
});

test('nine bounty cards render in a scrollable grid and index eight follows the normal selection and confirmation path', () => {
  const tapped = [];
  const sp = { family: 'bounty', turnPid: 'p1', pickOf: new Map(), order: ['p1'], cards: Array.from({ length: 9 }, (_, idx) => ({ idx, kind: 'bounty', name: `目标${idx}`, desc: '悬赏任务' })) };
  const view = ChoiceView({ pub: { players: [{ playerId: 'p1' }] }, sp, myId: 'p1', solo: false, onTap: idx => tapped.push(idx) });
  const grid = [...walk(view)].find(n => n.props?.class?.includes('spov__grid--many'));
  assert.ok(grid);
  const cards = [...walk(grid)].filter(n => n.type === 'button');
  assert.equal(cards.length, 9);
  assert.equal(cards[8].props['data-idx'], 8);
  assert.equal(cards[8].props.disabled, false);
  cards[8].props.onClick();
  assert.deepEqual(tapped, [8]);
  assert.equal(cardPickable(sp, sp.cards[8], { myId: 'p1', solo: false }), true);
  assert.deepEqual(spTap(null, 8, true), { armed: 8, pick: null });
  assert.deepEqual(spTap(8, 8, true), { armed: null, pick: 8 });
  const css = readFileSync(new URL('../../public/css/screens/game-panels.css', import.meta.url), 'utf8');
  assert.match(css, /\.spov__grid--many\s*\{[^}]*overflow:\s*auto/);
});
