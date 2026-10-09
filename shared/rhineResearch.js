import { N_ } from './i18n.js';
// Rhine Lab fan expansion. Keep balance values here for both browser and server.
export const RHINE_BOND = 'rhineShip';
export const RHINE_CHARACTERS = Object.freeze({ mayer: 'char_242_otter', silence: 'char_108_silent', ptilopsis: 'char_128_plosis', saria: 'char_202_demkni', ifrit: 'char_134_ifrit', muelsyse: 'char_249_mlyss', halo2: 'char_1047_halo2', astgenne: 'char_135_halo', dorothy: 'char_4048_doroth' });
export const RHINE_BALANCE = Object.freeze({
  thresholds: [3, 6, 9], baseAttack: 300, attackPerLayer: 4,
  mayerDeviceLayers: [1, 2], mayerSummons: [1, 2], ptilopsisLayersPerMember: [2, 4],
  sariaLayerStep: 3, sariaHealBonus: [0.01, 0.02], ifritInheritance: [1, 1.5],
  sharingCount: 6, researchSharing: [0.15, 0.25],
  astgenneFirstSkillLayers: [3, 6], dorothyTrapLayers: [2, 4], dorothyBattleLayerCap: [24, 48], dorothyTrapLimit: [4, 5],
  successPoints: 2, failurePoints: 1, breakthroughPoints: [5, 5],
  medicalInterval: 3, medicalHealScale: Object.freeze([0.75, 0.75, 1]), medicalTargetCount: Object.freeze([1, 2, 3]),
  medicalShieldHealRatio: 0.25, medicalShieldRatio: 0.5, medicalShieldCap: 0.4, medicalShieldDuration: 6,
  energyCharges: 3, energyContributorCooldown: 3, energyPulseScale: Object.freeze([1.8, 2.4, 3]), energyPulseInterval: 1.5, energySpreadRadius: 1,
  ecologyInterval: 8, ecologyDuration: 8, ecologySlow: 0.5, ecologyResearchInterval: 3,
  ecologyBindDuration: 1, radius: 2,
  laserMinCount: 9, laserTick: 0.25, laserBaseScale: 1.5, laserRampPerSecond: 0.05,
  laserRampSeconds: 20, laserTrueHpRatio: 0.005, laserTrueInterval: 1, laserResearchInterval: 3,
});
// Equipment values are shared by generated records and the combat/bot implementations.
export const RHINE_EQUIPMENT = Object.freeze({
  terminal: Object.freeze({ key: 'chess_item_rhine_terminal', tier: 3, attack: [0.15, 0.25], layerStep: 10, attackSpeed: [2, 3], attackSpeedCap: [20, 30] }),
  mainframe: Object.freeze({ key: 'chess_item_rhine_mainframe', tier: 6, hp: [0.45, 0.70], attackPerLayer: 1, comboAttackPerLayer: 2 }),
});
export const RHINE_DEVICES = Object.freeze([
  { key: 'medical', tokenId: 'token_rhine_medical', minCount: 3, maxStage: 2, name: N_('生态维持仪'), color: '#6fe8c1', icon: '/art/rhine/medical.svg', sprite: '/art/rhine/medical-unit.png', description: N_('一级：半径2格内敌人持续减速50%；每3秒治疗生命比例最低的1名友军，治疗量为基础攻击的75%。二级：每次治疗2人，范围内己方干员接受任意来源治疗时，获得最终治疗量25%与溢出治疗量50%的护盾，持续6秒；同一装置护盾累计不超过目标生命上限40%。三级：半径扩大至3格，每次治疗3人，各恢复100%基础攻击的生命；每8秒束缚范围内敌人1秒。自然生命回复不触发护盾。'), breakthroughs: [N_('双目标治疗与全来源治疗护盾'), N_('三目标治疗、扩大范围与周期束缚')] },
  { key: 'energy', tokenId: 'token_rhine_energy', minCount: 3, maxStage: 2, name: N_('能量谐振仪'), color: '#ffbc70', icon: '/art/rhine/energy.svg', sprite: '/art/rhine/energy-unit.png', description: N_('一级：半径2格内己方干员释放技能时充能，3点充能对装置范围内所有敌人造成180%基础攻击的法术脉冲。二级：己方全场干员释放技能均可充能，选敌半径扩大至3格，脉冲造成240%基础攻击的范围法术伤害，溅射半径1格。三级：伤害提高至300%，溅射扩大至塞雷娅“钙质化”的25格范围，以主目标为中心。同一干员3秒内至多贡献一次；脉冲发射间隔至少1.5秒，无目标时保留满充能。'), breakthroughs: [N_('全场技能充能、扩大选敌范围与240%伤害'), N_('300%伤害与钙质化25格溅射')] },
  { key: 'laser', tokenId: 'token_rhine_laser', minCount: 9, maxStage: 0, name: N_('激光钻机'), color: '#e6a4ff', icon: '/art/rhine/laser.svg', sprite: '/art/rhine/laser.svg', description: N_('仅9莱茵生命时可部署，只有一级，无阶段突破。全场选择面板最大生命值最高的敌人，锁定后仅在目标死亡或永久离场时转移火力；暂时无法攻击时暂停输出。基础每秒法术伤害为装置基础攻击的150%，持续输出每秒增加初始伤害的5%，20秒后达到300%；换目标时清空增伤。满20秒后，每秒额外造成目标最大生命值0.5%的真实伤害，领袖直接按完整共享最大生命值计算。'), breakthroughs: [] },
]);
export const rhineDevice = (id) => RHINE_DEVICES.find(d => d.key === id || d.tokenId === id) ?? null;
export const isRhineDevice = (id) => rhineDevice(id) !== null;
/** Device gates and stage limits are shared by preparation, frozen sim input and the browser. */
export function rhineDeviceUnlocked(deviceOrId, bond) {
  const device = typeof deviceOrId === 'object' ? deviceOrId : rhineDevice(deviceOrId);
  return !!device && !!bond?.active && Number(bond.count) >= device.minCount;
}
export function rhineDeviceStage(deviceOrId, stage = 0) {
  const device = typeof deviceOrId === 'object' ? deviceOrId : rhineDevice(deviceOrId);
  return device ? Math.min(device.maxStage, rhineStage(stage)) : 0;
}
export function rhineCapacity(bond) {
  return bond?.active ? RHINE_BALANCE.thresholds.filter(n => bond.count >= n).length : 0;
}
const nonnegativeInteger = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
/** Normalize an explicit stage. A stage can no longer be inferred from points, which reset on every breakthrough. */
export function rhineStage(stage = 0) { return Math.min(RHINE_BALANCE.breakthroughPoints.length, nonnegativeInteger(stage)); }
/** Advance one battle's research. Each stage needs its own points; a breakthrough discards all overflow. */
export function advanceRhineResearch({ stage = 0, points = 0 } = {}, gain = 0) {
  const currentStage = rhineStage(stage);
  const goal = RHINE_BALANCE.breakthroughPoints[currentStage];
  if (goal == null) return { stage: currentStage, points: 0 };
  const nextPoints = nonnegativeInteger(points) + nonnegativeInteger(gain);
  return nextPoints >= goal ? { stage: currentStage + 1, points: 0 } : { stage: currentStage, points: nextPoints };
}
export function rhineAttack(layers = 0) {
  const n = Math.max(0, Number(layers) || 0);
  return RHINE_BALANCE.baseAttack + n * RHINE_BALANCE.attackPerLayer;
}
