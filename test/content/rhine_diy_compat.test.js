// Rhine chess and upstream DIY operators may share a character/token id, never a kit or owner variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { KITS, kitOf } from '../../server/sim/content/index.js';
import { OPERATOR_KITS } from '../../server/sim/content/kits/index.js';
import RHINE_KITS from '../../server/sim/content/kits/rhine.js';

const ds = getDefaultSource();
const done = (h) => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

test('Rhine and DIY Ifrit/Eunectes resolve separate kits even in the same data profile', () => {
  for (const [name, charId] of [['ifrit', 'char_134_ifrit'], ['eunectes', 'char_416_zumama']]) {
    const rhine = ds.getChess(`chess_rhine_${name}_a`);
    const diy = ds.getDiy('chess_char_6_diy1_a', { charId, skillIndex: 0 });
    assert.equal(kitOf(rhine, KITS), RHINE_KITS[rhine.baseId]);
    assert.equal(kitOf(diy, KITS), OPERATOR_KITS[charId]);
    assert.notEqual(kitOf(rhine, KITS), kitOf(diy, KITS));
  }
});

test('only the Rhine Ifrit card inherits research device attack; upstream DIY remains without protocol traits', () => {
  const h = makeBattle({ autoFinish: false, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
    bonds: { rhineShip: { count: 3, layers: 50, active: true } },
    research: { active: true, devices: [{ uid: 'device', key: 'medical', tokenId: 'token_rhine_medical', onBoard: true, stage: 0 }] },
    units: [
      { uid: 'rhine', chessId: 'chess_rhine_ifrit_a', row: 10, col: 4 },
      { uid: 'diy', chessId: 'chess_char_6_diy1_a', diy: { charId: 'char_134_ifrit', skillIndex: 1 }, row: 11, col: 4 },
      { uid: 'device', kind: 'token', tokenId: 'token_rhine_medical', row: 10, col: 5 },
    ] }] });
  h.step();
  const rhine = h.unit('rhine'), diy = h.unit('diy');
  assert.equal(rhine.s.atk - rhine.base.atk, 500);
  assert.equal(diy.s.atk, diy.base.atk);
  assert.ok(!diy.findBuff('rhine:ifrit'));
  done(h);
});

test('normal and elite Saria stand-ins retain the protocol healing trait on Tuye body and kit', () => {
  for (const [suffix, expected] of [['a', 1.1], ['b', 1.2]]) {
    const h = makeBattle({ autoFinish: false, bonds: { rhineShip: { count: 3, layers: 30, active: true } },
      units: [{ uid: 'saria', chessId: `chess_char_5_11_${suffix}`, row: 10, col: 4 },
        { uid: 'standin', chessId: `chess_char_5_11_${suffix}`, standIn: true, row: 11, col: 4 }] });
    h.step();
    const source = h.unit('saria'), replacement = h.unit('standin');
    assert.equal(replacement.def.charId, 'char_613_acmedc');
    assert.equal(replacement.def.standInFor, 'char_202_demkni');
    assert.deepEqual(replacement.def.raw.garrisonIds, source.def.raw.garrisonIds);
    assert.equal(replacement.findBuff('rhine:saria').mods.healingDealtMul, expected);
    assert.equal(replacement.s.healingDealtMul, source.s.healingDealtMul);
    h.b.getPlayer('p1').bonds.rhineShip.active = false;
    h.step();
    assert.equal(replacement.findBuff('rhine:saria').mods.healingDealtMul, 1);
    done(h);
  }
});

test('a matching character name alone never grants Mayer, Saria or Ifrit protocol effects', () => {
  const names = { magallan: 'char_248_mgllan', mayer: 'char_242_otter', saria: 'char_202_demkni', ifrit: 'char_134_ifrit' };
  const chess = Object.fromEntries(Object.entries(names).map(([name, charId]) => [`test_${name}_a`, {
    ...chessRec({ id: `test_${name}_a`, charId, skill: null, stats: { blockCnt: 0 } }), garrisonIds: [],
  }]));
  const kits = Object.fromEntries(Object.keys(chess).map(id => [id, () => ({ trait: { noAttack: true }, skill: null })]));
  const h = makeBattle({ autoFinish: false, defs: { chess }, kits, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
    bonds: { rhineShip: { count: 3, layers: 30, active: true } },
    research: { active: true, devices: [{ uid: 'device', key: 'medical', tokenId: 'token_rhine_medical', onBoard: true, stage: 0 }] },
    units: Object.keys(names).map((name, i) => ({ uid: name, chessId: `test_${name}_a`, row: 9 + i, col: 4 })).concat([
      { uid: 'device', kind: 'token', tokenId: 'token_rhine_medical', row: 10, col: 5 },
    ]),
  }] });
  h.step();
  assert.ok(!h.unit('saria').findBuff('rhine:saria'));
  assert.ok(!h.unit('ifrit').findBuff('rhine:ifrit'));
  h.unit('mayer').hp = 100;
  h.step(90);
  assert.ok(h.unit('mayer').hp > 100, 'the selected device completed effective work');
  assert.equal(h.b.getPlayer('p1').bonds.rhineShip.layers, 30, 'a namesake without the trait earns no layers');
  done(h);
});
