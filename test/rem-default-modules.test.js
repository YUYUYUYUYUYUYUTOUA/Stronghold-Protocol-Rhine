// Generated defaults feed the existing sparse browser/server loadout paths; no preference migration may overwrite a pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REM_ADDITIONS } from '../tools/rem-data.mjs';
import { loadoutOptions, checkLoadout, resolveLoadout } from '../shared/protocol.js';
import { composeStats, composeTalents } from '../shared/loadoutRecord.js';
import { atPotential } from '../shared/potential.js';
import { getDefaultSource } from '../server/sim/simdata.js';
import {
  parseStored, toStored, effectiveChoice, setChoice, resetChoice, sanitizeEntries,
} from '../public/js/ui/loadoutModel.js';
import { makeBattle, checkInvariants } from './helpers/battleHarness.js';
import { makeMatch } from './match/harness.js';

const source = getDefaultSource(), C = source.raw.chess;
const get = id => Object.hasOwn(C, id) ? C[id] : null;
const members = Object.values(C).filter(c => !c.isGolden && c.visible && c.bonds.includes('remShip'));
const defaults = {
  jcinta: 'uniequip_002_jcinta', glider: 'uniequip_002_glider', aprl: 'uniequip_002_aprl',
  warmy: 'uniequip_002_warmy', tmslot: 'uniequip_002_tmslot', savage: 'uniequip_002_savage',
  asbest: 'uniequip_002_asbest', thumpy: 'uniequip_002_thumpy', ray: 'uniequip_002_ray',
};
const record = (key, elite = false) => C[`chess_rem_${key}_${elite ? 'b' : 'a'}`];

test('all eleven Rem members have one supported elite module default; nine additions use ordinary 002 at their existing grade', () => {
  assert.equal(members.length, 11);
  for (const base of members) {
    const elite = C[base.goldenId], selected = elite.modules.filter(m => m.isDefault);
    assert.equal(selected.length, 1, base.name);
    assert.equal(elite.module.active, true, base.name);
    assert.equal(elite.module.id, selected[0].uniEquipId, base.name);
    assert.equal(loadoutOptions(base, elite).defaultModule, selected[0].uniEquipId, base.name);
    assert.equal(base.module?.active ?? false, false, `${base.name}: normal form keeps the global no-module rule`);
  }
  for (const spec of REM_ADDITIONS) {
    const elite = record(spec.key, true);
    assert.equal(elite.module.id, defaults[spec.key]);
    assert.equal(elite.module.level, spec.key === 'ray' ? 3 : 1);
    assert.equal(elite.modules.find(m => m.isDefault).isSpecialEquip ?? false, false);
  }
  assert.equal(C.chess_char_3_02_b.module.id, 'uniequip_002_ayer', 'Ayerscarpe already had the correct default');
  assert.equal(C.chess_char_4_14_b.module.id, 'uniequip_002_lionhd', 'Leonhardt already had the correct default');
});

test('new-player, missing-field and per-operator reset paths take the data default without filling saved preferences', () => {
  const empty = parseStored(null);
  assert.deepEqual(empty, {});
  for (const base of members) {
    const elite = C[base.goldenId], opt = loadoutOptions(base, elite);
    assert.equal(effectiveChoice(empty, base, elite).module, opt.defaultModule);
    assert.equal(resolveLoadout({}, elite, get).moduleId, opt.defaultModule);
    const custom = setChoice({}, base, elite, { module: 'none' });
    assert.equal(effectiveChoice(custom, base, elite).module, 'none');
    const reset = resetChoice(custom, base.chessId);
    assert.deepEqual(reset, {});
    assert.equal(effectiveChoice(reset, base, elite).module, opt.defaultModule);
    assert.equal(resolveLoadout(checkLoadout(reset, get).loadout, elite, get).moduleId, opt.defaultModule);
    assert.equal(effectiveChoice({ [base.chessId]: { skill: 0 } }, base, elite).module, opt.defaultModule);
  }
  assert.deepEqual(empty, {}, 'defaults never mutate or manufacture browser preference entries');
});

test('stored explicit none, alternate Ray module and non-default skills survive parsing, sanitising and server validation', () => {
  const entries = Object.fromEntries(REM_ADDITIONS.map(spec => [record(spec.key).chessId, { skill: 0, module: 'none' }]));
  entries.chess_rem_ray_a.module = 'uniequip_003_ray';
  const stored = toStored(entries, { char_4117_ray: { potential: 2, cultivate: 1 } });
  const serialized = JSON.stringify(stored), parsed = parseStored(JSON.parse(serialized));
  const clean = sanitizeEntries(parsed, get), checked = checkLoadout(clean, get);
  assert.equal(checked.ok, true);
  for (const [id, choice] of Object.entries(entries)) {
    const elite = C[C[id].goldenId];
    assert.deepEqual(effectiveChoice(clean, C[id], elite), { ...choice, changed: true });
    assert.deepEqual(resolveLoadout(checked.loadout, elite, get), { skillIndex: 0, moduleId: choice.module });
    const def = source.getChess(elite.chessId, resolveLoadout(checked.loadout, elite, get));
    assert.equal(def.raw.module.active, choice.module !== 'none');
    assert.equal(def.raw.module.id, choice.module === 'none' ? null : choice.module);
  }
  assert.equal(JSON.stringify(stored), serialized, 'the existing saved data and per-operator settings remain untouched');
});

test('module-less operators and normal chess remain module-less when using or resetting the same helpers', () => {
  for (const id of ['chess_char_2_13_a', 'chess_char_5_14_a']) {
    const base = C[id], elite = C[base.goldenId];
    assert.deepEqual(elite.modules, []);
    assert.deepEqual(loadoutOptions(base, elite).modules, ['none']);
    assert.equal(effectiveChoice(resetChoice({ [id]: { skill: 0 } }, id), base, elite).module, 'none');
    assert.equal(source.getChess(elite.chessId).raw.module.active, false);
  }
  for (const base of members) assert.equal(resolveLoadout({ [base.chessId]: { module: 'none' } }, base, get).moduleId, null);
});

test('default module stats, trait and talents compose correctly at all six potentials, including explicit no-module choices', () => {
  for (const spec of REM_ADDITIONS) for (let potential = 1; potential <= 6; potential++) {
    const elite = atPotential(record(spec.key, true), potential);
    const mod = elite.modules.find(m => m.isDefault);
    assert.deepEqual(elite.stats, composeStats(elite.statsBase, mod.attr), `${spec.key} P${potential}: stats`);
    assert.deepEqual(elite.trait, mod.traitOverride || elite.traitBase, `${spec.key} P${potential}: trait`);
    // Both generated and runtime composition resolve the potential before merging module talent upgrades.
    const expectedTalents = composeTalents(elite.talentsBase, mod.talentChanges);
    assert.deepEqual(elite.talents.map(({ potMin: _m, potBelow: _b, ...t }) => t), expectedTalents,
      `${spec.key} P${potential}: talents`);
    const selected = source.getChess(elite.chessId, { potential });
    const none = source.getChess(elite.chessId, { potential, moduleId: 'none' });
    assert.equal(selected.loadout.moduleId, defaults[spec.key]);
    assert.equal(selected.raw.module.active, true);
    assert.equal(none.raw.module.active, false);
    assert.deepEqual(none.raw.stats, elite.statsBase);
  }
});

test('Ray HUN-X default follows the real sandbeast while saved HUN-Y and none keep their own summon stats at every potential', () => {
  const id = 'chess_rem_ray_b', token = 'token_10034_ray_sndbst';
  assert.deepEqual(C[id].modules.map(m => m.uniEquipId), ['uniequip_002_ray', 'uniequip_003_ray']);
  for (let potential = 1; potential <= 6; potential++) {
    const def = source.getChess(id, { potential });
    assert.equal(def.traitBb.extra_add, 1);
    assert.equal(source.getToken(token, id, { potential }).stats.respawnTime, 20);
    for (const moduleId of ['none', 'uniequip_003_ray']) {
      assert.equal(source.getToken(token, id, { potential, moduleId }).stats.respawnTime, 30);
      assert.equal(source.getChess(id, { potential, moduleId }).traitBb.extra_add ?? 0, 0);
    }
    assert.equal(source.getChess(id, { potential, moduleId: 'uniequip_003_ray' }).traitBb.atk_scale, 1.33);
  }
});

test('new seats and bots emit elite defaults; existing saved selections are retained in the actual battle-input path', () => {
  const explicit = { chess_rem_jcinta_a: { module: 'none' }, chess_rem_ray_a: { module: 'uniequip_003_ray' } };
  const h = makeMatch({ mode: 'coop', clients: false, seed: 31, seats: [
    { seat: 0, playerId: 'new', name: 'New', connected: true },
    { seat: 1, playerId: 'saved', name: 'Saved', connected: true, loadout: explicit },
    { seat: 2, playerId: 'bot', name: 'Bot', connected: true, isBot: true, loadout: explicit },
  ] }).start();
  try {
    h.toPrep(1);
    for (const id of ['new', 'saved', 'bot']) {
      const ps = h.ps(id);
      ps.board.clear();
      for (const [col, chessId] of [[4, 'chess_rem_jcinta_b'], [5, 'chess_rem_ray_b']]) {
        ps.board.set(`10,${col}`, ps.newPiece('chess', chessId));
      }
      const units = ps.battleInput().units;
      assert.equal(units.find(u => u.chessId === 'chess_rem_jcinta_b').moduleId, id === 'saved' ? 'none' : 'uniequip_002_jcinta');
      assert.equal(units.find(u => u.chessId === 'chess_rem_ray_b').moduleId, id === 'saved' ? 'uniequip_003_ray' : 'uniequip_002_ray');
    }
    assert.deepEqual(h.logs.error, []);
  } finally { h.m.dispose(); }
});

test('Asbestos Solo membership counts identities across both grades and disables with a second distinct Solo operator', () => {
  const h = makeMatch({ mode: 'solo', clients: false, seed: 31 }).start();
  try {
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.board.clear();
    const put = (id, col) => ps.board.set(`10,${col}`, ps.newPiece('chess', id));
    put('chess_rem_asbest_a', 4); ps.recompute();
    assert.equal(ps.bonds.soloShip.count, 1);
    assert.equal(ps.bonds.soloShip.active, true);
    assert.equal(ps.bonds.steadShip?.count ?? 0, 0);
    put('chess_rem_asbest_b', 5); ps.recompute();
    assert.equal(ps.bonds.soloShip.count, 1, 'normal and elite Asbestos share one identity');
    assert.equal(ps.bonds.soloShip.active, true);
    put('chess_rhine_eunectes_a', 6); ps.recompute();
    assert.equal(ps.bonds.soloShip.count, 2);
    assert.equal(ps.bonds.soloShip.active, false);
    assert.deepEqual(h.logs.error, []);
  } finally { h.m.dispose(); }
});

for (const elite of [false, true]) test(`Asbestos ${elite ? 'elite' : 'normal'} actually receives Solo ATK/HP/SP while retaining her native kit`, () => {
  const id = `chess_rem_asbest_${elite ? 'b' : 'a'}`;
  const h = makeBattle({ units: [{ uid: 'asbest', chessId: id, row: 10, col: 5 }],
    bonds: { soloShip: { active: true, tier: 1, count: 1, layers: 0 } } });
  h.step();
  const u = h.unit('asbest');
  assert.ok(Math.abs(u.s.atk - u.base.atk * 1.6) < 1e-6);
  assert.ok(Math.abs(u.s.maxHp - u.base.maxHp * 1.6) < 1e-6);
  assert.ok(u.skill.sp >= C[id].skill.initSp + 15 && u.skill.sp < C[id].skill.initSp + 15.1);
  assert.equal(u.kit.generic, undefined);
  assert.equal(u.skill.id, 'skchr_asbest_2');
  assert.equal(u.def.raw.garrisonIds[0], `garrison_rem_asbest_${elite ? 'b' : 'a'}`);
  assert.deepEqual(h.b.errors, []);
  checkInvariants(h.b);
});
