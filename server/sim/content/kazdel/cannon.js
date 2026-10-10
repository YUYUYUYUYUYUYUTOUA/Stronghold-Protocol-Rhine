// Independent charge and tile-square targeting; the cannon is not a deployed unit or an SP recipient.
import { KAZDEL_CANNON as C } from '../../../../shared/kazdel.js';
import { Unit } from '../../units.js';
import { bodyInKeys } from '../../body.js';
import { COLS, ROWS } from '../../constants.js';

const present = u => u.alive && u.deployed && !u.hidden && !u.removed;
export function cannonKeys(x, y) {
  const keys = new Set();
  for (let r = y - C.radius; r <= y + C.radius; r++) for (let c = x - C.radius; c <= x + C.radius; c++) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) keys.add(r * COLS + c);
  }
  return keys;
}
function chooseTarget(battle) {
  const enemies = battle.enemies.filter(e => present(e) && !e.s.flags.untargetable);
  if (!enemies.length) return null;
  const candidates = new Map();
  for (const e of enemies) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const x = Math.round(e.x) + dc, y = Math.round(e.y) + dr;
    if (battle.grid.inRect(y, x)) candidates.set(y * COLS + x, { x, y });
  }
  let best = null, count = -1;
  // Stable tile order resolves ties independently of spawn / Map insertion order.
  for (const [key, tile] of [...candidates].sort((a, b) => a[0] - b[0])) {
    const keys = cannonKeys(tile.x, tile.y), n = enemies.filter(e => bodyInKeys(e, keys)).length;
    if (n > count) { count = n; best = { ...tile, key }; }
  }
  return best;
}
export function cannonSource(ps, stage) {
  const source = new Unit({ id: -1 - ps.seat, side: 'ally', kind: 'device', ownerId: ps.playerId,
    defId: 'kazdel_cannon', name: '众魂大炮', base: { atk: 0, maxHp: 1, spRecovery: 0 } });
  source.kazdelCannon = true;
  source.kazdelCannonSafeAllies = stage >= C.enemiesOnlyStage;
  return source;
}
function fire(battle, state, layers, onFire) {
  const at = state.warning ?? chooseTarget(battle);
  if (!at) return false;
  const keys = cannonKeys(at.x, at.y), amount = C.damageBase + C.damagePerLayer * layers;
  state.charge = 0;
  state.lastFireAt = battle.time;
  state.warning = null;
  battle.fx('kazdelCannonImpact', { ownerId: state.ps.playerId, x: at.x, y: at.y, radius: C.radius });
  onFire(state);
  const targets = battle.enemies.filter(e => present(e) && bodyInKeys(e, keys));
  if (state.stage === C.friendlyFireStage) for (const a of battle.allyUnits) {
    if (a.ownerId === state.ps.playerId && present(a) && !a.kazdelSoul && a.kind !== 'device' && keys.has(a.tileR * COLS + a.tileC)) targets.push(a);
  }
  for (const target of targets) battle.dealDamage(state.cannon, target, {
    amount: amount * (target.side === 'ally' ? C.friendlyFireRatio : 1), type: 'true', canDodge: false, noSp: true,
    tags: state.stage >= C.enemiesOnlyStage ? ['kazdelCannon', 'kazdelCannonEnemiesOnly'] : ['kazdelCannon'], ignoreSelect: true,
  });
  return true;
}
export function tickCannon(battle, state, dt, layers, onFire) {
  if (state.stage < C.friendlyFireStage || battle.finished) return;
  if (!state.ps.units.some(u => present(u) && (u.kind === 'op' || u.kazdelSoul))) { state.warning = null; return; }
  const rate = C.chargePerSec + C.chargePerLayer * layers;
  state.charge = Math.min(C.capacity, state.charge + rate * dt);
  const readyAt = Math.max(battle.time + (C.capacity - state.charge) / rate, state.lastFireAt + C.minInterval);
  if (!state.warning && readyAt - battle.time <= C.warningDuration + 1e-9) {
    const at = chooseTarget(battle);
    if (at) {
      state.warning = { x: at.x, y: at.y, startedAt: battle.time, until: Math.max(readyAt, battle.time + C.warningDuration) };
      battle.fx('kazdelCannonWarning', { ownerId: state.ps.playerId, ...at, dur: C.warningDuration, radius: C.radius });
    }
  } else if (state.warning) state.warning.until = Math.max(readyAt, state.warning.startedAt + C.warningDuration);
  if (state.warning && state.charge >= C.capacity - 1e-9 && battle.time >= state.warning.until - 1e-9) fire(battle, state, layers, onFire);
}
