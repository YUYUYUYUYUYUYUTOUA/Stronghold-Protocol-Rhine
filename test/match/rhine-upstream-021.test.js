import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataProfile } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, legalTileFor } from './harness.js';

const SLOT = 'chess_char_5_diy1_a';
const DOROTHY = 'char_4048_doroth';
const TRAP = 'token_10025_doroth_recttp';
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
const profiles = [['Rhine', DATA], ['vanilla', getDataProfile(false, { log: QUIET })]];

for (const [profile, data] of profiles) {
  test(`${profile}: six-seat leader HP uses the surviving four-seat baseline exactly once under 0.2.1`, () => {
    const modeId = 'mode_multi_hard';
    const six = new GameData(data, modeId, 6);
    const four = new GameData(data, modeId, 4);
    const base = data.bosses.boss_1.bloodPoint.HARD;
    for (const alive of [1, 2, 3, 4, 5, 6]) {
      assert.equal(six.bossPoolHp('boss_1', alive), base * Math.min(alive, 4) * 2);
      assert.equal(six.bossPoolHp('boss_1', alive), four.bossPoolHp('boss_1', Math.min(alive, 4)) * 2);
    }
    assert.equal(six.bossPoolHp('boss_1'), base * 8);
    for (const [scale, expected] of [[{ perPlayer: false }, 2], [{ perPlayer: false, aliveScaling: true }, 1.5]]) {
      const fixed = new GameData({ ...data, config: { ...data.config, modes: { ...data.config.modes, [modeId]: { ...data.config.modes[modeId], bossHpScale: scale } } } }, modeId, 6);
      assert.equal(fixed.bossPoolShare(3), expected, 'explicit fixed-pool settings retain the six-seat modifier');
    }
  });

  test(`${profile}: DIY Dorothy keeps upstream traps and no Rhine trait while the regular roster remains separate`, () => {
    const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [SLOT]: { charId: DOROTHY, skillIndex: 2, uniEquipId: 'uniequip_002_doroth' } } }];
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', data, rhineEnabled: profile === 'Rhine', seats, fake: true }).start().toPrep(1);
    try {
      const ps = h.ps('p_0');
      const record = ps.gd.chess(SLOT);
      assert.equal(record.charId, DOROTHY);
      assert.deepEqual(record.garrisonIds, []);
      assert.ok(!record.bonds.includes('rhineShip'), 'the DIY form does not inherit a custom faction');
      const loadout = ps.loadoutFor(record);
      const tokens = ps.gd.placeableTokens(SLOT, loadout);
      assert.equal(tokens.find(x => x.tokenId === TRAP)?.count, 9, 'the upstream ten traps use its existing per-stack cap of nine');
      if (profile === 'Rhine') {
        assert.equal(ps.gd.placeableTokens('chess_rhine_dorothy_a').find(x => x.tokenId === TRAP)?.count, 4);
        assert.equal(ps.gd.placeableTokens('chess_rhine_dorothy_b').find(x => x.tokenId === TRAP)?.count, 5);
      }
      const piece = ps.acquireChess(SLOT, { source: 'buy' });
      assert.ok(piece);
      const at = legalTileFor(h.m, ps, SLOT);
      assert.ok(at);
      assert.deepEqual(ps.move(piece.uid, { area: 'board', row: at[0], col: at[1] }), { ok: true });
      const traps = [...ps.hand, ...ps.temp].filter(p => p?.ownerUid === piece.uid && p.id === TRAP);
      assert.equal(traps.reduce((sum, p) => sum + p.count, 0), 9);
      assert.equal(ps.battleInput().units.find(u => u.uid === piece.uid).diy.charId, DOROTHY);
      h.invariants();
    } finally { h.m.dispose(); }
  });
}

for (const [profile, data] of profiles) {
  test(`${profile}: an immediate R14 beacon keeps a DIY slot private instead of transferring it as a preset core`, () => {
    const seats = Array.from({ length: 6 }, (_, seat) => ({ seat, playerId: `p_${seat}`, name: `P${seat}`, isBot: false, connected: true,
      ...(seat === 0 ? { diy: { [SLOT]: { charId: 'char_134_ifrit', skillIndex: 1, uniEquipId: 'uniequip_002_ifrit' } } } : {}) }));
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', data, rhineEnabled: profile === 'Rhine', seats, fake: true }).start().toPrep(1);
    try {
      const ps = h.ps('p_0');
      const target = ps.acquireChess(SLOT, { source: 'buy' });
      assert.ok(target);
      const beacon = ps.acquireItem('chess_item_5_04_e_a', { source: 'sixPlayerBeacon' });
      beacon.meta.sixPlayerBeaconRound = 14;
      h.m.round = 14;
      assert.deepEqual(ps.equip(beacon.uid, target.uid), { ok: true });
      assert.equal(ps.find(target.uid), null);
      assert.equal(ps.find(beacon.uid), null);
      assert.equal(ps.offers.at(-1).slots.length, 2);
      assert.ok(!ps.effects.some(e => e.key === 'effect:builtin_gift'), 'a private DIY roster never creates a cross-player pending transfer');
      for (const mate of h.m.order.slice(1)) assert.ok(!mate.allChess().some(p => p.id === SLOT));
      h.invariants();
    } finally { h.m.dispose(); }
  });
}
