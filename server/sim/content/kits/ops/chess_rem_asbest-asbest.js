// 石棉 — official blackboards; https://prts.wiki/w/石棉. PRTS S2: BAT +40%, projectile splash radius 1, hits air.
import { num, talentBb, skillBbOf, skillRec, statBuff, giveSp, traitBb } from '../shared/tier1.js';
export default {
  chess_rem_asbest_a: (bb, chess) => {
    const b1 = skillBbOf(chess, 'skchr_asbest_1'), b2 = skillBbOf(chess, 'skchr_asbest_2'), t = talentBb(chess, 0);
    return {
      skills: {
        skchr_asbest_1: { kind: 'duration', attack: { dmgType: 'arts' }, mods: { artsTakenMul: num(b1.damage_scale, 1) },
          onStart({ unit }) { unit.mem.asbestShield = true; }, onEnd({ unit }) { unit.mem.asbestShield = false; } },
        skchr_asbest_2: { kind: 'duration', mods: { atkPct: num(b2.atk), defPct: num(b2.def), batPct: num(b2.base_attack_time) },
          targeting: { rangeGrid: skillRec(chess, 'skchr_asbest_2')?.rangeGrid }, attack: { dmgType: 'arts', attack: 'ranged', projectile: 'bomb', canHitFly: true, splashRadius: 1.0 } },
      },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'asbest:skin', { resFlat: num(t.magic_resistance) });
        const bonus = num(traitBb(chess).atk_scale);
        if (bonus > 0) battle.on('damaged', (ctx) => {
          if (!unit.alive || !unit.skill?.active || !ctx.dmg?.isAttack || ctx.dmg.tags?.includes('asbest:module')) return;
          const target = ctx.source === unit ? ctx.target : ctx.target === unit ? ctx.source : null;
          if (target?.alive && target.side === 'enemy') battle.dealDamage(unit, target, {
            type: 'arts', amount: unit.s.atk * bonus, tags: ['asbest:module'] });
        }, { owner: unit });
        battle.on('hit', (ctx) => {
          if (ctx.target !== unit || ctx.dmg.type !== 'arts') return;
          if (ctx.source?.side === 'enemy' && !ctx.dmg.isSplash) giveSp(unit, num(t.sp));
          if (unit.mem.asbestShield) { unit.mem.asbestShield = false; ctx.dmg.mul = 0; }
        }, { owner: unit });
      } }],
    };
  },
};
