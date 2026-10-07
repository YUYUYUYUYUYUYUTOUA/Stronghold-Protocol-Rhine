// Selectable Rhine support kits. Skill/talent/module numbers come from the resolved loadout records.
// PRTS: https://prts.wiki/w/梅尔 · https://prts.wiki/w/乌啾
import { num, talentBb, skillRec, freeTileAround, enemiesInGrid, alliesInGridOf, up } from './shared/tier1.js';
import { RHINE_BALANCE as B } from '../../../../shared/rhineResearch.js';
import { canReceiveHeal } from '../../damage.js';

export const OTTER = 'token_10004_otter_motter';
const MAYER_S1 = 'skchr_otter_1', MAYER_S2 = 'skchr_otter_2';
const WUHOO_S1 = 'skchr_turdus_1', WUHOO_S2 = 'skchr_turdus_2';
export const liveOtters = (b, owner) => b.allyUnits.filter(a => a.kind === 'token' && a.defId === OTTER && a.ownerUnit === owner && up(a));
const selected = (chess, def) => def?.skill?.id ?? chess.skill?.skillId;
const record = (chess, id, bb, def) => {
  const rec = skillRec(chess, id) ?? {};
  return id === selected(chess, def) ? { ...rec, bb: bb ?? rec.bb ?? {} } : rec;
};

/** Same named aura never stacks; a weaker source cannot overwrite a stronger live source. */
function aura(b, target, key, source, value, mods) {
  const cur = target.findBuff(key);
  if (cur && cur.source !== source && num(cur.data?.value) > value && cur.timeLeft > 0.05) return;
  b.addBuff(target, { key, source, duration: 0.2, data: { value }, mods, tags: ['aura'] });
}

/** Intrinsic blocking slow reads the token's OWN resolved module variant, including pre-placed otters. */
export function otterKit() {
  return { fromTokens: true, skill: null, talents: [{ install(b, t) {
    b.addBuff(t, { key: 'mayer:noOperatorHeal', persist: true, allowDead: true, flags: { noOperatorHeal: true } });
    const owner = t.ownerUnit;
    const slow = num(t.def.talents?.find(x => x.bb?.attack_speed != null)?.bb.attack_speed, -25);
    const s1 = owner?.def.skill?.id === MAYER_S1 ? owner.def.raw?.skill : null;
    const dodge = num(s1?.bb?.prob);
    const apply = () => {
      if (!up(t)) return;
      for (const enemy of t.blocking) if (enemy.alive) aura(b, enemy, 'mayer:otterBlock', t, -slow, { aspd: slow });
      if (dodge > 0 && up(owner)) for (const ally of alliesInGridOf(b, t, s1.rangeGrid ?? [[0, 0]])) {
        aura(b, ally, 'mayer:confusion', t, dodge, { dodgePhys: dodge, dodgeArts: dodge });
      }
    };
    b.every(0.1, apply, { owner: t });
    b.on('deploy', c => { if (c.unit === t) apply(); }, { owner: t });
  } }] };
}
export const RHINE_SUPPORT_TOKEN_KITS = { [OTTER]: otterKit };

export function mayer(bb, chess, def) {
  const capacity = Math.min(B.mayerSummons[chess.isGolden ? 1 : 0], Math.max(1, num(talentBb(chess).cnt, 1)));
  const s2 = record(chess, MAYER_S2, bb, def);
  const summon = (b, u) => {
    if (!up(u) || !(u.mem.otterStock > 0) || liveOtters(b, u).length >= capacity) return;
    const tile = freeTileAround(b, u, (r, c) => b.grid.canStand(r, c) && !b.grid.isObstacle(r, c));
    if (!tile) return;
    const t = b.spawnToken(u, OTTER, ...tile, { kit: otterKit() });
    if (t) { u.mem.otterStock--; b.fx('summon', { x: t.x, y: t.y, id: t.id, token: OTTER }); }
  };
  const skills = {
    [MAYER_S1]: { kind: 'passive' }, // each otter applies its selected skill's aura, including board pieces
    [MAYER_S2]: { kind: 'instant', onStart({ battle: b, unit: u }) {
      const data = s2.bb ?? {}, seq = u.deploySeq;
      for (const t of liveOtters(b, u)) {
        // The owner's skill triggers the summon skill: a stunned/frozen/silenced otter cannot detonate.
        if (!t.canAct || t.s.flags.silence) continue;
        for (const e of enemiesInGrid(b, t, s2.rangeGrid, { canHitFly: true })) {
          b.dealDamage(u, e, { amount: u.s.atk * num(data.atk_scale, 3.8), type: 'arts', isSkill: true, tags: ['skill', 'mayerExplosion'] });
          if (e.alive) b.applyStatus(e, 'stun', { duration: num(data.stun, 1), source: u });
        }
        b.fx('explode', { x: t.x, y: t.y, id: t.id });
        b.retreat(t, { reason: 'recycle', permanent: true });
        u.mem.otterStock = Math.min(capacity, num(u.mem.otterStock) + 1);
      }
      // Automatic placement retains the project's summon adaptation; it never consumes another owner's stock.
      b.after(1, () => { if (u.deploySeq === seq) summon(b, u); }, { owner: u });
    } },
  };
  return { skills, skill: skills[selected(chess, def)] ?? skills[MAYER_S2], talents: [{ install(b, u) {
    b.on('deploy', c => {
      if (c.unit !== u) return;
      const seq = u.deploySeq;
      // Operators deploy before their board tokens. Count those tokens before any automatic placement.
      b.after(0, () => {
        if (!up(u) || u.deploySeq !== seq) return;
        u.mem.otterStock = Math.max(0, capacity - liveOtters(b, u).length);
        summon(b, u);
      }, { owner: u });
    }, { owner: u });
    b.on('death', c => {
      if (c.unit !== u) return;
      for (const t of liveOtters(b, u)) b.retreat(t, { reason: 'ownerGone', permanent: true });
      u.mem.otterStock = 0;
    }, { owner: u });
    b.every(10, () => summon(b, u), { owner: u });
    if (u.skill.id === MAYER_S2) {
      const activate = u.skill.activate;
      u.skill.activate = function(reason, opts) {
        return liveOtters(b, u).length ? activate.call(this, reason, opts) : false;
      };
    }
  } }] };
}

const isWuhoo = u => u?.def?.charId === 'char_4224_turdus';
const healable = (b, u, a) => up(a) && !a.hidden && a.kind !== 'device' && !a.s.flags.noHeal && !a.profile?.noHeal && canReceiveHeal(u, a) && b.allySelectable(a, u);

export function wuhoo(bb, chess, def) {
  const s1 = record(chess, WUHOO_S1, bb, def), s2 = record(chess, WUHOO_S2, bb, def);
  const tb = chess.trait?.bb ?? {}, tal = talentBb(chess);
  const chainCount = Math.max(1, num(tb['attack@chain.max_target'] ?? tb['chain.max_target'], 3));
  const chainScale = num(tb['attack@chain.atk_scale'] ?? tb['chain.atk_scale'], 0.75);
  const selfScale = num(tal['attack@chain.atk_scale_2'] ?? tal['chain.atk_scale_2'], 1.2);

  function hide(b, u, a) {
    const key = `wuhoo:hide:${u.id}`, duration = num(s2.bb?.bonus_duration, 10);
    const current = a.findBuff(key);
    // Reapplication refreshes the existing buff: its cached attack and tick phase do not reset.
    if (current) { current.timeLeft = current.duration = duration; return; }
    const heal = u.s.atk * num(s2.bb?.['turdus_s2[continues_heal].heal_scale'], 0.2);
    b.addBuff(a, { key, duration, source: u, flags: { camou: !a.blocking.length }, interval: 1,
      onTick: () => { if (up(a)) b.heal(u, a, heal, { regen: true, rhineHot: true }); } });
  }

  function jumps(b, u, first, raw, withHide) {
    const seen = new Set([first.id]);
    let prev = first, amount = raw;
    let remaining = chainCount - 1 + (u.skill.active && u.skill.id === WUHOO_S1 ? num(s1.bb?.['attack@chain.extra_value'], 1) : 0);
    const firstIsSelf = first === u || isWuhoo(first);
    if (firstIsSelf) { amount *= selfScale; remaining++; }
    if (withHide) hide(b, u, first);
    let noDecay = firstIsSelf;
    while (remaining-- > 0) {
      const target = b.alliesInRadius(prev.x, prev.y, 2.5).filter(a => !seen.has(a.id) && healable(b, u, a))
        .sort((a, c) => a.hpRatio - c.hpRatio || c.deploySeq - a.deploySeq)[0];
      if (!target) break;
      seen.add(target.id);
      if (!noDecay) amount *= chainScale;
      noDecay = target === u || isWuhoo(target);
      if (noDecay) { amount *= selfScale; remaining++; }
      b._ev(['atk', prev.id, target.id, 'chainHeal']);
      b.heal(u, target, amount, { rhineBounce: true });
      if (withHide) hide(b, u, target);
      prev = target;
    }
  }

  const skills = {
    [WUHOO_S1]: { kind: 'duration', heal: true, mods: { aspd: num(s1.bb?.attack_speed, 40) } },
    [WUHOO_S2]: { kind: 'instant', heal: true, onStart({ battle: b, unit: u }) {
      b.loseHp(u, Math.max(0, Math.min(u.hp - 1, u.hp * num(s2.bb?.['turdus_s2[self_damage].hp_ratio'], 0.15))), { source: u });
      // This skill needs no injured target to activate; select after paying HP, nearest on equal HP ratios.
      const target = alliesInGridOf(b, u).filter(a => healable(b, u, a)).sort((a, c) => a.hpRatio - c.hpRatio
        || Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(c.x - u.x, c.y - u.y) || c.deploySeq - a.deploySeq)[0];
      if (target) b.heal(u, target, u.s.atk * u.s.atkScaleMul, { rhineSkill: true });
    } },
  };
  return { trait: { heal: { mode: 'single' } }, skills, skill: skills[selected(chess, def)] ?? skills[WUHOO_S2], talents: [{ install(b, u) {
    b.on('beforeAttack', c => {
      if (c.attacker !== u || c.profile?.dmgType !== 'heal') return;
      c.targets = b.injuredAlliesInKeys(u.rangeKeys, u).filter(a => healable(b, u, a)).slice(0, 1);
    }, { owner: u });
    b.on('heal', c => {
      if (c.source !== u || c.opts?.rhineBounce || c.opts?.regen || c.opts?.hot || c.opts?.self || c.opts?.aura || c.opts?.reflect || c.opts?.tags?.length || !up(u)) return;
      // The heal hook receives the pipeline-scaled primary amount. Recover only the incoming raw amount,
      // so the source healing bonus is applied once and every bounce uses its OWN recipient's intake bonus.
      const scale = u.s.healingDealtMul * c.target.s.healingTakenMul;
      const raw = scale > 0 ? c.amount / scale : 0;
      if (c.target === u || isWuhoo(c.target)) c.amount *= selfScale;
      jumps(b, u, c.target, raw, !!c.opts?.rhineSkill);
    }, { owner: u, priority: 1000 });
    // Once blocking cancels this skill's camouflage, the same HoT cannot grant it again until it expires.
    b.on('blocked', c => {
      const a = c.unit ?? c.blocker;
      const buff = a?.findBuff?.(`wuhoo:hide:${u.id}`);
      if (buff?.flags.camou) { buff.flags.camou = false; a.markDirty(); }
    }, { owner: u });
  } }] };
}

export const RHINE_SUPPORT_KITS = { char_242_otter: mayer, char_4224_turdus: wuhoo,
  chess_rhine_mayer_a: mayer, chess_rhine_wuhoo_a: wuhoo };
export default RHINE_SUPPORT_KITS;
