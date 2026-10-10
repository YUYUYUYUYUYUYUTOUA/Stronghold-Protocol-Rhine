// Kazdel souls: fresh native skill/talent runtimes on the unchanged soul stat baseline.
import { KAZDEL_BALANCE as B } from '../../../../shared/kazdel.js';
import { Unit } from '../../units.js';
import { installOwnerSummons } from '../tokens.js';

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
    blockCnt: mud?.block_cnt ?? s.blockCnt, hpRecoveryPerSec: 0, spRecovery: owner.base.spRecovery });
  if (logos) soul.profile.maxTargets = logos.target_count;
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
  // Birth starts a new combatant, not a deferred cannon hit: native timers created here
  // must not carry the killing shell's provenance into later independent skills.
  const depth = battle._kazdelCannonDamageDepth, origin = battle._kazdelCannonOwnerId;
  battle._kazdelCannonDamageDepth = 0;
  battle._kazdelCannonOwnerId = null;
  try { return spawnSoul(battle, owner, layers, trait); } finally {
    battle._kazdelCannonDamageDepth = depth;
    battle._kazdelCannonOwnerId = origin;
  }
}

function spawnSoul(battle, owner, layers, trait) {
  const [r, c] = battle.restTile(owner), ps = battle.getPlayer(owner.ownerId), d = owner.def;
  // Keep the original resolved loadout/variant identity for native summon lookups, but no
  // garrison/item installation and no shared mutable kit closures, SP, buffs or talent memory.
  const def = { ...d, name: `${owner.name} · 众魂`,
    raw: { ...d.raw, garrisonIds: [] }, garrisonIds: [] };
  const soul = battle._makeAlly(ps, def, 'token', r, c, { ownerUnit: owner, dir: owner.dir });
  soul.kazdelSoul = true;
  soul.form = 'kazdelSoul';
  battle._setupUnit(soul);
  installOwnerSummons(battle, soul);
  soul.mem.kazdelBaseTargets = soul.profile.maxTargets;
  refreshSoul(battle, soul, layers, trait);
  if (!battle._deploy(soul)) { soul.removed = true; battle.offOwner(soul); return null; }
  owner.kazdelSoulUnit = soul;
  battle.fx('kazdelSoulSpawn', { x: soul.x, y: soul.y, id: soul.id, soulOf: owner.id });
  return soul;
}
