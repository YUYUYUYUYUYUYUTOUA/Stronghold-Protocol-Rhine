// 暴行 — official blackboards; https://prts.wiki/w/暴行 (山谷 checks four orthogonal high tiles).
import { num, talentBb, skillBbOf, skillRec, enemiesInGrid, toggleBuff, traitBb } from '../shared/tier1.js';
export default {
  chess_rem_savage_a: (bb, chess) => {
    const b1 = skillBbOf(chess, 'skchr_savage_1'), b2 = skillBbOf(chess, 'skchr_savage_2'), t = talentBb(chess, 0);
    return {
      trait: { dmgMul: (battle, unit, target) => target.blockedBy ? num(traitBb(chess).atk_scale, 1) : 1 },
      skills: {
        skchr_savage_1: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1) } },
        skchr_savage_2: { kind: 'instant', targeting: { rangeGrid: skillRec(chess, 'skchr_savage_2')?.rangeGrid },
          onStart({ battle, unit }) {
            const grid = skillRec(chess, 'skchr_savage_2')?.rangeGrid;
            for (const e of enemiesInGrid(battle, unit, grid, { n: num(b2.max_target), canHitFly: false })) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'savage'] });
            }
          } },
      },
      talents: [{ install(battle, unit) {
        toggleBuff(battle, unit, 'savage:valley', () => [[0, 1], [1, 0], [0, -1], [-1, 0]].filter(([r, c]) =>
          battle.grid.inRect(unit.tileR + r, unit.tileC + c) && battle.grid.tile(unit.tileR + r, unit.tileC + c).height === 'HIGH').length >= num(t.cnt, 2),
        { atkPct: num(t.atk), defPct: num(t.def) });
      } }],
    };
  },
};
