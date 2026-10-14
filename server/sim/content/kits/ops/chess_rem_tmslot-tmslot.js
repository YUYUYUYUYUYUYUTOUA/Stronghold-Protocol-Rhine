// 时隙 — https://prts.wiki/w/时隙 and official character/skill tables.
// Independent drone locks/ramping; S2 retains locks outside range and jumps to its second half on escape.
// Released drones deal direct skill damage and ignore disarm (PRTS branch notes).
// [ASSUMED] Like the existing 澄闪 implementation, released drones also continue through stun/freeze.
import { num, talentBb, skillBbOf, statBuff, up, enemiesInGrid } from '../shared/tier1.js';
import { bodyInKeys } from '../../../body.js';
import { canTargetEnemy } from '../../../targeting.js';
const S2 = 'skchr_tmslot_2';
export default {
  chess_rem_tmslot_a: (bb, chess) => {
    const s1 = skillBbOf(chess, 'skcom_atk_up[3]'), s2 = skillBbOf(chess, S2), t = talentBb(chess, 0);
    const reset = (unit) => { unit.mem.tmslotDrones = []; unit.mem.remMarkedTarget = null; unit.mem.tmslotOver = false; };
    const fire = (battle, unit, d, skill) => {
      const f = unit.profile.funnel ?? { init: 0.2, delta: 0.15, max: 1.1 };
      d.scale = d.scale ? Math.min(f.max, d.scale + f.delta) : f.init;
      const target = d.target, amount = unit.s.atk * unit.s.atkScaleMul * d.scale;
      if (battle.rng.chance(num(t.prob))) battle.applyStatus(target, 'sluggish', { duration: num(t.sluggish), source: unit });
      battle.addProjectile({ from: unit, target, source: unit, speed: 8, visual: 'drone',
        onHit({ target: hit }) { if (hit?.alive) battle.dealDamage(unit, hit, { amount, type: 'arts', isAttack: false,
          isSkill: skill, tags: ['tmslot:drone', skill ? 'skill' : 'addition'] }); } });
      d.cd = unit.s.interval;
    };
    return {
      trait: { dmgMul: () => 1, canAttack: (battle, unit) => !unit.mem.tmslotOver },
      skills: {
        'skcom_atk_up[3]': { kind: 'duration', mods: { atkPct: num(s1.atk) } },
        [S2]: { kind: 'duration', onStart({ unit }) { reset(unit); },
          onTick({ battle, unit, skill }) {
            const escaped = (unit.mem.tmslotDrones ?? []).some((d) => d.target?.alive && !bodyInKeys(d.target, unit.rangeKeySet));
            if (escaped && skill.timeLeft > skill.duration / 2) skill.timeLeft = skill.duration / 2;
            if (!unit.mem.tmslotOver && skill.timeLeft <= skill.duration / 2 + 1e-9) {
              unit.mem.tmslotOver = true;
              battle.addBuff(unit, { key: 'tmslot:overload', mods: { atkPct: num(s2.atk), aspd: num(s2.attack_speed) } });
            }
          },
          onEnd({ battle, unit }) { reset(unit); battle.removeBuff(unit, 'tmslot:overload'); },
        },
      },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'tmslot:review', { atkPct: num(t.atk) });
        battle.on('deploy', ({ unit: a }) => { if (a === unit) reset(unit); }, { owner: unit });
        // An unreleased drone is an additional hit of the caster's actual attack, never a second free attack timer.
        battle.on('attack', ({ attacker, targets }) => {
          if (attacker !== unit || (unit.skill?.active && unit.skill.id === S2) || !targets[0]?.alive) return;
          const target = targets[0], ds = unit.mem.tmslotDrones ?? (unit.mem.tmslotDrones = []);
          const d = ds[0] ?? (ds[0] = { target: null, scale: 0, cd: 0 });
          if (d.target !== target) { d.target = target; d.scale = 0; }
          fire(battle, unit, d, false); unit.mem.remMarkedTarget = target;
        }, { owner: unit });
        battle.on('tick', ({ dt }) => {
          if (!up(unit)) { unit.mem.remMarkedTarget = null; return; }
          const skill = unit.skill?.active && unit.skill.id === S2;
          if (!skill) {
            if (!unit.mem.remMarkedTarget?.alive || !bodyInKeys(unit.mem.remMarkedTarget, unit.rangeKeySet)) unit.mem.remMarkedTarget = null;
            return;
          }
          const count = 1 + (skill ? num(s2['attack@cnt']) : 0), ds = unit.mem.tmslotDrones ?? (unit.mem.tmslotDrones = []);
          ds.length = Math.min(ds.length, count);
          const candidates = enemiesInGrid(battle, unit, null);
          for (let i = 0; i < count; i++) {
            const d = ds[i] ?? (ds[i] = { target: null, cd: 0, scale: 0 });
            if (!d.target?.alive || !canTargetEnemy(unit, d.target, unit.profile) || (!skill && !bodyInKeys(d.target, unit.rangeKeySet))) {
              d.target = candidates[i % Math.max(1, candidates.length)] ?? null; d.scale = 0;
            }
            d.cd = Math.max(0, d.cd - dt);
            if (!d.target || d.cd > 1e-9) continue;
            fire(battle, unit, d, true);
          }
          unit.mem.remMarkedTarget = ds.find((d) => d.target?.alive)?.target ?? null;
        }, { owner: unit });
      } }],
    };
  },
};
