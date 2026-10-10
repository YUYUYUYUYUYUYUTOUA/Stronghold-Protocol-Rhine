import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { validateClientResult } from '../../server/match/fields.js';
import { DataSource } from '../../server/sim/simdata.js';
import { compactResult, createBattleFromSpec } from '../../server/sim/spec.js';

const data = getData({ log: { warn() {}, error() {}, info() {} } });
const gd = new GameData(data, 'mode_multi_normal');
function spec(chessId) {
  return { kind: 'normal', round: 1, timeLimit: 600, spawns: [], flags: { layerGainsEnabled: true },
    players: [{ playerId: 'p_0', units: [{ uid: 1, kind: 'chess', chessId, row: 10, col: 4 }],
      bonds: { kazdelShip: { active: true, count: 3, layers: 0 }, steadShip: { active: true, count: 2, layers: 0 },
        skillfulShip: { active: true, count: 2, layers: 0 } } }] };
}
function check(s, gains) {
  return validateClientResult(s, { reason: 'cleared', time: 600, perPlayer: {
    p_0: { killed: 0, total: 0, leaked: [], perfect: true, coins: 0, unitsEnd: [], unitStats: [], layerGains: gains },
  } }, { gd });
}

test('Odda and Hoederer accept uncapped gains only for their own active target bonds', () => {
  for (const grade of ['a', 'b']) {
    const odda = spec(`chess_kazdel_odd_${grade}`);
    assert.equal(check(odda, { kazdelShip: 400, steadShip: 400 }).ok, true);
    assert.equal(check(odda, { skillfulShip: 65 }).ok, false, 'another bond keeps its flat allowance');
    odda.players[0].bonds.kazdelShip.active = false;
    assert.equal(check(odda, { kazdelShip: 65 }).ok, false, 'inactive targets get no extra allowance');
    assert.equal(check(odda, { steadShip: 400 }).ok, true);
    const hoederer = spec(`chess_kazdel_hoederer_${grade}`);
    assert.equal(check(hoederer, { kazdelShip: 400 }).ok, true);
    assert.equal(check(hoederer, { steadShip: 65 }).ok, false);
  }
});

test('Kazdel allowances preserve the shared cap, field restrictions and boards without the trait', () => {
  const s = spec('chess_kazdel_odd_b');
  s.players[0].bonds.kazdelShip.layers = 900;
  assert.equal(check(s, { kazdelShip: 99 }).ok, true);
  assert.equal(check(s, { kazdelShip: 100 }).ok, false);
  for (const kind of ['unite', 'boss', 'hidden']) {
    const field = spec('chess_kazdel_odd_b'); field.kind = kind;
    assert.equal(check(field, { steadShip: 400 }).ok, false, kind);
  }
  const disabled = spec('chess_kazdel_odd_b'); disabled.flags.layerGainsEnabled = false;
  assert.equal(check(disabled, { steadShip: 1 }).ok, false);
  assert.equal(check(spec('chess_kazdel_logos_a'), { kazdelShip: 65 }).ok, false);
});

test('real four-player FUNNY seed 113 R13 Odda result survives client validation', () => {
  const s = JSON.parse(readFileSync(new URL('../fixtures/kazdel-odda-r13.json', import.meta.url)));
  const battle = createBattleFromSpec(s, new DataSource(data));
  for (let i = 0; i < 30000 && !battle.finished; i++) battle.step();
  assert.equal(battle.finished, true);
  const result = compactResult(battle.result());
  assert.equal(result.errors, 0);
  assert.ok(result.perPlayer.p_1.layerGains.kazdelShip > 60 + 4 * s.round);
  assert.equal(validateClientResult(s, result, { gd: new GameData(data, s.modeId) }).ok, true);
});

test('Ascalon client layer allowance is confined to its active Kazdel bond and normal battles', () => {
  for (const grade of ['a', 'b']) {
    const s = spec(`chess_kazdel_ascalon_${grade}`);
    assert.equal(check(s, { kazdelShip: 200 }).ok, true);
    assert.equal(check(s, { steadShip: 65 }).ok, false);
    s.players[0].bonds.kazdelShip.active = false;
    assert.equal(check(s, { kazdelShip: 65 }).ok, false);
    for (const kind of ['unite', 'boss', 'hidden']) {
      const other = spec(`chess_kazdel_ascalon_${grade}`); other.kind = kind;
      assert.equal(check(other, { kazdelShip: 200 }).ok, false);
    }
  }
});
