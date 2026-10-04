// Rhine Lab fan expansion. Keep balance values here for both browser and server.
export const RHINE_BOND = 'rhineShip';
export const RHINE_CHARACTERS = Object.freeze({ mayer: 'char_242_otter', silence: 'char_108_silent', ptilopsis: 'char_128_plosis', saria: 'char_202_demkni', ifrit: 'char_134_ifrit', muelsyse: 'char_249_mlyss', halo2: 'char_1047_halo2' });
export const RHINE_BALANCE = Object.freeze({
  thresholds: [3, 6, 9], baseAttack: 300, attackPerLayer: 3,
  mayerLayerStep: 5, mayerAttack: [2, 4], mayerSummons: [1, 2], ptilopsisLayersPerMember: [2, 4],
  sariaLayerStep: 3, sariaHealBonus: [0.01, 0.02], ifritInheritance: [0.30, 0.60],
  successPoints: 2, failurePoints: 1, breakthroughPoints: [5, 5],
  medicalInterval: 3, medicalHealScale: 0.5, medicalShieldRatio: 0.5, medicalShieldDuration: 6,
  energyCharges: 3, energyContributorCooldown: 3, energyPulseScale: 1.2, energySpreadRadius: 1, energyStage2Scale: 1.5,
  ecologyInterval: 8, ecologyDuration: 4, ecologySlow: 0.25, ecologySlowPerLayer: 0.001,
  ecologySlowCap: 0.65, ecologyBindDuration: 1, radius: 2,
});
// Equipment values are shared by generated records and the combat/bot implementations.
export const RHINE_EQUIPMENT = Object.freeze({
  terminal: Object.freeze({ key: 'chess_item_rhine_terminal', tier: 3, attack: [0.15, 0.25], layerStep: 10, attackSpeed: [2, 3], attackSpeedCap: [20, 30] }),
  mainframe: Object.freeze({ key: 'chess_item_rhine_mainframe', tier: 6, hp: [0.45, 0.70], attackPerLayer: 1, attackCap: 100, comboAttackPerLayer: 2, comboAttackCap: 200 }),
});
export const RHINE_DEVICES = Object.freeze([
  { key: 'medical', tokenId: 'token_rhine_medical', name: '生命维持仪', color: '#6fe8c1', icon: '/art/rhine/medical.svg', sprite: '/art/rhine/medical-unit.png', description: '每3秒治疗范围内生命比例最低的友军。突破Ⅰ：溢出治疗转为短时护盾；突破Ⅱ：同时治疗两个目标。', breakthroughs: ['溢出治疗转为护盾', '同时治疗两个目标'] },
  { key: 'energy', tokenId: 'token_rhine_energy', name: '能量谐振仪', color: '#ffbc70', icon: '/art/rhine/energy.svg', sprite: '/art/rhine/energy-unit.png', description: '范围内友军释放技能时充能，3次充能释放法术脉冲；同一干员3秒内至多贡献一次。突破Ⅰ：脉冲向附近扩散；突破Ⅱ：伤害提高。', breakthroughs: ['脉冲向附近扩散', '脉冲伤害提高'] },
  { key: 'ecology', tokenId: 'token_rhine_ecology', name: '生态调控器', color: '#8bbdff', icon: '/art/rhine/ecology.svg', sprite: '/art/rhine/ecology-unit.png', description: '周期产生减速区域，减速随莱茵层数增强。突破Ⅰ：区域启动时短暂束缚；突破Ⅱ：作用范围扩大。', breakthroughs: ['区域启动时束缚敌人', '作用范围扩大'] },
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
export function rhineAttack(layers = 0, mayerElite = null) {
  const n = Math.max(0, Number(layers) || 0);
  return RHINE_BALANCE.baseAttack + n * RHINE_BALANCE.attackPerLayer + (mayerElite == null ? 0 : Math.floor(n / RHINE_BALANCE.mayerLayerStep) * RHINE_BALANCE.mayerAttack[mayerElite ? 1 : 0]);
}
