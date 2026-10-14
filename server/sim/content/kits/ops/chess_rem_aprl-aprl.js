// 四月 — official character/skill blackboards; https://prts.wiki/w/四月.
import { num, talentBb, skillBbOf, skillRec, moduleBb, toggleBuff } from '../shared/tier1.js';
export default {
  chess_rem_aprl_a: (bb, chess) => {
    const b1 = skillBbOf(chess, 'skchr_aprl_1'), b2 = skillBbOf(chess, 'skchr_aprl_2');
    return {
      skills: {
        skchr_aprl_1: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1) } },
        skchr_aprl_2: { kind: 'duration', activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER',
          duration: num(skillRec(chess, 'skchr_aprl_2')?.duration), mods: { atkPct: num(b2.atk) }, flags: { camou: true } },
      },
      talents: [{ install(battle, unit) {
        const t = talentBb(chess, 0);
        const aspd = num(moduleBb(chess).attack_speed);
        if (aspd) toggleBuff(battle, unit, 'aprl:module', () => battle.enemiesInKeys(unit.rangeKeys, unit, { groundOnly: true }).length > 0, { aspd });
        unit.base.cost = Math.max(0, unit.base.cost + num(t.cost));
        unit.base.respawnTime = Math.max(0, unit.base.respawnTime + num(t.respawn_time));
      } }],
    };
  },
};
