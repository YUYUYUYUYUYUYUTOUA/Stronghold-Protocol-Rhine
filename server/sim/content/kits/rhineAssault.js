// All selectable Eunectes / Ifrit combat loadouts. Numerical values are taken from the resolved
// SkillRecord / trait / talent blackboards (including the selected module), never the default module.
// Mechanics: https://prts.wiki/w/森蚺 and https://prts.wiki/w/伊芙利特 .
import { num, talentBb, traitBb, moduleBb, skillBbOf, up, toggleBuff, giveSp, batMod } from './shared/tier1.js';
import { bodyInKeys, bodyDist } from '../../body.js';
import { hasHp } from '../../damage.js';
import { canTargetEnemy } from '../../targeting.js';

const E1 = 'skchr_zumama_1', E2 = 'skchr_zumama_2', E3 = 'skchr_zumama_3';
const I1 = 'skchr_ifrit_1', I2 = 'skchr_ifrit_2', I3 = 'skchr_ifrit_3';

export function eunectes(_bb, chess) {
  const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), trait = traitBb(chess);
  const s1 = skillBbOf(chess, E1), s2 = skillBbOf(chess, E2), s3 = skillBbOf(chess, E3);
  // HES-X/Y remove the original trait's lock on ALL SP gains. Their recovery ratio only modifies
  // natural regeneration while not blocking. RA-alpha's mode-specific trait is filtered by data.
  const moduleRecovery = Object.hasOwn(trait, 'sp_recover_ratio');
  const lockBlocked = (b, u) => {
    for (const e of u.blocking) if (hasHp(e)) b.applyStatus(e, 'stun', { duration: b.dt * 2, source: u });
  };
  const skills = {
    [E1]: { kind: 'passive', mods: { atkPct: num(s1.atk), defPct: num(s1.def) } },
    [E2]: {
      kind: 'duration', mods: { atkPct: num(s2.atk), batPct: batMod(s2.base_attack_time, chess) },
      onStart({ battle: b, unit: u }) { lockBlocked(b, u); },
      onTick({ battle: b, unit: u }) { lockBlocked(b, u); },
    },
    [E3]: {
      kind: 'duration', mods: { atkPct: num(s3.atk), defPct: num(s3.def), blockCnt: num(s3.block_cnt),
        hpRegenRatio: num(s3.hp_recovery_per_sec_by_max_hp_ratio) },
      onEnd({ battle: b, unit: u, reason }) {
        if (reason !== 'death' && up(u)) b.applyStatus(u, 'stun', { duration: num(s3.stun), source: u });
      },
    },
  };
  return {
    skills, skill: skills[chess.skill?.skillId] ?? skills[E3],
    trait: { dmgMul: (b, u) => u.hpRatio > num(t0.hp_ratio, 0.5) ? num(t0.atk_scale, 1) : 1 },
    talents: [{ install(b, u) {
      toggleBuff(b, u, 'eunectes:shelter', () => u.hpRatio <= num(t0.hp_ratio, 0.5), {
        physTakenMul: 1 - num(t0.damage_resistance), artsTakenMul: 1 - num(t0.damage_resistance),
      });
      toggleBuff(b, u, 'eunectes:block', () => u.blocking.length > 0, {
        spRecoveryFlat: num(t1.sp_recovery_per_sec), atkPct: num(trait.atk), defPct: num(trait.def),
      });
      b.on('spGain', c => {
        if (c.unit !== u || c.reason === 'init' || u.blocking.length) return;
        if (!moduleRecovery) c.amount = 0;
        else if (c.reason === 'time') c.amount *= Math.max(0, 1 + num(trait.sp_recover_ratio));
      }, { owner: u });
      // Newly blocked enemies are stunned immediately, without waiting for the next skill tick.
      b.on('blocked', c => {
        if (c.blocker === u && u.skill?.id === E2 && u.skill.active) lockBlocked(b, u);
      }, { owner: u });
    } }],
  };
}

export function ifrit(_bb, chess) {
  const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), trait = traitBb(chess), mod = moduleBb(chess);
  const s1 = skillBbOf(chess, I1), s2 = skillBbOf(chess, I2), s3 = skillBbOf(chess, I3);
  const skills = {
    [I1]: { kind: 'duration', mods: { atkPct: num(s1.atk), aspd: num(s1.attack_speed) } },
    [I2]: {
      kind: 'charges', attack: { atkScale: num(s2.atk_scale, 1),
        onEachHit({ battle: b, unit: u, target }) {
          if (!hasHp(target)) return;
          // Owned by the victim: the burn survives Ifrit leaving the field and uses her current ATK.
          // 3.01 in client data guarantees all three one-second ticks before expiry.
          b.addBuff(target, { key: `ifrit:scorch:${u.id}`, duration: num(s2.duration, 3.01), source: u,
            mods: { defFlat: num(s2.def) }, interval: 1, onTick: () => {
              b.dealDamage(u, target, { amount: u.s.atk * num(s2['burn.atk_scale']), type: 'arts',
                isSkill: true, canDodge: false, tags: ['skill', 'dot', 'ifritScorch'] });
            } });
        },
      },
    },
    [I3]: {
      kind: 'duration', attack: { noAttack: true },
      onStart({ unit: u }) { u.mem.ifritPulse = 0; },
      onTick({ battle: b, unit: u, skill, dt }) {
        // 灼地 is a maintained skill (PRTS 游戏数据基础#维持技能状态): hard control ends it.
        if (u.s.flags.stun || u.s.flags.sleep) { skill.end('interrupted'); return; }
        u.mem.ifritPulse += dt;
        while (u.mem.ifritPulse >= 1 - 1e-9 && up(u)) {
          u.mem.ifritPulse -= 1;
          for (const e of b.enemiesInKeys(u.rangeKeys, u, { canHitFly: false, groundOnly: true })) {
            b.addBuff(e, { key: `ifrit:burn:${u.id}`, duration: 1, mods: { resFlat: num(s3.magic_resistance) }, source: u });
            b.dealDamage(u, e, { amount: u.s.atk * num(s3.atk_scale), type: 'arts', isSkill: true,
              canDodge: false, tags: ['skill', 'dot', 'ifritBurn'] });
          }
          b.loseHp(u, Math.min(Math.max(0, u.hp - 1), u.s.maxHp * num(s3.hp_ratio)), { source: u });
          b.fx('burn', { x: u.x, y: u.y, id: u.id });
        }
      },
    },
  };
  return {
    skills, skill: skills[chess.skill?.skillId] ?? skills[I3],
    trait: { allInRange: true, splashRadius: 0, projectile: 'beam' },
    talents: [{ install(b, u) {
      b.on('statusApplied', c => {
        if (c.target === u && u.skill?.id === I3 && u.skill.active && (u.s.flags.stun || u.s.flags.sleep)) {
          u.skill.end('interrupted');
        }
      }, { owner: u });
      // The aura reaches flyers and sleeping enemies even during S3, but respects the engine's hidden/stealth selectors.
      b.every(0.1, () => {
        for (const e of b.enemies) {
          const key = `ifrit:res:${u.id}`;
          if (up(u) && canTargetEnemy(u, e, { canHitFly: true, hitSleep: true }) && bodyInKeys(e, u.rangeKeySet)) b.addBuff(e, {
            key, duration: 0.15, mods: { resMul: 1 + num(t0.magic_resistance) }, source: u,
          });
          else b.removeBuff(e, key);
        }
      }, { owner: u });
      // Talent timer is deployment-relative, resets on redeployment, and cannot feed a running skill.
      let timer = null;
      const resetTimer = () => {
        timer?.cancel();
        const interval = num(t1.interval, num(t1['ifrit_e_002[dice_sp].interval'], 6));
        if (!(num(t1.sp) > 0)) return;
        timer = b.every(interval, () => {
          if (!up(u)) return;
          giveSp(u, num(t1.sp), 'ifritTalent');
          if (b.rng.chance(num(t1['ifrit_e_002[dice_sp].prob']))) {
            giveSp(u, num(t1['ifrit_e_002[dice_sp].sp']), 'ifritModule');
          }
        }, { owner: u });
      };
      b.on('deploy', c => { if (c.unit === u) resetTimer(); }, { owner: u });
      if (up(u)) resetTimer();

      const distanceScale = num(trait.damage_scale);
      if (distanceScale > 0) b.on('hit', c => {
        if (c.source !== u || !up(u) || c.target.side !== 'enemy' || c.dmg.type !== 'arts') return;
        const lo = num(trait.min_dist), hi = num(trait.max_dist, 4);
        const fraction = Math.max(0, Math.min(1, (bodyDist(c.target, u.x, u.y) - lo) / Math.max(1e-9, hi - lo)));
        c.dmg.mul *= 1 + distanceScale * fraction;
      }, { owner: u });

      const gaugeScale = num(trait.ep_damage_ratio), burstScale = num(mod.element_atk_scale);
      if (gaugeScale > 0 || burstScale > 0) b.on('damaged', c => {
        if (c.source !== u || !up(u) || c.target.side !== 'enemy' || c.type !== 'arts' || !(c.amount > 0) || !hasHp(c.target)) return;
        // The gauge uses damage actually received (after RES, vulnerability and shields), not raw ATK.
        if (gaugeScale > 0) b.dealDamage(u, c.target, { amount: c.amount * gaugeScale, type: 'element', element: 'burn',
          isSkill: !!c.dmg.isSkill, tags: ['ifritModuleGauge'] });
        // Δ talent: an attack against a bursting target adds elemental HP damage. It is a damage-over-time
        // classification, not another gauge fill; S2's lingering burn is not an additional attack.
        if (burstScale > 0 && hasHp(c.target) && c.target.findBuff('burnBurst') &&
          (c.dmg.isAttack || c.dmg.tags?.includes('ifritBurn'))) {
          b.dealDamage(u, c.target, { amount: u.s.atk * burstScale, type: 'elemental', element: 'burn', canDodge: false,
            isSkill: !!c.dmg.isSkill, tags: ['dot', 'ifritModuleBurst'] });
        }
      }, { owner: u });
    } }],
  };
}

export const RHINE_ASSAULT_KITS = {
  char_416_zumama: eunectes, char_134_ifrit: ifrit,
  chess_rhine_eunectes_a: eunectes, chess_rhine_ifrit_a: ifrit,
};
export default RHINE_ASSAULT_KITS;
