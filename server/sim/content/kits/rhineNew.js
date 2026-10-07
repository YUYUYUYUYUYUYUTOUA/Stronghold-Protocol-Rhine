// 星源 / 多萝西: native selectable skills and the owner's resolved module blackboards.
// Trap damage and chain reactions are explicit physical activations, never inferred from damage/kill events.
import { num, talentBb, traitBb, skillRec, up } from './shared/tier1.js';
import { RHINE_BALANCE as B } from '../../../../shared/rhineResearch.js';
import { absoluteRangeKeys } from '../../targeting.js';
import { bodyOnTile, bodyInKeys, bodyInRadius } from '../../body.js';
import { COLS, CHAIN_RADIUS } from '../../constants.js';
import { localOrder } from '../../dir.js';

export const RESONATOR = 'token_10025_doroth_recttp';
const A1 = 'skchr_halo_1', A2 = 'skchr_halo_2';
const D1 = 'sktok_doroth_1', D2 = 'sktok_doroth_2', D3 = 'sktok_doroth_3';
const selected = (chess, def) => def?.skill?.id ?? chess.skill?.skillId;
const record = (chess, id, bb, def) => {
  const rec = skillRec(chess, id) ?? {};
  return id === selected(chess, def) ? { ...rec, bb: bb ?? rec.bb ?? {} } : rec;
};

export function astgenne(bb, chess, def) {
  const s1 = record(chess, A1, bb, def), s2 = record(chess, A2, bb, def);
  const tb = traitBb(chess), t = talentBb(chess);
  const chain = { count: num(tb['attack@chain.max_target'], chess.isGolden ? 4 : 3),
    falloff: 1 - num(tb['attack@chain.atk_scale'], 0.85), radius: CHAIN_RADIUS,
    sluggish: num(tb['attack@sluggish'], 0.5) };
  const skills = {
    [A1]: { kind: 'charges', attack: { atkScale: num(s1.bb?.atk_scale, 1),
      maxTargets: num(s1.bb?.max_target, 2), chain: { ...chain, count: num(s1.bb?.['chain.max_target'], 4),
        falloff: 1 - num(tb['skill@chain.atk_scale'], 0.85), sluggish: num(s1.bb?.sluggish, 0.5) } } },
    [A2]: { kind: 'duration', mods: { atkPct: num(s2.bb?.atk) },
      targeting: { maxTargets: num(s2.bb?.['attack@max_target'], 2), rangeGrid: s2.rangeGrid },
      attack: { chain } },
  };
  return { trait: { chain }, skills, skill: skills[selected(chess, def)] ?? skills[A1], talents: [{ install(b, u) {
    let timer = null;
    const reset = () => {
      timer?.cancel(); u.mem.astgenneZeal = 0; b.removeBuff(u, 'astgenne:zeal');
      timer = b.every(Math.max(b.dt, num(t.interval, 15)), () => {
        if (!up(u)) return;
        u.mem.astgenneZeal = Math.min(num(t.max_stack_cnt, 5), u.mem.astgenneZeal + 1);
        b.addBuff(u, { key: 'astgenne:zeal', mods: { aspd: u.mem.astgenneZeal * num(t.attack_speed) } });
      }, { owner: u });
    };
    b.on('deploy', c => { if (c.unit === u) reset(); }, { owner: u });
  } }] };
}

export const liveResonators = (b, owner) => b.allyUnits.filter(t => t.kind === 'token' && t.defId === RESONATOR && t.ownerUnit === owner && up(t));
const trapLimit = owner => B.dorothyTrapLimit[owner?.def?.golden || owner?.def?.raw?.isGolden ? 1 : 0];
const touches = (enemy, r, c) => enemy.hitArea ? bodyOnTile(enemy, r, c)
  : Math.abs(enemy.x - c) <= 0.5 && Math.abs(enemy.y - r) <= 0.5;
const groundOn = (b, r, c) => b.enemies.some(e => up(e) && !e.hidden && !e.isFlying && touches(e, r, c));

/** One activation per physical deployment, also if several S3 waves queue the same trap. */
export function triggerResonator(b, t, hit = null, { chain = false, deploySeq = t.deploySeq } = {}) {
  if (!up(t) || t.deploySeq !== deploySeq || t.mem.dorothyTriggered === deploySeq) return false;
  const owner = t.ownerUnit;
  if (!owner || t.defId !== RESONATOR) return false;
  if (!chain && (!hit || !up(hit) || hit.isFlying || !touches(hit, t.tileR, t.tileC))) return false;
  t.mem.dorothyTriggered = deploySeq;
  const sk = t.def.skill, bb = sk?.bb ?? {}, id = sk?.id ?? sk?.skillId;
  const keys = new Set(absoluteRangeKeys(sk?.rangeGrid ?? [[0, 0]], t.tileR, t.tileC, t.dir, 0));
  // Like the game's champagne trap: ground contact/explosions do not require a visible attack target.
  const selectable = e => up(e) && !e.hidden && !e.isFlying;
  const victims = id === D1 ? (hit && selectable(hit) ? [hit] : [])
    : b.enemies.filter(e => selectable(e) && (id === D2 ? bodyInRadius(e, t.x, t.y, 1.2) : bodyInKeys(e, keys)));
  const event = { token: t, owner, target: hit, victims, chain, critical: t.mem.dorothyDamageScale > 1, deploySeq };
  // PRTS 梦想家: S1/S2 gain their ATK stack before damage; S3 after damage.
  if (id !== D3) b.emit('trapTriggered', event);
  const amount = owner.s.atk * num(bb.atk_scale) * num(t.mem.dorothyDamageScale, 1);
  for (const e of victims) {
    b.dealDamage(t, e, { amount, type: id === D3 ? 'arts' : 'phys', isSkill: true, canDodge: false, tags: ['summon', 'trap', 'dorothyTrap'] });
    if (!up(e)) continue;
    if (id === D1) b.addBuff(e, { key: `dorothy:def:${owner.id}`, source: owner, duration: num(bb.duration, 5), mods: { defPct: num(bb.def) } });
    if (id === D2) b.applyStatus(e, 'bind', { source: owner,
      duration: victims.length === num(bb.cnt_2, 1) ? num(bb.duration_2) : num(bb.duration) });
    if (id === D3) b.applyStatus(e, 'sluggish', { source: owner, duration: num(bb.sluggish) });
  }
  // Queue the OTHER traps before withdrawing this one; cycles stop at the per-deployment guard above.
  if (id === D3) for (const other of liveResonators(b, owner)) {
    if (other === t || other.mem.dorothyTriggered === other.deploySeq || other.mem.dorothyQueued === other.deploySeq || !keys.has(other.tileR * COLS + other.tileC)) continue;
    const seq = other.deploySeq, delay = num(bb.interval, 2);
    other.mem.dorothyQueued = seq;
    b.fx('dorothyChain', { x: other.x, y: other.y, fromX: t.x, fromY: t.y, source: t.id, target: other.id, delay });
    b.after(delay, () => triggerResonator(b, other, null, { chain: true, deploySeq: seq }), { owner: other });
  }
  if (id === D3) b.emit('trapTriggered', event);
  b.fx('dorothyTrap', { x: t.x, y: t.y, id: t.id, token: RESONATOR, skill: id, target: hit?.id,
    n: victims.length, critical: t.mem.dorothyDamageScale > 1, consumed: true });
  b.retreat(t, { reason: 'expired', permanent: true });
  return true;
}

/** The placed trap is inert until a ground enemy steps on it or its owner's S3 chain reaches it. */
export function resonator() {
  return { fromTokens: true, trait: { noAttack: true }, skill: { kind: 'passive', onTick({ battle: b, unit: t }) {
    if (!up(t)) return;
    const hit = b.enemies.filter(e => up(e) && !e.hidden && !e.isFlying && touches(e, t.tileR, t.tileC))
      .sort((a, c) => a.spawnSeq - c.spawnSeq)[0];
    if (hit) triggerResonator(b, t, hit);
  } }, install(b, t) {
    b.addBuff(t, { key: 'dorothy:untargetable', persist: true, allowDead: true, flags: { untargetable: true, noHeal: true } });
    b.on('deploy', c => {
      if (c.unit !== t) return;
      if (groundOn(b, t.tileR, t.tileC)) {
        b.retreat(t, { reason: 'invalidPlacement', permanent: true }); return;
      }
      // Guard even injected high-level deployLimit data; automatic and pre-placed traps share the owner's cap.
      if (liveResonators(b, t.ownerUnit).length > trapLimit(t.ownerUnit)) {
        b.retreat(t, { reason: 'limit', permanent: true }); return;
      }
      t.mem.dorothyTriggered = null; t.mem.dorothyQueued = null;
      const tb = t.ownerUnit?.def?.raw?.trait?.bb ?? {};
      const critical = b.rng.chance(num(tb.prob));
      t.mem.dorothyDamageScale = critical ? num(tb.atk_scale, 2) : 1;
      t.form = critical ? 'dorothyCritical' : 'dorothyNormal';
      b.fx('form', { id: t.id, form: t.form });
      if (critical) b.fx('dorothyCritical', { x: t.x, y: t.y, id: t.id });
    }, { owner: t, priority: -95 });
    b.on('death', c => {
      if (c.unit !== t || c.reason !== 'expired' || t.mem.dorothyTriggered !== t.deploySeq) return;
      // The same board/automatic cell can be armed again using stock, after its native redeploy delay.
      t.removed = false;
      t.mem.dorothyReadyAt = b.time + Math.max(0, num(t.base.respawnTime, 5));
    }, { owner: t, priority: -10 });
  } };
}

/** Free ground cells in the owner's range, prioritising approaching ground enemies and rejecting occupied cells. */
function trapTile(b, u) {
  const enemies = b.enemies.filter(e => up(e) && !e.hidden && !e.isFlying);
  const candidates = [];
  for (const key of u.rangeKeys) {
    const r = Math.floor(key / COLS), c = key % COLS;
    if (!b.grid.canStand(r, c) || b.grid.isObstacle(r, c) || b.isReservedTile(r, c) || groundOn(b, r, c)) continue;
    const [lr, lc] = localOrder(r - u.tileR, c - u.tileC, u.dir);
    const distance = enemies.length ? Math.min(...enemies.map(e => Math.hypot(e.x - c, e.y - r))) : Math.hypot(u.x - c, u.y - r);
    candidates.push({ r, c, distance, lr, lc });
  }
  candidates.sort((a, c) => a.distance - c.distance || a.lr - c.lr || a.lc - c.lc);
  return candidates[0] ? [candidates[0].r, candidates[0].c] : null;
}

export function dorothy(bb, chess, def) {
  const capacity = B.dorothyTrapLimit[chess.isGolden ? 1 : 0];
  const t0 = talentBb(chess, 0), dream = talentBb(chess, 1);
  const setStock = (b, u, value) => {
    u.mem.dorothyStock = Math.max(0, Math.min(capacity, value));
    if (u.mem.dorothyStock >= capacity) b.addBuff(u, { key: 'dorothy:stockFull', flags: { noSp: true } });
    else b.removeBuff(u, 'dorothy:stockFull');
  };
  const arm = (b, u, allowNew = false, free = false) => {
    if (!up(u) || (!free && !(u.mem.dorothyStock > 0)) || liveResonators(b, u).length >= capacity) return null;
    const ready = b.allyUnits.filter(t => t.kind === 'token' && t.defId === RESONATOR && t.ownerUnit === u && !t.alive && !t.removed
      && t.mem.dorothyReadyAt <= b.time + 1e-9 && !groundOn(b, t.homeR, t.homeC));
    let trap = null;
    for (const t of ready) if (b.redeploy(t, { free: true })) { trap = t; break; }
    if (!trap && allowNew) { const tile = trapTile(b, u); if (tile) trap = b.spawnToken(u, RESONATOR, ...tile); }
    if (trap && up(trap)) {
      if (!free) setStock(b, u, u.mem.dorothyStock - 1);
      b.fx('summon', { x: trap.x, y: trap.y, id: trap.id, token: RESONATOR });
    }
    return trap;
  };
  const skills = Object.fromEntries(['skchr_doroth_1', 'skchr_doroth_2', 'skchr_doroth_3'].map(id => [id, {
    kind: 'instant', trigger: 'SP_FULL', onStart({ battle: b, unit: u }) {
      setStock(b, u, num(u.mem.dorothyStock) + Math.max(1, num(bb.cnt, 1)));
      arm(b, u, true);
    },
  }]));
  return { skills, skill: skills[selected(chess, def)] ?? skills.skchr_doroth_3, talents: [{ install(b, u) {
    b.on('deploy', c => {
      if (c.unit !== u) return;
      u.mem.dorothyDream = 0; b.removeBuff(u, 'dorothy:dreamer');
      const seq = u.deploySeq;
      b.after(0, () => {
        if (!up(u) || u.deploySeq !== seq) return;
        setStock(b, u, capacity - liveResonators(b, u).length);
        // Automatic on-deploy resonators are free, but occupy the same field cap as board pieces.
        for (let i = 0; i < Math.min(capacity, num(t0['attack@max_cnt'], 2)); i++) if (!arm(b, u, true, true)) break;
      }, { owner: u });
    }, { owner: u });
    b.every(0.5, () => arm(b, u), { owner: u });
    b.on('trapTriggered', c => {
      if (c.owner !== u || !up(u)) return;
      u.mem.dorothyDream = Math.min(num(dream.max_stack_cnt, 10), num(u.mem.dorothyDream) + 1);
      b.addBuff(u, { key: 'dorothy:dreamer', mods: { atkMul: 1 + u.mem.dorothyDream * num(dream.atk) } });
    }, { owner: u });
    b.on('death', c => {
      if (c.unit !== u) return;
      for (const trap of b.allyUnits.filter(t => t.kind === 'token' && t.defId === RESONATOR && t.ownerUnit === u)) {
        if (up(trap)) b.retreat(trap, { reason: 'ownerGone', permanent: true });
        trap.removed = true;
      }
      setStock(b, u, 0);
    }, { owner: u });
  } }] };
}

export const RHINE_NEW_KITS = { char_135_halo: astgenne, char_4048_doroth: dorothy,
  chess_rhine_astgenne_a: astgenne, chess_rhine_dorothy_a: dorothy };
export const RHINE_NEW_TOKEN_KITS = { [RESONATOR]: resonator };
