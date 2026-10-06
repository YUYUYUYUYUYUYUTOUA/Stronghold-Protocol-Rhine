import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { validateClientResult } from '../../server/match/fields.js';
import { RHINE_BOND } from '../../shared/rhineResearch.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const gd = new GameData(DATA, 'mode_multi_hard');
const MAYER = 'chess_rhine_mayer_a';
const ELITE = 'chess_rhine_mayer_b';
const MEDICAL = 'token_rhine_medical';
const ENERGY = 'token_rhine_energy';
const FLAT_BOUND = 64;
const mayer = (chessId = MAYER, extra = {}) => ({ uid: 1, kind: 'chess', chessId, row: 10, col: 4, dir: 'RIGHT', ...extra });
const device = (extra = {}) => ({ uid: 2, kind: 'token', tokenId: MEDICAL, row: 10, col: 5, research: true, researchKey: 'medical', ...extra });
const selection = (extra = {}) => ({ key: 'medical', tokenId: MEDICAL, uid: 2, onBoard: true, stage: 0, ...extra });

function spec() {
  return {
    kind: 'normal', round: 1, timeLimit: 600, spawns: [], flags: { layerGainsEnabled: true },
    players: [{
      playerId: 'p_0', units: [mayer(), device()],
      bonds: { [RHINE_BOND]: { active: true, count: 3, tier: 1, layers: 0 }, arcaneShip: { active: true, count: 2, tier: 1, layers: 0 } },
      research: { active: true, devices: [selection()] },
    }],
  };
}

function check(s, gains, data = gd) {
  const perPlayer = Object.fromEntries(s.players.map((p) => [p.playerId, {
    killed: 0, total: 0, leaked: [], perfect: true, coins: 0, unitsEnd: [], unitStats: [], layerGains: gains[p.playerId] || {},
  }]));
  return validateClientResult(s, { reason: 'cleared', time: 600, perPlayer }, { gd: data });
}
const ownGains = (s, gains, data) => check(s, { p_0: gains }, data);
function keepsFlatBound(s, label, data) {
  assert.equal(ownGains(s, { [RHINE_BOND]: FLAT_BOUND }, data).ok, true, label);
  assert.deepEqual(ownGains(s, { [RHINE_BOND]: FLAT_BOUND + 1 }, data), { ok: false, reason: 'layer bound' }, label);
}

test('client research gains: normal and elite Mayer with a selected front device can exceed the flat allowance', () => {
  for (const chessId of [MAYER, ELITE]) {
    const s = spec(); s.players[0].units[0] = mayer(chessId);
    assert.equal(ownGains(s, { [RHINE_BOND]: 200 }).ok, true, chessId);
    const garrison = gd.garrison(gd.chess(chessId).garrisonIds[0]);
    assert.equal(garrison.effectKey, 'RHINE_MAYER_RESEARCH');
    assert.equal(garrison.bb.device_layers, chessId === ELITE ? 2 : 1, 'shipped data uses the device-work contract');
  }
  const defaults = spec(); delete defaults.flags;
  assert.equal(ownGains(defaults, { [RHINE_BOND]: 200 }).ok, true, 'normal battles enable gains by default');
});

test('client Mayer allowance follows all four deployment directions', () => {
  for (const [dir, row, col] of [['RIGHT', 10, 5], ['UP', 11, 4], ['LEFT', 10, 3], ['DOWN', 9, 4]]) {
    const s = spec(); s.players[0].units = [mayer(MAYER, { dir }), device({ row, col })];
    assert.equal(ownGains(s, { [RHINE_BOND]: 200 }).ok, true, dir);
  }
});

test('missing Mayer, a missing front device or an adjacent device outside the front tile keeps the old bound', () => {
  const cases = [
    ['no Mayer', (p) => { p.units = p.units.filter((u) => u.kind === 'token'); }],
    ['no device', (p) => { p.units = p.units.filter((u) => u.kind !== 'token'); }],
    ['wrong tile', (p) => { p.units[1].row = 11; p.units[1].col = 4; }],
    ['wrong facing', (p) => { p.units[0].dir = 'LEFT'; }],
    ['wrong token', (p) => { p.units[1].tokenId = ENERGY; }],
    ['not a token', (p) => { p.units[1].kind = 'chess'; }],
  ];
  for (const [label, mutate] of cases) {
    const s = spec(); mutate(s.players[0]); keepsFlatBound(s, label);
  }
});

test('inactive or invalid frozen research cannot authorize extra client layers', () => {
  const cases = [
    ['no research state', (p) => { delete p.research; }],
    ['research inactive', (p) => { p.research.active = false; }],
    ['Rhine inactive', (p) => { p.bonds[RHINE_BOND].active = false; }],
    ['count below threshold', (p) => { p.bonds[RHINE_BOND].count = 2; }],
    ['empty selection', (p) => { p.research.devices = []; }],
    ['reserve device', (p) => { p.research.devices[0].onBoard = false; }],
    ['unknown type', (p) => { p.research.devices[0].key = 'fake'; }],
    ['wrong selected token', (p) => { p.research.devices[0].tokenId = ENERGY; }],
    ['wrong selected uid', (p) => { p.research.devices[0].uid = 30; }],
  ];
  for (const [label, mutate] of cases) {
    const s = spec(); mutate(s.players[0]); keepsFlatBound(s, label);
  }
});

test('research selection capacity and per-type uniqueness also constrain client Mayer allowance', () => {
  const full = spec(), p = full.players[0];
  p.units.push(device({ uid: 3, tokenId: ENERGY, row: 12, col: 5, researchKey: 'energy' }));
  p.research.devices.unshift(selection({ key: 'energy', tokenId: ENERGY, uid: 3 }));
  keepsFlatBound(full, 'the front medical device is outside the one-device capacity');
  p.bonds[RHINE_BOND].count = 6;
  assert.equal(ownGains(full, { [RHINE_BOND]: 200 }).ok, true, 'the second valid selection fits at Rhine six');

  const duplicate = spec(), pp = duplicate.players[0];
  pp.bonds[RHINE_BOND].count = 6;
  pp.units.push(device({ uid: 3, row: 12 }));
  pp.research.devices.unshift(selection({ uid: 3 }));
  keepsFlatBound(duplicate, 'the second medical selection is a duplicate type, even with capacity two');
});

test('Mayer authorization belongs to its own player and never broadens another bond', () => {
  const s = spec();
  assert.equal(ownGains(s, { [RHINE_BOND]: 200, arcaneShip: FLAT_BOUND }).ok, true);
  assert.deepEqual(ownGains(s, { arcaneShip: FLAT_BOUND + 1 }), { ok: false, reason: 'layer bound' });

  const other = structuredClone(s.players[0]); other.playerId = 'p_1';
  s.players.push(other); s.players[0].units = [mayer()]; other.units = [device()];
  assert.deepEqual(check(s, { p_0: { [RHINE_BOND]: 200 } }), { ok: false, reason: 'layer bound' }, 'a teammate device is unavailable');
  assert.deepEqual(check(s, { p_1: { [RHINE_BOND]: 200 } }), { ok: false, reason: 'layer bound' }, 'a teammate Mayer is unavailable');
});

test('device-work allowance requires an actual Mayer and a positive IN_BATTLE trait contract', () => {
  for (const mutate of [
    (data) => { data.garrisons.garrison_rhine_mayer_a.bb.device_layers = 0; },
    (data) => { data.garrisons.garrison_rhine_mayer_a.eventType = 'SERVER_PREP_FIN'; },
    (data) => { data.chess[MAYER].garrisonIds = []; },
    (data) => { data.chess[MAYER].charId = 'char_1047_halo2'; },
    (data) => { delete data.tokens[MEDICAL]; },
  ]) {
    const data = structuredClone(DATA); mutate(data);
    keepsFlatBound(spec(), 'invalid content cannot grant an uncapped research budget', new GameData(data, 'mode_multi_hard'));
  }
});

test('disabled gains and non-normal fields never receive Mayer extra allowance', () => {
  const disabled = spec(); disabled.flags.layerGainsEnabled = false;
  assert.deepEqual(ownGains(disabled, { [RHINE_BOND]: 1 }), { ok: false, reason: 'layers disabled' });
  for (const kind of ['boss', 'hidden', 'unite']) {
    const s = spec(); s.kind = kind;
    keepsFlatBound(s, `${kind} cannot receive extra Mayer allowance even with a forged enabled flag`);
    s.flags.layerGainsEnabled = false;
    assert.deepEqual(ownGains(s, { [RHINE_BOND]: 1 }), { ok: false, reason: 'layers disabled' }, kind);
  }
});

test('multiple Mayers facing one device remain bounded by the room under 999', () => {
  const s = spec(), p = s.players[0];
  p.units.push(mayer(ELITE, { uid: 3, col: 6, dir: 'LEFT' }));
  p.bonds[RHINE_BOND].layers = 17;
  assert.equal(ownGains(s, { [RHINE_BOND]: 982 }).ok, true);
  assert.deepEqual(ownGains(s, { [RHINE_BOND]: 983 }), { ok: false, reason: 'layer bound' });
  p.bonds[RHINE_BOND].layers = 999;
  assert.equal(ownGains(s, { [RHINE_BOND]: 0 }).ok, true);
  assert.deepEqual(ownGains(s, { [RHINE_BOND]: 1 }), { ok: false, reason: 'layer bound' });
});
