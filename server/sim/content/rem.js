// Rim Billiton allies. Player-local generation, deterministic tile marching and finite vehicle routes.
import { REM_BOND, REM_LIMITS, REM_INTERVALS, REM_BATCHES, REM_OPENING, remStage, remPick } from '../../../shared/rem.js';
import { COLS } from '../constants.js';
import { hypot } from '../detmath.js';
import { isMember } from './support/index.js';

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
// Count successful creations, including vehicles, bosses and bypass sources; deaths never subtract appearances.
function refreshAppearance(b, s) {
  if (s.stage < 2) return;
  const pct = s.stage >= 3 ? Math.min(300, s.appeared * 8) / 100 : Math.min(200, s.appeared * 4) / 100;
  for (const u of s.ps.units) {
    if (u.kind !== 'op' || !isMember(b, u, REM_BOND)) continue;
    if (u.findBuff('rem:appearance')?.mods?.atkPct === pct) continue;
    b.addBuff(u, { key: 'rem:appearance', mods: { atkPct: pct, hpPct: pct }, persist: true, allowDead: true });
  }
}
function record(type, S) {
  const miner = type === 'miner' || type === 'combined';
  const chef = type === 'chef', boss = type === 'boss', vehicle = type === 'food' || type === 'bus';
  const atk = boss ? 400 + S : type === 'food' ? 1500 + 5 * S : type === 'bus' ? 0 : miner ? 500 + S + (type === 'combined' ? 600 : 0) : chef ? 200 + .5 * S : 450 + .75 * S;
  return { name: names[type], spine: art[type], avatar: art[type], stats: { maxHp: miner || type === 'enthusiast' ? 1800 + 5 * S : chef ? 1600 + 4 * S : 1200 + 3 * S,
    atk, def: miner || type === 'enthusiast' ? 200 + (type === 'combined' ? 800 : 0) : chef ? 150 : 100, res: miner || type === 'enthusiast' ? 10 : chef ? 20 : 0,
    bat: miner || chef || type === 'enthusiast' ? 2.5 : 2.4, aspd: 100, blockCnt: chef || boss || vehicle ? 0 : 1,
    moveSpeed: 1, respawnTime: 0, cost: 0, hpRecoveryPerSec: 0, spRecovery: 0 },
  rangeGrid: [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]], dmgType: chef ? 'arts' : 'phys', attackKind: 'melee', canHitFly: false,
  };
}
function spawn(b, s, type, source, point = s.gate) {
  if (!free(b, ...point, null, type === 'boss')) return null;
  const u = b.spawnToken(s.ps.playerId, `token_rem_${type}`, ...point, { def: record(type, layers(s)), kit: { trait: { noAttack: special(type) }, install(_battle, unit) { if (type === 'boss') unit.motion = 'FLY'; } } });
  if (!u) return null;
  u.remType = type; u.remCounted = !special(type) && source !== 'jacinta'; u.remSource = source;
  u.mem.remBomb = 0; u.mem.remStun = 0; u.mem.remHit = new Set();
  if (type === 'boss') { u.x = s.gate[1]; u.y = s.gate[0]; u.mem.remAirIndex = 0; u.mem.remAirDirection = 1; u.ground = false; b.addBuff(u, { key: 'rem:flight', persist: true, flags: { liftoff: true, noBlock: true } }); }
  if (type === 'food' || type === 'bus') b.addBuff(u, { key: 'rem:vehicle', persist: true, flags: { noBlock: true } });
  s.units.push(u);
  s.appeared++;
  refreshAppearance(b, s);
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
  if (!b.grid.groundPassable(...leg.to) || b.downOn(...leg.to)) leg.to = leg.from;
  u.remTransitAnchor ??= leg.from;
  b.remTransit.add(u);
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
    if (free(b,r,c,u)) b.relocate(u,r,c);
  }
  for (const e of b.enemies) if (present(e)) b._checkBlock(e);
  if (u.blocking.length) u.moving=false;
}
function move(b, s, u, dt) {
  u.moving = false;
  if (!u.canAct || u.s.flags.noMove || u.blocking.length) return;
  const type = u.remType, vehicle = special(type), fly = type === 'boss';
  // A flyer retains a reserved off-road home tile, like Yan's moving summon. Its world
  // position follows the ground route without occupying or blocking that ground corridor.
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
  // Blocking uses fractional world coordinates; range keys follow the current tile as in the engine.
  if (!vehicle && b.enemiesInKeys(u.rangeKeys, u, u.profile).length) return;
  if (u.mem.remLeg) { advanceMarch(b,u,dt); return; }
  if ((u.mem.remPlanAt || 0) > b.time + 1e-9) return;
  const at = [u.tileR, u.tileC];
  const inRally = (r, c) => Math.max(Math.abs(r - s.rally[0]), Math.abs(c - s.rally[1])) <= 1;
  // Tour the rendezvous's eight neighbours; the centre is a legal transit tile.
  // A fixed rotating order keeps the simulation deterministic and patrol paths inside the 3x3 area.
  if (!vehicle && u.mem.remSettled && !inRally(...at)) u.mem.remSettled = false;
  if (!vehicle && inRally(...at) && free(b, ...at, u) && !u.remTransitAnchor) u.mem.remSettled = true;
  if (!vehicle && u.mem.remSettled) {
    const ring = [[-1,-1],[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1]];
    const start = u.mem.remPatrolIndex ?? u.id % ring.length;
    for (let i = 0; i < ring.length; i++) {
      const index = (start + i) % ring.length, [dr, dc] = ring[index];
      const goal = [s.rally[0] + dr, s.rally[1] + dc];
      if ((goal[0] === at[0] && goal[1] === at[1]) || !free(b, ...goal, u)) continue;
      const path = remPath(b, at, [goal], u, false, false, true, inRally);
      if (path?.length > 1) {
        u.mem.remPatrolIndex = (index + 1) % ring.length;
        u.mem.remLeg = { from: at, to: path[1] };
        advanceMarch(b, u, dt);
        return;
      }
    }
    if (u.remTransitAnchor) {
      const path = remPath(b, at, [u.remTransitAnchor], u, false, false, true, inRally);
      if (path?.length > 1) {
        u.mem.remLeg = { from: at, to: path[1] };
        advanceMarch(b, u, dt);
        return;
      }
      if (path?.length === 1) b.relocate(u, ...at);
    }
    u.mem.remPlanAt = b.time + 1;
    return;
  }
  let goals;
  if (type === 'food' || fly) {
    const end = u.mem.remReturn ? s.gate : s.exit;
    goals = [end, ...[[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dr, dc]) => [end[0] + dr, end[1] + dc])];
  }
  else if (type === 'bus') goals = nearby(b, s.rally).filter(p => distance(p, s.gate) > 0);
  else {
    // Fill deepest reachable route positions first, not the first radius tile encountered.
    // Manhattan distance gives the wrong order on winding single-lane maps.
    const candidates = nearby(b, s.rally, 1).filter(p => distance(p, s.gate) > 0 && free(b, ...p, u))
      .sort((a, c) => (s.depth.get(key(...c)) ?? 0) - (s.depth.get(key(...a)) ?? 0) || distance(a, s.rally) - distance(c, s.rally) || a[0] - c[0] || a[1] - c[1]);
    goals = [];
    for (const candidate of candidates) if (remPath(b, [u.tileR, u.tileC], [candidate], u, false, false, true)) { goals = [candidate]; break; }
  }
  goals = goals.filter(p => free(b,...p,u,fly));
  if (vehicle && goals.length && !remPath(b, [u.tileR,u.tileC], goals, u, fly, false, true)) goals = [];
  // If the rally filled while this unit was crossing, return to its still-reserved free tile.
  const returningToAnchor = !goals.length && !!u.remTransitAnchor;
  if (returningToAnchor) goals = [u.remTransitAnchor];
  if (goals.some(p => p[0] === at[0] && p[1] === at[1])) {
    // An ally can leave during transit: commit the now-free landing tile before settling/unloading.
    if (u.remTransitAnchor && !b.relocate(u,...at)) return;
    u.mem.remPlanAt = b.time + 1;
    if (returningToAnchor) return;
    if (fly) u.mem.remReturn = !u.mem.remReturn;
    else if (type === 'food') b.retreat(u, { reason: 'remRouteEnd', permanent: true });
    else if (type === 'bus') {
      request(b, s, 5, { source: 'bus', point: [u.tileR, u.tileC] });
      b.retreat(u, { reason: 'remPassengersOut', permanent: true });
    } else u.mem.remSettled = true;
    return;
  }
  const path = remPath(b, at, goals, u, fly, false, true);
  // Only transit may share an ally's tile. Destinations and retained reservations remain exclusive.
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
      const x = u.x, y = u.y, amount = u.s.atk;
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
  b.remTransit = new Set();
  b.on('death', ({unit}) => {
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
    let rally = ps.input.remRally ? b.mapTile(ps, ps.input.remRally.row, ps.input.remRally.col) : [gate[0], gate[1] + (ps.mirror ? -3 : 3)];
    if (!ps.input.remRally) {
      const options = nearby(b, rally).filter(p => distance(p, gate) >= 3);
      options.sort((a, c) => nearby(b, c).length - nearby(b, a).length || distance(a, rally) - distance(c, rally));
      rally = options[0] ?? gate;
    }
    const exit = b.grid.specialTiles('start').sort((a, c) => distance(a, gate) - distance(c, gate))[0] ?? rally;
    const airRoute = remPath(b, gate, [exit], null, false, true) ?? [gate, exit];
    const depth = new Map();
    for (const p of nearby(b, rally)) { const path = remPath(b, gate, [p], null, false, true); if (path) depth.set(key(...p), path.length); }
    const carry = b.kind === 'unite' && Number.isInteger(ps.input.remAppearances) && ps.input.remAppearances > 0
      && ps.input.remAppearances <= 1e9 ? ps.input.remAppearances : 0;
    return { airRoute, depth, ps, stage: remStage(ps.bonds[REM_BOND]), gate, rally, exit, units: [], queue: [], appeared: carry, regular: 0, food: -10, bus: 0, boss: 0, aura: 0 };
  });
  b.remState = new Map(states.map(s => [s.ps.playerId, s]));
  b.remSummon = (owner, count, opts) => { const s = b.remState.get(owner); return s ? request(b, s, count, opts) : 0; };
  b.on('deploy', ({ unit }) => { const s = b.remState.get(unit.ownerId); if (s) refreshAppearance(b, s); });
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
        const next = record(u.remType, layers(s)).stats;
        if (u.base.atk !== next.atk || u.base.maxHp !== next.maxHp) { Object.assign(u.base, next); u.markDirty(); void u.s; }
        specials(b, s, u, dt); move(b, s, u, dt); }
      drain(b, s);
      s.aura += dt; if (s.aura >= .2 - 1e-9) { s.aura = 0; aura(b, s); }
    }
  });
  b.on('battleEnd', () => { for (const s of states) { s.queue.length = 0; for (const u of living(s)) b.retreat(u, { reason: 'remBattleEnd', permanent: true }); } });
}
