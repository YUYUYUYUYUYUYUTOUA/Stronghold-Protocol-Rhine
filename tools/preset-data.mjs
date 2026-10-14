// Reuse native self-select forms for fixed expansion cards without changing the DIY records.
import { composeUnitRecord, statusKey } from '../shared/standIn.js';
import { atRank, stripPotential } from '../shared/potential.js';
export function compileBackupPreset(files, spec, gold, index, garrison, rank = 5) {
  const prefix = spec.prefix || 'rhine';
  const baseId = `chess_${prefix}_${spec.key}_a`, goldenId = `chess_${prefix}_${spec.key}_b`;
  const chessId = gold ? goldenId : baseId;
  const status = structuredClone(files.config.economy.chessStatus[spec.tier][gold ? 'golden' : 'normal']);
  const unit = files.backups.units[spec.charId], key = statusKey(status);
  const form = stripPotential(atRank(unit.forms[key], rank));
  if (!form) throw new Error(`Missing native preset form ${spec.charId}@${key}`);
  const identity = { chessId, baseId, goldenId, isGolden: gold, tier: spec.tier, identifier: 300 + index,
    isHidden: false, isDiy: false, visible: true, chessType: 'PRESET', shopSortId: 300 + index,
    bonds: [...spec.bonds], garrisonIds: [garrison.garrisonId], status,
    price: spec.price ?? files.config.economy.chessPrice[spec.tier][gold ? 'golden' : 'normal'], sellPrice: 1,
    upgradeNum: gold ? 0 : 3, upgradeChessId: gold ? null : goldenId,
    backup: { charId: spec.charId, tmplId: null, skillIndex: 2, uniEquipId: spec.defaultModuleId || null, potRank: rank } };
  const out = composeUnitRecord(identity, unit, form, { skillIndex: 2, moduleId: gold ? spec.defaultModuleId : null });
  out.extension = { id: prefix === 'rem' ? 'rem-reinforcements' : 'rhine-research', supportedSkills: out.skills.map(s => s.skillId) };
  for (const tokenId of out.tokens) {
    const native = files.backups.tokens[tokenId];
    const token = files.tokens[tokenId] ||= { ...structuredClone(native), owners: [], variants: {} };
    if (!token.owners.includes(chessId)) token.owners.push(chessId);
    const variant = stripPotential(atRank(native.variants[`${spec.charId}@${key}`], rank));
    // Native DIY token variants use S1 as their base; fixed cards default to S3.
    const firstSkill = { skill: structuredClone(variant.skill), count: variant.count, sources: [...variant.sources] };
    variant.bySkill ||= {};
    variant.bySkill[0] = firstSkill;
    if (variant.bySkill[2]) Object.assign(variant, variant.bySkill[2]);
    delete variant.bySkill[2];
    if (gold && spec.defaultModuleId && variant.byModule?.[spec.defaultModuleId]) {
      const base = Object.fromEntries(Object.keys(variant.byModule[spec.defaultModuleId]).map(k => [k, structuredClone(variant[k])]));
      variant.byModule.none ||= base;
      Object.assign(variant, variant.byModule[spec.defaultModuleId]);
    }
    if (variant.byModule) {
      const wanted = gold ? [...(out.modules || []).filter(m => !m.isDefault).map(m => m.uniEquipId), ...(out.module?.active ? ['none'] : [])] : [];
      variant.byModule = Object.fromEntries(wanted.map(id => [id, variant.byModule[id]]));
    }
    token.variants[chessId] = variant;
  }
  return out;
}
