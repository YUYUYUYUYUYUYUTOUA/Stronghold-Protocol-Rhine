// Kazdel souls: ordinary profession attacks and one copy of passive numerical attributes.
import { KAZDEL_BALANCE as B, KAZDEL_SOUL_TOKEN } from '../../../../shared/kazdel.js';
import { Unit } from '../../units.js';
import { resolveProfile } from '../../professions.js';

const NON_SOUL_MODS = new Set(['hpRegen', 'hpRegenRatio', 'spRecoveryFlat', 'spRecoveryMul', 'spCostFlat', 'redeployMul']);
const purePassive = (buff) => buff.persist && !buff.status && (buff.key.startsWith('bond:') || /^item:.*:stat:/.test(buff.key));

/** No active skills, triggered talents, statuses, Kazdel layers or regeneration enter H0/A0. */
export function soulBaseline(owner) {
  const clone = new Unit({ id: 0, side: 'ally', kind: 'token', base: { ...owner.base, hpRecoveryPerSec: 0 } });
  clone.cultMul = owner.cultMul;
  clone.alive = false;
  clone.buffs = owner.buffs.filter(purePassive).map(b => ({ ...b, flags: {}, shield: 0,
    mods: Object.fromEntries(Object.entries(b.mods ?? {}).filter(([key]) => !NON_SOUL_MODS.has(key))) }));
  return clone.s;
}

export function refreshSoul(battle, soul, layers, trait) {
  const owner = soul.ownerUnit, s = soulBaseline(owner);
  const mud = trait(owner, 'mudrock'), logos = trait(owner, 'logos'), paprika = trait(owner, 'paprika');
  const maxHp = B.soulHpRatio * s.maxHp + (B.soulHpPerLayer + (mud?.hp_per_layer ?? 0)) * layers;
  const atk = B.soulAttackRatio * s.atk + (B.soulAttackPerLayer + (logos?.atk_per_layer ?? 0)) * layers;
  Object.assign(soul.base, { maxHp, atk, def: s.def, res: s.res, aspd: s.aspd, bat: s.bat,
    blockCnt: mud?.block_cnt ?? s.blockCnt, hpRecoveryPerSec: 0, spRecovery: 0 });
  soul.profile.maxTargets = logos?.target_count ?? soul.mem.kazdelBaseTargets;
  const mods = Object.fromEntries(['dmgDealtMul', 'physDealtMul', 'artsDealtMul', 'dmgTakenMul',
    'physTakenMul', 'artsTakenMul', 'trueTakenMul', 'elemTakenMul', 'elementalTakenMul',
    'healingDealtMul', 'healingTakenMul', 'atkScaleMul', 'defIgnoreFlat', 'defIgnorePct',
    'resIgnoreFlat', 'resIgnorePct', 'dodgePhys', 'dodgeArts', 'maxTargets', 'rangeExtend', 'blockRadiusScale']
    .map(k => [k, s[k]]));
  mods.healingDealtMul *= 1 + (paprika?.heal_bonus ?? 0);
  battle.addBuff(soul, { key: 'kazdel:inherited', mods, persist: true });
  soul.markDirty();
  void soul.s; // preserve the HP ratio immediately when persistent layers change.
}

export function createSoul(battle, owner, layers, trait) {
  const [r, c] = battle.restTile(owner), ps = battle.getPlayer(owner.ownerId), d = owner.def;
  const raw = { name: `${owner.name} · 众魂`, profession: d.profession, subProfessionId: d.subProf,
    position: d.position, dmgType: resolveProfile(d).dmgType, attackKind: d.attackKind, projectile: d.projectile,
    canHitFly: d.canHitFly, targetPriority: d.targetPriority, rangeGrid: d.rangeGrid,
    trait: { desc: '', bb: { ...(d.traitBb ?? {}) } }, skill: null, stats: { ...owner.base, atk: Math.max(1, owner.base.atk) },
    spine: d.spine ?? d.charId, avatar: d.avatar ?? d.charId };
  const def = battle._tokenDef(KAZDEL_SOUL_TOKEN, null, raw);
  const soul = battle._makeAlly(ps, def, 'token', r, c, { ownerUnit: owner, dir: owner.dir });
  soul.kazdelSoul = true;
  soul.form = 'kazdelSoul';
  // Native profile attacks (splash / chain healing / blocked-target count) stay; native installs do not.
  battle._setupUnit(soul, { skill: null, trait: { install: null, noHeal: false } });
  soul.mem.kazdelBaseTargets = soul.profile.maxTargets;
  refreshSoul(battle, soul, layers, trait);
  if (!battle._deploy(soul)) { soul.removed = true; battle.offOwner(soul); return null; }
  owner.kazdelSoulUnit = soul;
  battle.fx('kazdelSoulSpawn', { x: soul.x, y: soul.y, id: soul.id, soulOf: owner.id });
  return soul;
}
