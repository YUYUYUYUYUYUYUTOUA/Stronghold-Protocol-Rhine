// 嘉辛塔 — https://prts.wiki/w/嘉辛塔: S2 is a fixed-one-second healing attack, affected by disarm.
import { num, talentBb, skillBbOf, skillRec, alliesInGridOf, up, traitBb } from '../shared/tier1.js';
import { nativeOperator } from '../shared/nativeIdentity.js';
import { performAttack } from '../../../ai.js';
const S1 = 'skcom_assist_cost[3]', S2 = 'skchr_jcinta_2';
export default {
  chess_rem_jcinta_a: (bb, chess) => {
    const t = talentBb(chess, 0), b2 = skillBbOf(chess, S2), grid = skillRec(chess, S2)?.rangeGrid;
    const inAura = (battle, unit, a) => unit.skill?.active && unit.skill.id === S2
      ? alliesInGridOf(battle, unit, grid).includes(a)
      : Math.abs(a.tileR - unit.tileR) <= 1 && Math.abs(a.tileC - unit.tileC) <= 1;
    const spec = (b, healing) => ({
      kind: 'duration', attack: { noAttack: true },
      onStart({ unit }) { unit.mem.jcintaDp = { t: 0, given: 0 }; unit.mem.jcintaHealCd = 0; },
      onTick({ battle, unit, dt }) {
        const d = unit.mem.jcintaDp; d.t += dt;
        const due = Math.min(num(b.value), Math.floor((d.t + 1e-9) / num(b.interval, 1)) * num(b.cost, 1));
        if (due > d.given) { battle.addDp(unit.ownerId, due - d.given); d.given = due; }
        if (!healing || !unit.canAct) return;
        unit.mem.jcintaHealCd = Math.max(0, unit.mem.jcintaHealCd - dt);
        if (unit.s.flags.disarm || unit.mem.jcintaHealCd > 1e-9) return;
        const targets = alliesInGridOf(battle, unit, grid).filter((a) => a.hp < a.s.maxHp && !a.s.flags.noHeal)
          .sort((a, c) => a.hpRatio - c.hpRatio || a.deploySeq - c.deploySeq).slice(0, num(b['attack@heal_max_target'], 1));
        if (!targets.length) return;
        performAttack(battle, unit, { ...unit.profile, noAttack: false, dmgType: 'heal', heal: {}, atkScale: num(b['attack@heal_scale']), isSkill: true }, targets);
        unit.mem.jcintaHealCd = 1;
      },
      onEnd({ battle, unit, reason }) {
        if (reason === 'duration') battle.addDp(unit.ownerId, Math.max(0, num(b.value) - (unit.mem.jcintaDp?.given ?? 0)));
        unit.mem.jcintaDp = null;
      },
    });
    return {
      skills: { [S1]: spec(skillBbOf(chess, S1), false), [S2]: spec(b2, true) },
      talents: [{ install(battle, unit) {
        const frontBlock = num(traitBb(chess).block_cnt), given = new Set();
        if (frontBlock > 0) {
          const key = `jcinta:front:${unit.id}`;
          battle.on('tick', () => {
            if (!up(unit) || !unit.skill?.active) return;
            const a = battle.unitAt(unit.tileR + unit.fwd[0], unit.tileC + unit.fwd[1]);
            if (nativeOperator(a) && !a.s.flags.stun && !a.s.flags.freeze && !a.s.flags.sleep) {
              if (!a.findBuff(key)) battle.addBuff(a, { key, mods: { blockCnt: frontBlock }, source: unit });
              given.add(a);
            }
          }, { owner: unit });
          battle.on('skillEnd', ({ unit: a }) => { if (a === unit) { for (const target of given) battle.removeBuff(target, key); given.clear(); } }, { owner: unit });
        }
        battle.on('hit', (ctx) => {
          const a = ctx.target, d = ctx.dmg;
          if (!up(unit) || !a?.alive || a.side !== 'ally' || !ctx.source?.isFlying || !['phys', 'arts'].includes(d.type) || !inAura(battle, unit, a)) return;
          const value = num(t.damage_resistance) * (unit.skill?.active && unit.skill.id === S2 ? num(b2.talent_scale, 1) : 1);
          const prev = d.jcintaAirProtect ?? 0;
          if (value > prev) { d.mul *= (1 - value) / (1 - prev); d.jcintaAirProtect = value; }
        }, { owner: unit });
      } }],
    };
  },
};
