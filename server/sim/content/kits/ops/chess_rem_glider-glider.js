// 蜜莓 — https://prts.wiki/w/蜜莓; official skill/talent blackboards, elemental load priority and delayed recovery.
import { num, talentBb, skillBbOf, installAura, up } from '../shared/tier1.js';
import { nativeOperator } from '../shared/nativeIdentity.js';
const load = (u) => Math.max(u.elem.burn, u.elem.neural, u.elem.necrosis, u.elem.apoptosis, u.elem.erosion ?? 0);
const S1 = 'skchr_glider_1', S2 = 'skchr_glider_2';
export default {
  chess_rem_glider_a: (bb, chess) => {
    const b1 = skillBbOf(chess, S1), b2 = skillBbOf(chess, S2), t = talentBb(chess, 0);
    return {
      skills: {
        [S1]: { kind: 'instant', heal: true, attack: { maxTargets: 2 },
          onHit({ battle, unit, target }) {
            if (!target) return;
            const amount = unit.s.atk * num(b1['glider_s_1.ep_heal_ratio']);
            const duration = num(b1['glider_s_1.duration']), interval = num(b1['glider_s_1.interval'], 1);
            battle.addBuff(target, { key: `glider:recovery:${unit.id}`, source: unit, duration: duration + 1e-6,
              interval, onTick() { battle.reduceElement(target, amount); } });
          } },
        [S2]: { kind: 'duration', heal: true, mods: { atkPct: num(b2.atk) }, targeting: { maxTargets: num(b2['attack@max_target'], 3) } },
      },
      talents: [{ install(battle, unit) {
        installAura(battle, unit, { key: 'glider:collective', value: num(t.max_hp), mods: { hpPct: num(t.max_hp) },
          select: (a) => nativeOperator(a) && ['RANGED', 'ALL'].includes(a.def.position) && unit.rangeKeySet.has(a.tileR * 21 + a.tileC) });
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !up(unit) || !ctx.isSkill) return;
          const n = unit.skill.id === S1 ? 2 : num(b2['attack@max_target'], 3);
          ctx.targets = battle.injuredAlliesInKeys(unit.rangeKeys, unit, true)
            .sort((a, c) => load(c) - load(a) || a.hpRatio - c.hpRatio || a.deploySeq - c.deploySeq).slice(0, n);
        }, { owner: unit });
      } }],
    };
  },
};
