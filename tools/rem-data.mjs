// Deterministic offline Rim Billiton roster; native records come from the pinned source subset.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileChess } from './rhine-data.mjs';
import { compileBackupPreset } from './preset-data.mjs';
import { applyPotentialOverlay } from './extension-potential.mjs';
export const REM_BOND = 'remShip';
export const REM_ADDITIONS = [
  ['jcinta','char_4237_jcinta',1,'deputShip','执旗手','REM_JACINTA'],
  ['glider','char_449_glider',1,'deputShip','行医','REM_MULBERRY'],
  ['aprl','char_365_aprl',2,null,'速射手',null],
  ['warmy','char_4081_warmy',2,'visiShip','本源术师','REM_WARMY'],
  ['tmslot','char_4236_tmslot',3,'skillfulShip','驭械术师','REM_CLICK'],
  ['savage','char_230_savage',4,'steadShip','强攻手','REM_SAVAGE'],
  ['asbest','char_378_asbest',5,null,'驭法铁卫','REM_ASBESTOS'],
  ['thumpy','char_4235_thumpy',5,'steadShip','本源铁卫','REM_SANDRECKONER'],
  ['ray','char_4117_ray',6,'preciShip','猎手','REM_RAY'],
].map(([key,charId,tier,sub,subName,effectKey]) => ({ key,charId,tier,subName,effectKey,prefix:'rem',bonds:[REM_BOND,...(sub?[sub]:[])],skillId:`skchr_${key}_2`,defaultModuleId:null,...(key==='aprl'?{price:1}:{}) }));
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
export async function applyRemData(files,source=null) {
  const ctx=source||JSON.parse(await readFile(new URL('./rem-data-source.json',import.meta.url),'utf8'));
  if(!Number.isInteger(ctx.potRank)) return applyPotentialOverlay(files,applyRemData,ctx);
  for(const [index,spec] of REM_ADDITIONS.entries()) for(const gold of [false,true]) {
    const g=trait(spec,gold); files.garrisons[g.garrisonId]=g;
    const c=['thumpy','ray'].includes(spec.key)?compileBackupPreset(files,spec,gold,index,g,ctx.potRank):compileChess(ctx,files.config,{...spec,garrison:g},gold,index+20);
    c.extension.id='rem-reinforcements';
    if(spec.price!=null)c.price=spec.price;
    files.chess[c.chessId]=c;
  }
  // Reinforcements use the simulation's layer-scaled inline definitions; art is planned by rem-plan.mjs.
  for (const key of ['child','miner','combined','chef','enthusiast','food','bus','boss']) delete files.tokens[`token_rem_${key}`];
  for(const id of ['chess_char_3_02_a','chess_char_3_02_b','chess_char_4_14_a','chess_char_4_14_b']) {
    const c=files.chess[id]; if(!c.bonds.includes(REM_BOND))c.bonds.push(REM_BOND);
  }
  const desc='战斗开始时按3/6/9名不同雷姆必拓干员锁定档位。常规援军上限6/12/16；开场2/2/3名，之后每10/8/6秒补充1/2/3名，满额不积欠。从己方蓝门向准备阶段设置的集合点行军，途中接敌，不主动追击；普通援军抵达后在集合点周围8格可通行地块持续徘徊，接敌停下作战，脱战后继续，车辆与老板保持原路线。6/9档每实际成功生成一个己方援军，使己方【雷姆必拓】干员本场攻击力和生命值增加4%/8%，每回合最多200%/300%；死亡不扣除已出现数。每次常驻召唤先独立判定2%组合矿工，再抽当前档位池；厨师最多1/2/3名，同名光环不叠加。6档起每20秒一辆美食的诱惑（首次10秒），一次经过对每名敌人造成一次1500+5S物理伤害；9档每25秒校车投放最多5名常驻援军，开场1名好心肠老板、之后每30秒补充至最多2名，沿路线往返每秒投弹。援军不占人口或盟约人数，不产亡魂，不触发递归召唤，战末清理。';
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
