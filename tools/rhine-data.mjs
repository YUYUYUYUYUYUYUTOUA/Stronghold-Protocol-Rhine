// Deterministic, offline roster overlay. Run: node tools/rhine-data.mjs [--out data]
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkill, statsFrom, interpolateAttrs, baseTalentList, traitRecord, rangeGrid, immunitiesOf,
  unlocked, bestCandidate, moduleAttr, moduleTalentChanges, splitModuleParts, tokenVariant, OPERATOR_POTENTIAL, withPotential } from './build-data.mjs';
import { RHINE_BOND, RHINE_CHARACTERS, RHINE_BALANCE, RHINE_DEVICES, RHINE_EQUIPMENT } from '../shared/rhineResearch.js';
import { composeStats, composeTalents } from '../shared/loadoutRecord.js';
import { applyOpeningBans } from '../shared/openingBans.js';
import { KAZDEL_BOND, applyKazdelOpeningBans } from '../shared/kazdel.js';
import { applyPotentialOverlay } from './extension-potential.mjs';

export const RHINE_ADDITIONS = Object.freeze([
  { key: 'mayer', charId: 'char_242_otter', tier: 1, bonds: [RHINE_BOND], skillId: 'skchr_otter_1', defaultModuleId: 'uniequip_002_otter', subName: '召唤师', trait: 'mayer' },
  { key: 'wuhoo', charId: 'char_4224_turdus', tier: 4, bonds: ['skillfulShip', 'emptyShip'], skillId: 'skchr_turdus_2', defaultModuleId: 'uniequip_002_turdus', subName: '链愈师', trait: 'copy_start' },
  { key: 'eunectes', charId: 'char_416_zumama', tier: 5, bonds: ['soloShip', 'sargonShip'], skillId: 'skchr_zumama_3', defaultModuleId: 'uniequip_002_zumama', excludedModuleIds: ['uniequip_004_zumama'], subName: '决战者', trait: 'copy_end' },
  { key: 'ifrit', charId: 'char_134_ifrit', tier: 5, bonds: ['arcaneShip', RHINE_BOND], skillId: 'skchr_ifrit_2', defaultModuleId: 'uniequip_002_ifrit', subName: '轰击术师', trait: 'ifrit' },
  { key: 'astgenne', charId: 'char_135_halo', tier: 2, bonds: [RHINE_BOND, 'preciShip'], skillId: 'skchr_halo_1', defaultModuleId: 'uniequip_002_halo', subName: '链术师', trait: 'astgenne' },
  { key: 'dorothy', charId: 'char_4048_doroth', tier: 4, bonds: [RHINE_BOND], skillId: 'skchr_doroth_3', defaultModuleId: 'uniequip_002_doroth', excludedModuleIds: ['uniequip_003_doroth'], subName: '陷阱师', trait: 'dorothy' },
]);
const TOKEN = 'token_10004_otter_motter';
export const DOROTHY_TOKEN = 'token_10025_doroth_recttp';
const clone = x => structuredClone(x);
const BASE_STATS = { maxHp: 3000, atk: 300, def: 0, res: 0, cost: 0, blockCnt: 0, bat: 1, aspd: 100,
  respawnTime: 999, spRecovery: 0, hpRecoveryPerSec: 0, moveSpeed: 0, tauntLevel: -10, massLevel: 0, deployLimit: 1, deckStack: 0 };
const TEXT = `在场${RHINE_BALANCE.thresholds[0]}名不同【莱茵生命】干员时启动一台科研装置；在场${RHINE_BALANCE.thresholds[1]}名时同时启动两台，${RHINE_BALANCE.thresholds[2]}名时三台全部启动。达到${RHINE_BALANCE.sharingCount}名时，除伊芙利特和治疗干员外的莱茵输出干员获得己方已部署装置中最高基础攻击力的${RHINE_BALANCE.researchSharing[0] * 100}%，精锐${RHINE_BALANCE.researchSharing[1] * 100}%，作为额外攻击力；多个装置不重复共享。3名时获得生态维持仪与能量谐振仪，9名时解锁只有一级的全场激光钻机。装置基础攻击力${RHINE_BALANCE.baseAttack}，每层科研增加${RHINE_BALANCE.attackPerLayer}点。生态维持仪与能量谐振仪参战成功获得${RHINE_BALANCE.successPoints}研究点，失败获得${RHINE_BALANCE.failurePoints}点；${RHINE_BALANCE.breakthroughPoints.map((n,i) => `第${i+1}次突破需要${n}点`).join('，')}。每次突破后研究点清零，溢出不保留；科研层数不受影响，激光钻机不积累研究点或突破。`;

// This expansion is not a sandbox/roguelike mode. Preserve the source conditions for auditing,
// but never compile mode-restricted module parts into the live ordinary-battle blackboards.
function ordinaryModulePhase(ctx, id, equipLevel) {
  const raw = ctx.battleEquipTable?.[id]?.phases.find(p => p.equipLevel === equipLevel);
  return raw ? { ...raw, parts: raw.parts.filter(p => !p.validInGameTag && !p.validInMapTag) } : null;
}
function moduleChoices(ctx, char, status, label, spec) {
  if (!status.equipLevel) return [];
  const { phase, level, equipLevel } = status;
  return (ctx.uniequipTable?.charEquip[char.charId] || []).flatMap(id => {
    const meta = ctx.uniequipTable.equipDict[id], ph = ordinaryModulePhase(ctx, id, equipLevel);
    if (meta.type === 'INITIAL' || !ph || spec.excludedModuleIds?.includes(id)) return [];
    const { op } = splitModuleParts(ph);
    const hasTrait = op.some(p => bestCandidate(p.overrideTraitDataBundle?.candidates, phase, level, (ctx.potRank ?? OPERATOR_POTENTIAL)));
    const restrictedModes = [...new Set(ctx.battleEquipTable[id].phases.flatMap(p => p.parts.map(x => x.validInGameTag).filter(Boolean)))];
    const scopeNote = meta.isSpecialEquip ? '仅应用基础属性；生息演算限定的技力限制解除、食物、引敌、额外阻挡、群攻和物理脆弱效果在卫戍协议中不生效。'
      : id === 'uniequip_002_otter' ? '首个召唤物不占部署位；不过卫戍召唤物本来就不占人口，所以这条效果没了XP' : null;
    const traitOverride = hasTrait ? traitRecord(ctx, char, phase, level, op, label, (ctx.potRank ?? OPERATOR_POTENTIAL)).trait : null;
    // RA-alpha's source trait part has no tag, but its own description explicitly scopes the
    // SP unlock to sandbox mode. Keep that original explanation while retaining the ordinary
    // blocking-only SP rule; the condition is semantic, not safely inferred from a null tag.
    if (id === 'uniequip_004_zumama' && traitOverride) {
      const baseTrait = traitRecord(ctx, char, phase, level, [], label, (ctx.potRank ?? OPERATOR_POTENTIAL)).trait;
      traitOverride.bb = clone(baseTrait.bb); traitOverride.bbStr = clone(baseTrait.bbStr);
    }
    return [{ uniEquipId: id, name: meta.uniEquipName,
      typeName: `${meta.typeName1}-${({ A: 'α', D: 'Δ' })[meta.typeName2] || meta.typeName2}`,
      typeIcon: meta.typeIcon, icon: meta.uniEquipIcon || id, isDefault: id === spec.defaultModuleId, level: equipLevel,
      attr: moduleAttr(ph), traitOverride,
      talentChanges: moduleTalentChanges(ctx, op, phase, level, label, (ctx.potRank ?? OPERATOR_POTENTIAL)),
      ...(scopeNote ? { scopeNote } : {}), ...(meta.isSpecialEquip ? { isSpecialEquip: true, restrictedModes } : {}) }];
  });
}

function garrison(id, desc, eventType, effectKey, bb = {}, bbStr = {}) {
  return { garrisonId: id, desc, descRaw: desc, eventType, eventTypeDesc: '特异化', eventTypeIcon: 'icon_support',
    effectType: effectKey, effectKey, battleRuneKey: null, charLevel: 0, bb, bbStr, owners: [] };
}
function makeGarrison(key, gold) {
  const suffix = gold ? 'b' : 'a', id = `garrison_rhine_${key}_${suffix}`;
  const grade = gold ? 1 : 0, r = RHINE_BALANCE;
  if (key === 'copy_start') return garrison(id, '身前一格干员若为“进入休整期时”特质，本干员的特质与其相同', 'SERVER_PREP_START', 'SERVER_FRONT_SAME_EFFECT_PREP_START');
  if (key === 'copy_end') return garrison(id, '身前一格干员若为“休整期结束时”特质，本干员的特质与其相同', 'SERVER_PREP_FIN', 'SERVER_FRONT_SAME_EFFECT_PREP_FIN');
  if (key === 'mayer') return garrison(id, `战斗中，身前一格科研装置每完成一次有效工作，使已激活的【莱茵生命】增加${r.mayerDeviceLayers[grade]}层。能量装置每次实际发射脉冲计一次；生态维持仪有实际治疗、护盾净增加或累计${r.ecologyResearchInterval}秒有效减速时计一次，同一装置${r.medicalInterval}秒内最多计一次，多个目标和治疗来源不重复计数；激光钻机累计${r.laserResearchInterval}秒有效输出计一次，逐次伤害不重复产层。无目标时暂停累计。同一装置只取最强的一名梅尔`, 'IN_BATTLE', 'RHINE_MAYER_RESEARCH', { device_layers: r.mayerDeviceLayers[grade] });
  if (key === 'saria') return garrison(id, `战斗中，每${r.sariaLayerStep}层科研使自身治疗量提高${r.sariaHealBonus[grade] * 100}%`, 'IN_BATTLE', 'RHINE_SARIA_HEALING', { layer_step: r.sariaLayerStep, heal: r.sariaHealBonus[grade] });
  if (key === 'ifrit') return garrison(id, `战斗中，自身获得己方已部署且有效的单台科研装置中最高基础攻击力的${r.ifritInheritance[grade] * 100}%作为额外攻击力，多台不相加，无独立继承上限`, 'IN_BATTLE', 'RHINE_IFRIT_INHERITANCE', { atk_scale: r.ifritInheritance[grade] });
  if (key === 'astgenne') return garrison(id, `战斗中，首次开启技能时，使已激活的【莱茵生命】与【精准】各增加${r.astgenneFirstSkillLayers[grade]}层`, 'IN_BATTLE', 'RHINE_ASTGENNE_FIRST_SKILL', { layer: r.astgenneFirstSkillLayers[grade] }, { bond_ids: `${RHINE_BOND},preciShip` });
  if (key === 'dorothy') return garrison(id, `战斗中，自身布置的陷阱每触发一枚，使已激活的【莱茵生命】增加${r.dorothyTrapLayers[grade]}层；每场普通主战最多获得${r.dorothyBattleLayerCap[grade]}层。一枚陷阱命中多人只计一次，连锁引爆逐枚计数；双倍伤害陷阱不额外产层，撤回、搬动或未触发销毁不产层`, 'IN_BATTLE', 'RHINE_DOROTHY_TRAP_RESEARCH', { layer: r.dorothyTrapLayers[grade], max_layer: r.dorothyBattleLayerCap[grade] }, { bond_id: RHINE_BOND });
  return garrison(id, `休整期结束时，每名实际在场的莱茵生命干员使莱茵生命增加${r.ptilopsisLayersPerMember[grade]}层科研；同名干员分别计数，调和的虚拟人数不计入`, 'SERVER_PREP_FIN', 'RHINE_RESEARCH_BY_MEMBER', { layer: r.ptilopsisLayersPerMember[grade] }, { conditionkey: 'character_target_inboard' });
}

function adaptMayerTalent(talent, count) {
  if (talent.bb?.cnt == null) return;
  talent.bb.cnt = count;
  for (const field of ['desc', 'descRaw']) talent[field] = String(talent[field]).replace(/可以使用.*?个机械水獭召唤物/, `可以使用${count}个机械水獭召唤物`) + '。机械水獭不能接受干员治疗（包括塞雷娅及干员的治疗召唤物），可接受生态维持仪治疗';
}

function adaptDorothyTalent(talent, count) {
  if (talent.bb?.cnt == null || talent.tokenKey !== DOROTHY_TOKEN) return;
  talent.bb.cnt = count;
  for (const field of ['desc', 'descRaw']) talent[field] = String(talent[field]).replace(/可以使用.*?个共振装置（最多拥有\d+个）/, `可以使用${count}个共振装置（最多拥有${count}个，同时最多部署${count}个）`);
}

function compileDorothyToken(ctx, chess) {
  const t = ctx.charTable[DOROTHY_TOKEN], variants = {}, owners = ['chess_rhine_dorothy_a', 'chess_rhine_dorothy_b'];
  for (const id of owners) {
    const c = chess[id], opts = { ...c.status, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL), skillIndex: c.skill.index, label: id };
    if (c.module?.active) {
      opts.modulePhase = ordinaryModulePhase(ctx, c.module.id, c.module.level);
      opts.moduleTokenParts = splitModuleParts(opts.modulePhase).token;
    }
    const count = RHINE_BALANCE.dorothyTrapLimit[c.isGolden ? 1 : 0];
    const variant = (extra = {}) => {
      const v = tokenVariant({ ...ctx, ac: {} }, DOROTHY_TOKEN, t, { ...opts, ...extra });
      v.stats.deployLimit = count; v.stats.deckStack = count;
      // Only the trap kit may activate the zero-SP token skill after a ground enemy steps on it.
      if (v.skill) v.skill.trigger = { rule: 'DOROTHY_TRAP', rawRule: 'DEFAULT', customRangeGrid: null };
      return v;
    };
    const v = variants[id] = { ...variant(), count, sources: ['talent', 'display'], bySkill: {} };
    for (const s of c.skills.filter(s => !s.isDefault)) v.bySkill[s.index] = { skill: variant({ skillIndex: s.index }).skill, count, sources: ['talent', 'display'] };
    if (c.isGolden) {
      const mv = variant({ modulePhase: null, moduleTokenParts: [] });
      v.byModule = { none: { stats: mv.stats, immunities: mv.immunities, trait: mv.trait, talents: mv.talents } };
    }
  }
  const initial = variants[owners[0]], desc = `${t.description}；库存与同时部署上限为普通4个、精锐5个，开场自动部署也占上限。撤回、搬动或未触发销毁不会获得科研层数`;
  return { tokenId: DOROTHY_TOKEN, kind: 'summon', name: t.name, appellation: t.appellation, desc, descRaw: desc,
    profession: 'TOKEN', subProfessionId: t.subProfessionId, position: 'MELEE', displayType: 'DEFAULT', placeable: true, ownerRange: false,
    owners, stats: initial.stats, rangeGrid: initial.rangeGrid, dmgType: 'none', attackKind: 'melee', projectile: 'none', canHitFly: false,
    skill: null, deployLimit: initial.stats.deployLimit, count: initial.count, abnormal: ['isolated'], variants,
    assets: { avatar: DOROTHY_TOKEN, spine: DOROTHY_TOKEN } };
}

function compileChess(ctx, config, spec, gold, index) {
  const c = ctx.charTable[spec.charId], baseId = `chess_rhine_${spec.key}_a`, goldenId = `chess_rhine_${spec.key}_b`;
  const chessId = gold ? goldenId : baseId;
  const st = config.economy.chessStatus[spec.tier][gold ? 'golden' : 'normal'];
  const status = { phase: st.phase, level: st.level, skillLevel: st.skillLevel, equipLevel: st.equipLevel };
  const attrs = withPotential(c, interpolateAttrs(c, status.phase, status.level), (ctx.potRank ?? OPERATOR_POTENTIAL), chessId);
  const { trait, classify } = traitRecord(ctx, c, status.phase, status.level, [], chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  const skills = c.skills.flatMap((s, index) => {
    if (!unlocked(s.unlockCond, status.phase, status.level)) return [];
    const skill = buildSkill(ctx, s.skillId, status.skillLevel, null, chessId);
    skill.index = index; skill.overrideTokenKey = s.overrideTokenKey || null;
    if (spec.key === 'mayer' && index === 1) skill.trigger = { rule: 'SP_FULL', rawRule: 'ALWAYS', customRangeGrid: null };
    if (spec.key === 'dorothy') skill.trigger = { rule: 'SP_FULL', rawRule: 'ALWAYS', customRangeGrid: null };
    return [{ ...skill, isDefault: s.skillId === spec.skillId }];
  });
  const skill = clone(skills.find(s => s.isDefault)); delete skill.isDefault;
  const g = makeGarrison(spec.trait, gold);
  const statsBase = statsFrom(attrs), talentsBase = baseTalentList(ctx, c, status.phase, status.level, chessId, (ctx.potRank ?? OPERATOR_POTENTIAL));
  if (spec.key === 'mayer') for (const t of talentsBase) adaptMayerTalent(t, RHINE_BALANCE.mayerSummons[gold ? 1 : 0]);
  if (spec.key === 'dorothy') for (const t of talentsBase) adaptDorothyTalent(t, RHINE_BALANCE.dorothyTrapLimit[gold ? 1 : 0]);
  const modules = gold ? moduleChoices(ctx, { ...c, charId: spec.charId }, status, chessId, spec) : [];
  if (spec.key === 'mayer') for (const m of modules) for (const t of m.talentChanges) adaptMayerTalent(t, RHINE_BALANCE.mayerSummons[gold ? 1 : 0]);
  if (spec.key === 'dorothy') for (const m of modules) for (const t of m.talentChanges) adaptDorothyTalent(t, RHINE_BALANCE.dorothyTrapLimit[gold ? 1 : 0]);
  const mod = modules.find(m => m.isDefault);
  return { chessId, baseId, goldenId, isGolden: gold, tier: spec.tier, identifier: 200 + index,
    isHidden: false, isDiy: false, visible: true, chessType: 'PRESET', shopSortId: 200 + index,
    backup: { charId: spec.charId, tmplId: null, skillIndex: skill.index, uniEquipId: spec.defaultModuleId, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL) },
    charId: spec.charId, name: c.name, appellation: c.appellation, rarity: Number(c.rarity.replace('TIER_', '')),
    profession: c.profession, subProfessionId: c.subProfessionId, subProfessionName: spec.subName, position: c.position,
    nationId: c.nationId, bonds: [...spec.bonds], garrisonIds: [g.garrisonId],
    price: config.economy.chessPrice[spec.tier][gold ? 'golden' : 'normal'], sellPrice: 1,
    upgradeNum: gold ? 0 : 3, upgradeChessId: gold ? null : goldenId, status,
    stats: mod ? composeStats(statsBase, mod.attr) : statsBase, immunities: immunitiesOf(attrs), rangeId: c.phases[status.phase].rangeId,
    rangeGrid: rangeGrid(ctx, c.phases[status.phase].rangeId), ...classify, trait: mod?.traitOverride || trait, skill,
    skills, talents: mod ? composeTalents(talentsBase, mod.talentChanges) : talentsBase,
    tokens: spec.key === 'mayer' ? [TOKEN] : spec.key === 'dorothy' ? [DOROTHY_TOKEN] : [], module: mod ? { id: mod.uniEquipId, name: mod.name, type: mod.typeName, level: mod.level, active: true } : null,
    assets: { avatar: gold ? `${spec.charId}_2` : spec.charId, portrait: `${spec.charId}_${gold ? 2 : 1}`, spine: spec.charId, skillIcon: skill.iconId, subProfIcon: `sub_${c.subProfessionId}_icon` },
    ...(gold ? { statsBase, traitBase: clone(trait), talentsBase, modules } : {}),
    extension: { id: 'rhine-research', sourceRevision: ctx.source.revision, supportedSkills: skills.map(s => s.skillId) } };
}

function applyEquipment({ items, effects }) {
  const specs = [
    { key: 'terminal', name: '莱茵实验终端', price: 2, sort: 13 },
    { key: 'mainframe', name: '联合研究主机', price: 4, sort: 12 },
  ];
  for (const [index, spec] of specs.entries()) for (const gold of [false, true]) {
    const r = RHINE_EQUIPMENT[spec.key], grade = gold ? 1 : 0, terminal = spec.key === 'terminal';
    const baseId = `${r.key}_a`, goldenId = `${r.key}_b`, id = gold ? goldenId : baseId;
    const stat = terminal ? { atk: r.attack[grade] } : { max_hp: r.hp[grade] };
    const special = terminal
      ? { layer_step: r.layerStep, attack_speed: r.attackSpeed[grade], max_attack_speed: r.attackSpeedCap[grade] }
      : { atk_per_layer: r.attackPerLayer, combo_atk_per_layer: r.comboAttackPerLayer };
    const specialStrings = { key: `rhine_${spec.key}`, ...(terminal ? {} : { equip_chess_id: RHINE_EQUIPMENT.terminal.key }) };
    const buffs = [
      { key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: stat, bbStr: { key: 'attr_common_global_buff' } },
      { key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: special, bbStr: specialStrings },
    ];
    const desc = terminal
      ? `攻击力+${r.attack[grade] * 100}%；己方【莱茵生命】盟约激活时，携带者每${r.layerStep}层科研获得${r.attackSpeed[grade]}攻击速度，最多${r.attackSpeedCap[grade]}。`
      : `生命上限+${r.hp[grade] * 100}%；携带者属于【莱茵生命】且在场时，己方每台已部署科研装置每层科研额外获得${r.attackPerLayer}点基础攻击力。携带者同时装备“莱茵实验终端”时，变为每层${r.comboAttackPerLayer}点。该额外攻击无数值上限；多个主机只取最强效果，不叠加。该增益计入伊芙利特的继承与科研成果共享。`;
    const effectId = `eff_rhine_${spec.key}_${gold ? 'b' : 'a'}`;
    effects[effectId] = { effectId, effectType: 'EQUIP', name: spec.name, desc, descRaw: desc,
      counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0,
      buffs: clone(buffs), params: { ...stat, ...special, ...specialStrings } };
    items[id] = { id, baseId, goldenId, isGolden: gold, trapId: `trap_rhine_${spec.key}`, iconId: `trap_rhine_${spec.key}`,
      identifier: 500 + index * 2 + grade, name: spec.name, itemType: 'EQUIP', tier: r.tier, shopSortId: spec.sort,
      price: gold ? 5 : spec.price, hideInShop: false, shopExcluded: false, shopExcludedBy: null,
      mergeable: !gold, upgradeNum: gold ? 0 : 2, upgradeChessId: gold ? null : goldenId, duration: gold ? 0 : -1,
      giveBondId: terminal ? RHINE_BOND : null, givePowerId: null, canGiveBond: false, requiresBondId: terminal ? null : RHINE_BOND,
      effectId, effectName: spec.name, desc, descRaw: desc, buffs, params: clone(effects[effectId].params),
      category: 'BOND_SIGNATURE', kind: 'passive', family: 'rhine',
      implFormula: terminal ? 'ATK% += atk. If own Rhine bond is active, ASPD += min(floor(layers / layer_step) * attack_speed, max_attack_speed).'
        : 'HP% += max_hp. Each deployed research device gains the strongest live Rhine carrier contribution: layers * atk_per_layer, or combo_atk_per_layer when that carrier also equips the terminal, without an attack cap. This enters device base ATK before inheritance/sharing and never reads device ATK.',
      rangeGrid: [[0, 0]], flavor: null };
  }
  // The ordinary grant mechanism already reads the OTHER item's giveBondId. Explain the new
  // pairing in both item grades and their source effect without replacing existing mappings.
  const mapping = '与“莱茵实验终端”同时携带时，额外获得【莱茵生命】盟约。';
  for (const it of Object.values(items).filter(i => i.canGiveBond)) {
    for (const rec of [it, effects[it.effectId]].filter(Boolean)) for (const key of ['desc', 'descRaw']) {
      if (!String(rec[key] || '').includes(mapping)) rec[key] = `${rec[key] || ''}\n${mapping}`;
    }
  }
}

export async function applyRhineData(files, source = null) {
  const ctx = source || JSON.parse(await readFile(new URL('./rhine-data-source.json', import.meta.url), 'utf8'));
  if (!Number.isInteger(ctx.potRank)) return applyPotentialOverlay(files, applyRhineData, ctx);
  const { chess, bonds, garrisons, tokens, effects, config } = files;
  applyOpeningBans(config);
  for (const [index, spec] of RHINE_ADDITIONS.entries()) for (const gold of [false, true]) {
    const c = compileChess(ctx, config, spec, gold, index);
    chess[c.chessId] = c;
    const g = makeGarrison(spec.trait, gold); garrisons[g.garrisonId] = g;
  }
  for (const c of Object.values(chess)) {
    if (c.charId === RHINE_CHARACTERS.ptilopsis || c.charId === RHINE_CHARACTERS.saria) {
      c.tier = 3;
      c.price = config.economy.chessPrice[3][c.isGolden ? 'golden' : 'normal'];
      // Tiers III–V share E2 L1 / E2 L60 and skill levels; existing module stats remain valid.
      const tierStatus = config.economy.chessStatus[3][c.isGolden ? 'golden' : 'normal'];
      for (const k of ['phase','level','skillLevel','equipLevel']) c.status[k] = tierStatus[k];
      c.bonds = [c.charId === RHINE_CHARACTERS.saria ? 'steadShip' : 'deputShip', RHINE_BOND];
      const g = makeGarrison(c.charId === RHINE_CHARACTERS.saria ? 'saria' : 'ptilopsis', c.isGolden);
      garrisons[g.garrisonId] = g; c.garrisonIds = [g.garrisonId];
    }
    if ([RHINE_CHARACTERS.silence, RHINE_CHARACTERS.muelsyse, RHINE_CHARACTERS.halo2].includes(c.charId) && !c.bonds.includes(RHINE_BOND)) c.bonds.push(RHINE_BOND);
  }
  // Extend only the Rhine profile's existing Solstice Astgenne trait. Its event, spending
  // arithmetic and copy/retrigger behavior remain those of the upstream handler.
  for (const c of Object.values(chess).filter(c => c.charId === RHINE_CHARACTERS.halo2)) {
    for (const id of c.garrisonIds) {
      const g = garrisons[id];
      if (g?.effectKey !== 'SERVER_ADD_BOND_ROUND_COIN_COST') continue;
      const ids = String(g.bbStr.bond || '').split(',').filter(Boolean);
      if (!ids.includes(RHINE_BOND)) ids.push(RHINE_BOND);
      g.bbStr.bond = ids.join(',');
      for (const field of ['desc', 'descRaw']) {
        if (!g[field].includes('【莱茵生命】')) g[field] = g[field].replace('【奥术】', '【奥术】【莱茵生命】');
      }
    }
  }
  for (const g of Object.values(garrisons)) g.owners = Object.values(chess).filter(c => c.garrisonIds.includes(g.garrisonId)).map(c => c.chessId);
  const bond = { ...clone(bonds.yanShip), bondId: RHINE_BOND, name: '莱茵生命', identifier: 24, bondOrder: 24,
    isCore: true, bondType: 'SEASON', iconId: 'rhineShip', activeCount: RHINE_BALANCE.thresholds[0], thresholds: [...RHINE_BALANCE.thresholds], maxCount: null,
    layerMilestones: [], powerIdList: [], desc: TEXT, descRaw: TEXT, effectId: 'bondeffect_rhine', effectName: '莱茵生命',
    effectDesc: TEXT, effectDescRaw: TEXT, effectDescParams: [], bb: { base_atk: RHINE_BALANCE.baseAttack, atk_per_stack: RHINE_BALANCE.attackPerLayer, sharing_count: RHINE_BALANCE.sharingCount, sharing_atk: RHINE_BALANCE.researchSharing[0], sharing_golden_atk: RHINE_BALANCE.researchSharing[1] },
    bbStr: { key: 'rhine_research' }, buffs: [], baseParams: {}, perStackParams: {}, spec: { researchDevices: RHINE_DEVICES.map(d => d.tokenId) } };
  bonds[RHINE_BOND] = bond;
  for (const b of Object.values(bonds)) {
    b.members = Object.values(chess).filter(c => !c.isGolden && c.bonds.includes(b.bondId)).map(c => c.chessId);
    b.visibleMembers = b.members.filter(id => chess[id].visible);
  }
  effects.bondeffect_rhine = { effectId: 'bondeffect_rhine', effectType: 'BOND', name: '莱茵生命', desc: TEXT, descRaw: TEXT,
    counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0, buffs: [], params: { base_atk: RHINE_BALANCE.baseAttack, atk_per_stack: RHINE_BALANCE.attackPerLayer, sharing_count: RHINE_BALANCE.sharingCount, sharing_atk: RHINE_BALANCE.researchSharing[0], sharing_golden_atk: RHINE_BALANCE.researchSharing[1] } };
  for (const m of Object.values(config.modes)) {
    if (!m.activeBondIds.includes(RHINE_BOND)) m.activeBondIds.push(RHINE_BOND);
    m.inactiveBondIds = m.inactiveBondIds.filter(id => id !== RHINE_BOND);
  }
  const t = ctx.charTable[TOKEN], variants = {}, owners = ['chess_rhine_mayer_a', 'chess_rhine_mayer_b'];
  for (const id of owners) {
    const c = chess[id], opts = { ...c.status, potRank: (ctx.potRank ?? OPERATOR_POTENTIAL), skillIndex: c.skill.index, label: id };
    if (c.module?.active) {
      opts.modulePhase = ordinaryModulePhase(ctx, c.module.id, c.module.level);
      opts.moduleTokenParts = splitModuleParts(opts.modulePhase).token;
    }
    const variant = (extra = {}) => {
      const v = tokenVariant({ ...ctx, ac: {} }, TOKEN, t, { ...opts, ...extra });
      // Expansion summon limit applies to every loadout variant, not only the default skill.
      v.stats.deployLimit = RHINE_BALANCE.mayerSummons[c.isGolden ? 1 : 0];
      for (const talent of v.talents) if (talent.bb.max_deploy_count != null) talent.bb.max_deploy_count = v.stats.deployLimit;
      return v;
    };
    const v = variants[id] = { ...variant(), count: c.talents[0].bb.cnt, sources: ['talent', 'display'], bySkill: {} };
    for (const s of c.skills.filter(s => !s.isDefault)) v.bySkill[s.index] = { skill: variant({ skillIndex: s.index }).skill, count: v.count, sources: ['talent', 'display'] };
    if (c.isGolden) {
      v.byModule = {};
      for (const m of [...c.modules.filter(m => !m.isDefault), ...(c.module?.active ? [null] : [])]) {
        const ph = m && ordinaryModulePhase(ctx, m.uniEquipId, m.level);
        const mv = variant({ modulePhase: ph, moduleTokenParts: ph ? splitModuleParts(ph).token : [] });
        v.byModule[m?.uniEquipId || 'none'] = { stats: mv.stats, immunities: mv.immunities, trait: mv.trait, talents: mv.talents };
      }
    }
  }
  const initial = variants[owners[0]];
  const otterDesc = `${t.description}；机械水獭不能接受干员治疗（包括塞雷娅及干员的治疗召唤物），可接受生命维持仪治疗`;
  tokens[TOKEN] = { tokenId: TOKEN, kind: 'summon', name: t.name, appellation: t.appellation, desc: otterDesc, descRaw: otterDesc,
    profession: 'TOKEN', subProfessionId: t.subProfessionId, position: 'MELEE', displayType: 'DEFAULT', placeable: true, ownerRange: false,
    owners, stats: initial.stats, rangeGrid: initial.rangeGrid, dmgType: 'phys', attackKind: 'melee', projectile: 'none', canHitFly: false,
    skill: null, deployLimit: initial.stats.deployLimit, count: initial.count, abnormal: [], variants, assets: { avatar: TOKEN, spine: TOKEN } };
  tokens[DOROTHY_TOKEN] = compileDorothyToken(ctx, chess);
  delete tokens.token_rhine_ecology;
  for (const d of RHINE_DEVICES) tokens[d.tokenId] = { tokenId: d.tokenId, kind: 'summon', name: d.name, appellation: d.name,
    desc: d.description, descRaw: d.description, profession: 'TOKEN', subProfessionId: 'notchar1', position: 'ALL', displayType: 'DEFAULT',
    placeable: false, ownerRange: false, owners: [], stats: { ...BASE_STATS, atk: RHINE_BALANCE.baseAttack },
    rangeGrid: [[0,0]], dmgType: 'none', attackKind: 'ranged', projectile: 'none', canHitFly: false, skill: null,
    deployLimit: 1, count: 1, abnormal: [], variants: {}, assets: { avatar: d.tokenId, spine: null, icon: d.icon, sprite: d.sprite } };
  applyEquipment(files);
  if (bonds[KAZDEL_BOND]) applyKazdelOpeningBans(config);
  return files;
}

export function validateRhineData({ chess, bonds, garrisons, tokens, config, items, effects }) {
  const errors = [], rhine = bonds[RHINE_BOND];
  if (!rhine || rhine.visibleMembers.length !== 9) errors.push('Rhine must have exactly 9 visible normal members');
  for (const spec of RHINE_ADDITIONS) for (const suffix of ['a','b']) {
    const c = chess[`chess_rhine_${spec.key}_${suffix}`];
    if (!c || c.charId !== spec.charId || c.skills.length !== (['mayer','wuhoo','astgenne'].includes(spec.key) ? 2 : 3)
      || c.skill.skillId !== spec.skillId || c.skills.filter(s => s.isDefault).length !== 1) errors.push(`Rhine missing supported unit ${spec.key}_${suffix}`);
    if (c) for (const id of c.garrisonIds) if (!garrisons[id]) errors.push(`Rhine missing garrison ${id}`);
    if (c) for (const id of c.tokens) if (!tokens[id]) errors.push(`Rhine missing token ${id}`);
  }
  for (const d of RHINE_DEVICES) if (tokens[d.tokenId]?.stats.atk !== RHINE_BALANCE.baseAttack) errors.push(`Rhine bad device attack ${d.tokenId}`);
  for (const m of Object.values(config.modes)) if (!m.activeBondIds.includes(RHINE_BOND)) errors.push(`Rhine missing mode ${m.modeId}`);
  for (const [key, spec] of Object.entries(RHINE_EQUIPMENT)) for (const suffix of ['a','b']) {
    const id = `${spec.key}_${suffix}`, it = items?.[id];
    if (!it || it.tier !== spec.tier || !effects[it.effectId] || it.itemType !== 'EQUIP') errors.push(`Rhine missing equipment ${id}`);
    if (it && (it.isGolden !== (suffix === 'b') || it.mergeable !== (suffix === 'a') || !items[it.goldenId]?.isGolden)) errors.push(`Rhine bad equipment upgrade ${id}`);
    if (key === 'terminal' && it?.giveBondId !== RHINE_BOND) errors.push(`Rhine missing terminal transfer ${id}`);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('usage: node tools/rhine-data.mjs [--out data]');
  const out = resolve(args[1] || fileURLToPath(new URL('../data', import.meta.url)));
  const names = ['chess','bonds','garrisons','tokens','effects','config','items'];
  const files = Object.fromEntries(await Promise.all(names.map(async n => [n, JSON.parse(await readFile(join(out, `${n}.json`), 'utf8'))])));
  await applyRhineData(files);
  const errors = validateRhineData(files);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const n of names) { const dest = join(out, `${n}.json`), tmp = `${dest}.tmp-${process.pid}`; await writeFile(tmp, JSON.stringify(files[n])); await rename(tmp, dest); }
  const { refreshRhineTranslations } = await import('./rhine-i18n.mjs');
  await refreshRhineTranslations(out);
  console.log('Rhine overlay complete: 6 operators, 9 Rhine members, 3 research devices, 2 equipment pairs.');
}
