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
  medicalInterval: 3, medicalHealScale: 0.5, medicalShieldRatio: 0.5, medicalShieldDuration: 6,
  energyCharges: 3, energyContributorCooldown: 3, energyPulseScale: 1.2, energySpreadRadius: 1,
  ecologyInterval: 8, ecologyDuration: 8, ecologySlow: 0.5, ecologyResearchInterval: 3,
  ecologyBindDuration: 1, radius: 2,
});
// Equipment values are shared by generated records and the combat/bot implementations.
export const RHINE_EQUIPMENT = Object.freeze({
  terminal: Object.freeze({ key: 'chess_item_rhine_terminal', tier: 3, attack: [0.15, 0.25], layerStep: 10, attackSpeed: [2, 3], attackSpeedCap: [20, 30] }),
  mainframe: Object.freeze({ key: 'chess_item_rhine_mainframe', tier: 6, hp: [0.45, 0.70], attackPerLayer: 1, comboAttackPerLayer: 2 }),
});
export const RHINE_DEVICES = Object.freeze([
  { key: 'medical', tokenId: 'token_rhine_medical', name: N_('生命维持仪'), color: '#6fe8c1', icon: '/art/rhine/medical.svg', sprite: '/art/rhine/medical-unit.png', description: N_('每3秒治疗范围内生命比例最低的友军。突破Ⅰ：溢出治疗转为短时护盾；突破Ⅱ：同时治疗两个目标。'), breakthroughs: [N_('溢出治疗转为护盾'), N_('同时治疗两个目标')] },
  { key: 'energy', tokenId: 'token_rhine_energy', name: N_('能量谐振仪'), color: '#ffbc70', icon: '/art/rhine/energy.svg', sprite: '/art/rhine/energy-unit.png', description: N_('一级：范围内己方干员释放技能时充能，3点充能发射120%攻击的范围法术脉冲；无目标时保留满充能。同一干员3秒内至多贡献一次。二级：己方全场干员释放技能均可充能。三级：溅射扩大至塞雷娅“钙质化”的25格范围，以主目标为中心。'), breakthroughs: [N_('己方全场技能充能'), N_('钙质化25格溅射')] },
  { key: 'ecology', tokenId: 'token_rhine_ecology', name: N_('生态调控器'), color: '#8bbdff', icon: '/art/rhine/ecology.svg', sprite: '/art/rhine/ecology-unit.png', description: N_('一级：范围内敌人持续减速50%。二级：每8秒额外束缚范围内敌人1秒。三级：作用半径由2格扩大至3格。'), breakthroughs: [N_('周期束缚敌人'), N_('作用范围扩大')] },
]);
export const rhineDevice = (id) => RHINE_DEVICES.find(d => d.key === id || d.tokenId === id) ?? null;
export const isRhineDevice = (id) => rhineDevice(id) !== null;
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
