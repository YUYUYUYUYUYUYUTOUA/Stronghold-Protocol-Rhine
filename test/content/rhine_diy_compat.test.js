// Rhine chess and upstream DIY operators may share a character/token id, never a kit or owner variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { KITS, kitOf } from '../../server/sim/content/index.js';
import { OPERATOR_KITS } from '../../server/sim/content/kits/index.js';
import RHINE_KITS from '../../server/sim/content/kits/rhine.js';

const TRAP = 'token_10025_doroth_recttp';
const DOROTHY = 'char_4048_doroth';
const ds = getDefaultSource();
const done = (h) => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

test('Rhine and DIY Ifrit/Eunectes/Dorothy resolve separate kits even in the same data profile', () => {
  for (const [name, charId] of [['ifrit', 'char_134_ifrit'], ['eunectes', 'char_416_zumama'], ['dorothy', DOROTHY]]) {
    const rhine = ds.getChess(`chess_rhine_${name}_a`);
    const diy = ds.getDiy('chess_char_6_diy1_a', { charId, skillIndex: 0 });
    assert.equal(kitOf(rhine, KITS), RHINE_KITS[rhine.baseId]);
    assert.equal(kitOf(diy, KITS), OPERATOR_KITS[charId]);
    assert.notEqual(kitOf(rhine, KITS), kitOf(diy, KITS));
  }
});

test('shared Dorothy token id retains Rhine 4/5 limits and every upstream DIY variant including stage-3 TRP-X', () => {
  const raw = ds.rawToken(TRAP);
  for (const [suffix, count] of [['a', 4], ['b', 5]]) {
    const owner = ds.getChess(`chess_rhine_dorothy_${suffix}`);
    assert.equal(ds.getToken(TRAP, owner.id, owner.loadout).raw.variants[owner.id].stats.deployLimit, count);
  }
  for (const [tier, suffix, moduleId, limit] of [[5, 'a', null, 10], [5, 'b', 'uniequip_002_doroth', 10],
    [6, 'a', null, 10], [6, 'b', 'uniequip_003_doroth', 13]]) {
    const owner = ds.getDiy(`chess_char_${tier}_diy1_${suffix}`, { charId: DOROTHY, skillIndex: 2, uniEquipId: moduleId });
    assert.ok(raw.variants[owner.tokenOwner], 'DIY owner variant survives the Rhine token overlay');
    const token = ds.getToken(TRAP, owner.id, owner.loadout);
    const variant = token.raw.variants[owner.tokenOwner];
    assert.equal(variant.byModule?.[moduleId]?.stats?.deployLimit ?? variant.stats.deployLimit, limit);
    assert.equal(token.skill.id, 'sktok_doroth_3');
  }
});

test('Rhine and DIY Dorothy coexist with independently owned traps and research traits', () => {
  const h = makeBattle({ autoFinish: false, flags: { dpInit: 99, dpPerSec: 0 },
    bonds: { rhineShip: { count: 3, layers: 0, active: true } }, units: [
      { uid: 'rhine', chessId: 'chess_rhine_dorothy_a', row: 10, col: 4, skillIndex: 0 },
      { uid: 'diy', diy: { slot: 6, charId: DOROTHY, skillIndex: 0, uniEquipId: 'uniequip_003_doroth' }, elite: true, row: 12, col: 4 },
      { uid: 'rhineTrap', kind: 'token', tokenId: TRAP, ownerUid: 'rhine', row: 9, col: 6 },
      { uid: 'diyTrap', kind: 'token', tokenId: TRAP, ownerUid: 'diy', row: 11, col: 6 },
    ] });
  h.step();
  const rhine = h.unit('rhine'), diy = h.unit('diy');
  assert.equal(rhine.def.raw.garrisonIds.length, 1);
  assert.deepEqual(diy.def.raw.garrisonIds, []);
  assert.equal(diy.trait.doroth.limit, 13);
  assert.equal(h.unit('rhineTrap').ownerUnit, rhine);
  assert.equal(h.unit('rhineTrap').def.raw.variants[rhine.defId].stats.deployLimit, 4);
  assert.equal(h.unit('diyTrap').ownerUnit, diy);
  assert.equal(h.unit('diyTrap').def.raw.variants[diy.def.tokenOwner].byModule.uniequip_003_doroth.stats.deployLimit, 13);
  assert.equal(diy.mem.dorothyStock, undefined, 'the custom stock mechanism never installs on a DIY operator');
  done(h);
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
  const names = { mayer: 'char_242_otter', saria: 'char_202_demkni', ifrit: 'char_134_ifrit' };
  const chess = Object.fromEntries(Object.entries(names).map(([name, charId]) => [`test_${name}_a`, {
    ...chessRec({ id: `test_${name}_a`, charId, skill: null, stats: { blockCnt: 0 } }), garrisonIds: [],
  }]));
  const kits = Object.fromEntries(Object.keys(chess).map(id => [id, () => ({ trait: { noAttack: true }, skill: null })]));
  const h = makeBattle({ autoFinish: false, defs: { chess }, kits, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
    bonds: { rhineShip: { count: 3, layers: 30, active: true } },
    research: { active: true, devices: [{ uid: 'device', key: 'medical', tokenId: 'token_rhine_medical', onBoard: true, stage: 0 }] },
    units: Object.keys(names).map((name, i) => ({ uid: name, chessId: `test_${name}_a`, row: 10 + i, col: 4 })).concat([
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
