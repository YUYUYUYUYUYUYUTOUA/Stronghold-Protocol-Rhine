// Kazdel presets use native operator kits; souls intentionally install none of these active kits.
import ascalon from './ops/op-ascln.js';
import logos from './ops/op-logos.js';
import wisdel, { SHADOW, shadowTokenKit } from './ops/op-wisdel.js';
import hoederer from './ops/op-hodrer.js';
import { num, talentBb, traitBb, instantKind, enemiesInGrid } from './shared/tier1.js';

export const tokenKits = { [SHADOW]: shadowTokenKit };

export function odda(bb, chess, def) {
  const t = talentBb(chess), tb = traitBb(chess);
  return {
    skills: {
      skchr_odda_1: { kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1), splashRadius: num(bb.ability_range_radius, 1.5) } },
      skchr_odda_2: { kind: 'duration', mods: { atkPct: num(bb.atk), defPct: num(bb.def) } },
    },
    install(battle, unit) {
      battle.on('damaged', c => {
        if (c.source !== unit || c.target.side !== 'enemy' || c.dmg?.type !== 'phys' || !(c.amount > 0)) return;
        unit.mem.oddaHits = (unit.mem.oddaHits ?? 0) + 1;
        if (unit.mem.oddaHits >= num(t.count, Infinity) && !unit.findBuff('odda:hammer')) {
          battle.addBuff(unit, { key: 'odda:hammer', mods: { atkPct: num(t.atk) }, source: unit });
        }
        if (unit.skill?.id === 'skchr_odda_2' && unit.skill.active && c.dmg.isSplash
          && c.target.alive && num(c.target.s.massLevel, num(c.target.base?.massLevel)) <= num(bb['attack@value'], 3)) {
          battle.applyStatus(c.target, 'levitate', { source: unit, duration: num(bb['attack@levitate_duration'], 0.5) });
        }
      }, { owner: unit });
      battle.on('beforeAttack', c => {
        if (c.attacker !== unit) return;
        const target = c.targets[0], radius = num(c.profile?.splashRadius, 1);
        // HMR-X counts targets in the splash area, including the primary enemy (native Pepe convention).
        if (target && battle.foesInRadius(target.x, target.y, radius).length >= num(tb.cnt, Infinity)) {
          battle.addBuff(unit, { key: 'odda:module', duration: 0.1, mods: { atkScaleMul: num(tb.atk_scale_e, 1) } });
        }
      }, { owner: unit });
      battle.on('attack', c => { if (c.attacker === unit) battle.removeBuff(unit, 'odda:module'); }, { owner: unit });
    },
  };
}

export function meteorite(bb, chess, def) {
  const t = talentBb(chess), tb = traitBb(chess);
  const roll = (battle, unit) => {
    const crit = battle.rng.chance(num(t.prob));
    if (crit) battle.addBuff(unit, { key: 'meteo:crit', duration: 0.1, mods: { atkMul: 1 + num(t.atk) } });
    return crit;
  };
  return {
    skills: {
      // PRTS skill notes: S1 splash radius 2 tiles (normal attacks 1 tile).
      skchr_meteo_1: { kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1), splashRadius: 2 } },
      skchr_meteo_2: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const target = enemiesInGrid(battle, unit, null, { n: 1, priority: 'fly' })[0];
          if (!target) return;
          roll(battle, unit);
          const amount = unit.s.atk * num(bb.atk_scale, 1);
          // Native S2 shell radius 1 tile; its DEF reduction applies before the shell damage.
          for (const e of battle.foesInRadius(target.x, target.y, 1)) {
            battle.applyStrongest(e, 'meteo:def', { duration: num(bb.duration, 10), value: -num(bb.def), mods: v => ({ defFlat: -v }), source: unit });
            battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, defIgnoreFlat: num(tb.def_penetrate_fixed), tags: ['skill', 'meteo:shell'] });
          }
          battle.fx('aoe', { x: target.x, y: target.y, radius: 1, id: unit.id, skill: 'meteo2' });
          battle.removeBuff(unit, 'meteo:crit');
        },
      },
    },
    install(battle, unit) {
      unit.profile.splashRadius = 1;
      const rolls = new Map();
      battle.on('hit', c => {
        if (c.source !== unit || !c.dmg.isAttack) return;
        // A projectile may land after her next attack. One roll belongs to the whole shell, including splash.
        const id = c.dmg.attackId;
        if (!rolls.has(id)) rolls.set(id, battle.rng.chance(num(t.prob)));
        if (rolls.get(id)) c.dmg.amount *= 1 + num(t.atk);
        c.dmg.defIgnoreFlat += num(tb.def_penetrate_fixed);
      }, { owner: unit });
    },
  };
}

export function paprika(bb, chess) {
  const t = talentBb(chess);
  return {
    skills: {
      'skcom_heal_rage[3]': { kind: 'duration', heal: true, mods: { aspd: num(bb.attack_speed) } },
      skchr_peper_2: {
        kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) },
        onStart({ unit }) {
          unit.mem.peperHeal = unit.profile.heal;
          unit.profile.heal = { ...unit.profile.heal, count: (unit.profile.heal?.count ?? 3) + num(bb['attack@chain.extra_value']) };
        },
        onEnd({ unit }) { if (unit.mem.peperHeal) unit.profile.heal = unit.mem.peperHeal; unit.mem.peperHeal = null; },
      },
    },
    install(battle, unit) {
      battle.on('heal', c => {
        if (c.source !== unit || c.opts?.regen || !(c.amount > 0)) return;
        const threshold = unit.skill?.id === 'skchr_peper_2' && unit.skill.active ? num(bb['talent@hp_ratio'], num(t.hp_ratio)) : num(t.hp_ratio);
        if (c.target.hpRatio < threshold) c.amount += num(t.value) * unit.s.healingDealtMul * c.target.s.healingTakenMul;
      }, { owner: unit });
    },
  };
}

export default {
  chess_kazdel_ascalon_a: ascalon.char_4132_ascln,
  chess_kazdel_odd_a: odda,
  chess_kazdel_meteorite_a: meteorite,
  chess_kazdel_paprika_a: paprika,
  chess_kazdel_hoederer_a: hoederer.char_4088_hodrer,
  chess_kazdel_logos_a: logos.char_4133_logos,
  chess_kazdel_wisdel_a: wisdel.char_1035_wisdel,
};
