// Fixed IV Magallan reuses the full native summoner; protocol bonuses stay on the fixed identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { KITS, kitOf } from '../../server/sim/content/index.js';
import { OPERATOR_KITS } from '../../server/sim/content/kits/index.js';
import { deviceBaseAttack } from '../../server/sim/content/rhine.js';
const MG = 'char_248_mgllan';
const DRONES = [1, 2, 3].map(n => `token_10005_mgllan_drone${n}`);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const valid = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };

for (const elite of [false, true]) for (let skillIndex = 0; skillIndex < 3; skillIndex++) {
  for (const moduleId of elite ? [undefined, 'none', 'uniequip_003_mgllan'] : [undefined, 'none']) {
  test(`fixed Magallan S${skillIndex + 1} elite=${elite} ${moduleId ?? 'default'}: native drone and flat research once, no DIY inheritance`, () => {
    const chessId = `chess_rhine_magallan_${elite ? 'b' : 'a'}`, tokenId = DRONES[skillIndex];
    const h = makeBattle({ autoFinish: false, flags: { dpInit: 99, dpPerSec: 0 },
      bonds: { rhineShip: { count: 6, layers: 100, active: true } }, units: [
        { uid: 'fixed', chessId, row: 10, col: 4, skillIndex, moduleId },
        { uid: 'drone', kind: 'token', tokenId, ownerUid: 'fixed', row: 10, col: 5 },
        { uid: 'diy', diy: { slot: 6, charId: MG, skillIndex, uniEquipId: null }, row: 11, col: 4 },
        { uid: 'diyDrone', kind: 'token', tokenId, ownerUid: 'diy', row: 11, col: 5 },
      ] });
    h.step();
    const owner = h.unit('fixed'), drone = h.unit('drone'), diy = h.unit('diy'), diyDrone = h.unit('diyDrone');
    assert.equal(kitOf(owner.def, KITS), OPERATOR_KITS[MG]);
    assert.equal(owner.skill.id, `skchr_mgllan_${skillIndex + 1}`);
    assert.equal(owner.kit.skillSource, 'skills');
    assert.equal(drone.ownerUnit, owner);
    assert.ok(drone.alive && drone.deployed && diyDrone.alive, 'selected native drones actually enter battle');
    assert.ok(h.b.producesToken(owner, tokenId));
    assert.ok(owner.mem.summonDeck && drone.s.flags.noHeal);
    assert.equal(owner.mem.dorothyStock, undefined);
    const bonus = elite ? 200 : 100;
    close(owner.findBuff('rhine:magallan').mods.atkFlat, bonus);
    close(drone.findBuff('rhine:magallan').mods.atkFlat, bonus);
    close(drone.s.atk, drone.base.atk + bonus);
    assert.ok(!diy.findBuff('rhine:magallan') && !diyDrone.findBuff('rhine:magallan'));
    h.b.getPlayer('p1').bonds.rhineShip.layers = 200; h.step();
    close(drone.s.atk, drone.base.atk + 2 * bonus);
    if (skillIndex === 2) {
      owner.skill.addCharge(1); assert.equal(owner.skill.activate('test'), true);
      const nativeScale = 1 + drone.findBuff('mgllan:s3:drone').mods.atkPct;
      close(drone.s.atk, (drone.base.atk + 2 * bonus) * nativeScale);
      owner.skill.end('test'); h.step();
      // The native end-of-skill recall is allowed; the passive itself must never stack on redeploy.
      h.b.redeploy(drone, { free: true }); h.step();
      close(drone.findBuff('rhine:magallan').mods.atkFlat, 2 * bonus);
    }
    h.b.getPlayer('p1').bonds.rhineShip.active = false; h.step();
    close(owner.findBuff('rhine:magallan').mods.atkFlat, 0);
    close(drone.s.atk, drone.base.atk);
    h.b.retreat(owner); assert.ok(!drone.alive, 'native drones leave with their summoner');
    assert.ok(diyDrone.alive, 'other summoner retains its drone');
    assert.deepEqual(h.result().perPlayer.p1.layerGains, {}, 'deploy, cast, recall and retreat produce no research'); valid(h);
  });
  }
}

test('Magallan device bonus takes strongest living local copy and never feeds shared ATK back', () => {
  const units = (suffix, row) => [
    { uid: `m${suffix}`, chessId: `chess_rhine_magallan_${suffix}`, row, col: 4 },
    { uid: `d${suffix}`, kind: 'token', tokenId: 'token_rhine_medical', row, col: 5 },
  ];
  const h = makeBattle({ autoFinish: false, players: [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: { rhineShip: { count: 6, layers: 100, active: true } },
      research: { active: true, devices: [{ uid: 'da', key: 'medical', tokenId: 'token_rhine_medical', onBoard: true, stage: 0 }] },
      units: [...units('a', 10), { uid: 'elite', chessId: 'chess_rhine_magallan_b', row: 9, col: 4 }] },
    { playerId: 'p2', seat: 1, side: 'L', colOffset: 0, bonds: { rhineShip: { count: 6, layers: 200, active: true } },
      research: { active: true, devices: [{ uid: 'db', key: 'medical', tokenId: 'token_rhine_medical', onBoard: true, stage: 0 }] },
      units: units('b', 11) },
  ] });
  h.step(); close(deviceBaseAttack(h.b, h.unit('da')), 800); close(deviceBaseAttack(h.b, h.unit('db')), 1300);
  h.run(3); close(deviceBaseAttack(h.b, h.unit('da')), 800);
  h.b.retreat(h.unit('elite')); h.step();
  close(deviceBaseAttack(h.b, h.unit('da')), 750); close(deviceBaseAttack(h.b, h.unit('db')), 1300);
  h.b.retreat(h.unit('ma')); h.step(); close(deviceBaseAttack(h.b, h.unit('da')), 700);
  valid(h);
});

test('Magallan fixed and DIY token variants coexist in the same datasource', () => {
  const ds = getDefaultSource();
  for (const suffix of ['a', 'b']) for (let skillIndex = 0; skillIndex < 3; skillIndex++) {
    const fixed = ds.getChess(`chess_rhine_magallan_${suffix}`, { skillIndex });
    const diy = ds.getDiy(`chess_char_6_diy1_${suffix}`, { charId: MG, skillIndex });
    for (const owner of [fixed, diy]) {
      const token = ds.getToken(DRONES[skillIndex], owner.id, owner.loadout);
      assert.ok(token && token.stats.atk >= 0);
    }
  }
});
