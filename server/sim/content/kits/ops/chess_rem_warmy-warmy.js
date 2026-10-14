// 温米 — official blackboards; https://prts.wiki/w/温米. Element gauge damage and elemental HP damage stay distinct.
import { num, skillBbOf, talentBb, up, batMod, traitBb } from '../shared/tier1.js';
import { burstDamageUp } from '../shared/tier5.js';
import { bodyInKeys } from '../../../body.js';
const S1 = 'skchr_warmy_1', S2 = 'skchr_warmy_2';
export default {
  chess_rem_warmy_a: (bb, chess) => {
    const a = skillBbOf(chess, S1), c = skillBbOf(chess, S2), t = talentBb(chess, 0);
    return {
      skills: {
        [S1]: { kind: 'duration', mods: { aspd: num(a.attack_speed) },
          attack: { onHit({ battle, unit, target, dealt }) {
            if (target?.alive && dealt > 0) battle.dealDamage(unit, target, { type: 'element', element: 'burn', amount: dealt * num(a['attack@ep_damage_ratio']), tags: ['warmy:burn'] });
          } } },
        [S2]: { kind: 'duration', charges: 2, mods: { atkPct: num(c.atk), batPct: batMod(c.base_attack_time, chess) },
          targeting: { maxTargets: 2 },
          onStart({ unit, skill }) {
            unit.mem.warmyCharged = skill.charges >= 1;
            skill.charges = 0; skill.sp = 0; // 蓄力 consumes all SP even below the second full charge.
            if (unit.mem.warmyCharged) skill.timeLeft = num(c.enhanced_duration);
          }, onEnd({ unit }) { unit.mem.warmyCharged = false; },
          attack: { onHit({ battle, unit, target }) {
            if (unit.mem.warmyCharged && target?.alive && target.findBuff('burnBurst')) battle.dealDamage(unit, target, {
              type: 'elemental', element: 'burn', amount: unit.s.atk * num(c['attack@ep_damage_scale']), isSkill: true, tags: ['warmy:charged'] });
          } },
        },
      },
      talents: [{ install(battle, unit) {
        burstDamageUp(battle, unit, num(traitBb(chess).damage_scale, 1));
        battle.on('elementBurst', ({ target, element }) => {
          if (element === 'burn' && up(unit) && target.side === 'enemy' && bodyInKeys(target, unit.rangeKeySet)) battle.dealDamage(unit, target, {
            type: 'elemental', element: 'burn', amount: unit.s.atk * num(t.ep_damage_scale), tags: ['warmy:overflow'] });
        }, { owner: unit });
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active || unit.skill.id !== S2 || !unit.mem.warmyCharged) return;
          const candidates = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
          ctx.targets = [...ctx.targets, ...candidates.filter((e) => !ctx.targets.includes(e))].slice(0, 3);
        }, { owner: unit });
      } }],
    };
  },
};
