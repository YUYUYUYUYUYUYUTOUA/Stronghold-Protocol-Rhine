// Rhine research devices and the battle-side protocol traits. Device experience belongs to Match;
// this module consumes its frozen selection and reads the owner's live bond layers only.
import { RHINE_BALANCE as B, RHINE_BOND, RHINE_CHARACTERS as C, RHINE_DEVICES, rhineDevice, rhineCapacity, rhineAttack, rhineDeviceUnlocked, rhineDeviceStage } from '../../../shared/rhineResearch.js';
import { energyPulseRange, researchContainsTile } from '../../../shared/rhineRange.js';
import { frontOf } from '../dir.js';
import { bodyDist, bodyInKeys } from '../body.js';
import { absoluteRangeKeys, canTargetEnemy } from '../targeting.js';
import { canReceiveHeal } from '../damage.js';
import { TICK } from '../constants.js';
import { memberOf, rhineEquipmentAttack } from './items/battle.js';
import { gainLayers, garrisonRecord } from './support/index.js';

const alive = (u) => !!u?.alive && u.deployed && !u.removed && !u.hidden;
const charId = (u) => u.def?.charId ?? u.def?.raw?.charId;
const elite = (u) => !!u.def?.golden;
const layersOf = (ps) => ps?.bonds?.[RHINE_BOND]?.active ? Math.max(0, Number(ps.bonds[RHINE_BOND].layers) || 0) : 0;
// Protocol traits belong to the chess identity. A stand-in keeps them; a same-name DIY body does not.
function researchTrait(unit, effectKey) {
  const ids = unit.def?.raw?.garrisonIds ?? unit.def?.garrisonIds ?? [];
  for (const id of ids) {
    const g = garrisonRecord(id);
    if (g?.eventType === 'IN_BATTLE' && g.effectKey === effectKey) return g.bb ?? {};
  }
  return null;
}
const damageOperator = (u) => u.def?.profession !== 'MEDIC' && charId(u) !== C.saria
  && ['phys', 'arts', 'true'].includes(u.profile?.dmgType ?? u.dmgType);

function inertDevice() {
  return {
    fromTokens: true,
    skill: null,
    trait: { noAttack: true },
    install(battle, unit) {
      unit.base.blockCnt = 0;
      battle.addBuff(unit, { key: 'rhine:device', persist: true, allowDead: true,
        flags: { untargetable: true, invulnerable: true, noBlock: true, noHeal: true } });
    },
  };
}
export const kits = Object.freeze(Object.fromEntries(RHINE_DEVICES.map((d) => [d.tokenId, inertDevice])));

/** Validate the frozen selection again at the sim boundary, including per-owner uniqueness and capacity. */
function selectedDevices(ps) {
  const bond = ps.bonds?.[RHINE_BOND];
  if (!bond?.active || !(bond.count >= B.thresholds[0]) || !ps.input.research?.active) return [];
  const cap = rhineCapacity(bond);
  const out = [], seen = new Set();
  for (const entry of ps.input.research.devices ?? []) {
    const d = rhineDevice(entry?.key);
    if (!d || !rhineDeviceUnlocked(d, bond) || !entry.onBoard || entry.tokenId !== d.tokenId || seen.has(d.key)) continue;
    const unit = ps.units.find((u) => u.uid === entry.uid && u.kind === 'token' && u.defId === d.tokenId);
    if (!unit) continue;
    seen.add(d.key);
    out.push({ unit, key: d.key, stage: rhineDeviceStage(d, entry.stage) });
    if (out.length >= cap) break;
  }
  return out;
}

/** Only layer-derived research and mainframe bonuses enter base ATK; no buffs or inherited ATK. */
export function deviceBaseAttack(battle, unit) {
  const ps = battle.getPlayer(unit.ownerId);
  const layers = layersOf(ps);
  return rhineAttack(layers) + rhineEquipmentAttack(battle, unit.ownerId, layers);
}

function setPassive(battle, unit, key, mods) {
  const old = unit.findBuff(key);
  if (old && Object.keys(mods).every((k) => old.mods?.[k] === mods[k])) return;
  battle.addBuff(unit, { key, mods, persist: true, allowDead: true });
}

export function install(battle) {
  const states = [];
  for (const ps of battle.players) {
    const entries = selectedDevices(ps);
    for (const entry of entries) {
      entry.unit.researchStage = entry.stage;
      entry.unit.researchActive = false;
      if (entry.key === 'energy') {
        entry.unit.researchCharges = 0;
        entry.unit.researchChargeMax = B.energyCharges;
      }
      if (entry.key === 'laser') {
        entry.unit.researchLaserTarget = null;
        entry.unit.researchLaserProgress = 0;
        entry.unit.researchLaserActive = false;
      }
      states.push({ ...entry, ps, charges: 0, contributors: new Map(), active: false, ecologyWork: 0, pulsing: false,
        lastPulse: -Infinity, lastWork: -Infinity, laserTarget: null, laserProgress: 0, laserTime: 0, laserWork: 0, laserTrue: 0 });
    }
  }
  const enabled = (s) => alive(s.unit) && selectedDevices(s.ps).some((d) => d.unit === s.unit);
  let ready = false;
  const ecologyFx = (s, active, bind = false) => battle.fx('rhineEcology', {
    x: s.unit.x, y: s.unit.y, source: s.unit.id, stage: s.stage, active,
    radius: B.radius + (s.stage >= 2 ? 1 : 0), continuous: true, duration: B.ecologyInterval, bind,
  });
  // Use the engine's ally-side selector: unrevealed, unblocked stealth enemies cannot be selected by a device.
  const targets = (s, radius = B.radius) => battle.foesInRadius(s.unit.x, s.unit.y, radius + Math.SQRT1_2)
    .filter(u => researchContainsTile(u, s.unit.x, s.unit.y, radius));
  const setCharges = (s, charges) => {
    s.charges = Math.min(B.energyCharges, Math.max(0, charges));
    charges = s.charges;
    if (s.key === 'energy' && s.unit.researchCharges !== charges) {
      s.unit.researchCharges = charges;
      s.unit.markDirty();
    }
  };

  const refresh = () => {
    for (const s of states) {
      const atk = deviceBaseAttack(battle, s.unit);
      if (s.unit.base.atk !== atk) { s.unit.base.atk = atk; s.unit.markDirty(); }
      const active = enabled(s);
      if (s.active !== active) {
        s.active = active;
        s.unit.researchActive = active;
        s.unit.markDirty();
        if (ready && s.key === 'medical') ecologyFx(s, active);
      }
      if (!active) { setCharges(s, 0); s.contributors.clear(); s.ecologyWork = 0; }
    }
    for (const ps of battle.players) {
      const layers = layersOf(ps);
      const deviceAttacks = states.filter((s) => s.ps === ps && enabled(s)).map((s) => deviceBaseAttack(battle, s.unit));
      const highest = Math.max(0, ...deviceAttacks);
      const sharing = ps.bonds?.[RHINE_BOND]?.active && ps.bonds[RHINE_BOND].count >= B.sharingCount;
      for (const u of ps.units) {
        if (u.kind !== 'op') continue;
        const healing = researchTrait(u, 'RHINE_SARIA_HEALING');
        const inheritance = researchTrait(u, 'RHINE_IFRIT_INHERITANCE');
        if (healing) setPassive(battle, u, 'rhine:saria', { healingDealtMul: 1 + Math.floor(layers / Math.max(1, Number(healing.layer_step) || B.sariaLayerStep)) * (Number(healing.heal) || 0) });
        if (inheritance) setPassive(battle, u, 'rhine:ifrit', { atkFlat: highest * (Number(inheritance.atk_scale) || 0) });
        const shared = sharing && alive(u) && !inheritance && charId(u) !== C.ifrit && damageOperator(u) && memberOf(battle, u, RHINE_BOND)
          ? highest * B.researchSharing[elite(u) ? 1 : 0] : 0;
        if (shared > 0) setPassive(battle, u, 'rhine:sharing', { atkFlat: shared });
        else if (u.findBuff('rhine:sharing')) battle.removeBuff(u, 'rhine:sharing');
      }
    }
  };
  battle.on('battleStart', refresh);
  battle.on('deploy', refresh);
  battle.on('death', refresh);
  battle.on('rhineEquipmentChange', refresh);
  // layerGain is emitted before the engine writes the live count. Run after that transaction.
  battle.on('layerGain', ({ bondId }) => { if (bondId === RHINE_BOND) battle.after(0, refresh); });
  battle.on('tick', refresh, { priority: 100 });

  // One completed device action credits the strongest live Mayer facing that device, never each target/copy.
  const worked = (s, interval = 0) => {
    if (!enabled(s)) return;
    if (battle.time - s.lastWork < interval - 1e-9) return;
    s.lastWork = battle.time;
    let source = null, n = 0;
    for (const u of s.ps.units) {
      if (u.kind !== 'op' || !alive(u)) continue;
      const research = researchTrait(u, 'RHINE_MAYER_RESEARCH');
      if (!research) continue;
      const [r, c] = frontOf(u.tileR, u.tileC, u.dir);
      const amount = Math.max(0, Number(research.device_layers) || 0);
      if (r === s.unit.tileR && c === s.unit.tileC && amount > n) { source = u; n = amount; }
    }
    if (source) gainLayers(battle, { playerId: s.unit.ownerId, bonds: RHINE_BOND, n, source, reason: 'garrison' });
  };

  const medicalRadius = (s) => B.radius + (s.stage >= 2 ? 1 : 0);
  const medicalShieldKey = (s) => `rhine:overheal:${s.unit.id}`;
  // Any successful treatment in the field can power an upgraded medical device. This observer never heals,
  // and runs only after the mutable heal transaction has finished (including all normal bonuses / hooks).
  battle.on('healResolved', ({ target, amount, overheal, opts }) => {
    if (!(amount > 0) || opts?.regen || target.kind !== 'op' || !alive(target) || target.s.flags.healFree) return;
    for (const s of states) {
      if (s.key !== 'medical' || s.stage < 1 || !enabled(s) || target.ownerId !== s.unit.ownerId
        || !battle.allySelectable(target, s.unit) || !researchContainsTile(target, s.unit.x, s.unit.y, medicalRadius(s))) continue;
      const key = medicalShieldKey(s), previous = target.findBuff(key)?.shield ?? 0;
      const extra = amount * B.medicalShieldHealRatio + overheal * B.medicalShieldRatio;
      const shield = Math.min(target.s.maxHp * B.medicalShieldCap, previous + extra);
      battle.addBuff(target, { key, shield, duration: B.medicalShieldDuration, source: s.unit });
      if (shield > previous + 1e-9) worked(s, B.ecologyResearchInterval);
    }
  });
  const medical = (s) => {
    if (!enabled(s)) return;
    refresh();
    const eligible = s.ps.units.filter((u) => alive(u) && battle.allySelectable(u, s.unit) && !rhineDevice(u.defId) && !u.bossPool && canReceiveHeal(s.unit, u)
      && researchContainsTile(u, s.unit.x, s.unit.y, medicalRadius(s)) && (u.hp < u.s.maxHp || (s.stage >= 1 && u.kind === 'op')));
    const key = medicalShieldKey(s);
    eligible.sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp
      || (a.findBuff(key)?.shield ?? 0) - (b.findBuff(key)?.shield ?? 0) || a.id - b.id);
    let effective = false;
    const amount = deviceBaseAttack(battle, s.unit) * B.medicalHealScale[s.stage];
    for (const target of eligible.slice(0, B.medicalTargetCount[s.stage])) {
      const previous = target.findBuff(key)?.shield ?? 0;
      const actual = battle.heal(s.unit, target, amount);
      const shielded = (target.findBuff(key)?.shield ?? 0) > previous + 1e-9;
      effective ||= actual > 0;
      if (actual > 0 || shielded) battle.fx('rhineHeal', { x: target.x, y: target.y, source: s.unit.id, target: target.id, stage: s.stage });
    }
    if (effective) worked(s, B.ecologyResearchInterval);
  };

  const pulse = (s) => {
    if (!enabled(s) || s.pulsing || s.charges < B.energyCharges || battle.time - s.lastPulse < B.energyPulseInterval - 1e-9) return;
    const enemies = targets(s, B.radius + (s.stage >= 1 ? 1 : 0)).sort((a, b) => bodyDist(a, s.unit.x, s.unit.y) - bodyDist(b, s.unit.x, s.unit.y) || a.id - b.id);
    if (!enemies.length) return;
    const primary = enemies[0];
    const range = energyPulseRange(s.stage);
    const row = Math.round(primary.y), col = Math.round(primary.x);
    const keys = range.tileBased ? absoluteRangeKeys(range.grid, row, col, 'RIGHT') : null;
    const hit = s.stage === 0 ? enemies : keys ? battle.foesInRadius(col, row, range.radius + Math.SQRT1_2).filter((u) => bodyInKeys(u, keys))
      : battle.foesInRadius(primary.x, primary.y, range.radius, true);
    const amount = deviceBaseAttack(battle, s.unit) * B.energyPulseScale[s.stage];
    // Consume only after finding a selectable primary, before damage hooks can cause another skill start.
    s.pulsing = true;
    s.lastPulse = battle.time;
    setCharges(s, 0);
    try {
      for (const target of hit) battle.dealDamage(s.unit, target, { type: 'arts', amount, canDodge: false, tags: ['rhinePulse'] });
      battle.fx('rhinePulse', { x: primary.x, y: primary.y, fromX: s.unit.x, fromY: s.unit.y, source: s.unit.id, target: primary.id, stage: s.stage });
      worked(s);
    } finally { s.pulsing = false; }
  };
  battle.on('skillStart', ({ unit, skill, reason }) => {
    // A carried active skill merely resumes in a unite field; passive deployment is not a cast either.
    if (unit?.kind !== 'op' || !alive(unit) || reason === 'carry' || skill?.kind === 'passive') return;
    refresh();
    for (const s of states) {
      if (s.key !== 'energy' || !enabled(s) || unit.ownerId !== s.unit.ownerId
        || (s.stage < 1 && !researchContainsTile(unit, s.unit.x, s.unit.y, B.radius))) continue;
      const last = s.contributors.get(unit.id) ?? -Infinity;
      if (battle.time - last < B.energyContributorCooldown - 1e-9) continue;
      s.contributors.set(unit.id, battle.time);
      setCharges(s, s.charges + 1);
      pulse(s);
    }
  });

  const ecology = (s, bind = true) => {
    if (!enabled(s)) return;
    if (bind && s.stage >= 2) for (const target of targets(s, medicalRadius(s))) {
      battle.applyStatus(target, 'bind', { duration: B.ecologyBindDuration, source: s.unit });
    }
    ecologyFx(s, true, bind && s.stage >= 2);
  };
  const laserFx = (s, active) => {
    const target = s.laserTarget;
    battle.fx('rhineLaser', { source: s.unit.id, target: target?.id ?? null,
      fromX: s.unit.x, fromY: s.unit.y, x: target?.x ?? s.unit.x, y: target?.y ?? s.unit.y,
      active, progress: s.laserProgress });
  };
  const laserActive = (s, active) => {
    if (s.unit.researchLaserActive === active) return;
    s.unit.researchLaserActive = active;
    s.unit.markDirty();
    laserFx(s, active);
  };
  const clearLaser = (s) => {
    s.laserTarget = null;
    s.laserProgress = s.laserTime = s.laserWork = s.laserTrue = 0;
    s.unit.researchLaserTarget = null;
    s.unit.researchLaserProgress = 0;
    s.unit.researchLaserActive = false;
    s.unit.markDirty();
    // Publish the cleared lock even if the beam was already paused, or no successor will emit another event.
    laserFx(s, false);
  };
  const laserSelectable = (s, target) => !target.removed && canTargetEnemy(s.unit, target, { canHitFly: true });
  const laser = (s, dt) => {
    if (!enabled(s)) { if (s.laserTarget) clearLaser(s); return; }
    // A temporary disappearance, sleep, invulnerability or target-selection exclusion holds the lock.
    // Only death / permanent removal permits a fresh max-panel-HP selection.
    if (s.laserTarget && (!s.laserTarget.alive || s.laserTarget.removed)) clearLaser(s);
    if (!s.laserTarget) {
      const target = battle.enemies.filter((u) => laserSelectable(s, u))
        .sort((a, b) => b.s.maxHp - a.s.maxHp || a.id - b.id)[0];
      if (!target) return;
      s.laserTarget = target;
      s.unit.researchLaserTarget = target.id;
      s.unit.markDirty();
    }
    const target = s.laserTarget;
    if (!laserSelectable(s, target) || target.s.flags.invulnerable) {
      laserActive(s, false);
      s.laserTime = 0;
      return;
    }
    laserActive(s, true);
    s.laserTime += dt;
    while (s.laserTime >= B.laserTick - 1e-9 && target.alive && !target.removed && laserSelectable(s, target) && !target.s.flags.invulnerable) {
      s.laserTime = Math.max(0, s.laserTime - B.laserTick);
      const beforeShield = target.s.shield, beforeProgress = s.laserProgress;
      const ramp = 1 + Math.floor(Math.min(B.laserRampSeconds, beforeProgress) + 1e-9) * B.laserRampPerSecond;
      const dealt = battle.dealDamage(s.unit, target, { type: 'arts', amount: deviceBaseAttack(battle, s.unit) * B.laserBaseScale * ramp * B.laserTick,
        canDodge: false, resIgnorePct: -s.unit.s.resIgnorePct, resIgnoreFlat: -s.unit.s.resIgnoreFlat, tags: ['rhineLaser'] });
      // Absorbed HP-shield damage is output too; a cancelled hit contributes no ramp or research time.
      if (dealt > 0 || target.s.shield < beforeShield) {
        s.laserProgress = Math.min(B.laserRampSeconds, beforeProgress + B.laserTick);
        s.unit.researchLaserProgress = s.laserProgress;
        s.unit.markDirty();
        s.laserWork += B.laserTick;
        if (s.laserWork >= B.laserResearchInterval - 1e-9) {
          s.laserWork = Math.max(0, s.laserWork - B.laserResearchInterval);
          worked(s, B.laserResearchInterval);
        }
        if (beforeProgress >= B.laserRampSeconds - 1e-9) {
          s.laserTrue += B.laserTick;
          while (s.laserTrue >= B.laserTrueInterval - 1e-9 && target.alive && !target.removed) {
            s.laserTrue = Math.max(0, s.laserTrue - B.laserTrueInterval);
            const maxHp = target.bossPool?.maxHp ?? target.s.maxHp;
            battle.dealDamage(s.unit, target, { type: 'true', amount: maxHp * B.laserTrueHpRatio,
              canDodge: false, tags: ['rhineLaser', 'rhineLaserTrue'] });
          }
        }
      }
      laserFx(s, true);
    }
    if (!target.alive || target.removed) laserActive(s, false);
  };
  battle.on('battleStart', () => {
    ready = true;
    for (const s of states) if (s.key === 'medical') ecology(s, false);
  });
  battle.on('tick', ({ dt = TICK }) => {
    for (const s of states) {
      if (s.key === 'energy') { pulse(s); continue; }
      if (s.key === 'laser') { laser(s, dt); continue; }
      if (s.key !== 'medical' || !enabled(s)) continue;
      const inRange = targets(s, medicalRadius(s));
      for (const target of inRange) battle.applyStatus(target, 'slow', { value: B.ecologySlow, duration: TICK * 2, source: s.unit });
      if (inRange.length) {
        s.ecologyWork += dt;
        if (s.ecologyWork >= B.ecologyResearchInterval - 1e-9 && battle.time - s.lastWork >= B.ecologyResearchInterval - 1e-9) {
          s.ecologyWork = Math.max(0, s.ecologyWork - B.ecologyResearchInterval);
          worked(s, B.ecologyResearchInterval);
        }
      }
    }
  });
  for (const s of states) {
    if (s.key === 'medical') {
      battle.every(B.medicalInterval, () => medical(s));
      battle.every(B.ecologyInterval, () => ecology(s));
    }
  }
}
