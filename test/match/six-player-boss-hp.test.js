// Six-seat leader HP is a match rule, applied once to the shared pool used by every combat pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataProfile } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp, SharedBossPool } from '../../server/match/finalAssault.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DATA, makeMatch } from './harness.js';

const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
const profiles = [['Rhine', DATA], ['vanilla', getDataProfile(false, { log: QUIET })]];
const modes = ['mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss'];
const close = h => { h.m.dispose(); h.clients?.closeAll(); };

for (const [profile, data] of profiles) {
  test(`${profile}: only six occupied starting seats double every leader pool, on every difficulty`, () => {
    for (const modeId of modes) {
      const four = new GameData(data, modeId, 4);
      for (let starting = 1; starting <= 6; starting++) {
        const gd = new GameData(data, modeId, starting);
        for (const bossId of Object.keys(data.bosses)) {
          for (const alive of [1, 2, 4, 5, 6, undefined]) {
            const expected = four.bossPoolHp(bossId, alive) * (starting === 6 ? 2 : 1);
            assert.equal(gd.bossPoolHp(bossId, alive), expected, `${modeId}, ${bossId}, start ${starting}, alive ${alive}`);
            assert.equal(bossPoolHp(gd, bossId, alive), expected, 'the Match helper uses the same single multiplier');
          }
        }
      }
    }
    for (const modeId of ['mode_single_funny', 'mode_single_normal', 'mode_single_hard', 'mode_single_abyss']) {
      const normal = new GameData(data, modeId, 1);
      const malformedSix = new GameData(data, modeId, 6);
      for (const bossId of Object.keys(data.bosses)) {
        assert.equal(malformedSix.bossPoolHp(bossId, 1), normal.bossPoolHp(bossId, 1), 'solo never takes a co-op modifier');
      }
    }
  });
}

test('six-seat HP remains twice the same four-seat rule when optional alive scaling is enabled', () => {
  const modeId = 'mode_multi_hard';
  const data = { ...DATA, config: { ...DATA.config, modes: { ...DATA.config.modes,
    [modeId]: { ...DATA.config.modes[modeId], bossHpScale: { ...DATA.config.modes[modeId].bossHpScale, aliveScaling: true } },
  } } };
  const four = new GameData(data, modeId, 4), six = new GameData(data, modeId, 6);
  for (const alive of [1, 2, 3, 4, 5, 6, undefined]) {
    assert.equal(six.bossPoolHp('boss_1', alive), four.bossPoolHp('boss_1', alive) * 2);
  }
});

function startBoss(data, starting, { hidden = false, clientCombat = false, survivors = starting } = {}) {
  const h = makeMatch({ data, mode: 'coop', difficulty: 'HARD', humans: starting, seed: 16601,
    clientCombat, clients: false, instant: false, captureFrames: false });
  const m = h.m;
  m.bossId = 'boss_1';
  m.hiddenBossId = 'boss_9';
  m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
  for (const [i, ps] of [...m.players.values()].entries()) {
    ps.lp = 1000;
    if (i >= survivors) ps.eliminate(m.round - 1);
  }
  if (hidden) m.teamLp = survivors * 1000;
  m.startFinalAssault(hidden);
  return h;
}

function spawnLeader(battle) {
  for (let ticks = 0; ticks < 3600; ticks++) {
    const boss = battle.enemies.find(e => e.alive && e.isBoss);
    if (boss) return boss;
    assert.equal(battle.finished, false, 'the field stays active until the leader enters');
    battle.step();
  }
  assert.fail('leader did not enter within 120 game seconds');
}

for (const [profile, data] of profiles) for (const hidden of [false, true]) for (const clientCombat of [false, true]) {
  test(`${profile} ${hidden ? 'Hidden Core' : 'Final Assault'} ${clientCombat ? 'client specs' : 'server battles'}: HP reaches every field exactly once; other stats stay unchanged`, () => {
    const four = startBoss(data, 4, { hidden, clientCombat });
    const six = startBoss(data, 6, { hidden, clientCombat });
    try {
      const expected = four.m.bossPool.maxHp * 2;
      assert.equal(six.m.bossPool.maxHp, expected);
      assert.deepEqual(six.m.publicView().bossHp, { hp: expected, max: expected }, 'public HUD carries the doubled pool');
      assert.equal(six.m.fields.length, 3);
      const baselineBattle = clientCombat
        ? createBattleFromSpec(four.m.fields[0].spec, four.m.ds, { recordEvents: false, quiet: true })
        : four.m.fields[0].battle;
      const baseline = spawnLeader(baselineBattle);
      for (const f of six.m.fields) {
        if (clientCombat) {
          assert.deepEqual(f.spec.boss, { poolHp: expected, poolMax: expected });
          const wire = six.lastTo(f.authority, 'b.start');
          assert.deepEqual(wire.spec.boss, f.spec.boss, 'the actual wire frame retains pool size');
        } else assert.strictEqual(f.battle.sharedBoss, six.m.bossPool, 'three server fields share one doubled pool');
        const battle = clientCombat ? createBattleFromSpec(f.spec, six.m.ds, { recordEvents: false, quiet: true }) : f.battle;
        assert.equal(battle.sharedBoss.maxHp, expected, 'replay / live battle never multiplies the pool again');
        const leader = spawnLeader(battle);
        assert.equal(leader.defId, baseline.defId);
        assert.equal(leader.base.maxHp, baseline.base.maxHp * 2, 'the scene leader displays the doubled max HP');
        assert.equal(leader.s.maxHp, baseline.s.maxHp * 2);
        assert.equal(leader.hp, baseline.hp * 2);
        for (const stat of ['atk', 'def', 'res', 'aspd', 'bat', 'moveSpeed']) {
          assert.equal(leader.base[stat], baseline.base[stat], `${stat} base unchanged`);
          assert.equal(leader.s[stat], baseline.s[stat], `${stat} effective unchanged`);
        }
        const bossSpawn = (clientCombat ? f.spec : f.battle.opts).spawns.find(s => s.tag === 'boss');
        assert.equal(bossSpawn.mods?.hpMul, undefined, 'no additional spawn HP multiplier');
        if (clientCombat) {
          const replayPool = new SharedBossPool(expected);
          const verified = createBattleFromSpec(f.spec, six.m.ds, { sharedBoss: replayPool, recordEvents: false, quiet: true });
          assert.equal(spawnLeader(verified).s.maxHp, expected, 'server verification consumes the already doubled spec');
        }
      }
      assert.equal(four.m.errorCount, 0);
      assert.equal(six.m.errorCount, 0);
    } finally { close(four); close(six); }
  });
}

for (const hidden of [false, true]) for (const clientCombat of [false, true]) {
  test(`six-seat ${hidden ? 'hidden' : 'final'} ${clientCombat ? 'client' : 'server'} retains the six-seat HP rule after two eliminations`, () => {
    const h = startBoss(DATA, 6, { hidden, clientCombat, survivors: 4 });
    try {
      assert.equal(h.m.alivePlayers().length, 4);
      const four = new GameData(DATA, h.m.modeId, 4);
      const bossId = hidden ? h.m.hiddenBossId : h.m.bossId;
      assert.equal(h.m.bossPool.maxHp, four.bossPoolHp(bossId, 4) * 2);
      assert.equal(h.m.fields.length, 2);
    } finally { close(h); }
  });
}

test('six-seat client authority takeover keeps the existing doubled pool without increasing HP again', () => {
  const h = startBoss(DATA, 6, { clientCombat: true });
  try {
    const m = h.m, f = m.fields[0], pool = m.bossPool;
    const expected = new GameData(DATA, m.modeId, 4).bossPoolHp(m.bossId, 4) * 2;
    m.onDisconnect('p_0');
    assert.equal(f.authority, 'p_1');
    assert.equal(h.lastTo('p_1', 'b.start').spec.boss.poolMax, expected);
    m.onDisconnect('p_1');
    assert.equal(f.mode, 'server');
    assert.strictEqual(f.battle.sharedBoss.pool, pool, 'the server takeover credits the existing shared pool');
    assert.equal(f.battle.sharedBoss.maxHp, expected);
    assert.equal(spawnLeader(f.battle).s.maxHp, expected);
    assert.equal(pool.maxHp, expected);
  } finally { close(h); }
});
