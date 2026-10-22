// Rem protocol traits. Only fixed chess garrison identities opt in; native DIY kits are unchanged.
import { garrisonRecord, gainLayers, isMember } from './support/index.js';
import { bodyInKeys } from '../body.js';
import { roundHalfEven } from '../detmath.js';

const BOND = 'remShip';
const up = u => !!u?.alive && u.deployed && !u.removed && !u.hidden;
const adjacent = (a, b) => Math.abs(roundHalfEven(a.x) - roundHalfEven(b.x)) <= 1 && Math.abs(roundHalfEven(a.y) - roundHalfEven(b.y)) <= 1;
const rank = u => u.def?.golden ? 2 : 1;
function traits(u) {
  if (u.kind !== 'op' || u.kazdelSoul) return [];
  return (u.def?.raw?.garrisonIds ?? u.def?.garrisonIds ?? [])
    .map(garrisonRecord).filter(g => g?.eventType === 'IN_BATTLE' && g.effectKey?.startsWith('REM_'))
    .map(g => g.effectKey);
}
function buff(b, u, key, mods) {
  const old = u.findBuff(key);
  if (old && Object.keys(mods).every(k => old.mods?.[k] === mods[k])) return;
  b.addBuff(u, { key, mods });
}

export function install(battle) {
  const entries = battle.allyUnits.flatMap(unit => traits(unit).map(key => ({ unit, key })));
  if (!entries.length) return;
  const owned = (pid, key) => entries.filter(e => e.key === key && e.unit.ownerId === pid && up(e.unit));
  const strongest = (pid, key) => owned(pid, key).sort((a, b) => rank(b.unit) - rank(a.unit))[0]?.unit;
  const reinforcements = new Set();
  const rayProfiles = new WeakMap();
  const regen = new Map(), appeared = new Set(), savageDeaths = new Set(), asbestos = new Map();
  const savageBudget = new Map();
  const savageUnits = entries.filter(e => e.key === 'REM_SAVAGE').map(e => e.unit);
  // The local aura determines each gain; the best Savage deployed this battle determines the shared budget.
  // A later elite deployment can expand it, and losing that elite never takes the budget back.
  const rememberSavage = unit => {
    if (up(unit)) savageBudget.set(unit.ownerId, Math.max(savageBudget.get(unit.ownerId) ?? 0, rank(unit)));
  };
  for (const unit of savageUnits) rememberSavage(unit);
  battle.on('deploy', ({ unit }) => { if (savageUnits.includes(unit)) rememberSavage(unit); });
  const sandTimers = new Map(entries.filter(e => e.key === 'REM_SANDRECKONER').map(e => [e.unit, 0]));
  const touch = unit => {
    if (!up(unit)) return;
    const armor = strongest(unit.ownerId, 'REM_ASBESTOS');
    // A stronger copy elsewhere must not suppress a weaker copy the reinforcement actually passes.
    const passed = owned(unit.ownerId, 'REM_ASBESTOS').filter(e => adjacent(e.unit, unit));
    const power = Math.max(asbestos.get(unit) ?? 0, ...passed.map(e => rank(e.unit)));
    if (armor && power > (asbestos.get(unit) ?? 0)) {
      asbestos.set(unit, power);
      buff(battle, unit, 'rem:asbestos', { defFlat: 20 * power, resFlat: 3 * power });
    }
  };
  battle.on('remSpawned', ({ unit, ownerId }) => {
    if (!unit || ownerId !== unit.ownerId) return;
    reinforcements.add(unit);
    const berry = strongest(ownerId, 'REM_MULBERRY');
    if (berry) regen.set(unit, { next: battle.time + 5, ratio: .05 * rank(berry), source: berry });
    // Count each successfully created owned reinforcement once, even if its event is replayed.
    const firstSpawn = up(unit) && unit.kind === 'token' && unit.remType &&
      battle.unitById(unit.id) === unit && !appeared.has(unit.id);
    if (firstSpawn) appeared.add(unit.id);
    const warmy = strongest(ownerId, 'REM_WARMY');
    if (warmy && firstSpawn) {
      gainLayers(battle, { playerId: ownerId, bonds: BOND, n: rank(warmy), source: warmy,
        reason: 'garrison', cap: 16 * rank(warmy), capKey: `rem:warmy:${ownerId}` });
    }
    touch(unit);
  });
  battle.on('skillStart', ({ unit }) => {
    if (!up(unit) || !entries.some(e => e.unit === unit && e.key === 'REM_JACINTA')) return;
    battle.remSummon?.(unit.ownerId, rank(unit), { poolStage: 1, source: 'jacinta', capMode: 'extra' });
  });
  // `kill` may revive its victim. Only final enemy removal awards layers, once per enemy.
  battle.on('death', ({ unit, reason, killer }) => {
    if (!unit || unit.side !== 'enemy' || reason !== 'killed' || unit.removeReason !== 'killed' || unit.alive || unit.hp > 0 ||
      battle.unitById(unit.id) !== unit || savageDeaths.has(unit.id)) return;
    savageDeaths.add(unit.id);
    if (!killer || killer.side !== 'ally') return;
    const reinforcement = killer.kind === 'token' && killer.remType && reinforcements.has(killer);
    if (!(killer.kind === 'op' && !killer.kazdelSoul && isMember(battle, killer, BOND)) && !reinforcement) return;
    if (battle.unitById(killer.id) !== killer) return;
    const source = owned(killer.ownerId, 'REM_SAVAGE').filter(e => adjacent(e.unit, killer))
      .sort((a, b) => rank(b.unit) - rank(a.unit))[0]?.unit;
    if (!source) return;
    for (const { unit: op } of owned(killer.ownerId, 'REM_SAVAGE')) rememberSavage(op);
    gainLayers(battle, { playerId: killer.ownerId, bonds: BOND, n: 2 * rank(source), source,
      reason: 'garrison', cap: 24 * savageBudget.get(killer.ownerId), capKey: `rem:savage:${killer.ownerId}` });
  }, { priority: -100 });
  battle.on('tick', ({ dt }) => {
    for (const unit of savageUnits) rememberSavage(unit);
    for (const [op, elapsed] of sandTimers) {
      if (!up(op)) continue;
      const time = elapsed + dt, interval = 12 / rank(op);
      if (time + 1e-9 >= interval) {
        sandTimers.set(op, time - interval);
        battle.remSummon?.(op.ownerId, 2, { source: 'sandreckoner', capMode: 'extra' });
      } else sandTimers.set(op, time);
    }
    for (const unit of reinforcements) {
      if (unit.removed || !unit.alive) { reinforcements.delete(unit); regen.delete(unit); asbestos.delete(unit); continue; }
      touch(unit);
      const heal = regen.get(unit);
      if (heal && battle.time + 1e-9 >= heal.next) {
        heal.next += 5;
        battle.heal(heal.source, unit, unit.s.maxHp * heal.ratio);
      }
      const click = owned(unit.ownerId, 'REM_CLICK').filter(e => bodyInKeys(unit, e.unit.rangeKeys)
        && up(e.unit.mem.remMarkedTarget)).sort((a, b) => rank(b.unit) - rank(a.unit))[0]?.unit;
      unit.mem.remGuidedTarget = click?.mem.remMarkedTarget ?? null;
      if (click) buff(battle, unit, 'rem:click', { aspd: 10 * rank(click) });
      else if (unit.findBuff('rem:click')) battle.removeBuff(unit, 'rem:click');
    }
  });
  battle.on('beforeAttack', ctx => {
    const unit = ctx.attacker, marked = unit.mem.remGuidedTarget;
    if (battle.remBossTarget?.(unit)) return;
    if (!reinforcements.has(unit) || !up(marked) || !ctx.targets.length || battle.blockedTargets(unit, ctx.profile).length) return;
    if (battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile).includes(marked)) ctx.targets = [marked];
  }, { priority: -30 });
  battle.on('beforeAttack', ({ attacker, profile }) => {
    if (entries.some(e => e.unit === attacker && e.key === 'REM_RAY')) rayProfiles.set(attacker, profile);
  }, { priority: -100 });
  // Additional arrows are damage, not additional attack transactions: no extra ammo, trance stacks or S2 returns.
  battle.on('attack', ({ attacker: unit, targets }) => {
    if (!entries.some(e => e.unit === unit && e.key === 'REM_RAY') || !up(unit)) return;
    const profile = rayProfiles.get(unit) ?? unit.profile;
    if (profile.tags?.includes('ray:special')) return;
    const extra = battle.enemiesInKeys(unit.rangeKeys, unit, profile)
      .filter(e => !targets.includes(e) && e.blockedBy?.ownerId === unit.ownerId && reinforcements.has(e.blockedBy));
    const amount = unit.s.atk * (rank(unit) === 2 ? .7 : .5) * (profile.atkScale ?? 1) * unit.s.atkScaleMul;
    for (const target of extra) {
      const mul = typeof profile.dmgMul === 'function' ? profile.dmgMul(battle, unit, target) : (profile.dmgMul ?? 1);
      battle.dealDamage(unit, target, { amount: amount * mul * (profile.skillDmgMul ?? 1), type: 'phys', isAttack: false, isSkill: !!profile.isSkill, tags: ['rem:ray'] });
      if (unit.skill?.active && unit.skill.id === 'skchr_ray_3' && target.alive) battle.applyStatus(target, 'bind',
        { duration: Number(unit.skill.bb['attack@unmove_duration']) || 2, source: unit });
      if (profile.onHitStatus && target.alive) battle.applyStatus(target, profile.onHitStatus.key,
        { duration: profile.onHitStatus.duration, source: unit, value: profile.onHitStatus.value });
    }
  });
}
