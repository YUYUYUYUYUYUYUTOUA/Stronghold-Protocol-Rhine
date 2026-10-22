// Deterministic offline Rim Billiton roster; native records come from the pinned source subset.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileChess } from './rhine-data.mjs';
import { compileBackupPreset } from './preset-data.mjs';
import { applyPotentialOverlay } from './extension-potential.mjs';
import { REM_EQUIPMENT } from '../shared/rem.js';
export const REM_BOND = 'remShip';
// Match the other fixed expansions: the first ordinary (002) supported module is the elite default.
// Keep this explicit per member so a future module-less addition can stay null; normal cards never equip a module.
export const REM_ADDITIONS = [
  ['jcinta','char_4237_jcinta',1,'deputShip','执旗手','REM_JACINTA','uniequip_002_jcinta'],
  ['glider','char_449_glider',1,'deputShip','行医','REM_MULBERRY','uniequip_002_glider'],
  ['aprl','char_365_aprl',2,null,'速射手',null,'uniequip_002_aprl'],
  ['warmy','char_4081_warmy',2,'visiShip','本源术师','REM_WARMY','uniequip_002_warmy'],
  ['tmslot','char_4236_tmslot',3,'skillfulShip','驭械术师','REM_CLICK','uniequip_002_tmslot'],
  ['savage','char_230_savage',4,'steadShip','强攻手','REM_SAVAGE','uniequip_002_savage'],
  ['asbest','char_378_asbest',5,'soloShip','驭法铁卫','REM_ASBESTOS','uniequip_002_asbest'],
  ['thumpy','char_4235_thumpy',5,'steadShip','本源铁卫','REM_SANDRECKONER','uniequip_002_thumpy'],
  ['ray','char_4117_ray',6,'preciShip','猎手','REM_RAY','uniequip_002_ray'],
].map(([key,charId,tier,sub,subName,effectKey,defaultModuleId]) => ({ key,charId,tier,subName,effectKey,prefix:'rem',bonds:[REM_BOND,...(sub?[sub]:[])],skillId:`skchr_${key}_2`,defaultModuleId,...(key==='aprl'?{price:1}:{}) }));
function trait(spec,gold) {
  const n=gold?1:0;
  const text={
    jcinta:`每次成功开启技能，召唤${[1,2][n]}名常驻援军，固定使用三档池，不占常规总量；仍受厨师种类上限约束。`,
    glider:`本玩家援军入场后，每5秒恢复自身最大生命的${[5,10][n]}%；同名取最高。`,
    aprl:'普通与精锐基础购买价格均为1；折扣后最低0。',
    warmy:`每回合本玩家每实际成功生成一个援军，使已激活的【雷姆必拓】增加${[1,2][n]}层，同玩家共享上限${[16,32][n]}层。`,
    tmslot:`浮游单元标记目标，引导附近援军攻击射程内该目标，并获得${[10,20][n]}攻速；已有阻挡目标优先，不追击范围外敌人。`,
    savage:`自身与周围8格的本玩家【雷姆必拓】干员及援军（包含车辆）击杀敌人时，使已激活的【雷姆必拓】增加${[2,4][n]}层；仅真实死亡生效，每个敌人只结算一次，同玩家每回合共享上限${[24,48][n]}层。`,
    asbest:`经过周围8格的本玩家援军本场防御力增加${[20,40][n]}、法抗增加${[3,6][n]}；出生即在范围内也生效，同名不重复叠加。`,
    thumpy:`每${[12,6][n]}秒召唤2名随机常驻援军，可出现组合矿工，不包含车辆或老板；不开场瞬发。`,
    ray:`普攻同时攻击射程内所有被本玩家援军阻挡的额外敌人，造成${[50,70][n]}%攻击力伤害。每轮只扣一发弹药，原生回弹和入神按主目标结算；一技能特殊攻击保持原生。`,
  }[spec.key];
  const bb={ jcinta:{count:[1,2][n]},glider:{interval:5,heal_ratio:[.05,.1][n]},warmy:{layer:[1,2][n],max_layer:[16,32][n]},tmslot:{attack_speed:[10,20][n]},savage:{layer:[2,4][n],max_layer:[24,48][n]},asbest:{def:[20,40][n],res:[3,6][n]},thumpy:{interval:[12,6][n],count:2},ray:{atk_scale:[.5,.7][n]} }[spec.key]||{};
  return {garrisonId:`garrison_rem_${spec.key}_${gold?'b':'a'}`,desc:text,descRaw:text,eventType:'IN_BATTLE',eventTypeDesc:'特异化',eventTypeIcon:'icon_support',effectType:spec.effectKey||'REM_APRIL_PRICE',effectKey:spec.effectKey||'REM_APRIL_PRICE',battleRuneKey:null,charLevel:0,bb,bbStr:{},owners:[]};
}
function applyRemEquipment({ items, effects }) {
  for (const [index, [key, spec]] of Object.entries(REM_EQUIPMENT).entries()) for (const gold of [false, true]) {
    const grade = gold ? 1 : 0, armor = key === 'armor', name = armor ? '矿业护具' : '工头的扩音器';
    const baseId = `${spec.key}_a`, goldenId = `${spec.key}_b`, id = gold ? goldenId : baseId;
    const params = armor ? { max_hp: spec.hp[grade], damage_reduction: spec.damageReduction[grade] }
      : { atk: spec.attack[grade], def_ignore: spec.defIgnore[grade], combo_def_ignore: spec.comboDefIgnore[grade] };
    const strings = { key: `rem_${key}`, ...(!armor ? { equip_chess_id: REM_EQUIPMENT.armor.key } : {}) };
    const buffs = [{ key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: params, bbStr: strings }];
    const common = '仅【雷姆必拓】干员可装备；携带者存活在场时，自身格及周围八格内同玩家援军（含车辆与老板）受益，按双方实际位置判定；同类装备的基础属性与专属效果均只取最高。';
    const desc = armor ? `最大生命值+${Math.round(spec.hp[grade] * 100)}%；范围内己方援军受到的伤害降低${Math.round(spec.damageReduction[grade] * 100)}%。${common}`
      : `攻击力+${Math.round(spec.attack[grade] * 100)}%；范围内己方援军攻击忽略目标${Math.round(spec.defIgnore[grade] * 100)}%防御；携带者同时装备“矿业护具”时改为忽略${Math.round(spec.comboDefIgnore[grade] * 100)}%防御。${common}`;
    const effectId = `eff_rem_${key}_${gold ? 'b' : 'a'}`;
    effects[effectId] = { effectId, effectType: 'EQUIP', name, desc, descRaw: desc,
      counterType: 'NONE', continuedRound: -1, decoIconId: null, enemyPrice: 0,
      buffs: structuredClone(buffs), params: { ...params, ...strings } };
    items[id] = { id, baseId, goldenId, isGolden: gold, trapId: `trap_rem_${key}`, iconId: `trap_rem_${key}`,
      identifier: 540 + index * 2 + grade, name, itemType: 'EQUIP', tier: spec.tier, shopSortId: 30 + index,
      price: gold ? 5 : spec.price, hideInShop: false, shopExcluded: false, shopExcludedBy: null,
      mergeable: !gold, upgradeNum: gold ? 0 : 2, upgradeChessId: gold ? null : goldenId, duration: gold ? 0 : -1,
      giveBondId: null, givePowerId: null, canGiveBond: false, requiresBondId: REM_BOND,
      effectId, effectName: name, desc, descRaw: desc, buffs, params: structuredClone(effects[effectId].params),
      category: 'BOND_SIGNATURE', kind: 'passive', family: 'rem',
      implFormula: armor ? 'Rem carrier only: HP% += max_hp. Nearby same-owner actual Rem reinforcements take damage * (1 - strongest damage_reduction).'
        : 'Rem carrier only: ATK% += atk. Nearby same-owner actual Rem reinforcement physical hits ignore strongest def_ignore, replaced by combo_def_ignore only when that same live carrier also carries armor.',
      rangeGrid: [[0, 0], [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]], flavor: null };
  }
}
export async function applyRemData(files,source=null) {
  const ctx=source||JSON.parse(await readFile(new URL('./rem-data-source.json',import.meta.url),'utf8'));
  if(!Number.isInteger(ctx.potRank)) return applyPotentialOverlay(files,applyRemData,ctx);
  applyRemEquipment(files);
  for(const [index,spec] of REM_ADDITIONS.entries()) for(const gold of [false,true]) {
    const g=trait(spec,gold); files.garrisons[g.garrisonId]=g;
    const c=['thumpy','ray'].includes(spec.key)?compileBackupPreset(files,spec,gold,index,g,ctx.potRank):compileChess(ctx,files.config,{...spec,garrison:g},gold,index+20);
    if(gold && spec.defaultModuleId && (!c.module?.active || c.module.id!==spec.defaultModuleId)) throw new Error(`Missing supported Rem default module ${spec.defaultModuleId} for ${c.chessId}`);
    c.extension.id='rem-reinforcements';
    if(spec.price!=null)c.price=spec.price;
    files.chess[c.chessId]=c;
  }
  // Reinforcements use the simulation's layer-scaled inline definitions; art is planned by rem-plan.mjs.
  for (const key of ['child','miner','combined','chef','enthusiast','food','bus','boss']) delete files.tokens[`token_rem_${key}`];
  for(const id of ['chess_char_3_02_a','chess_char_3_02_b','chess_char_4_14_a','chess_char_4_14_b']) {
    const c=files.chess[id]; if(!c.bonds.includes(REM_BOND))c.bonds.push(REM_BOND);
  }
  const desc='战斗开始时按3/6/9名不同雷姆必拓干员锁定档位。普通援军（含厨师）与好心肠老板先按层数计算完整面板，再按3/6/9档生命乘1.5/2.2/3.2、攻击乘1.3/1.8/2.5、防御乘1.2/1.5/1.8、法抗加5/10/15，档位替代不累乘；组合矿工固定攻击+600、防御+800计入倍率前基底，厨师光环、眩晕和攻击频率不放大。美食车辆与校车仅应用攻击倍率，车辆生命、防御与法抗保持原基底，校车攻击仍为0。9档300层无其他增益时，老板生命6720、攻击4000、防御180、法抗15，每枚披萨减防前8000物理伤害。常规援军上限6/12/16；开场2/2/3名，之后每10/8/6秒补充1/2/3名，满额不积欠。取消集合点；普通战斗中，普通援军从己方蓝门入场，搜索同战场友方（包含合作队友）存活且已部署的攻击型干员火力覆盖内的合法可达敌人，接近并攻击，目标离开覆盖、死亡或不可达时重新选敌；无合格敌人时在覆盖内沿四方向持续徘徊，无覆盖时安全让开蓝门后待机。协防中，普通援军优先进入本玩家存活且已部署的攻击型【雷姆必拓】干员在当前战场的攻击覆盖；进入或跨区追击可沿合法路径经过无覆盖中间格，追击目的地仍须在优先覆盖内。无可达雷姆覆盖时回退友方火力覆盖，无可达覆盖则让门待机；随干员死亡、范围变化或道路恢复重新评估并恢复优先。援军彼此移动和停留可重叠，包含车辆与老板，不影响干员部署或地形规则；车辆与老板保持原路线。Boss及隐秘核心阶段，普通援军直接锁定同场存活Boss，沿合法可走路径接近，不受友方火力覆盖限制；Boss暂不可选中时在附近合法位置等待，真正死亡后改锁同场其他存活Boss，没有则解除锁定。实际阻挡接战与不拖拽规则保留，清除阻挡后继续追击。6/9档按本玩家实际存活且已部署的援军（包含车辆与老板）累计存活时间，每累计1援军·秒使己方【雷姆必拓】干员攻击力和生命值增加1%/2%，每回合最多200%/300%；待生成不计，死亡或退场停止贡献，已得加成保留，普通主战至本回合联防继承，下回合清零。每次常驻召唤先独立判定2%组合矿工，再抽当前档位池；厨师最多1/2/3名，同名光环不叠加。6档起每20秒一辆美食的诱惑（首次10秒），一次经过对每名敌人造成一次以1500+5S为基底乘当前档位攻击倍率的物理伤害；9档每25秒校车投放最多5名常驻援军，开场1名好心肠老板、之后每30秒补充至最多2名，老板攻击力以1000+2S为基底乘当前档位攻击倍率，沿路线往返每秒投弹；普通场在自身当时位置投弹，Boss及隐秘核心场有Boss时瞄准其发射时位置，落点不追踪；1秒后在半径0.45内造成200%攻击力的对地物理伤害，无额外回合倍率，不获得仅干员享有的存活攻血加成。援军不占人口或盟约人数，不产亡魂，不触发递归召唤，战末清理。';
  files.bonds[REM_BOND]={...structuredClone(files.bonds.yanShip),bondId:REM_BOND,name:'雷姆必拓',identifier:26,bondOrder:26,isCore:true,bondType:'SEASON',iconId:REM_BOND,activeCount:3,thresholds:[3,6,9],maxCount:null,layerMilestones:[],powerIdList:[],desc,descRaw:desc,effectId:'bondeffect_rem',effectName:'雷姆必拓',effectDesc:desc,effectDescRaw:desc,effectDescParams:[],bb:{},bbStr:{key:'rem_layers'},buffs:[],baseParams:{},perStackParams:{},spec:{}};
  files.effects.bondeffect_rem={effectId:'bondeffect_rem',effectType:'BOND',name:'雷姆必拓',desc,descRaw:desc,counterType:'NONE',continuedRound:-1,decoIconId:null,enemyPrice:0,buffs:[],params:{}};
  for(const b of Object.values(files.bonds)){b.members=Object.values(files.chess).filter(c=>!c.isGolden&&c.bonds.includes(b.bondId)).map(c=>c.chessId);b.visibleMembers=b.members.filter(id=>files.chess[id].visible);}
  for(const g of Object.values(files.garrisons))g.owners=Object.values(files.chess).filter(c=>c.garrisonIds.includes(g.garrisonId)).map(c=>c.chessId);
  for(const m of Object.values(files.config.modes)){if(!m.activeBondIds.includes(REM_BOND))m.activeBondIds.push(REM_BOND);m.inactiveBondIds=m.inactiveBondIds.filter(id=>id!==REM_BOND);}
  return files;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const out=resolve(process.argv[3]||'data'),names=['chess','bonds','garrisons','tokens','effects','config','items','backups'];
  const files=Object.fromEntries(await Promise.all(names.map(async n=>[n,JSON.parse(await readFile(join(out,`${n}.json`),'utf8'))])));
  await applyRemData(files);
  for(const n of names)await writeFile(join(out,`${n}.json`),JSON.stringify(files[n]));
}
