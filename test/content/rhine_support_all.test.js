import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants, flatStage } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { RHINE_SUPPORT_KITS, OTTER, liveOtters } from '../../server/sim/content/kits/rhineSupport.js';
const ds = getDefaultSource();
const cid = (key, elite = false) => `chess_rhine_${key}_${elite ? 'b' : 'a'}`;
const dummy = enemyRec({ key: 'dummy', hp: 1e8, atk: 0, speed: 0 });
const patient = chessRec({ id: 'patient', stats: { maxHp: 100000, atk: 0 }, rangeGrid: [], skill: null });
const mods = { mayer: 'uniequip_002_otter', wuhoo: 'uniequip_002_turdus' };
const close = (got, want, msg = '') => assert.ok(Math.abs(got - want) < 1e-6, `${msg}: ${got} != ${want}`);
function run(key, { elite = false, skillIndex = 1, moduleId = 'none', units = [], ...opts } = {}) {
  const id = cid(key, elite), raw = ds.rawChess(id);
  const chess = { ...raw, bonds: [], garrisonIds: [] };
  // Keep skill selection real but leave activation timing to each assertion.
  chess.skills = chess.skills.map(s => ({ ...s, trigger: { rule: 'NEVER' } }));
  chess.skill = { ...chess.skill, trigger: { rule: 'NEVER' } };
  const h = makeBattle({ autoFinish: false, timeLimit: 200, seed: 7, captureNoisy: true,
    hooks: ['heal', 'damaged', 'dodge', 'skillStart'], kits: RHINE_SUPPORT_KITS,
    defs: { chess: { [id]: chess, patient }, enemies: { dummy } },
    units: [{ chessId: id, uid: 'owner', row: 10, col: 4, skillIndex, moduleId }, ...units], ...opts });
  h.run(0.1); h.owner = h.unit('owner'); h.owner.atkCd = 999;
  return h;
}
const done = h => { assert.deepEqual(h.b.errors, []); checkInvariants(h.b); };
const token = (uid, row, col, ownerUid = 'owner') => ({ kind: 'token', tokenId: OTTER, ownerUid, uid, row, col });
const cast = u => { u.skill.gainSp(999, 'test'); return u.skill.activate('test'); };
const directChain = (h, first, amount = h.owner.s.atk) => {
  const start = h.hooksOf('heal').length;
  h.b.heal(h.owner, first, amount);
  return h.hooksOf('heal').slice(start).filter(c => c.source === h.owner && !c.opts?.regen);
};

test('support loadouts: every real normal/elite skill and equipped/unequipped module uses a hand-authored spec', () => {
  for (const key of ['mayer', 'wuhoo']) for (const elite of [false, true]) for (const skillIndex of [0, 1]) {
    for (const moduleId of elite ? ['none', mods[key]] : ['none']) {
      const h = run(key, { elite, skillIndex, moduleId });
      assert.equal(h.owner.skill.id, `skchr_${key === 'mayer' ? 'otter' : 'turdus'}_${skillIndex + 1}`);
      assert.equal(h.owner.kit.skillSource, 'skills');
      assert.equal(h.owner.def.loadout.moduleId, elite ? moduleId : null);
      done(h);
    }
  }
});

test('Mayer defaults to S1 and elite SUM-X; pre-placed and automatic otters both receive the passive dodge', () => {
  for (const elite of [false, true]) {
    const id = cid('mayer', elite), h = makeBattle({ autoFinish: false,
      units: [{ chessId: id, uid: 'owner', row: 10, col: 4 }, token('preplaced', 10, 5)] });
    h.run(0.3);
    const owner = h.unit('owner'), otters = liveOtters(h.b, owner), rate = elite ? 0.25 : 0.18;
    assert.equal(owner.skill.id, 'skchr_otter_1'); assert.equal(owner.skill.kind, 'passive');
    assert.equal(owner.def.loadout.moduleId, elite ? mods.mayer : null);
    const bare=ds.getChess(id,{moduleId:'none'});
    close(owner.s.atk,bare.stats.atk+(elite?25:0));
    close(owner.s.maxHp,bare.stats.maxHp+(elite?80:0));
    assert.equal(otters.length, elite ? 2 : 1); assert.ok(otters.includes(h.unit('preplaced')));
    for (const t of otters) {
      assert.equal(t.def.skill.id, 'sktok_motter_1'); close(t.s.dodgePhys, rate); close(t.s.dodgeArts, rate);
    }
    done(h);
  }
});

test('Mayer S1 applies the selected 18%/25% physical and arts dodge to pre-placed and automatic otters only', () => {
  for (const elite of [false, true]) {
    const h = run('mayer', { elite, skillIndex: 0, units: [token(2, 10, 5), { chessId: 'patient', uid: 3, row: 11, col: 5 }] });
    h.run(0.2);
    const rate = elite ? 0.25 : 0.18, otters = liveOtters(h.b, h.owner);
    assert.equal(otters.length, elite ? 2 : 1);
    for (const t of otters) { close(t.s.dodgePhys, rate); close(t.s.dodgeArts, rate); }
    assert.equal(h.unit(3).s.dodgePhys, 0, 'current Lv4/Lv7 skill range is only the summon tile');
    assert.equal(h.owner.skill.kind, 'passive'); assert.equal(h.owner.skill.activations, 0);
    const foe = h.spawn('dummy', { pos: [11, 6] }), t = otters[0];
    for (const type of ['phys', 'arts']) for (let i = 0; i < 100; i++) h.b.dealDamage(foe, t, { amount: 1, type });
    assert.ok(h.hooksOf('dodge').some(c => c.target === t && c.dmg.type === 'phys'));
    assert.ok(h.hooksOf('dodge').some(c => c.target === t && c.dmg.type === 'arts'));
    assert.equal(h.b.dealDamage(foe, t, { amount: 1, type: 'true' }), 1);
    done(h);
  }
});

test('Mayer SUM-X Lv1 applies its actual stats while both live and pre-placed otters retain the base blocking slow', () => {
  for (const [moduleId, slow] of [['none', -25], [mods.mayer, -25]]) {
    const h = run('mayer', { elite: true, skillIndex: 0, moduleId, units: [token(2, 10, 5)] });
    const t = h.unit(2), e = h.spawn('dummy', { pos: [10, 5] }); h.run(0.4);
    assert.equal(e.blockedBy, t); close(e.s.aspd, 100 + slow);
    const auto = liveOtters(h.b, h.owner).find(a => a !== t);
    const e2 = h.spawn('dummy', { pos: [auto.tileR, auto.tileC] }); h.run(0.4);
    assert.equal(e2.blockedBy, auto); close(e2.s.aspd, 100 + slow);
    const expected = ds.getChess(cid('mayer', true), { skillIndex: 0, moduleId });
    close(h.owner.s.atk, expected.stats.atk);
    if (moduleId !== 'none') assert.ok(h.owner.s.atk > ds.getChess(cid('mayer', true), { skillIndex: 0, moduleId: 'none' }).stats.atk);
    done(h);
  }
});

test('Mayer S2 detonates her own available otters, honors control, returns stock and redeploys without reviving the old token', () => {
  const h = run('mayer', { elite: true, units: [token(2, 10, 5), token(3, 11, 4)] });
  const u = h.owner, frozen = h.unit(3), t = h.unit(2);
  const enemy = h.spawn('dummy', { pos: [10, 5] });
  h.run(0.1);
  h.b.applyStatus(frozen, 'stun', { duration: 2 });
  assert.equal(cast(u), true);
  assert.equal(t.alive, false); assert.equal(frozen.alive, true);
  const hit = h.hooksOf('damaged').find(c => c.target === enemy && c.dmg.tags?.includes('mayerExplosion'));
  close(hit.dmg.amount, u.s.atk * 4.5); assert.equal(hit.dmg.type, 'arts'); assert.equal(enemy.s.flags.stun, true);
  const stock = u.mem.otterStock;
  h.run(1.2); assert.equal(u.mem.otterStock, stock - 1);
  assert.ok(liveOtters(h.b, u).some(a => a !== frozen)); assert.equal(t.alive, false);
  h.b.kill(u, enemy); assert.equal(liveOtters(h.b, u).length, 0, 'summons leave when Mayer leaves');
  h.run(1); assert.equal(liveOtters(h.b, u).length, 0);
  done(h);
});

test('Mayer automatic placement respects a full pre-placed roster and no-otter S2 preserves its charge', () => {
  const h = run('mayer', { units: [token(2, 10, 5)] });
  h.run(10.2); assert.equal(liveOtters(h.b, h.owner).length, 1); assert.equal(h.owner.mem.otterStock, 0);
  for (const t of liveOtters(h.b, h.owner)) h.b.retreat(t, { permanent: true });
  h.owner.skill.gainSp(999, 'test'); const charges = h.owner.skill.charges;
  assert.equal(h.owner.skill.activate('test'), false); assert.equal(h.owner.skill.charges, charges);
  done(h);
});

test('Mayer automatic otters avoid deep water and a knocked-out operator awaiting redeployment', () => {
  const stage = flatStage();
  stage.rows[10] = `${stage.rows[10].slice(0, 5)}d${stage.rows[10].slice(6)}`;
  const h = run('mayer', { stage, units: [{ chessId: 'patient', uid: 'body', row: 11, col: 5 }],
    setup(b) { b.on('battleStart', () => b.kill(b.allyUnits.find(u => u.uid === 'body'))); } });
  const body = h.unit('body'), otters = liveOtters(h.b, h.owner);
  assert.equal(h.b.isDown(body), true); assert.equal(h.b.downOn(11, 5), body);
  assert.equal(h.b.grid.canStand(10, 5), false);
  assert.equal(otters.length, 1);
  assert.ok(otters.every(t => (t.tileR !== 10 || t.tileC !== 5) && (t.tileR !== 11 || t.tileC !== 5)));
  assert.equal(h.b.redeploy(body), true, 'the reserved tile is still free for its original operator');
  done(h);
});

test('Mayer summon stock and concurrency stay at one normal / two elite for both skills and module choices', () => {
  for (const elite of [false, true]) for (const skillIndex of [0, 1]) {
    for (const moduleId of elite ? ['none', mods.mayer] : ['none']) {
      const h = run('mayer', { elite, skillIndex, moduleId });
      h.run(20.1);
      const limit = elite ? 2 : 1;
      assert.equal(liveOtters(h.b, h.owner).length, limit);
      assert.equal(h.owner.mem.otterStock, 0);
      assert.equal(h.owner.def.raw.talents.find(t => t.bb.cnt != null).bb.cnt, limit);
      done(h);
    }
  }
});

test('Mayer otters reject operator heals including Saria, chained HoT and operator-owned summons, while medical devices still heal', () => {
  for (const elite of [false, true]) {
    const id = cid('mayer', elite), h = makeBattle({ autoFinish: false, hooks: ['heal'], captureNoisy: true,
      players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
        bonds: { rhineShip: { active: true, count: 3, layers: 0 } },
        research: { active: true, devices: [{ key: 'medical', tokenId: 'token_rhine_medical', uid: 'medical', onBoard: true, stage: 0 }] },
        units: [{ chessId: id, uid: 'owner', row: 10, col: 4 }, token('preplaced', 10, 5),
          { chessId: 'chess_char_5_11_a', uid: 'saria', row: 11, col: 4 },
          { chessId: cid('wuhoo'), uid: 'wuhoo', row: 12, col: 4 },
          { kind: 'token', tokenId: 'token_rhine_medical', uid: 'medical', row: 11, col: 5 }] }] });
    h.run(0.3);
    const t = h.unit('preplaced'), medical = h.unit('medical');
    for (const otter of liveOtters(h.b, h.unit('owner'))) assert.equal(otter.s.flags.noOperatorHeal, true);
    t.hp = 100;
    for (const uid of ['owner', 'saria', 'wuhoo']) {
      const healer = h.unit(uid);
      for (const opts of [{}, { regen: true }, { self: true }]) {
        assert.equal(h.b.heal(healer, t, 100, opts), 0, `${uid} cannot bypass with heal options`);
      }
      assert.equal(h.b.injuredAlliesInKeys(new Set([t.tileR * 21 + t.tileC]), healer).includes(t), false);
      healer.atkCd = 999;
    }
    assert.equal(h.b.heal({ kind: 'token', ownerUnit: h.unit('saria') }, t, 100), 0, 'operator-owned healing summons follow the same source rule');
    assert.equal(t.hp, 100);
    assert.equal(h.hooksOf('heal').some(c => c.target === t), false, 'rejected heals never reach reactive heal hooks');
    h.run(3);
    close(t.hp, 100 + 150);
    assert.ok(h.hooksOf('heal').some(c => c.source === medical && c.target === t));
    assert.equal(h.b.heal(t, t, 10, { self: true }), 10, 'intrinsic self recovery retains the original self-heal rule');
    h.b.addBuff(t, { key: 'test:healFree', flags: { healFree: true } });
    assert.equal(h.b.heal(medical, t, 100), 0, 'the independent medical device does not bypass upstream 禁疗');
    assert.equal(h.b.heal(t, t, 10, { self: true }), 0, 'upstream 禁疗 stops intrinsic heals too');
    assert.equal(h.b.heal(t, t, 10, { regen: true }), 10, 'HP-regeneration attributes retain the upstream exception');
    assert.equal(h.b.heal(t, t, 10, { ignoreHealFree: true }), 10, 'an explicitly exempt intrinsic heal retains the upstream rule');
    assert.equal(h.b.heal(h.unit('saria'), t, 100, { ignoreHealFree: true }), 0, 'the upstream exemption does not bypass the separate operator-healing restriction');
    h.b.removeBuff(t, 'test:healFree');
    h.b.addBuff(t, { key: 'absoluteNoHeal', flags: { noHeal: true } });
    assert.equal(h.b.heal(medical, t, 100), 0, 'medical exception never bypasses unrelated noHeal');
    done(h);
  }
});

function healer(opts = {}) {
  return run('wuhoo', { units: [[10, 5], [11, 4], [11, 5], [9, 4], [9, 5]].map(([row, col], i) => ({ chessId: 'patient', uid: i + 2, row, col })), ...opts });
}

test('Wuhoo S1 raises ASPD and adds one jump; a self jump carries its multiplied healing to all subsequent jumps', () => {
  for (const elite of [false, true]) {
    const h = healer({ elite, skillIndex: 0 });
    for (const a of h.b.allyUnits) a.hp = a.s.maxHp * 0.1;
    const aspd = h.owner.s.aspd; assert.equal(cast(h.owner), true);
    close(h.owner.s.aspd, aspd + (elite ? 55 : 40));
    const chain = directChain(h, h.owner, 100);
    assert.equal(chain.length, 5);
    close(chain.find(c => c.target === h.owner).amount, 125);
    assert.deepEqual(chain.filter(c => c.opts?.rhineBounce).map(c => c.amount), [125, 93.75, 70.3125, 52.734375]);
    h.owner.skill.end('test'); close(h.owner.s.aspd, aspd);
    assert.equal(directChain(h, h.owner, 100).length, 4);
    done(h);
  }
});

test('Wuhoo XAH-X Lv1 changes 75% decay to 85%, retaining its full-potential 125% talent without repeating healing modifiers', () => {
  for (const [moduleId, scale, self] of [['none', 0.75, 1.25], [mods.wuhoo, 0.85, 1.25]]) {
    const h = healer({ elite: true, moduleId });
    for (const a of h.b.allyUnits) a.hp = a.s.maxHp * 0.3;
    h.b.addBuff(h.owner, { key: 'sourceBonus', mods: { healingDealtMul: 1.5 } });
    h.b.addBuff(h.owner, { key: 'selfIntake', mods: { healingTakenMul: 2 } });
    const chain = directChain(h, h.owner, 100), bounce = chain.filter(c => c.opts?.rhineBounce);
    assert.equal(chain.length, 4); close(chain.find(c => c.target === h.owner).amount, 100 * self * 1.5 * 2);
    [1, scale, scale * scale].forEach((s, i) => close(bounce[i].amount, 100 * self * 1.5 * s));
    done(h);
  }
});

test('Wuhoo can bounce through full-health allies, latest deployment wins ties, and no-heal/isolated targets are excluded', () => {
  const h = healer();
  const first = h.unit(2), forbidden = h.unit(6);
  h.b.addBuff(forbidden, { key: 'noHeal', flags: { noHeal: true } });
  h.b.addBuff(h.owner, { key: 'noHeal', flags: { noHeal: true } });
  h.b.addBuff(h.unit(5), { key: 'isolated', flags: { isolated: true } });
  const chain = directChain(h, first, 100);
  assert.equal(chain.length, 3, 'full health does not terminate the chain');
  const bounce = chain.filter(c => c.opts?.rhineBounce);
  assert.equal(bounce[0].target, h.unit(4)); assert.equal(bounce[1].target, h.unit(3));
  assert.ok(chain.every(c => c.target !== forbidden && c.target !== h.unit(5)));
  done(h);
});

test('Wuhoo self amplification also carries forward when she is reached in the middle of a chain', () => {
  const h = healer(), u = h.owner;
  for (const a of h.b.allyUnits) a.hp = a.s.maxHp * 0.5;
  const first = h.unit(2); first.hp = first.s.maxHp * 0.1; u.hp = u.s.maxHp * 0.2;
  const chain = directChain(h, first, 100), bounce = chain.filter(c => c.opts?.rhineBounce);
  assert.equal(bounce[0].target, u);
  assert.equal(chain.length, 4);
  [93.75, 93.75, 70.3125].forEach((amount, i) => close(bounce[i].amount, amount));
  done(h);
});

test('Wuhoo item recovery and regeneration do not create extra chains or trigger the self-heal talent', () => {
  const h = healer(), u = h.owner;
  u.hp = u.s.maxHp * 0.1;
  for (const opts of [{ self: true }, { regen: true }, { hot: true }, { tags: ['talent'] }]) {
    const n = h.hooksOf('heal').length, hp = u.hp;
    h.b.heal(u, u, 10, opts);
    close(u.hp - hp, 10);
    assert.equal(h.hooksOf('heal').length - n, 1);
  }
  done(h);
});

test('Wuhoo S2 works from full HP, does not kill its caster, applies camouflage/HoT to every chain target and caches ATK', () => {
  const h = healer(), u = h.owner;
  const max = u.s.maxHp, atk = u.s.atk;
  assert.equal(cast(u), true); assert.ok(u.hp > max * 0.85);
  const targets = h.b.allyUnits.filter(a => a.findBuff(`wuhoo:hide:${u.id}`));
  assert.equal(targets.length, 4, 'the self-heal opens the extra jump even when everyone started full');
  assert.ok(targets.every(a => a.s.flags.camou));
  for (const a of targets) a.hp = a.s.maxHp * 0.1;
  h.b.addBuff(u, { key: 'laterAtk', mods: { atkPct: 1 } });
  const n = h.hooksOf('heal').length; h.run(1.05);
  const hot = h.hooksOf('heal').slice(n).filter(c => c.opts?.rhineHot);
  assert.equal(hot.length, 4); for (const c of hot) close(c.amount, atk * 0.2);
  const primary = targets.find(a => a !== u), oldBuff = primary.findBuff(`wuhoo:hide:${u.id}`);
  h.b.emit('blocked', { blocker: primary, enemy: {} }); assert.equal(primary.s.flags.camou, undefined);
  u.hp = 1; assert.equal(cast(u), true); assert.ok(u.hp >= 1); assert.equal(primary.findBuff(`wuhoo:hide:${u.id}`), oldBuff);
  assert.equal(primary.s.flags.camou, undefined, 'refreshing its active HoT does not re-grant lost camouflage');
  done(h);
});
