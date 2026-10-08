// Kazdel fan covenant (owner decision, 2026-10-09). Death resources, souls and the external cannon are separate.
import { KAZDEL_BOND as BOND, KAZDEL_BALANCE as B, KAZDEL_CANNON as C, KAZDEL_GARRISON_KEYS as G, kazdelStage } from '../../../shared/kazdel.js';
import { gainLayers, garrisonRecord, isMember } from './support/index.js';
import { createSoul, refreshSoul } from './kazdel/souls.js';
import { cannonSource, tickCannon } from './kazdel/cannon.js';

const present = u => !!u?.alive && u.deployed && !u.hidden && !u.removed;
const soulOrBody = u => present(u) || present(u?.kazdelSoulUnit);
const member = (battle, u) => u.kind === 'op' && isMember(battle, u, BOND);
const layersOf = s => s.stage ? Math.max(0, Number(s.ps.bonds[BOND]?.layers) || 0) : 0;

export function kazdelTrait(unit, key) {
  for (const id of unit.def?.raw?.garrisonIds ?? unit.def?.garrisonIds ?? []) {
    const record = garrisonRecord(id);
    if (record?.eventType === 'IN_BATTLE' && record.effectKey === G[key]) return record.bb ?? {};
  }
  return null;
}
const gain = (battle, s, source, bonds, n, cap = Infinity, capKey = null) => gainLayers(battle, {
  playerId: s.ps.playerId, source, bonds, n, reason: 'garrison', cap, capKey,
});
function bestAura(state, key, victim = null) {
  let best = null;
  for (const u of state.originals) {
    const bb = kazdelTrait(u, key);
    if (!bb || !(soulOrBody(u) || u === victim)) continue;
    const strength = key === 'hoederer' ? bb.layer : bb.damage_bonus;
    const current = best && (key === 'hoederer' ? best.bb.layer : best.bb.damage_bonus);
    if (!best || strength > current) best = { unit: u, bb };
  }
  return best;
}
function qualifiedDeath(battle, s, u) {
  if (s.deaths.has(u)) return;
  s.deaths.add(u);
  if (s.stage >= C.friendlyFireStage) s.charge = Math.min(C.capacity, s.charge + C.deathCharge);
  const v = kazdelTrait(u, 'vigna');
  if (v) gain(battle, s, u, ['kazdelShip', 'skillfulShip'], v.layer);
  const o = kazdelTrait(u, 'odda');
  if (o) gain(battle, s, u, ['kazdelShip', 'steadShip'], o.layer * (u.mem.kazdelParticipatedKills?.size ?? 0), o.max_layer, `kazdel:odda:${u.id}`);
  const h = bestAura(s, 'hoederer', u);
  if (h) gain(battle, s, h.unit, BOND, h.bb.layer, h.bb.max_layer, `kazdel:hoederer:${s.ps.playerId}`);
}
function updatePassives(battle, s, states) {
  const layers = layersOf(s);
  for (const u of s.originals) if (member(battle, u)) {
    const old = u.findBuff('kazdel:body');
    if (old?.mods?.hpFinal !== B.bodyHpPerLayer * layers) battle.addBuff(u, {
      key: 'kazdel:body', persist: true, allowDead: true, mods: { hpFinal: B.bodyHpPerLayer * layers },
    });
  }
  for (const soul of s.souls) if (present(soul)) {
    refreshSoul(battle, soul, layers, kazdelTrait);
    let aspd = 0;
    for (const u of states.flatMap(state => state.originals)) {
      const bb = kazdelTrait(u, 'tinman'), source = present(u) ? u : present(u.kazdelSoulUnit) ? u.kazdelSoulUnit : null;
      if (bb && source && source !== soul && Math.abs(source.tileR - soul.tileR) <= bb.radius && Math.abs(source.tileC - soul.tileC) <= bb.radius) aspd = Math.max(aspd, bb.aspd);
    }
    battle.addBuff(soul, { key: 'kazdel:tinman', mods: { aspd }, persist: true });
  }
}

export function install(battle) {
  const states = battle.players.map(ps => ({ ps, stage: kazdelStage(ps.bonds[BOND]),
    originals: ps.units.filter(u => u.kind === 'op'), souls: [], deaths: new Set(), soulCreated: new Set(),
    charge: 0, warning: null, lastFireAt: -Infinity, cannon: cannonSource(ps, kazdelStage(ps.bonds[BOND])),
  }));
  if (!states.some(s => s.stage || s.originals.some(u => Object.keys(G).some(k => kazdelTrait(u, k))))) return;
  const byOwner = new Map(states.map(s => [s.ps.playerId, s]));
  battle._kazdelView = () => states.filter(s => s.stage).map(s => ({ ownerId: s.ps.playerId, stage: s.stage,
    layers: layersOf(s), charge: s.charge, maxCharge: C.capacity, rate: C.chargePerSec + C.chargePerLayer * layersOf(s),
    warning: s.warning ? { ...s.warning } : null, lastFireAt: Number.isFinite(s.lastFireAt) ? s.lastFireAt : null }));
  const onFire = s => {
    const w = bestAura(s, 'wisdel');
    if (w) for (const soul of s.souls) if (present(soul)) soul.mem.kazdelNextAttackBonus = w.bb.next_attack_bonus;
  };
  battle.on('battleStart', () => { for (const s of states) updatePassives(battle, s, states); }, { priority: -100 });
  battle.on('tick', ({ dt }) => {
    for (const s of states) { updatePassives(battle, s, states); tickCannon(battle, s, dt, layersOf(s), onFire); }
  }, { priority: -50 });
  // Track actual positive body damage, then count distinct enemies that really die; soul damage never feeds Odda.
  battle.on('damaged', ({ credit, source, target, amount }) => {
    const unit = credit ?? source;
    if (!(amount > 0) || target.side !== 'enemy' || unit?.kind !== 'op' || !kazdelTrait(unit, 'odda')) return;
    const owners = target.mem.kazdelContributors ?? (target.mem.kazdelContributors = new Set());
    owners.add(unit);
  });
  battle.on('death', ctx => {
    const { unit: u, reason, dmg } = ctx;
    if (u.kazdelSoul) {
      battle.fx('kazdelSoulEnd', { x: u.x, y: u.y, id: u.id, soulOf: u.ownerUnit?.id, reason });
      return;
    }
    if (reason !== 'killed' || u.alive || battle.finished) return;
    if (u.side === 'enemy') {
      for (const owner of u.mem.kazdelContributors ?? []) {
        (owner.mem.kazdelParticipatedKills ?? (owner.mem.kazdelParticipatedKills = new Set())).add(u.id);
      }
      return;
    }
    const s = byOwner.get(u.ownerId);
    if (!s || !member(battle, u)) return;
    if (!dmg?.tags?.includes('kazdelCannon')) qualifiedDeath(battle, s, u);
    if (s.stage && !s.soulCreated.has(u)) {
      s.soulCreated.add(u);
      const soul = createSoul(battle, u, layersOf(s), kazdelTrait);
      if (soul) s.souls.push(soul);
    }
    updatePassives(battle, s, states);
  }, { priority: -100 });
  battle.on('hit', ({ source, target, dmg }) => {
    const s = byOwner.get(source?.ownerId);
    if (!s || source?.kazdelCannon) return;
    const owner = source.kazdelSoul ? source.ownerUnit : source;
    const m = kazdelTrait(owner, 'meteorite');
    if (m && target.blockedBy?.kazdelSoul && target.blockedBy.side === source.side) dmg.mul *= 1 + m.damage_bonus;
    if (source.kazdelSoul) {
      const w = bestAura(s, 'wisdel');
      if (w) dmg.mul *= 1 + w.bb.damage_bonus;
    }
  });
  battle.on('healResolved', ({ source, target, actual }) => {
    if (target.kazdelSoul && actual > 0) battle.fx('kazdelSoulHeal', { source: source?.id, target: target.id, x: target.x, y: target.y });
  });
  battle.on('battleEnd', () => {
    for (const s of states) {
      s.warning = null;
      s.charge = 0;
      for (const soul of s.souls) if (soul.alive) battle.retreat(soul, { reason: 'kazdelBattleEnd', permanent: true });
    }
  }, { priority: -100 });
}
