// Rim Billiton allies. Player-local generation, deterministic tile marching and finite vehicle routes.
import { REM_BOND, REM_LIMITS, REM_INTERVALS, REM_BATCHES, REM_OPENING, REM_TIER_STATS, remStage, remPick } from '../../../shared/rem.js';
import { COLS, TICK } from '../constants.js';
import { hypot } from '../detmath.js';
import { isMember } from './support/index.js';
import { absoluteRangeKeys, canTargetEnemy } from '../targeting.js';
import { bodyInRange, bodyDist } from '../body.js';
import { effectiveProfile } from '../ai.js';
import { isRemMobile } from '../remMobile.js';

const present = u => u.alive && u.deployed && !u.removed;
const key = (r, c) => r * COLS + c;
const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const names = { child: '孩童', miner: '矿工', combined: '组合矿工', chef: '厨师', enthusiast: '好外号热衷者', food: '美食的诱惑', bus: '校车', boss: '好心肠老板' };
const art = { child: 'enemy_10221_agporc', miner: 'enemy_10222_agtski', combined: 'enemy_10223_agtrac', chef: 'enemy_10229_agactr', enthusiast: 'enemy_10226_agprnk', food: 'enemy_10228_agball', bus: 'enemy_10225_agpbus', boss: 'enemy_10230_agkiro' };
const special = type => ['food', 'bus', 'boss'].includes(type);
const layers = s => s.stage ? Math.max(0, Number(s.ps.bonds[REM_BOND]?.layers) || 0) : 0;
const living = s => s.units.filter(present);
const counted = s => living(s).filter(u => u.remCounted).length;
const chefs = s => living(s).filter(u => u.remType === 'chef').length;
const bosses = s => living(s).filter(u => u.remType === 'boss').length;
const bossField = b => b.kind === 'boss' || b.kind === 'hidden';

/** Keep one living leader from this Battle, including during its unselectable phases. */
function lockBoss(b, u) {
  const old = u.mem.remBossTarget;
  let target = b.enemies.find(e => e.id === old && e.isBoss && present(e));
  if (!target) target = b.enemies.filter(e => e.isBoss && present(e))
    .sort((a, c) => bodyDist(a, u.x, u.y) - bodyDist(c, u.x, u.y) || a.spawnSeq - c.spawnSeq || a.id - c.id)[0] ?? null;
  if (old !== target?.id) {
    delete u.mem.remTarget;
    delete u.mem.remSearchKey;
    delete u.mem.remSearchAt;
    // Changing a chase never cuts a corner from a fractional position. Cancel the
    // old destination and return along its actual edge before planning another.
    const leg = u.mem.remLeg;
    if (leg) { leg.to = leg.from; leg.intent = 'bossReturn'; leg.target = null; }
    if (target) u.mem.remBossTarget = target.id;
    else delete u.mem.remBossTarget;
  }
  return target;
}

function troopBoss(b, u) {
  return bossField(b) && isRemMobile(u) && present(u) && !special(u.remType) ? lockBoss(b, u) : null;
}

/** null preserves ordinary AI; [] means a locked leader currently offers no shot. */
function bossTargets(b, u, profile) {
  const target = troopBoss(b, u);
  if (!target) return null;
  if (canTargetEnemy(u, target, profile) && bodyInRange(target, u.rangeKeys)) return [target];
  // Actual contact blocking remains authoritative: clear a blocking escort, then
  // resume the same leader pursuit. Do not drag it or redirect the leader lock.
  return b.blockedTargets(u, profile).slice(0, 1);
}

/** Tile occupancy is authoritative; never force a summon onto a body, ally or obstacle. */
function free(b, r, c, u = null, fly = false) {
  if (!(fly ? b.grid.inRect(r, c) : b.grid.groundPassable(r, c)) || b.downOn(r, c)) return false;
  const occ = b._occ[key(r, c)];
  return !occ || occ === u || !present(occ);
}
/** Four-neighbour BFS avoids clipping corners. Occupied destinations are never used. */
export function remPath(b, start, goals, unit = null, fly = false, ignoreOccupancy = false, passAllies = false, within = null) {
  const pass = (r, c) => (!within || within(r, c)) && (ignoreOccupancy ? b.grid.groundPassable(r, c)
    : passAllies ? b.grid.groundPassable(r, c) && !b.downOn(r, c) && (!b._occ[key(r,c)] || b._occ[key(r,c)].side === 'ally')
      : free(b, r, c, unit, fly));
  const ends = new Set(goals.filter(([r, c]) => pass(r, c) && (ignoreOccupancy || free(b,r,c,unit,fly))).map(([r, c]) => key(r, c)));
  if (!ends.size) return null;
  const queue = [start], prev = new Map([[key(...start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i], k = key(r, c);
    if (ends.has(k)) {
      const path = [[r, c]];
      for (let p = prev.get(k); p; p = prev.get(key(...p))) path.push(p);
      return path.reverse();
    }
    for (const [dr, dc] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const nr = r + dr, nc = c + dc, nk = key(nr, nc);
      if (!prev.has(nk) && pass(nr, nc)) { prev.set(nk, [r, c]); queue.push([nr, nc]); }
    }
  }
  return null;
}
function nearby(b, point, radius = 2) {
  const out = [];
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    const p = [point[0] + dr, point[1] + dc];
    if (b.grid.groundPassable(...p)) out.push(p);
  }
  return out.sort((a, c) => distance(a, point) - distance(c, point) || a[0] - c[0] || a[1] - c[1]);
}
// Actual on-field survival in integer 30 Hz unit-ticks. One unit-second gives +1% / +2%.
// Already earned time survives deaths and same-round unite, never a new combat round.
const survivalSecond = Math.round(1 / TICK);
const survivalCapTicks = 200 * survivalSecond;
function refreshSurvival(b, s) {
  if (s.stage < 2) return;
  const seconds = Math.floor(s.survivalTicks / survivalSecond);
  const pct = s.stage >= 3 ? Math.min(300, seconds * 2) / 100 : Math.min(200, seconds) / 100;
  for (const u of s.ps.units) {
    if (u.kind !== 'op' || !isMember(b, u, REM_BOND)) continue;
    if (u.findBuff('rem:survival')?.mods?.atkPct === pct) continue;
    b.addBuff(u, { key: 'rem:survival', mods: { atkPct: pct, hpPct: pct }, persist: true, allowDead: true });
  }
}
function record(type, S, stage) {
  const miner = type === 'miner' || type === 'combined';
  const chef = type === 'chef', boss = type === 'boss', vehicle = type === 'food' || type === 'bus';
  const atk = boss ? 1000 + 2 * S : type === 'food' ? 1500 + 5 * S : type === 'bus' ? 0 : miner ? 500 + S + (type === 'combined' ? 600 : 0) : chef ? 200 + .5 * S : 450 + .75 * S;
  const stats = { maxHp: miner || type === 'enthusiast' ? 1800 + 5 * S : chef ? 1600 + 4 * S : 1200 + 3 * S,
    atk, def: miner || type === 'enthusiast' ? 200 + (type === 'combined' ? 800 : 0) : chef ? 150 : 100, res: miner || type === 'enthusiast' ? 10 : chef ? 20 : 0,
    bat: miner || chef || type === 'enthusiast' ? 2.5 : 2.4, aspd: 100, blockCnt: chef || boss || vehicle ? 0 : 1,
    moveSpeed: 1, respawnTime: 0, cost: 0, hpRecoveryPerSec: 0, spRecovery: 0 };
  const tier = REM_TIER_STATS[stage - 1];
  stats.atk *= tier?.atk ?? 1;
  if (!vehicle) {
    stats.maxHp *= tier?.hp ?? 1;
    stats.def *= tier?.def ?? 1;
    stats.res += tier?.res ?? 0;
  }
  return { name: names[type], spine: art[type], avatar: art[type], stats,
  rangeGrid: [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]], dmgType: chef ? 'arts' : 'phys', attackKind: 'melee', canHitFly: false,
  };
}
function spawn(b, s, type, source, point = s.gate) {
  if (!free(b, ...point, null, type === 'boss')) return null;
  const u = b.spawnToken(s.ps.playerId, `token_rem_${type}`, ...point, { def: record(type, layers(s), s.stage), kit: { trait: { noAttack: special(type) }, install(_battle, unit) { unit.remMobile = true; if (type === 'boss') unit.motion = 'FLY'; } } });
  if (!u) return null;
  u.remType = type; u.remCounted = !special(type) && source !== 'jacinta'; u.remSource = source;
  u.mem.remBomb = 0; u.mem.remStun = 0; u.mem.remHit = new Set();
  if (type === 'boss') { u.x = s.gate[1]; u.y = s.gate[0]; u.mem.remAirIndex = 0; u.mem.remAirDirection = 1; u.ground = false; b.addBuff(u, { key: 'rem:flight', persist: true, flags: { liftoff: true, noBlock: true } }); }
  if (type === 'food' || type === 'bus') b.addBuff(u, { key: 'rem:vehicle', persist: true, flags: { noBlock: true } });
  s.units.push(u);
  s.appeared++;
  refreshSurvival(b, s);
  b.emit('remSpawned', { unit: u, type, ownerId: s.ps.playerId, source });
  return u;
}
function request(b, s, count, { source = 'extra', poolStage = s.stage || 1, capMode = 'extra', point = null } = {}) {
  let added = 0;
  for (let i = 0; i < count; i++) {
    const pending = s.queue.filter(q => q.source !== 'jacinta' && !special(q.type)).length;
    if (capMode === 'regular' && counted(s) + pending >= REM_LIMITS[s.stage - 1]) break;
    const chefPending = s.queue.filter(q => q.type === 'chef').length;
    const type = remPick(b.rng, poolStage, chefs(s) + chefPending < Math.max(1, s.stage));
    s.queue.push({ type, source, point, regular: capMode === 'regular' }); added++;
  }
  drain(b, s);
  return added;
}
function drain(b, s) {
  // Independent specials must not starve behind a ground formation waiting for a free deployment tile.
  for (let i = 0; i < s.queue.length; i++) {
    const q = s.queue[i];
    // A bypass source may have filled the field since this regular slot was queued.
    // Missed regular replenishment never becomes deferred over-cap population.
    if (q.regular && counted(s) >= REM_LIMITS[s.stage - 1]) { s.queue.splice(i, 1); i--; continue; }
    const points = q.type === 'boss' ? [[s.gate[0] - 1, s.gate[1]], [s.gate[0] + 1, s.gate[1]], s.gate]
      : q.point ? [q.point, ...[[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dr, dc]) => [q.point[0] + dr, q.point[1] + dc])] : [s.gate];
    if (q.type === 'boss') {
      for (let radius = 1; radius <= 4; radius++) for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
        const p = [s.gate[0] + dr, s.gate[1] + dc];
        if (b.grid.inRect(...p) && !b.grid.groundPassable(...p)) points.push(p);
      }
      points.sort((a, c) => Number(b.grid.groundPassable(...a)) - Number(b.grid.groundPassable(...c)) || distance(a, s.gate) - distance(c, s.gate));
    }
    const point = points.find(p => free(b, ...p, null, q.type === 'boss'));
    if (!point || (q.type === 'chef' && chefs(s) >= Math.max(1, s.stage))) continue;
    if (spawn(b, s, q.type, q.source, point)) { s.queue.splice(i, 1); i--; }
  }
}
/** Advance real world coordinates each simulation tick; reservations never act as phantom blockers. */
function advanceMarch(b, u, dt) {
  const leg = u.mem.remLeg;
  if (!leg) return;
  // An obstacle/body can appear while crossing. Return along the same segment rather than clipping it.
  if (!b.grid.groundPassable(...leg.to) || b.downOn(...leg.to)) {
    if (!b.grid.groundPassable(...leg.from) || b.downOn(...leg.from)) { u.moving = false; return; }
    if (leg.coverageTransit) [leg.from, leg.to] = [leg.to, leg.from];
    else {
      if (leg.coverage != null) leg.returnFrom ??= leg.to;
      leg.to = leg.from;
    }
  }
  const [r,c] = leg.to, dx = c-u.x, dy = r-u.y, d = hypot(dx,dy);
  const step = dt; // Preserve the approved one tile per game second; only the motion cadence changes.
  if (step <= 0) return;
  const arrived = d <= step + 1e-9;
  if (arrived) { u.x=c; u.y=r; }
  else { u.x += dx/d*step; u.y += dy/d*step; }
  u.moving = d > 1e-9;
  u.tileR=Math.round(u.y); u.tileC=Math.round(u.x);
  u.ground=b.grid.isLow(u.tileR,u.tileC) && !b._elevated?.has(key(u.tileR,u.tileC));
  b._refreshRange(u);
  if (arrived) {
    delete u.mem.remLeg;
  }
  b._remMoved = true;
}
const steps = [[0, 1], [1, 0], [-1, 0], [0, -1]];

/** The live attack ranges of allied operators on this field, including cooperating players. */
function fireCoverage(b) {
  if (b._remCoverageTick === b.tickCount) return b._remCoverage;
  const keys = new Set(), remKeys = new Map();
  for (const op of b.allyUnits) {
    if (!present(op) || op.hidden || op.kind !== 'op' || op.kazdelSoul || op.remType) continue;
    const profile = effectiveProfile(op);
    if (!profile || profile.noAttack || (profile.heal && profile.dmgType === 'heal')
      || (profile.noAttackUnlessSkill && !op.skill?.active)) continue;
    if (b.rangeChanged(op)) b._refreshRange(op);
    for (const k of op.rangeKeys) keys.add(k);
    if (b.kind === 'unite' && isMember(b, op, REM_BOND)) {
      let owned = remKeys.get(op.ownerId);
      if (!owned) remKeys.set(op.ownerId, owned = new Set());
      for (const k of op.rangeKeys) owned.add(k);
    }
  }
  const signature = [...keys].sort((a, c) => a - c).join(',');
  const preferredByOwner = new Map([...remKeys].map(([owner, owned]) => [owner, {
    keys: owned, signature: `rem:${owner}:${[...owned].sort((a, c) => a - c).join(',')}`, preferred: true,
  }]));
  b._remCoverageTick = b.tickCount;
  return b._remCoverage = { keys, signature, preferredByOwner, enemies: new Map(b.enemies.map(e => [e.id, e])) };
}

/** Rem may cross living allies; terrain and knocked-out bodies remain impassable. */
function walkable(b, r, c) {
  return b.grid.groundPassable(r, c) && !b.downOn(r, c)
    && (!b._occ[key(r, c)] || b._occ[key(r, c)].side === 'ally');
}

/** A fresh bounded BFS: no shared failed-path cache can stop a later batch or a changed target. */
function mobilePath(b, start, accept, within = null, distanceTo = null) {
  const queue = [start], prev = new Map([[key(...start), null]]);
  let nearest = null, nearestDistance = Infinity;
  const pathTo = at => {
    const path = [at];
    for (let p = prev.get(key(...at)); p; p = prev.get(key(...p))) path.push(p);
    return path.reverse();
  };
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if ((!within || within(...at)) && free(b, ...at)) {
      if (accept(...at)) return pathTo(at);
      if (distanceTo) {
        const d = distanceTo(...at);
        if (d < nearestDistance) { nearest = at; nearestDistance = d; }
      }
    }
    for (const [dr, dc] of steps) {
      const next = [at[0] + dr, at[1] + dc], nk = key(...next);
      if (!prev.has(nk) && (!within || within(...next)) && walkable(b, ...next)) {
        prev.set(nk, at); queue.push(next);
      }
    }
  }
  return nearest ? pathTo(nearest) : null;
}

/** Unite uses this owner's already mapped Rem ranges, not the nearest teammate's half. */
function troopCoverage(b, s, u) {
  const allied = fireCoverage(b), preferred = allied.preferredByOwner.get(s.ps.playerId);
  if (!preferred?.keys.size) return allied;
  const at = [u.tileR, u.tileC], within = (r, c) => preferred.keys.has(key(r, c));
  if (within(...at)) return { ...preferred, enemies: allied.enemies };
  const signature = `${preferred.signature};${b.grid.version};${key(...at)}`;
  let reach = u.mem.remCoverageReach;
  if (reach?.signature !== signature || reach.until <= b.time) {
    // The destination must be covered; the route may cross ordinary walkable tiles.
    // Retry temporary body/occupancy failures rather than caching a fallback forever.
    reach = u.mem.remCoverageReach = { signature, until: b.time + .5, path: mobilePath(b, at, within) };
  }
  return reach.path ? { ...preferred, enemies: allied.enemies, entryPath: reach.path } : allied;
}

/** Use the same facing, active range override and extension rules as Battle._refreshRange. */
function attackRangeAt(u, r, c) {
  const targeting = u.skill?.active ? u.skill.spec.targeting : null;
  const grid = targeting?.rangeGrid || u.rangeGrid || [[0, 0]];
  const extend = (targeting?.noRangeExtend ? 0 : u.s.rangeExtend) + (targeting?.rangeExtend || 0);
  const keys = absoluteRangeKeys(grid, r, c, u.dir, extend);
  if (u.extraRangeKeys) keys.push(...u.extraRangeKeys);
  return new Set(keys);
}

function startMarch(b, u, path, dt, intent, target = null, coverage = null) {
  if (!path || path.length < 2) return false;
  u.mem.remLeg = { from: path[0], to: path[1], intent, target: target?.id ?? null };
  if (coverage) {
    u.mem.remLeg.coverage = coverage.signature;
    u.mem.remLeg.coverageTransit = !!coverage.preferred;
  }
  if (target) u.mem.remTarget = target.id;
  else delete u.mem.remTarget;
  advanceMarch(b, u, dt);
  return true;
}

function moveBossTroop(b, u, target, dt) {
  u.mem.remTarget = target.id;
  if (u.mem.remLeg?.intent === 'bossReturn') { advanceMarch(b, u, dt); return; }
  // Range is geometric here: an unselectable leader is still approached and
  // waited for. Only the attack selector applies canTargetEnemy's phase rules.
  if (bodyInRange(target, u.rangeKeys)) return;
  if (u.mem.remLeg) { advanceMarch(b, u, dt); return; }
  const search = `boss:${target.id}:${target.x}:${target.y}:${b.grid.version}`;
  if (u.mem.remSearchKey === search && u.mem.remSearchAt > b.time) return;
  u.mem.remSearchKey = search;
  const path = mobilePath(b, [u.tileR, u.tileC],
    (r, c) => bodyInRange(target, attackRangeAt(u, r, c)), null,
    (r, c) => bodyDist(target, c, r));
  if (!startMarch(b, u, path, dt, 'bossChase', target)) u.mem.remSearchAt = b.time + .5;
}

function moveTroop(b, s, u, dt) {
  const coverage = troopCoverage(b, s, u), within = (r, c) => coverage.keys.has(key(r, c));
  const profile = effectiveProfile(u), at = [u.tileR, u.tileC];
  const coveredTarget = e => e && !e.isFlying && canTargetEnemy(u, e, profile) && bodyInRange(e, coverage.keys);
  // The ordinary attack loop retains its blocked-target priority. Contact never drags an enemy along.
  if ((!coverage.preferred || within(...at)) && b.enemiesInKeys(u.rangeKeys, u, profile).length) return;
  const leg = u.mem.remLeg;
  if (leg) {
    // A fallback may already be returning when owner coverage recovers. Keep its
    // original opposite endpoint available without changing ordinary-field returns.
    if (coverage.preferred && leg.returnFrom) {
      leg.from = leg.returnFrom; delete leg.returnFrom;
      leg.coverageTransit = true;
    }
    const invalidTarget = leg.intent === 'chase' && !coveredTarget(coverage.enemies.get(leg.target));
    const outside = (leg.intent === 'chase' || leg.intent === 'wander') && !leg.coverageTransit && !within(...leg.to);
    const changed = (leg.coverageTransit || coverage.preferred) && leg.coverage != null
      && leg.coverage !== coverage.signature && leg.intent !== 'return';
    if (invalidTarget || outside || changed) {
      // Reverse the actual segment, rather than teleporting from a rounded tile or following a dead target.
      delete u.mem.remTarget;
      const preferredTransit = leg.coverageTransit || coverage.preferred;
      if (preferredTransit) leg.coverageTransit = true;
      if (!walkable(b, ...leg.from)) {
        // A body can close the traversed endpoint while preferred coverage changes.
        // Finish only this existing edge when its forward endpoint is still legal.
        if (preferredTransit && walkable(b, ...leg.to)) {
          leg.intent = 'return'; leg.target = null;
          advanceMarch(b, u, dt);
        }
        return;
      }
      if (preferredTransit) [leg.from, leg.to] = [leg.to, leg.from];
      else { leg.returnFrom ??= leg.to; leg.to = leg.from; }
      leg.intent = 'return';
    }
    advanceMarch(b, u, dt); return;
  }
  const foes = b.enemies.filter(coveredTarget);
  foes.sort((a, c) => bodyDist(a, u.x, u.y) - bodyDist(c, u.x, u.y) || a.spawnSeq - c.spawnSeq || a.id - c.id);
  const searchKey = `${coverage.signature};${b.grid.version};${foes.map(e => `${e.id}:${e.x}:${e.y}`).join(',')}`;
  if (u.mem.remSearchKey === searchKey && u.mem.remSearchAt > b.time) return;
  u.mem.remSearchKey = searchKey;
  const chase = () => {
    let target = null;
    const path = foes.length ? mobilePath(b, at, (r, c) => {
      const keys = attackRangeAt(u, r, c);
      target = within(r, c) ? foes.find(e => bodyInRange(e, keys)) ?? null : null;
      return !!target;
    }, coverage.preferred ? null : within) : null;
    return startMarch(b, u, path, dt, 'chase', target, coverage);
  };
  // Continue toward covered enemies across gaps instead of re-entering the
  // nearest component behind this unit at every completed one-tile leg.
  if (coverage.preferred && chase()) return;
  // Preferred Rem destinations can be across an uncovered bridge from the entry gate.
  if (coverage.keys.size && !within(...at)) {
    const path = coverage.entryPath ?? mobilePath(b, at, within);
    if (startMarch(b, u, path, dt, 'enter', null, coverage)) return;
  } else if (within(...at)) {
    if (!coverage.preferred && chase()) return;
    // A per-unit rotating cardinal choice produces continuous local wandering, without a fixed rendezvous.
    const turn = u.mem.remWanderTurn ?? u.id % steps.length;
    for (let i = 0; i < steps.length; i++) {
      const index = (turn + i) % steps.length, [dr, dc] = steps[index];
      const next = [at[0] + dr, at[1] + dc];
      if (!within(...next) || !free(b, ...next)) continue;
      u.mem.remWanderTurn = (index + 1) % steps.length;
      if (startMarch(b, u, [at, next], dt, 'wander', null, coverage)) return;
    }
    const wander = mobilePath(b, at, (r, c) => r !== at[0] || c !== at[1], within);
    if (startMarch(b, u, wander, dt, 'wander', null, coverage)) return;
  }
  // With no reachable coverage, clear an entry gate once and wait safely. No new rally or empty-field patrol.
  const gates = new Set([...b.remState.values()].map(owner => key(...owner.gate)));
  if (gates.has(key(...at))) {
    const clear = mobilePath(b, at, (r, c) => !gates.has(key(r, c)));
    if (startMarch(b, u, clear, dt, 'clear', null, coverage)) return;
  }
  delete u.mem.remTarget;
  u.mem.remSearchAt = b.time + .5;
}

function move(b, s, u, dt) {
  u.moving = false;
  const target = troopBoss(b, u);
  if (!u.canAct || u.s.flags.noMove || u.blocking.length) return;
  const type = u.remType, fly = type === 'boss';
  if (!special(type)) {
    if (target) moveBossTroop(b, u, target, dt);
    else moveTroop(b, s, u, dt);
    return;
  }
  // Preserve the boss's existing air route and actual world position without occupying or blocking its corridor.
  if (fly) {
    const route = s.airRoute;
    if (route.length < 2) return;
    let i = u.mem.remAirIndex + u.mem.remAirDirection;
    if (i < 0 || i >= route.length) { u.mem.remAirDirection *= -1; i = u.mem.remAirIndex + u.mem.remAirDirection; }
    const target = route[i], dx = target[1] - u.x, dy = target[0] - u.y, d = hypot(dx, dy), step = dt;
    if (d <= step) { u.x = target[1]; u.y = target[0]; u.mem.remAirIndex = i; }
    else { u.x += dx / d * step; u.y += dy / d * step; }
    u.moving = d > 1e-9;
    return;
  }
  if (u.mem.remLeg) { advanceMarch(b,u,dt); return; }
  if ((u.mem.remPlanAt || 0) > b.time + 1e-9) return;
  const at = [u.tileR, u.tileC];
  let goals;
  if (type === 'food' || fly) {
    const end = u.mem.remReturn ? s.gate : s.exit;
    goals = [end, ...[[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dr, dc]) => [end[0] + dr, end[1] + dc])];
  }
  else goals = nearby(b, s.vehicleStop).filter(p => distance(p, s.gate) > 0);
  goals = goals.filter(p => free(b,...p,u,fly));
  if (goals.length && !remPath(b, [u.tileR,u.tileC], goals, u, fly, false, true)) goals = [];
  if (goals.some(p => p[0] === at[0] && p[1] === at[1])) {
    u.mem.remPlanAt = b.time + 1;
    if (fly) u.mem.remReturn = !u.mem.remReturn;
    else if (type === 'food') b.retreat(u, { reason: 'remRouteEnd', permanent: true });
    else if (type === 'bus') {
      request(b, s, 5, { source: 'bus', point: [u.tileR, u.tileC] });
      b.retreat(u, { reason: 'remPassengersOut', permanent: true });
    }
    return;
  }
  const path = remPath(b, at, goals, u, fly, false, true);
  // Other allies still own their tiles; Rem reinforcements themselves do not reserve any tile.
  if (path?.length > 1) {
    u.mem.remLeg = { from: at, to: path[1] };
    advanceMarch(b,u,dt);
  } else u.mem.remPlanAt = b.time + 1;
}
function specials(b, s, u, dt) {
  const type = u.remType;
  if (type === 'food') for (const e of b.foesInRadius(u.x, u.y, .8)) {
    if (e.isFlying || u.mem.remHit.has(e.id)) continue;
    u.mem.remHit.add(e.id);
    b.dealDamage(u, e, { amount: u.s.atk, type: 'phys', tags: ['remFood'] });
  }
  if (type === 'boss' && u.canAct) {
    u.mem.remBomb += dt;
    if (u.mem.remBomb >= 1 - 1e-9) {
      u.mem.remBomb = 0;
      const target = bossField(b) ? lockBoss(b, u) : null;
      const x = target?.x ?? u.x, y = target?.y ?? u.y, amount = 2 * u.s.atk;
      b.fx('remPizza', { x, y, src: u.id, ownerId: u.ownerId, r: .45, t: 1 });
      b.after(1, () => {
        if (b.finished) return;
        b.fx('remPizzaImpact', { x, y, src: u.id, ownerId: u.ownerId, r: .45 });
        for (const e of b.foesInRadius(x, y, .45)) if (!e.isFlying) b.dealDamage(u, e, { amount, type: 'phys', tags: ['remPizza'] });
      });
    }
  }
  if (type === 'enthusiast') u.mem.remStun = Math.min(10, u.mem.remStun + dt);
}
function aura(b, s) {
  const cooks = living(s).filter(u => u.remType === 'chef' && !u.s.flags.silence);
  for (const u of b.allyUnits) {
    if (u.ownerId !== s.ps.playerId || !present(u)) continue;
    const on = cooks.some(c => hypot(c.x - u.x, c.y - u.y) <= 2.5 + 1e-9);
    if (on) b.addBuff(u, { key: 'rem:chef', duration: .45, mods: { resFlat: 15, aspd: u.remType === 'boss' ? 0 : 15 } });
    else b.removeBuff(u, 'rem:chef');
  }
}
export function install(b) {
  b.remBossTarget = u => troopBoss(b, u);
  b.remBossTargets = (u, profile) => bossTargets(b, u, profile);
  b.remTransit = new Set();
  b.remTroops = new Set();
  b.on('death', ({unit}) => {
    if (unit.remMobile) {
      delete unit.mem.remLeg; delete unit.mem.remTarget;
      delete unit.mem.remBossTarget;
      delete unit.mem.remSearchKey; delete unit.mem.remSearchAt;
      delete unit.mem.remCoverageReach;
      unit.moving = false;
    }
    if (!unit.remTransitAnchor) return;
    const k = key(...unit.remTransitAnchor);
    if (b._occ[k] === unit) b._occ[k] = null;
    delete unit.remTransitAnchor;
    delete unit.mem.remLeg;
    unit.moving = false;
    b.remTransit.delete(unit);
  });
  const states = b.players.map(ps => {
    const gates = b.grid.specialTiles('end');
    const home = ps.units[0] ? [ps.units[0].tileR, ps.units[0].tileC] : [10, 3];
    const gate = [...gates].sort((a, c) => distance(a, home) - distance(c, home))[0] ?? home;
    let vehicleStop = [gate[0], gate[1] + (ps.mirror ? -3 : 3)];
    const options = nearby(b, vehicleStop).filter(p => distance(p, gate) >= 3);
    options.sort((a, c) => nearby(b, c).length - nearby(b, a).length || distance(a, vehicleStop) - distance(c, vehicleStop));
    vehicleStop = options[0] ?? gate;
    const exit = b.grid.specialTiles('start').sort((a, c) => distance(a, gate) - distance(c, gate))[0] ?? vehicleStop;
    const airRoute = remPath(b, gate, [exit], null, false, true) ?? [gate, exit];
    const carry = b.kind === 'unite' && Number.isInteger(ps.input.remSurvivalTicks) && ps.input.remSurvivalTicks > 0
      && ps.input.remSurvivalTicks <= 1e9 ? Math.min(survivalCapTicks, ps.input.remSurvivalTicks) : 0;
    return { airRoute, ps, stage: remStage(ps.bonds[REM_BOND]), gate, vehicleStop, exit, units: [], queue: [], appeared: 0, survivalTicks: carry, regular: 0, food: -10, bus: 0, boss: 0, aura: 0 };
  });
  b.remState = new Map(states.map(s => [s.ps.playerId, s]));
  b.remSummon = (owner, count, opts) => { const s = b.remState.get(owner); return s ? request(b, s, count, opts) : 0; };
  b.on('deploy', ({ unit }) => { const s = b.remState.get(unit.ownerId); if (s) refreshSurvival(b, s); });
  b.on('battleStart', () => {
    for (const s of states) if (s.stage) {
      request(b, s, REM_OPENING[s.stage - 1], { source: 'regular', capMode: 'regular' });
      if (s.stage >= 3) { s.queue.push({ type: 'boss', source: 'boss' }); drain(b, s); }
    }
  });
  b.on('attack', ({ attacker: u, targets }) => {
    if (u.remType !== 'enthusiast' || u.mem.remStun < 10 || !targets[0]) return;
    u.mem.remStun = 0;
    const t = targets[0];
    for (const e of b.enemies) if (present(e) && Math.round(e.x) === Math.round(t.x) && Math.round(e.y) === Math.round(t.y)) b.applyStatus(e, 'stun', { duration: 1.5, source: u });
  });
  b.on('tick', ({ dt }) => {
    for (const s of states) {
      if (!s.stage && !s.units.length && !s.queue.length) continue;
      if (s.stage >= 2) {
        s.survivalTicks = Math.min(survivalCapTicks, s.survivalTicks + living(s).length);
        refreshSurvival(b, s);
      }
      if (s.stage) {
        s.regular += dt;
        if (s.regular >= REM_INTERVALS[s.stage - 1] - 1e-9) { s.regular = 0; request(b, s, REM_BATCHES[s.stage - 1], { source: 'regular', capMode: 'regular' }); }
        if (s.stage >= 2) { s.food += dt; if (s.food >= 0) { s.food -= 20; s.queue.push({ type: 'food', source: 'food' }); } }
        if (s.stage >= 3) {
          s.bus += dt; if (s.bus >= 25 - 1e-9) { s.bus = 0; s.queue.push({ type: 'bus', source: 'bus' }); }
          s.boss += dt; if (s.boss >= 30 - 1e-9) { s.boss = 0; if (bosses(s) + s.queue.filter(q => q.type === 'boss').length < 2) s.queue.push({ type: 'boss', source: 'boss' }); }
        }
      }
      for (const u of living(s)) {
        const next = record(u.remType, layers(s), s.stage).stats;
        if (u.base.atk !== next.atk || u.base.maxHp !== next.maxHp || u.base.def !== next.def || u.base.res !== next.res) { Object.assign(u.base, next); u.markDirty(); void u.s; }
        specials(b, s, u, dt); move(b, s, u, dt); }
      drain(b, s);
      s.aura += dt; if (s.aura >= .2 - 1e-9) { s.aura = 0; aura(b, s); }
    }
    // Contact sees all final positions once per tick, rather than rescanning the whole formation for every marcher.
    if (b._remMoved) {
      b._remMoved = false;
      for (const e of b.enemies) if (present(e)) b._checkBlock(e);
      for (const u of b.remTroops) if (u.blocking.length) u.moving = false;
    }
  });
  b.on('battleEnd', () => { for (const s of states) { s.queue.length = 0; for (const u of living(s)) b.retreat(u, { reason: 'remBattleEnd', permanent: true }); } });
}
