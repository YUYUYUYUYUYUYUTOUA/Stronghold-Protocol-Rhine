// Deterministic real-Battle fixture for Kazdel visual QA. No synthetic snapshots or private cannon timers.
import { KAZDEL_BOND, KAZDEL_CHARACTERS } from '../../shared/kazdel.js';

export function kazdelRoster(chess) {
  const records = Array.isArray(chess) ? chess : Object.values(chess?.chess || chess || {});
  return Object.values(KAZDEL_CHARACTERS).map(charId => records.find(c => c.charId === charId && !c.isGolden && c.bonds?.includes(KAZDEL_BOND))).filter(Boolean);
}

/** Only target durability / respawn delay are adjusted; Kazdel content, native kits and FX remain the live game's. */
export function createKazdelFixture(Battle, DataSource, raw, count = 6) {
  const roster = kazdelRoster(raw.chess), units = roster.slice(0, count);
  const chess = { ...(raw.chess?.chess || raw.chess) };
  for (const c of units) chess[c.chessId] = { ...c, stats: { ...c.stats, respawnTime: 180 } };
  const ds = new DataSource({ ...raw, chess });
  const positions = [[10,5],[9,4],[9,3],[11,3],[11,4],[10,6],[12,5],[12,6],[9,6]];
  const b = new Battle({ seed: 731, fieldId: 'kazdel-demo', kind: 'normal', modeId: 'mode_multi_normal', round: 10,
    stageId: 'act2autochess_m01', data: ds, timeLimit: 240, autoFinish: false, flags: { startOpCooldown: 0 },
    players: [{ playerId: 'p1', seat: 0, side: 'L', units: units.map((c, i) => ({ uid: i+1, kind: 'chess', chessId: c.chessId, row: positions[i][0], col: positions[i][1] })),
      bonds: { [KAZDEL_BOND]: { active: true, count, layers: 100 } } }],
    spawns: [], recordEvents: true, quiet: true,
  });
  b.step();
  const enemyKey = Object.keys(raw.enemies?.enemies || raw.enemies).find(k => k.startsWith('enemy_1000_gopro'));
  const enemy = ds.getEnemy(enemyKey);
  for (const pos of [[10,7],[10,8],[11,8]]) b.spawnEnemy(enemyKey, { pos,
    def: { ...enemy, type: 'enemy', immune: enemy.immune,
      maxHp: 400000, atk: 0, def: 0, res: 0, moveSpeed: 0, bat: 999, skills: [], abilities: [], talents: { bb: {} } },
  });
  const body = b.allyUnits.find(u => u.uid === 1);
  b.kill(body);
  return { b, roster, body };
}
