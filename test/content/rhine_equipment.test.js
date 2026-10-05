import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { RHINE_BOND, RHINE_CHARACTERS as C, RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { deviceBaseAttack } from '../../server/sim/content/rhine.js';
import { installItem, lendItemEffects, itemGrants } from '../../server/sim/content/items/battle.js';
import { unitBonds } from '../../server/sim/content/support/index.js';
import { DATA } from '../match/harness.js';

const terminal = (q = 'a') => `chess_item_rhine_terminal_${q}`;
const mainframe = (q = 'a') => `chess_item_rhine_mainframe_${q}`;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `expected ${b}, got ${a}`);
const op = (uid, items = [], extra = {}) => ({ uid, chessId: `${uid}_a`, row: 10, col: 4, items, ...extra });
const dev = (key = 'medical', row = 10, col = 5, uid = key) => ({ uid, kind: 'token', tokenId: `token_rhine_${key}`, key, row, col, stage: 0 });
const player = (playerId, units, layers = 50) => ({ playerId, seat: playerId === 'p1' ? 0 : 1, side: 'L', colOffset: 0, units,
  bonds: { [RHINE_BOND]: { count: 6, layers, active: true } },
  research: { active: true, unlocked: true, devices: units.filter((u) => u.kind === 'token').map((d) => ({ ...d, onBoard: true })) },
});
function fight(players) {
  const chess = {}, kits = {};
  for (const p of players) for (const u of p.units) if (u.kind !== 'token' && !u.real) {
    chess[u.chessId] = chessRec({ id: u.chessId, bonds: u.bonds ?? [RHINE_BOND], charId: u.charId ?? 'test',
      golden: u.elite, stats: { maxHp: 2000, atk: 500, blockCnt: 0 }, skill: null });
    kits[u.chessId] = () => ({ trait: { noAttack: true }, skill: null });
  }
  const tokens = Object.fromEntries(RHINE_DEVICES.map((d) => [d.tokenId, { name: d.name, stats: { maxHp: 100, atk: 300, blockCnt: 0 }, rangeGrid: [[0, 0]] }]));
  const h = makeBattle({ players, defs: { chess, tokens }, kits, timeLimit: 999, autoFinish: false });
  h.step(); return h;
}
function valid(h) { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); }

test('Rhine terminal: normal/elite ATK is universal; live complete tens grant owner-active capped ASPD', () => {
  for (const [q, atk, speed, cap] of [['a', 575, 2, 20], ['b', 625, 3, 30]]) {
    const h = fight([player('p1', [op('u', [terminal(q)], { bonds: [] })], 9)]);
    const u = h.unit('u'), bond = h.b.getPlayer('p1').bonds[RHINE_BOND];
    close(u.s.atk, atk); close(u.s.aspd, 100);
    h.b.addLayers('p1', RHINE_BOND, 1, 'test'); h.step(); close(u.s.aspd, 100 + speed);
    bond.layers = 99; h.step(); close(u.s.aspd, 100 + 9 * speed);
    bond.layers = 1000; h.step(); close(u.s.aspd, 100 + cap);
    bond.active = false; h.step(); close(u.s.aspd, 100); close(u.s.atk, atk);
    bond.active = true; h.step(); close(u.s.aspd, 100 + cap);
    valid(h);
  }
});

test('Rhine mainframe: HP qualities, membership, uncapped layer growth and same-carrier pairing', () => {
  for (const [q, hp] of [['a', 2900], ['b', 3400]]) for (const tq of ['a', 'b']) {
    const h = fight([player('p1', [op('m', [mainframe(q)]), op('t', [terminal(tq)], { row: 11 }), dev()])]);
    const m = h.unit('m'), d = h.unit('medical'), bond = h.b.getPlayer('p1').bonds[RHINE_BOND];
    close(m.s.maxHp, hp); close(d.base.atk, 500); // 300 + 150 + 50; a different carrier is not the combo.
    const g = installItem(h.b, m, terminal(tq), { lent: true });
    close(d.base.atk, 550);
    bond.layers = 400; h.step(); close(d.base.atk, 2300); // 300 + 1200 + 800, still growing past 100 layers.
    g.dispose(); close(d.base.atk, 1900); // falls to +400 immediately.
    valid(h);
    const foreign = fight([player('p1', [op('f', [mainframe(q), terminal(tq)], { bonds: [] }), dev()], 400)]);
    close(foreign.unit('medical').base.atk, 1500); close(foreign.unit('f').s.maxHp, hp); valid(foreign);
  }
});

test('Rhine mainframes: strongest only, two devices, independent owners, death/retreat/redeploy', () => {
  const h = fight([player('p1', [op('strong', [mainframe(), terminal()]), op('weak', [mainframe('b')], { row: 11 }),
    dev(), dev('energy', 11, 5)], 400), player('p2', [op('foreign', [mainframe(), terminal('b')], { row: 12 }), dev('medical', 12, 5, 'foreignDevice')], 10)]);
  for (const id of ['medical', 'energy']) close(h.unit(id).base.atk, 2300);
  close(h.unit('foreignDevice').base.atk, 350);
  h.b.kill(h.unit('strong'));
  for (const id of ['medical', 'energy']) close(h.unit(id).base.atk, 1900);
  h.b.retreat(h.unit('weak'), { permanent: true }); close(h.unit('medical').base.atk, 1500);
  assert.equal(h.b.redeploy(h.unit('strong')), true); close(h.unit('medical').base.atk, 2300);
  close(h.unit('foreignDevice').base.atk, 350);
  valid(h);
});

test('Rhine lending: terminal combo expires without residual stats/hooks; existing tier limit excludes VI', () => {
  const h = fight([player('p1', [op('donor', [terminal('b'), mainframe('b')], { row: 11 }), op('borrower', [mainframe()]), dev()], 400)]);
  // Remove the donor from the field but keep its equipment available for the existing lending helper.
  h.b.retreat(h.unit('donor'));
  const u = h.unit('borrower'), baselineHooks = Object.values(h.b._hooks).reduce((n, hs) => n + hs.filter((x) => !x.removed).length, 0);
  close(h.unit('medical').base.atk, 1900); close(u.s.atk, 785);
  assert.equal(lendItemEffects(h.b, h.unit('donor'), u, { duration: 1 }), 1);
  h.step(); close(h.unit('medical').base.atk, 2300); close(u.s.atk, 1056.25); close(u.s.aspd, 130);
  assert.equal(itemGrants(h.b, u).filter((g) => g.lent).length, 1);
  lendItemEffects(h.b, h.unit('donor'), u, { duration: 1 });
  h.run(1.1); close(h.unit('medical').base.atk, 1900); close(u.s.atk, 785); close(u.s.aspd, 100);
  assert.equal(itemGrants(h.b, u).filter((g) => g.lent).length, 0);
  assert.equal(Object.values(h.b._hooks).reduce((n, hs) => n + hs.filter((x) => !x.removed).length, 0), baselineHooks);
  valid(h);
});

test('Rhine mainframe uses transformation membership and removes borrowed aura completely', () => {
  const morph = Object.values(DATA.items).find((it) => it.canGiveBond && !it.isGolden).id;
  const h = fight([player('p1', [op('u', [terminal(), morph], { bonds: [] }), dev()], 400)]);
  const u = h.unit('u'); assert.ok(unitBonds(u).includes(RHINE_BOND));
  close(h.unit('medical').base.atk, 1500);
  const grant = installItem(h.b, u, mainframe(), { lent: true });
  close(h.unit('medical').base.atk, 2300); close(u.s.maxHp, 2900);
  grant.dispose(); close(h.unit('medical').base.atk, 1500); close(u.s.maxHp, 2000);
  valid(h);
});

test('Rhine mainframe: normal plus elite still contributes one aura; generic HP remains additive', () => {
  const h = fight([player('p1', [op('u', [mainframe(), mainframe('b')]), dev()], 400)]);
  close(h.unit('u').s.maxHp, 4300); close(h.unit('medical').base.atk, 1900);
  h.b.getPlayer('p1').bonds[RHINE_BOND].active = false; h.step();
  close(h.unit('medical').base.atk, 300); valid(h);
});

test('Rhine real Ifrit: mainframe bonus is inherited once per device, stable under equipment and external buffs', () => {
  for (const q of ['a', 'b']) {
    const h = fight([player('p1', [op('ifrit', [terminal(q), mainframe(q)], { real: true, chessId: `chess_rhine_ifrit_${q}`, moduleId: 'none' }), dev(), dev('energy', 11, 5)], 400)]);
    const u = h.unit('ifrit'), inherit = 4600 * (q === 'b' ? 0.6 : 0.3), mult = q === 'b' ? 1.25 : 1.15;
    close(h.unit('medical').base.atk, 2300); close(u.findBuff('rhine:ifrit').mods.atkFlat, inherit);
    close(u.s.atk, (u.base.atk + inherit) * mult);
    h.b.addBuff(h.unit('medical'), { key: 'externalDevice', mods: { atkMul: 20, atkFlat: 10000 } });
    h.b.addBuff(u, { key: 'externalIfrit', mods: { atkPct: 0.5 } });
    h.run(10); close(deviceBaseAttack(h.b, h.unit('medical')), 2300);
    close(u.findBuff('rhine:ifrit').mods.atkFlat, inherit); close(u.s.atk, (u.base.atk + inherit) * (mult + 0.5));
    assert.equal(u.buffs.filter((b) => b.key === 'rhine:ifrit').length, 1);
    valid(h);
  }
});

test('Rhine real Ifrit: uncapped inheritance refreshes on borrowed equipment disposal and expiry', () => {
  for (const q of ['a', 'b']) {
    const h = fight([player('p1', [op('ifrit', [], { real: true, chessId: `chess_rhine_ifrit_${q}`, moduleId: 'none' }),
      op('donor', [terminal(q)], { row: 12 }), dev(), dev('energy', 11, 5)], 400)]);
    const u = h.unit('ifrit'), ratio = q === 'b' ? 0.6 : 0.3;
    const inheritance = (deviceAttack) => {
      for (const id of ['medical', 'energy']) close(h.unit(id).base.atk, deviceAttack);
      close(u.findBuff('rhine:ifrit').mods.atkFlat, deviceAttack * 2 * ratio);
      assert.equal(u.buffs.filter((b) => b.key === 'rhine:ifrit').length, 1);
    };
    inheritance(1500);
    const grant = installItem(h.b, u, mainframe(q), { lent: true });
    inheritance(1900);
    assert.equal(lendItemEffects(h.b, h.unit('donor'), u, { duration: 1 }), 1);
    inheritance(2300);
    h.run(1.1); inheritance(1900);
    grant.dispose(); inheritance(1500);
    valid(h);
  }
});
