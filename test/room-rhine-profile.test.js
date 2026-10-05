import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Lobby, Room } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA_FILES, getData, getDataProfile, loadData, resetData } from '../server/data.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { ERR, PHASE } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
const BASE = 'chess_base_a';
const EXTRA = 'chess_rhine_extra_a';
const chessPair = (id, skills, modules) => {
  const goldenId = id.replace(/_a$/, '_b');
  const skill = { index: skills[0] };
  return {
    [id]: { chessId: id, baseId: id, goldenId, visible: true, isGolden: false, skill, skills: skills.map(index => ({ index, isDefault: index === skills[0] })) },
    [goldenId]: { chessId: goldenId, baseId: id, goldenId, isGolden: true, skill, skills: skills.map(index => ({ index, isDefault: index === skills[0] })), modules: modules.map((uniEquipId, index) => ({ uniEquipId, isDefault: index === 0 })) },
  };
};
function fixtureProfiles() {
  return {
    rhine: { chess: { ...chessPair(BASE, [0, 1, 2], ['mod_a', 'mod_b', 'mod_rhine']), ...chessPair(EXTRA, [0, 1], ['mod_extra']) } },
    vanilla: { chess: chessPair(BASE, [0, 1], ['mod_a', 'mod_b']) },
  };
}
function lobbyHarness(options = {}) {
  const data = fixtureProfiles();
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: QUIET, getData: () => data.rhine, vanillaData: data.vanilla, ...options });
  const player = name => {
    const session = registry.create(name);
    session.connected = true;
    session.messages = [];
    session.ws = { readyState: 1, bufferedAmount: 0, send(frame) { session.messages.push(JSON.parse(frame)); } };
    return session;
  };
  const send = (session, msg) => {
    assert.equal(validateC2S(msg), null);
    return lobby.onMessage(session, msg);
  };
  return { lobby, registry, player, send, data };
}
const create = (h, player, fields = {}) => {
  assert.deepEqual(h.send(player, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', ...fields }), { ok: true });
  return h.lobby.roomOf(player);
};

test('Rhine room protocol defaults to enabled, validates optional creation and host toggle booleans, and accepts all nine choices', () => {
  assert.equal(new Room('TEST', 'coop', 'NORMAL', 0).rhineEnabled, true);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', rhineEnabled: false }), null);
  for (const value of ['false', null, 0, {}]) {
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', rhineEnabled: value }), 'bad field rhineEnabled');
    assert.equal(validateC2S({ t: 'room.setRhine', enabled: value }), 'bad field enabled');
  }
  assert.equal(validateC2S({ t: 'room.setRhine' }), 'bad field enabled');
  for (const idx of [0, 6, 7, 8]) assert.equal(validateC2S({ t: 'g.choice', idx }), null);
  for (const idx of [-1, 9, 8.5, '8']) assert.equal(validateC2S({ t: 'g.choice', idx }), 'bad field idx');
  assert.equal(validateC2S({ t: 'g.reward', idx: 5 }), null);
  assert.equal(validateC2S({ t: 'g.reward', idx: 6 }), 'bad field idx');
});

test('only the lobby host can change Rhine; changes clear all human readiness and broadcast the profile without changing another room', () => {
  const h = lobbyHarness();
  try {
    const a = h.player('Host'), b = h.player('Guest'), other = h.player('Other');
    const room = create(h, a), separate = create(h, other);
    assert.deepEqual(h.send(b, { t: 'room.join', code: room.code }), { ok: true });
    assert.deepEqual(h.send(a, { t: 'room.ready', ready: true }), { ok: true });
    assert.deepEqual(h.send(b, { t: 'room.ready', ready: true }), { ok: true });
    assert.deepEqual(h.send(a, { t: 'room.addBot' }), { ok: true });
    assert.equal(h.send(b, { t: 'room.setRhine', enabled: false }).error, ERR.NOT_HOST);
    assert.equal(room.rhineEnabled, true);
    assert.deepEqual(h.send(a, { t: 'room.setRhine', enabled: false }), { ok: true });
    assert.equal(room.rhineEnabled, false);
    for (const seat of room.seats.filter(Boolean)) assert.equal(seat.ready, seat.isBot);
    assert.equal(room.toState().dataProfile, 'vanilla');
    assert.equal(b.messages.at(-1).rhineEnabled, false);
    assert.equal(separate.rhineEnabled, true);
    assert.strictEqual(separate.data, h.data.rhine);
    const solo = create(h, other, { mode: 'solo', rhineEnabled: false });
    assert.equal(solo.rhineEnabled, false);
  } finally { h.lobby.shutdown(); }
});

test('switching and joining sanitize missing operators, skills and modules independently against the target room data', () => {
  const h = lobbyHarness();
  try {
    const host = h.player('Host'), guest = h.player('Guest'), other = h.player('Separate');
    const rhineLoadout = { [BASE]: { skill: 2, module: 'mod_b' }, [EXTRA]: { skill: 1 } };
    assert.deepEqual(h.send(host, { t: 'room.loadout', entries: rhineLoadout }), { ok: true });
    const room = create(h, host), separate = create(h, other);
    assert.deepEqual(h.send(other, { t: 'room.loadout', entries: rhineLoadout }), { ok: true });
    const untouched = separate.seatOf(other.playerId).loadout;
    assert.deepEqual(h.send(guest, { t: 'room.join', code: room.code }), { ok: true });
    assert.deepEqual(h.send(guest, { t: 'room.loadout', entries: { [BASE]: { skill: 1, module: 'mod_rhine' } } }), { ok: true });
    assert.deepEqual(h.send(host, { t: 'room.setRhine', enabled: false }), { ok: true });
    assert.deepEqual(room.seatOf(host.playerId).loadout, { [BASE]: { skill: 0, module: 'mod_b' } });
    assert.deepEqual(room.seatOf(guest.playerId).loadout, { [BASE]: { skill: 1, module: 'mod_a' } });
    assert.strictEqual(host.loadout, room.seatOf(host.playerId).loadout);
    assert.equal(h.send(host, { t: 'room.loadout', entries: { [EXTRA]: { skill: 1 } } }).error, ERR.BAD_TARGET);
    assert.equal(h.send(host, { t: 'room.loadout', entries: { [BASE]: { module: 'mod_rhine' } } }).error, ERR.BAD_TARGET);
    assert.strictEqual(separate.seatOf(other.playerId).loadout, untouched);
    assert.deepEqual(untouched[BASE], { skill: 2, module: 'mod_b' });
    assert.deepEqual(h.send(other, { t: 'room.join', code: room.code }), { ok: true });
    assert.deepEqual(room.seatOf(other.playerId).loadout, { [BASE]: { skill: 0, module: 'mod_b' } });
    assert.ok(Object.isFrozen(room.seatOf(other.playerId).loadout[BASE]));
  } finally { h.lobby.shutdown(); }
});

test('missing vanilla profile refuses toggle/create atomically, preserves the current room and never selects Rhine as fallback', () => {
  const h = lobbyHarness({ getDataProfile: enabled => {
    if (!enabled) throw new Error('Vanilla game data unavailable: missing chess.json');
    return fixtureProfiles().rhine;
  } });
  try {
    const host = h.player('Host'), room = create(h, host);
    assert.deepEqual(h.send(host, { t: 'room.ready', ready: true }), { ok: true });
    const data = room.data;
    const toggle = h.send(host, { t: 'room.setRhine', enabled: false });
    assert.equal(toggle.error, ERR.INTERNAL);
    assert.match(toggle.detail, /Vanilla.*missing chess.json/);
    assert.equal(room.rhineEnabled, true);
    assert.strictEqual(room.data, data);
    assert.equal(room.seatOf(host.playerId).ready, true);
    const replacement = h.send(host, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL', rhineEnabled: false });
    assert.equal(replacement.error, ERR.INTERNAL);
    assert.strictEqual(h.lobby.roomOf(host), room);
    assert.equal(h.lobby.rooms.size, 1);
  } finally { h.lobby.shutdown(); }
});

test('vanilla profile loader is strict, cached and immutable while legacy loadData remains compatible with partial fixtures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-profile-'));
  try {
    const vanillaDir = path.join(dir, 'vanilla');
    fs.mkdirSync(vanillaDir);
    fs.writeFileSync(path.join(dir, 'chess.json'), JSON.stringify({ rhine: {} }));
    assert.deepEqual(loadData(dir, { log: QUIET }).chess, { rhine: {} });
    assert.throws(() => getDataProfile(false, { dir, log: QUIET }), /Vanilla game data unavailable.*config.json.*chess.json/);
    for (const file of DATA_FILES) fs.writeFileSync(path.join(vanillaDir, `${file}.json`), JSON.stringify({ marker: { profile: 'vanilla' } }));
    fs.writeFileSync(path.join(vanillaDir, 'chess.json'), '{broken');
    assert.throws(() => getDataProfile(false, { dir, log: QUIET }), /invalid chess.json/);
    fs.writeFileSync(path.join(vanillaDir, 'chess.json'), JSON.stringify({ base: { tier: 1 } }));
    const data = getDataProfile(false, { dir, log: QUIET });
    assert.ok(Object.isFrozen(data.chess.base));
    assert.throws(() => { data.chess.base.tier = 6; }, TypeError);
    assert.strictEqual(getDataProfile(false, { dir, log: QUIET }), data);
    assert.equal(data.chess.rhine, undefined);
    assert.throws(() => getDataProfile('false', { dir, log: QUIET }), /boolean/);
  } finally { resetData(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('two six-seat real matches keep distinct frozen profiles and opening bans, publish the selected profile and reject changes after start', () => {
  const rhine = getData({ log: QUIET }), vanilla = getDataProfile(false, { log: QUIET });
  const configs = [structuredClone(rhine.config), structuredClone(vanilla.config)];
  class VirtualMatch extends Match {
    constructor(opts) { super({ ...opts, scheduler: new VirtualScheduler(), botRehearsal: 0 }); }
  }
  const h = lobbyHarness({ getData: () => rhine, vanillaData: vanilla, MatchClass: VirtualMatch, seedFn: () => 31 });
  try {
    const a = h.player('Rhine'), b = h.player('Vanilla');
    const r = create(h, a), v = create(h, b, { rhineEnabled: false });
    for (const host of [a, b]) for (let i = 1; i < 6; i++) assert.deepEqual(h.send(host, { t: 'room.addBot' }), { ok: true });
    assert.deepEqual(h.send(a, { t: 'room.start' }), { ok: true });
    assert.deepEqual(h.send(b, { t: 'room.start' }), { ok: true });
    for (const [host, room, data, enabled] of [[a, r, rhine, true], [b, v, vanilla, false]]) {
      const m = room.match;
      assert.equal(m.phase, PHASE.INFO_CHECK);
      assert.strictEqual(m.data, data);
      assert.equal(m.startingPlayerCount, 6);
      assert.deepEqual(m.openingBans, { core: Math.max(0, data.config.bans.NORMAL.core - 2), addon: data.config.bans.NORMAL.addon });
      assert.equal(m.publicView().rhineEnabled, enabled);
      assert.equal(m.publicView().dataProfile, enabled ? 'rhine' : 'vanilla');
      assert.equal(h.send(host, { t: 'room.setRhine', enabled: !enabled }).error, ERR.ROOM_STARTED);
      for (const property of ['data', 'dataProfile', 'rhineEnabled']) assert.throws(() => { m[property] = null; }, TypeError);
      m.opts.rhineEnabled = !enabled;
      assert.equal(m.rhineEnabled, enabled);
      const field = m._ccField({ fieldId: 'profile-check', kind: 'normal', players: [host.playerId], opts: { players: [], spawns: [] } });
      assert.equal(field.spec.rhineEnabled, enabled);
      assert.equal(field.spec.dataProfile, m.dataProfile);
      assert.equal(m._startMsg(field, host.playerId).rhineEnabled, enabled);
      assert.equal(m._startMsg(field, host.playerId).dataProfile, m.dataProfile);
    }
    assert.ok(r.match.gd.chess('chess_rhine_mayer_a'));
    assert.equal(v.match.gd.chess('chess_rhine_mayer_a'), null);
    assert.deepEqual(rhine.config, configs[0]);
    assert.deepEqual(vanilla.config, configs[1]);
    assert.ok(Object.isFrozen(v.match.data.chess));
  } finally { h.lobby.shutdown(); }
});
