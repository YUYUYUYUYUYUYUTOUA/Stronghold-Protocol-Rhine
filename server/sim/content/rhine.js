// Rhine research devices and the battle-side protocol traits. Device experience belongs to Match;
// this module consumes its frozen selection and reads the owner's live bond layers only.
import { RHINE_BALANCE as B, RHINE_BOND, RHINE_CHARACTERS as C, RHINE_DEVICES, rhineDevice, rhineAttack } from '../../../shared/rhineResearch.js';
import { frontOf } from '../dir.js';
import { bodyDist, bodyInRadius } from '../body.js';
import { TICK } from '../constants.js';
import { rhineEquipmentAttack } from './items/battle.js';

const alive = (u) => !!u?.alive && u.deployed && !u.removed && !u.hidden;
const charId = (u) => u.def?.charId ?? u.def?.raw?.charId;
const elite = (u) => !!u.def?.golden;
const layersOf = (ps) => ps?.bonds?.[RHINE_BOND]?.active ? Math.max(0, Number(ps.bonds[RHINE_BOND].layers) || 0) : 0;
const healCapture = Symbol('rhineMedicalHeal');

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
  const cap = bond.count >= B.thresholds[1] ? 2 : 1;
  const out = [], seen = new Set();
  for (const entry of ps.input.research.devices ?? []) {
    const d = rhineDevice(entry?.key);
    if (!d || !entry.onBoard || entry.tokenId !== d.tokenId || seen.has(d.key)) continue;
    const unit = ps.units.find((u) => u.uid === entry.uid && u.kind === 'token' && u.defId === d.tokenId);
    if (!unit) continue;
    seen.add(d.key);
    out.push({ unit, key: d.key, stage: Math.min(2, Math.max(0, Math.floor(Number(entry.stage) || 0))) });
    if (out.length >= cap) break;
  }
  return out;
}

/** Only layer-derived research, Mayer and mainframe bonuses enter base ATK; no ordinary buffs or inherited ATK. */
export function deviceBaseAttack(battle, unit) {
  const ps = battle.getPlayer(unit.ownerId);
  let bestMayer = null;
  for (const u of ps?.units ?? []) {
    if (u.kind !== 'op' || !alive(u) || charId(u) !== C.mayer) continue;
    const [r, c] = frontOf(u.tileR, u.tileC, u.dir);
    if (r === unit.tileR && c === unit.tileC) bestMayer = bestMayer === true || elite(u);
  }
  const layers = layersOf(ps);
  return rhineAttack(layers, bestMayer) + rhineEquipmentAttack(battle, unit.ownerId, layers);
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
      states.push({ ...entry, ps, charges: 0, contributors: new Map(), zoneUntil: -1 });
    }
  }
  const enabled = (s) => alive(s.unit) && selectedDevices(s.ps).some((d) => d.unit === s.unit);
  // Use the engine's ally-side selector: unrevealed, unblocked stealth enemies cannot be selected by a device.
  const targets = (s, radius = B.radius) => battle.foesInRadius(s.unit.x, s.unit.y, radius);

  const refresh = () => {
    for (const s of states) {
      const atk = deviceBaseAttack(battle, s.unit);
      if (s.unit.base.atk !== atk) { s.unit.base.atk = atk; s.unit.markDirty(); }
      if (!enabled(s)) { s.charges = 0; s.contributors.clear(); s.zoneUntil = -1; }
    }
    for (const ps of battle.players) {
      const layers = layersOf(ps);
      const inherited = states.filter((s) => s.ps === ps && enabled(s)).reduce((n, s) => n + deviceBaseAttack(battle, s.unit), 0);
      for (const u of ps.units) {
        if (u.kind !== 'op') continue;
        if (charId(u) === C.saria) setPassive(battle, u, 'rhine:saria', { healingDealtMul: 1 + Math.floor(layers / B.sariaLayerStep) * B.sariaHealBonus[elite(u) ? 1 : 0] });
        if (charId(u) === C.ifrit) setPassive(battle, u, 'rhine:ifrit', { atkFlat: inherited * B.ifritInheritance[elite(u) ? 1 : 0] });
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

  // Observe the final heal amount without healing inside a heal hook or bypassing noHeal/other modifiers.
  battle.on('heal', (ctx) => { if (ctx.opts?.[healCapture]) ctx.opts[healCapture].amount = ctx.amount; }, { priority: -100000 });
  const medical = (s) => {
    if (!enabled(s)) return;
    refresh();
    const eligible = s.ps.units.filter((u) => alive(u) && battle.allySelectable(u, s.unit) && !rhineDevice(u.defId) && !u.bossPool && !u.s.flags.noHeal && !u.profile?.noHeal
      && bodyInRadius(u, s.unit.x, s.unit.y, B.radius) && (s.stage >= 1 || u.hp < u.s.maxHp));
    eligible.sort((a, b) => a.hp / a.s.maxHp - b.hp / b.s.maxHp || a.id - b.id);
    for (const target of eligible.slice(0, s.stage >= 2 ? 2 : 1)) {
      const capture = { amount: 0 };
      const actual = battle.heal(s.unit, target, deviceBaseAttack(battle, s.unit) * B.medicalHealScale, { [healCapture]: capture });
      const extra = Math.max(0, capture.amount - actual) * B.medicalShieldRatio;
      let shielded = false;
      if (s.stage >= 1 && extra > 0 && alive(target)) {
        const key = `rhine:overheal:${s.unit.id}`;
        const shield = Math.min(target.s.maxHp, (target.findBuff(key)?.shield ?? 0) + extra);
        battle.addBuff(target, { key, shield, duration: B.medicalShieldDuration, source: s.unit });
        shielded = true;
      }
      if (actual > 0 || shielded) battle.fx('rhineHeal', { x: target.x, y: target.y, source: s.unit.id, target: target.id, stage: s.stage });
    }
  };

  const pulse = (s) => {
    const enemies = targets(s).sort((a, b) => bodyDist(a, s.unit.x, s.unit.y) - bodyDist(b, s.unit.x, s.unit.y) || a.id - b.id);
    if (!enemies.length) return;
    const primary = enemies[0];
    const hit = s.stage >= 1 ? battle.foesInRadius(primary.x, primary.y, B.energySpreadRadius ?? 1, true) : [primary];
    const amount = deviceBaseAttack(battle, s.unit) * B.energyPulseScale * (s.stage >= 2 ? (B.energyStage2Scale ?? 1.5) : 1);
    for (const target of hit) battle.dealDamage(s.unit, target, { type: 'arts', amount, canDodge: false, tags: ['rhinePulse'] });
    battle.fx('rhinePulse', { x: primary.x, y: primary.y, source: s.unit.id, stage: s.stage });
  };
  battle.on('skillStart', ({ unit, skill, reason }) => {
    // A carried active skill merely resumes in a unite field; passive deployment is not a cast either.
    if (unit?.kind !== 'op' || !alive(unit) || reason === 'carry' || skill?.kind === 'passive') return;
    refresh();
    for (const s of states) {
      if (s.key !== 'energy' || !enabled(s) || unit.ownerId !== s.unit.ownerId || !bodyInRadius(unit, s.unit.x, s.unit.y, B.radius)) continue;
      const last = s.contributors.get(unit.id) ?? -Infinity;
      if (battle.time - last < B.energyContributorCooldown - 1e-9) continue;
      s.contributors.set(unit.id, battle.time);
      if (++s.charges >= B.energyCharges) { s.charges -= B.energyCharges; pulse(s); }
    }
  });

  const ecology = (s) => {
    if (!enabled(s)) return;
    s.zoneUntil = battle.time + B.ecologyDuration;
    if (s.stage >= 1) for (const target of targets(s, B.radius + (s.stage >= 2 ? 1 : 0))) {
      battle.applyStatus(target, 'bind', { duration: B.ecologyBindDuration, source: s.unit });
    }
    battle.fx('rhineEcology', { x: s.unit.x, y: s.unit.y, source: s.unit.id, stage: s.stage, radius: B.radius + (s.stage >= 2 ? 1 : 0) });
  };
  battle.on('tick', () => {
    for (const s of states) {
      if (s.key !== 'ecology' || !enabled(s) || battle.time >= s.zoneUntil) continue;
      const slow = Math.min(B.ecologySlowCap, B.ecologySlow + layersOf(s.ps) * B.ecologySlowPerLayer);
      for (const target of targets(s, B.radius + (s.stage >= 2 ? 1 : 0))) battle.applyStatus(target, 'slow', { value: slow, duration: TICK * 2, source: s.unit });
    }
  });
  for (const s of states) {
    if (s.key === 'medical') battle.every(B.medicalInterval, () => medical(s));
    if (s.key === 'ecology') battle.every(B.ecologyInterval, () => ecology(s));
  }
}
