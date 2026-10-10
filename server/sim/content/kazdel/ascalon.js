// Owner-approved tier-3 trait: body-only range slow, one effective-time clock per player.
import { gainLayers } from '../support/index.js';
import { KAZDEL_BOND } from '../../../../shared/kazdel.js';

const KEY = 'kazdel:ascalonSlow';
const present = u => u.alive && u.deployed && !u.hidden && !u.removed;
export function tickAscalon(battle, states, dt, trait) {
  const slows = new Map();
  for (const s of states) {
    let best = null;
    for (const u of s.originals) {
      const bb = trait(u, 'ascalon');
      if (!bb || !present(u)) continue;
      const enemies = battle.enemiesInKeys(u.rangeKeys, u, { canHitFly: true })
        .filter(e => present(e) && e.base.moveSpeed > 0);
      if (!enemies.length) continue;
      for (const e of enemies) {
        const old = slows.get(e);
        if (!old || bb.slow > old.bb.slow) slows.set(e, { unit: u, bb });
      }
      if (!best || bb.layer > best.bb.layer) best = { unit: u, bb };
    }
    if (!best || !s.ps.bonds[KAZDEL_BOND]?.active) continue;
    s.ascalonTime = (s.ascalonTime ?? 0) + dt;
    while (s.ascalonTime + 1e-9 >= best.bb.interval) {
      s.ascalonTime = Math.max(0, s.ascalonTime - best.bb.interval);
      gainLayers(battle, { playerId: s.ps.playerId, source: best.unit, bonds: KAZDEL_BOND,
        n: best.bb.layer, reason: 'garrison' });
    }
  }
  // A single key also prevents identical range auras from multiplying across teammates.
  for (const e of battle.enemies) {
    const strongest = slows.get(e), old = e.findBuff(KEY);
    if (!strongest) { if (old) battle.removeBuff(e, KEY); continue; }
    const moveMul = 1 - strongest.bb.slow;
    if (old?.mods.moveMul !== moveMul) battle.addBuff(e, { key: KEY, mods: { moveMul }, source: strongest.unit });
  }
}
