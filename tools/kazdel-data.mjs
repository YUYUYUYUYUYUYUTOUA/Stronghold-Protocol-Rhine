// Deterministic, offline Kazdel overlay. Run: node tools/kazdel-data.mjs [--out data].
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkill, statsFrom, interpolateAttrs, baseTalentList, traitRecord, rangeGrid, immunitiesOf,
  unlocked, bestCandidate, moduleAttr, moduleTalentChanges, splitModuleParts, OPERATOR_POTENTIAL, withPotential } from './build-data.mjs';
import { composeStats, composeTalents } from '../shared/loadoutRecord.js';
import { KAZDEL_BOND, KAZDEL_CHARACTERS, KAZDEL_BALANCE, KAZDEL_CANNON, KAZDEL_GARRISON_KEYS, applyKazdelOpeningBans } from '../shared/kazdel.js';

const clone = x => structuredClone(x);
export const WISDEL_TOKEN = 'token_10035_wisdel_wward';
export const KAZDEL_ADDITIONS = Object.freeze([
  { key: 'odd', characterKey: 'odda', charId: KAZDEL_CHARACTERS.odda, tier: 2, bonds: [KAZDEL_BOND, 'steadShip'], skillId: 'skchr_odda_2', defaultModuleId: 'uniequip_002_odda', subName: '撼地者' },
  { key: 'meteorite', characterKey: 'meteorite', charId: KAZDEL_CHARACTERS.meteorite, tier: 2, bonds: [KAZDEL_BOND, 'preciShip'], skillId: 'skchr_meteo_2', defaultModuleId: 'uniequip_002_meteo', subName: '炮手' },
  { key: 'paprika', characterKey: 'paprika', charId: KAZDEL_CHARACTERS.paprika, tier: 3, bonds: [KAZDEL_BOND, 'deputShip'], skillId: 'skchr_peper_2', defaultModuleId: 'uniequip_002_peper', subName: '链愈师' },
  { key: 'hoederer', characterKey: 'hoederer', charId: KAZDEL_CHARACTERS.hoederer, tier: 4, bonds: [KAZDEL_BOND, 'steadShip'], skillId: 'skchr_hodrer_3', defaultModuleId: 'uniequip_002_hodrer', subName: '重剑手' },
  { key: 'logos', characterKey: 'logos', charId: KAZDEL_CHARACTERS.logos, tier: 5, bonds: [KAZDEL_BOND, 'arcaneShip'], skillId: 'skchr_logos_3', defaultModuleId: 'uniequip_002_logos', subName: '中坚术师' },
  { key: 'wisdel', characterKey: 'wisdel', charId: KAZDEL_CHARACTERS.wisdel, tier: 6, bonds: [KAZDEL_BOND, 'preciShip'], skillId: 'skchr_wisdel_3', defaultModuleId: 'uniequip_002_wisdel', subName: '投掷手' },
  { key: 'ascalon', characterKey: 'ascalon', charId: KAZDEL_CHARACTERS.ascalon, tier: 3, bonds: [KAZDEL_BOND], skillId: 'skchr_ascln_2', defaultModuleId: 'uniequip_002_ascln', subName: '伏击客' },
]);
export const KAZDEL_EXISTING = Object.freeze([
  { key: 'vigna', baseId: 'chess_char_1_05', tier: 1, bonds: [KAZDEL_BOND, 'skillfulShip'] },
  { key: 'tinman', baseId: 'chess_char_2_19', tier: 2, bonds: ['investShip', 'skillfulShip', KAZDEL_BOND] },
  { key: 'ines', baseId: 'chess_char_4_04', tier: 4, bonds: ['visiShip', 'raidShip', KAZDEL_BOND], preserveGarrison: true },
  { key: 'mudrock', baseId: 'chess_char_4_18', tier: 4, bonds: ['soloShip', KAZDEL_BOND] },
]);

export const KAZDEL_DESCRIPTION = '战斗开始时按3/6/9名不同【卡兹戴尔】干员锁定档位，倒地不降低档位。每层众魂使卡兹戴尔本体生命上限+10。3名时，每枚己方卡兹戴尔棋子每次真正阵亡后产生一名亡魂；亡魂继承本体职业的普攻方式、范围、防御与法抗，不继承主动技能、原生天赋和装备触发效果，明确作用于亡魂的卡兹戴尔特质继续生效。亡魂生命上限为本体基础值的60%+每层众魂10点，攻击力为本体基础值的80%+每层众魂3点（基础值不含众魂与临时技能加成）。亡魂不占人口或盟约人数，无时间限制，阵亡、本体复活或战斗结束时消失。医疗亡魂只治疗亡魂；锡人二技能也可治疗亡魂，其他干员和装置治疗无效。6名时获得众魂炮：容量15，每秒充能1+每层众魂0.005，每枚己方卡兹戴尔本体首次有效阵亡额外充能3；向敌方最密集的3×3区域发射800+每层众魂15点真实伤害，炮击间隔至少3秒，命中前预警2秒，预警计入间隔。6名阶段炮击仅误伤炮击所属玩家自己的活体友军，伤害为对敌伤害的50%（400+每层众魂7.5点）；其他玩家友军免疫炮击及其衍生伤害，亡魂始终免疫；9名阶段只伤害敌军。炮击及其衍生伤害造成的友方阵亡仍可产生亡魂，但不获得死亡产层与充能；召唤物、亡魂死亡和主动撤退也不产层。同名卫戍光环只取最高值。';

function ordinaryModulePhase(ctx, id, level) {
  const raw = ctx.battleEquipTable?.[id]?.phases.find(p => p.equipLevel === level);
  return raw ? { ...raw, parts: raw.parts.filter(p => !p.validInGameTag && !p.validInMapTag) } : null;
}
function moduleChoices(ctx, char, status, label, spec) {
  if (!status.equipLevel) return [];
  return (ctx.uniequipTable.charEquip[spec.charId] || []).flatMap(id => {
    const meta = ctx.uniequipTable.equipDict[id], phase = ordinaryModulePhase(ctx, id, status.equipLevel);
    if (meta.type === 'INITIAL' || meta.isSpecialEquip || !phase) return [];
    const { op } = splitModuleParts(phase);
    const hasTrait = op.some(p => bestCandidate(p.overrideTraitDataBundle?.candidates, status.phase, status.level, (ctx.potRank ?? OPERATOR_POTENTIAL)));
    return [{ uniEquipId: id, name: meta.uniEquipName,
      typeName: `${meta.typeName1 || ''}${meta.typeName2 ? '-' + meta.typeName2 : ''}`,
      typeIcon: meta.typeIcon, icon: meta.uniEquipIcon || id, isDefault: id === spec.defaultModuleId, level: status.equipLevel,
      attr: moduleAttr(phase), traitOverride: hasTrait ? traitRecord(ctx, char, status.phase, status.level, op, label, (ctx.potRank ?? OPERATOR_POTENTIAL)).trait : null,
      talentChanges: moduleTalentChanges(ctx, op, status.phase, status.level, label, (ctx.potRank ?? OPERATOR_POTENTIAL)) }];
  });
}
export function kazdelGarrison(key, gold) {
  const grade = gold ? 1 : 0, id = `garrison_kazdel_${key}_${gold ? 'b' : 'a'}`;
  let desc, bb, bbStr = {};
  switch (key) {
    case 'ascalon':
      bb = { slow: [0.2, 0.3][grade], interval: 3, layer: [1, 2][grade] };
      desc = `活体本体在场时，攻击范围内敌人移动速度额外降低${bb.slow * 100}%，与原生减速相乘；累计每${bb.interval}秒范围内存在受此减速的敌人，为已激活的【卡兹戴尔】增加${bb.layer}层。无目标暂停累计，不按目标数量倍增；每位玩家同名仅取最强有效来源，魂灵不生效`;
      break;
    case 'vigna':
      bb = { layer: [2, 4][grade] }; bbStr = { bond_ids: `${KAZDEL_BOND},skillfulShip` };
      desc = `战斗中，本体首次有效阵亡时，使已激活的【卡兹戴尔】与【灵巧】各增加${bb.layer}层；炮击造成的友方阵亡不产层`;
      break;
    case 'odda':
      bb = { layer: [1, 2][grade] }; bbStr = { bond_ids: `${KAZDEL_BOND},steadShip` };
      desc = `战斗中，本体每参与击杀一个敌人，使已激活的【卡兹戴尔】与【坚守】各增加${bb.layer}层；本体每次有效阵亡时，本场此前每参与击杀一个敌人，再使这两个已激活盟约各增加${bb.layer}层，无特质产层上限；亡魂击杀不计入，炮击造成的友方阵亡不产层`;
      break;
    case 'meteorite':
      bb = { damage_bonus: [0.2, 0.4][grade] };
      desc = `战斗中，本体与亡魂对被己方亡魂阻挡的敌人造成的伤害提高${bb.damage_bonus * 100}%`;
      break;
    case 'tinman':
      bb = { aspd: [15, 30][grade], radius: 1 };
      desc = `战斗中，本体或亡魂在场时，周围八格其他己方亡魂攻击速度+${bb.aspd}；同名光环只取最高值`;
      break;
    case 'paprika':
      bb = { heal_bonus: [0.25, 0.5][grade] };
      desc = `战斗中，自身亡魂的治疗量提高${bb.heal_bonus * 100}%，医疗亡魂可治疗其他亡魂`;
      break;
    case 'hoederer':
      bb = { layer: [6, 10][grade] };
      desc = `战斗中，本体或亡魂在场时，每枚己方卡兹戴尔本体首次有效阵亡，使已激活的【卡兹戴尔】增加${bb.layer}层，无特质产层上限，包含自身；同名赫德雷只取最高值，亡魂死亡与炮击造成的友方阵亡不产层`;
      break;
    case 'mudrock':
      bb = { block_cnt: 3, hp_per_layer: [5, 10][grade] };
      desc = `战斗中，自身亡魂阻挡数为3，每层众魂额外使自身亡魂生命上限+${bb.hp_per_layer}`;
      break;
    case 'logos':
      bb = { atk_per_layer: [1, 2][grade], target_count: [2, 3][grade] };
      desc = `战斗中，每层众魂额外使自身亡魂攻击力+${bb.atk_per_layer}，自身亡魂普通攻击可攻击${bb.target_count}个目标`;
      break;
    case 'wisdel':
      bb = { damage_bonus: [0.2, 0.4][grade], next_attack_bonus: [0.5, 1][grade], cannon_attack_ratio: 0.5 };
      desc = `战斗中，本体或亡魂在场时，所有己方亡魂造成的伤害提高${bb.damage_bonus * 100}%；每次众魂炮击后，各己方亡魂的下一次普通攻击伤害提高${bb.next_attack_bonus * 100}%，再次炮击刷新而不储存次数；同名光环只取最高值；自身本体在场时，获得当前众魂炮击伤害50%的基础攻击力加成，随众魂层数更新，普通攻击与技能均生效`;
      break;
    default: throw new Error(`Unknown Kazdel trait ${key}`);
  }
  return { garrisonId: id, desc, descRaw: desc, eventType: 'IN_BATTLE', eventTypeDesc: '特异化', eventTypeIcon: 'icon_support',
    effectType: KAZDEL_GARRISON_KEYS[key], effectKey: KAZDEL_GARRISON_KEYS[key], battleRuneKey: null, charLevel: 0, bb, bbStr, owners: [] };
}

function compileChess(ctx, files, spec, gold, index) {
  const raw = ctx.charTable[spec.charId], baseId = `chess_kazdel_${spec.key}_a`, goldenId = `chess_kazdel_${spec.key}_b`;
  const chessId = gold ? goldenId : baseId, config = files.config;
  const st = config.economy.chessStatus[spec.tier][gold ? 'golden' : 'normal'];
  const status = { phase: st.phase, level: st.level, skillLevel: st.skillLevel, equipLevel: st.equipLevel };
  const formKey = Object.values(status).join('/'), nativeForm = files.backups?.units?.[spec.charId]?.forms?.[formKey];
  const attrs = withPotential(raw, interpolateAttrs(raw, status.phase, status.level), (ctx.potRank ?? OPERATOR_POTENTIAL), chessId);
  const { trait, classify } = traitRecord(ctx, raw, status.phase, status.level, [], chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  const skills = raw.skills.flatMap((s, skillIndex) => {
    if (!unlocked(s.unlockCond, status.phase, status.level)) return [];
    const skill = buildSkill(ctx, s.skillId, status.skillLevel, null, chessId);
    // Backups contain the audited live-client trigger rules for the three native high-star kits.
    // Lower-star additions retain the ordinary target/ally search of their native archetype.
    const trigger = nativeForm?.skills.find(x => x.skillId === s.skillId)?.trigger;
    if (trigger) skill.trigger = clone(trigger);
    skill.index = skillIndex; skill.overrideTokenKey = s.overrideTokenKey || null;
    return [{ ...skill, isDefault: skill.skillId === spec.skillId }];
  });
  const skill = clone(skills.find(s => s.isDefault));
  if (!skill) throw new Error(`Unavailable Kazdel default skill ${chessId}`);
  delete skill.isDefault;
  const modules = gold ? moduleChoices(ctx, raw, status, chessId, spec) : [];
  const mod = modules.find(m => m.isDefault), statsBase = statsFrom(attrs);
  const talentsBase = baseTalentList(ctx, raw, status.phase, status.level, chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  return { chessId, baseId, goldenId, isGolden: gold, tier: spec.tier, identifier: 300 + index,
    isHidden: false, isDiy: false, visible: true, chessType: 'PRESET', shopSortId: 300 + index,
    backup: { charId: spec.charId, tmplId: null, skillIndex: skill.index, uniEquipId: spec.defaultModuleId, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL) },
    charId: spec.charId, name: raw.name, appellation: raw.appellation, rarity: Number(raw.rarity.replace('TIER_', '')),
    profession: raw.profession, subProfessionId: raw.subProfessionId, subProfessionName: spec.subName, position: raw.position,
    nationId: raw.nationId, bonds: [...spec.bonds], garrisonIds: [kazdelGarrison(spec.characterKey, gold).garrisonId],
    price: config.economy.chessPrice[spec.tier][gold ? 'golden' : 'normal'], sellPrice: 1,
    upgradeNum: gold ? 0 : 3, upgradeChessId: gold ? null : goldenId, status,
    stats: mod ? composeStats(statsBase, mod.attr) : statsBase, immunities: immunitiesOf(attrs), rangeId: raw.phases[status.phase].rangeId,
    rangeGrid: rangeGrid(ctx, raw.phases[status.phase].rangeId), ...classify, trait: mod?.traitOverride || trait, skill, skills,
    talents: mod ? composeTalents(talentsBase, mod.talentChanges) : talentsBase,
    tokens: spec.characterKey === 'wisdel' ? [WISDEL_TOKEN] : [],
    module: mod ? { id: mod.uniEquipId, name: mod.name, type: mod.typeName, level: mod.level, active: true } : null,
    assets: { avatar: gold ? `${spec.charId}_2` : spec.charId, portrait: `${spec.charId}_${gold ? 2 : 1}`, spine: spec.charId,
      skillIcon: skill.iconId, subProfIcon: `sub_${raw.subProfessionId}_icon` },
    ...(gold ? { statsBase, traitBase: clone(trait), talentsBase, modules } : {}),
    extension: { id: 'kazdel-souls', sourceRevision: ctx.source.revision, supportedSkills: skills.map(s => s.skillId) } };
}

function compileWisdelToken(files) {
  const backup = files.backups?.tokens?.[WISDEL_TOKEN];
  if (!backup) throw new Error('Pinned native Wisadel token forms are required');
  const variants = {}, owners = ['chess_kazdel_wisdel_a', 'chess_kazdel_wisdel_b'];
  for (const id of owners) {
    const c = files.chess[id], formKey = Object.values(c.status).join('/');
    const base = backup.variants?.[`${c.charId}@${formKey}`];
    if (!base) throw new Error(`Missing native Wisadel shadow ${formKey}`);
    const v = clone(base), selectedSkill = c.skill.index;
    if (base.bySkill?.[selectedSkill]) Object.assign(v, clone(base.bySkill[selectedSkill]));
    v.bySkill = {};
    for (const s of c.skills.filter(s => !s.isDefault)) {
      const source = s.index === 0 ? base : base.bySkill[s.index];
      v.bySkill[s.index] = { skill: clone(source.skill), count: source.count, sources: clone(source.sources) };
    }
    v.byModule = {};
    if (c.module?.active) {
      const selected = base.byModule[c.module.id];
      if (!selected) throw new Error(`Missing native Wisadel shadow module ${c.module.id}`);
      Object.assign(v, clone(selected));
      v.byModule.none = Object.fromEntries(['stats', 'immunities', 'trait', 'talents'].map(k => [k, clone(base[k])]));
      for (const m of c.modules.filter(m => !m.isDefault)) v.byModule[m.uniEquipId] = clone(base.byModule[m.uniEquipId]);
    }
    if (!c.isGolden) delete v.byModule;
    variants[id] = v;
  }
  const first = variants[owners[0]];
  const { owners: _backupOwners, variants: _backupVariants, ...meta } = clone(backup);
  return { ...meta, owners, stats: first.stats, rangeGrid: first.rangeGrid, deployLimit: first.stats.deployLimit,
    count: first.count, variants };
}

export async function applyKazdelData(files, source = null) {
  const ctx = source || JSON.parse(await readFile(new URL('./kazdel-data-source.json', import.meta.url), 'utf8'));
  if (!Number.isInteger(ctx.potRank)) {
    const { applyPotentialOverlay } = await import('./extension-potential.mjs');
    return applyPotentialOverlay(files, applyKazdelData, ctx);
  }
  const { chess, bonds, garrisons, effects, config, tokens } = files;
  for (const [index, spec] of KAZDEL_ADDITIONS.entries()) for (const gold of [false, true]) {
    const c = compileChess(ctx, files, spec, gold, index);
    chess[c.chessId] = c;
    const g = kazdelGarrison(spec.characterKey, gold); garrisons[g.garrisonId] = g;
  }
  for (const spec of KAZDEL_EXISTING) for (const gold of [false, true]) {
    const c = chess[`${spec.baseId}_${gold ? 'b' : 'a'}`];
    if (!c || c.charId !== KAZDEL_CHARACTERS[spec.key]) throw new Error(`Unexpected existing Kazdel identity ${spec.baseId}`);
    c.bonds = [...spec.bonds]; c.visible = true; c.isHidden = false;
    if (!spec.preserveGarrison) {
      const g = kazdelGarrison(spec.key, gold); garrisons[g.garrisonId] = g;
      c.garrisonIds = [g.garrisonId];
    }
  }
  for (const g of Object.values(garrisons)) g.owners = Object.values(chess).filter(c => c.garrisonIds.includes(g.garrisonId)).map(c => c.chessId);
  const desc = KAZDEL_DESCRIPTION;
  bonds[KAZDEL_BOND] = { ...clone(bonds.yanShip), bondId: KAZDEL_BOND, name: '卡兹戴尔', identifier: 25, bondOrder: 25,
    isCore: true, bondType: 'SEASON', iconId: KAZDEL_BOND, activeCount: KAZDEL_BALANCE.thresholds[0], thresholds: [...KAZDEL_BALANCE.thresholds], maxCount: null,
    layerMilestones: [], powerIdList: [], desc, descRaw: desc, effectId: 'bondeffect_kazdel', effectName: '卡兹戴尔',
    effectDesc: desc, effectDescRaw: desc, effectDescParams: [],
    bb: { body_hp_per_stack: KAZDEL_BALANCE.bodyHpPerLayer, soul_hp_ratio: KAZDEL_BALANCE.soulHpRatio,
      soul_hp_per_stack: KAZDEL_BALANCE.soulHpPerLayer, soul_atk_ratio: KAZDEL_BALANCE.soulAttackRatio, soul_atk_per_stack: KAZDEL_BALANCE.soulAttackPerLayer },
    bbStr: { key: 'kazdel_souls' }, buffs: [], baseParams: {}, perStackParams: {},
    spec: { soulsPerPiecePerBattle: KAZDEL_BALANCE.soulsPerPiecePerBattle, cannon: clone(KAZDEL_CANNON) } };
  for (const b of Object.values(bonds)) {
    b.members = Object.values(chess).filter(c => !c.isGolden && c.bonds.includes(b.bondId)).map(c => c.chessId);
    b.visibleMembers = b.members.filter(id => chess[id].visible);
  }
  effects.bondeffect_kazdel = { effectId: 'bondeffect_kazdel', effectType: 'BOND', name: '卡兹戴尔', desc, descRaw: desc,
    counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0, buffs: [], params: clone(bonds[KAZDEL_BOND].bb) };
  for (const mode of Object.values(config.modes)) {
    if (!mode.activeBondIds.includes(KAZDEL_BOND)) mode.activeBondIds.push(KAZDEL_BOND);
    mode.inactiveBondIds = mode.inactiveBondIds.filter(id => id !== KAZDEL_BOND);
  }
  applyKazdelOpeningBans(config);
  tokens[WISDEL_TOKEN] = compileWisdelToken(files);
  return files;
}

export function validateKazdelData({ chess, bonds, garrisons, tokens, config }) {
  const errors = [], visible = bonds[KAZDEL_BOND]?.visibleMembers || [];
  if (visible.length !== 11 || new Set(visible.map(id => chess[id]?.charId)).size !== 11) errors.push('Kazdel must have eleven distinct visible members');
  for (const spec of KAZDEL_ADDITIONS) for (const gold of [false, true]) {
    const c = chess[`chess_kazdel_${spec.key}_${gold ? 'b' : 'a'}`];
    const count = ['odd', 'meteorite', 'paprika'].includes(spec.key) ? 2 : 3;
    if (!c || c.charId !== spec.charId || c.skills.length !== count || c.skill.skillId !== spec.skillId
      || c.skills.filter(s => s.isDefault).length !== 1) errors.push(`Kazdel missing supported unit ${spec.key}`);
    if (!c) continue;
    if (c.garrisonIds.some(id => !garrisons[id])) errors.push(`Kazdel missing trait ${c.chessId}`);
    if (c.tokens.some(id => !tokens[id])) errors.push(`Kazdel missing summon ${c.chessId}`);
    if (gold && (!c.module?.active || c.module.id !== spec.defaultModuleId || c.modules.some(m => m.isSpecialEquip))) errors.push(`Kazdel bad module choices ${c.chessId}`);
  }
  for (const mode of Object.values(config.modes)) if (!mode.activeBondIds.includes(KAZDEL_BOND)) errors.push(`Kazdel missing mode ${mode.modeId}`);
  if (config.bans.NORMAL.core !== 5 || config.bans.FUNNY.core !== 2 || config.bans.TRAINING.core !== 0) errors.push('Kazdel opening core rotation is incorrect');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('usage: node tools/kazdel-data.mjs [--out data]');
  const out = resolve(args[1] || fileURLToPath(new URL('../data', import.meta.url)));
  const names = ['chess', 'bonds', 'garrisons', 'tokens', 'effects', 'config', 'backups'];
  const files = Object.fromEntries(await Promise.all(names.map(async n => [n, JSON.parse(await readFile(join(out, `${n}.json`), 'utf8'))])));
  await applyKazdelData(files);
  const errors = validateKazdelData(files);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const n of names.filter(n => n !== 'backups')) {
    const dest = join(out, `${n}.json`), tmp = `${dest}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(files[n])); await rename(tmp, dest);
  }
  const { refreshRhineTranslations } = await import('./rhine-i18n.mjs');
  await refreshRhineTranslations(out);
  console.log('Kazdel overlay complete: seven new operators, eleven members, ordinary modules and native Wisadel shadows.');
}
