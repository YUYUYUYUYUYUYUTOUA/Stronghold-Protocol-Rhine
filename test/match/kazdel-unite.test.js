import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { DataSource } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec, compactResult, resultDigest } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { isBattleResult } from '../../shared/protocol.js';

const data = getData({ log: { warn() {}, error() {}, info() {} } });
const gd = new GameData(data, 'mode_multi_normal'), ds = new DataSource(data);
const player = (playerId, count = 6) => ({ playerId, seat: playerId === 'p1' ? 0 : 1,
  bonds: { kazdelShip: { active: true, count, layers: 10 } },
  units: [{ uid: 1, kind: 'chess', chessId: 'chess_kazdel_meteorite_a', row: 10, col: 4, items: [] }] });
const specOf = (players, kind = 'normal') => buildBattleSpec({ kind, seed: 17, stageId: 'act2autochess_m01',
  modeId: 'mode_multi_normal', round: 3, timeLimit: 120, players, spawns: [], flags: { layerGainsEnabled: false } });

test('living Kazdel souls survive result validation and a two-owner unite transition, then leave on real body return', () => {
  for (const count of [3, 6, 9]) for (const client of [false, true]) {
    const results = new Map();
    const helpers = ['p1', 'p2'].map((pid) => {
      const input = player(pid, count);
      if (count === 9) input.units[0].chessId = 'chess_char_3_02_a'; // Non-Kazdel native kit at the expanded threshold.
      const spec = specOf([input]);
      const b = createBattleFromSpec(spec, ds); b.start();
      const body = b.getPlayer(pid).units[0]; b.kill(body);
      const soul = body.kazdelSoulUnit;
      assert.ok(soul?.alive); soul.hp = soul.s.maxHp * 0.4; soul.skill.setSpTotal(7);
      b.forceEnd();
      assert.equal(soul.alive, false, 'old battlefield still cleans up');
      const raw = b.result();
      assert.equal(isBattleResult(compactResult(raw)), true);
      const checked = validateClientResult(spec, compactResult(raw), { gd });
      assert.equal(checked.ok, true, checked.reason);
      const result = client ? checked.result : raw;
      assert.deepEqual(result.perPlayer[pid].unitsEnd[0].kazdelSoul, { hpPct: 0.4, sp: 7 });
      assert.equal(resultDigest(raw).hash, resultDigest(compactResult(raw)).hash);
      results.set(pid, result.perPlayer[pid]);
      return { playerId: pid, board: new Map([['10,4', { uid: 1, kind: 'chess' }]]),
        battleInput: ({ colOffset, carry }) => ({ ...input, colOffset,
          units: input.units.map(u => ({ ...u, carryState: carry.get(u.uid) })) }) };
    });
    const { players } = uniteBattleOpts({ gd, round: 3, lastResults: results, dispatch() {} }, { helpers, leaked: [] }, 120);
    const spec = specOf(players, 'unite');
    const b = createBattleFromSpec(spec, ds); b.start();
    for (const pid of ['p1', 'p2']) {
      const body = b.getPlayer(pid).units.find(u => u.kind === 'op'), soul = body.kazdelSoulUnit;
      assert.equal(body.alive, false);
      assert.ok(soul?.alive && soul.deployed, `${pid}: soul restored after forced exit`);
      assert.equal(soul.ownerId, pid); assert.equal(soul.ownerUnit, body);
      assert.equal(soul.tileC, body.tileC);
      assert.equal(body.tileC, pid === 'p1' ? 12 : 4, 'each helper uses its new half of the field');
      assert.ok(Math.abs(soul.hp / soul.s.maxHp - 0.4) < 1e-9);
      assert.equal(soul.skill.spTotal, 7);
      assert.ok(b.fieldMeta().units.some(u => u.id === soul.id && u.kazdelSoul && u.ownerId === pid));
      assert.ok(b.snapshot().units.some(u => u[0] === soul.id));
      assert.deepEqual(b.result().perPlayer[pid].layerGains, {});
      assert.equal(b.snapshot().kazdel.find(s => s.ownerId === pid).charge, 0);
      assert.equal(b.redeploy(body), true);
      assert.equal(soul.alive, false, 'a real return removes only its own soul');
      b.kill(body);
      assert.ok(body.kazdelSoulUnit.alive);
      assert.notEqual(body.kazdelSoulUnit, soul);
    }
    b.forceEnd();
    assert.ok(b.allyUnits.filter(u => u.kazdelSoul).every(u => !u.alive));
    assert.equal(b.errorCount, 0);
  }
});

test('dead souls and living bodies are not carried; reports cannot attach a soul to an ineligible body', () => {
  const input = player('p1'), spec = specOf([input]);
  const b = createBattleFromSpec(spec, ds); b.start();
  const body = b.allyUnits[0];
  assert.equal(b.result().perPlayer.p1.unitsEnd[0].kazdelSoul, undefined);
  b.kill(body); b.kill(body.kazdelSoulUnit); b.forceEnd();
  const raw = compactResult(b.result());
  assert.equal(raw.perPlayer.p1.unitsEnd[0].kazdelSoul, undefined);
  const report = (patch = {}) => {
    const r = structuredClone(raw);
    Object.assign(r.perPlayer.p1.unitsEnd[0], { kazdelSoul: { hpPct: 0.5, sp: 3 } }, patch);
    return r;
  };
  for (const soul of [{ hpPct: 0, sp: 0 }, { hpPct: 1.01, sp: 0 }, { hpPct: 0.5, sp: -1 }, { hpPct: NaN, sp: 0 }]) {
    assert.equal(isBattleResult(report({ kazdelSoul: soul })), false);
    assert.equal(validateClientResult(spec, report({ kazdelSoul: soul }), { gd }).ok, false);
  }
  assert.equal(validateClientResult(spec, report({ alive: true, hpPct: 1 }), { gd }).ok, false);
  const inactive = structuredClone(spec); inactive.players[0].bonds.kazdelShip.active = false;
  assert.equal(validateClientResult(inactive, report(), { gd }).ok, false);
  const foreign = structuredClone(spec); foreign.players[0].units[0].chessId = 'chess_char_3_02_a';
  assert.equal(validateClientResult(foreign, report(), { gd }).ok, false);
  assert.notEqual(resultDigest(raw).hash, resultDigest(report()).hash, 'verification includes the soul state');
  const unite = createBattleFromSpec(specOf([{ ...input, units: input.units.map(u => ({ ...u, carryState: { down: true } })) }], 'unite'), ds);
  unite.start();
  assert.equal(unite.allyUnits.some(u => u.kazdelSoul), false, 'forced exit does not invent a dead soul');
});

test('active Harmony souls follow the same eligibility as native Kazdel members', () => {
  const input = player('p1');
  input.units[0].chessId = 'chess_char_1_15_a';
  input.bonds.maniShip = { active: true, count: 1, layers: 0 };
  const spec = specOf([input]), b = createBattleFromSpec(spec, ds); b.start();
  const body = b.allyUnits[0]; b.kill(body);
  assert.ok(body.kazdelSoulUnit?.alive);
  b.forceEnd();
  const report = compactResult(b.result());
  assert.equal(validateClientResult(spec, report, { gd }).ok, true);
  const state = report.perPlayer.p1.unitsEnd[0].kazdelSoul;
  const carried = structuredClone(input); carried.units[0].carryState = { down: true, kazdelSoul: state };
  const next = createBattleFromSpec(specOf([carried], 'unite'), ds); next.start();
  assert.ok(next.allyUnits[0].kazdelSoulUnit?.alive);
  spec.players[0].bonds.maniShip.active = false;
  assert.equal(validateClientResult(spec, report, { gd }).ok, false);
});
