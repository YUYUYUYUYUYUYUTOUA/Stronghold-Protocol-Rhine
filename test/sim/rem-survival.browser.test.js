// SIM_E2E=1 CHROME_PATH=<Chrome/Edge> node --test test/sim/rem-survival.browser.test.js
// Pure simulation acceptance: identical JSON records/specs and real Battle/Rem content in Node and Chromium.
// No renderer, 3D board, art, FakeBattle or wall-clock simulation inputs are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import * as specApi from '../../server/sim/spec.js';
import * as rem from '../../server/sim/content/rem.js';
import { chessRec, enemyRec, flatStage } from '../helpers/battleHarness.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SIM_E2E === '1' && existsSync(chrome);
const STAGE = 'rem_survival_acceptance';

function records() {
  return {
    chess: {
      survival_rem: chessRec({ id: 'survival_rem', bonds: ['remShip'], skill: null, stats: { atk: 100, maxHp: 1000, cost: 0 } }),
      survival_other: chessRec({ id: 'survival_other', skill: null, stats: { atk: 100, maxHp: 1000, cost: 0 } }),
    },
    enemies: { survival_dummy: enemyRec({ key: 'survival_dummy', hp: 1e8, atk: 0, speed: 0, def: 1200 }) },
    stages: { [STAGE]: flatStage({ id: STAGE }) },
  };
}

// This exact function is serialized by Puppeteer; keep every runtime helper inside it.
export function exerciseSurvival(api, raw) {
  let checks = 0;
  const check = (condition, label) => { checks++; if (!condition) throw new Error(label); };
  const near = (value, expected, label) => check(Math.abs(value - expected) < 1e-8, `${label}: ${value} != ${expected}`);
  const ds = new api.DataSource(raw);
  // A genuine Battle with only the production Rem domain installed, matching the focused Node content harness.
  class SurvivalBattle extends api.Battle {
    constructor(options) { super({ ...options, content: 'generic', extraContent: [api.rem], autoFinish: false, devices: false }); }
  }
  const tick = (b, n = 1) => { for (let i = 0; i < n; i++) { if (b.finished) throw new Error('fixture ended before its requested ticks'); b.step(); } };
  const present = u => u.alive && u.deployed && !u.removed;
  const field = (count, kind = 'normal', carry = null, ownerCount = 1) => {
    const input = {
      battleId: `survival.${kind}.${count}`, fieldId: `survival:${kind}`, kind, round: kind === 'normal' ? 2 : 1,
      stageId: 'rem_survival_acceptance', seed: 90123, content: 'generic', timeLimit: 1000,
      flags: { startOpCooldown: 0, dpInit: 99, dpPerSec: 0 }, spawns: [], routes: [],
      players: Array.from({ length: ownerCount }, (_, seat) => ({
        playerId: `p${seat + 1}`, seat, coords: 'field',
        bonds: { remShip: { active: count >= 3, count, layers: 0 } },
        ...(carry == null ? {} : { remSurvivalTicks: carry, remAppearances: 1e9, remRally: { row: 10, col: 4 } }),
        units: [{ uid: seat * 10 + 1, chessId: 'survival_rem', row: 12 - seat, col: 8 },
          { uid: seat * 10 + 2, chessId: 'survival_other', row: 12 - seat, col: 9 }],
      })),
    };
    const spec = api.buildBattleSpec(input);
    check(spec.players.every(p => !Object.hasOwn(p, 'remAppearances') && !Object.hasOwn(p, 'remRally')), 'retired metadata reached a spec');
    const b = api.createBattleFromSpec(spec, ds, { BattleClass: SurvivalBattle, quiet: true });
    b.start();
    for (const state of b.remState.values()) {
      for (const unit of state.units) if (present(unit)) b.retreat(unit, { permanent: true });
      state.queue = [];
      // Isolate explicitly requested real spawns from the periodic generators.
      state.regular = state.food = state.bus = state.boss = -1e6;
      for (const op of state.ps.units) if (op.kind === 'op') op.profile.noAttack = true;
    }
    return b;
  };
  const state = (b, owner = 'p1') => b.remState.get(owner);
  const op = (b, owner = 'p1') => b.getPlayer(owner).units.find(u => u.defId === 'survival_rem');
  const other = (b, owner = 'p1') => b.getPlayer(owner).units.find(u => u.defId === 'survival_other');
  const bonus = (b, pct, owner = 'p1') => {
    near(op(b, owner).s.atk, 100 * (1 + pct / 100), `${owner} attack bonus ${pct}%`);
    near(op(b, owner).s.maxHp, 1000 * (1 + pct / 100), `${owner} HP bonus ${pct}%`);
    near(other(b, owner).s.atk, 100, `${owner} non-Rem attack`);
    near(other(b, owner).s.maxHp, 1000, `${owner} non-Rem HP`);
  };
  const add = (b, type = 'miner', owner = 'p1', source = 'test') => {
    const s = state(b, owner), before = s.units.length;
    s.queue.push({ type, source }); tick(b);
    check(s.units.length === before + 1, `${owner}/${type}: a real reinforcement must spawn`);
    const unit = s.units.at(-1);
    unit.profile.noAttack = true;
    b.addBuff(unit, { key: 'acceptance:stationary', flags: { noMove: true }, persist: true });
    check(present(unit), `${owner}/${type}: deployment is live`);
    return unit;
  };
  const sample = b => [...b.remState.values()].map(s => ({
    owner: s.ps.playerId, ticks: s.survivalTicks, live: s.units.filter(present).length,
    atk: op(b, s.ps.playerId).s.atk, hp: op(b, s.ps.playerId).s.maxHp,
  }));
  const finish = b => {
    b.forceEnd();
    const result = b.result(), wire = api.compactResult(result), digest = api.resultDigest(wire).hash;
    check(digest === api.resultDigest(result).hash, 'compact result changed the authoritative outcome digest');
    check(b.errors.length === 0, `simulation errors: ${JSON.stringify(b.errors)}`);
    return { digest, ticks: Object.fromEntries(Object.entries(wire.perPlayer).map(([id, p]) => [id, p.remSurvivalTicks ?? 0])) };
  };
  const out = { rate: [], partial: [], failed: [], owners: [], carry: [], caps: [], bosses: [] };
  const types = ['child', 'miner', 'combined', 'chef', 'enthusiast', 'food', 'bus', 'boss'];
  const sources = ['regular', 'jacinta', 'sandreckoner', 'bus'];
  for (const count of [3, 6, 9]) for (let i = 0; i < types.length; i++) {
    const b = field(count), u = add(b, types[i], 'p1', sources[i % sources.length]), increment = count < 6 ? 0 : count === 6 ? 1 : 2;
    bonus(b, 0); check(state(b).survivalTicks === 0, 'appearance paid instant growth');
    b.emit('remSpawned', { unit: u, ownerId: 'p1', type: u.remType });
    bonus(b, 0); tick(b, 29); bonus(b, 0);
    check(state(b).survivalTicks === (count >= 6 ? 29 : 0), 'partial first second accounting');
    tick(b); bonus(b, increment);
    check(state(b).survivalTicks === (count >= 6 ? 30 : 0), 'one actual reinforcement-second accounting');
    check(!u.findBuff('rem:survival'), 'operator-only growth leaked onto a reinforcement');
    out.rate.push({ count, type: types[i], sample: sample(b), result: finish(b) });
  }
  for (const count of [6, 9]) {
    const b = field(count), s = state(b), increment = count === 6 ? 1 : 2;
    const first = add(b); tick(b, 15); b.kill(first); tick(b, 15);
    check(!first.alive && s.survivalTicks === 15, 'real death must stop additional survival time'); bonus(b, 0);
    const second = add(b); tick(b, 14);
    check(s.survivalTicks === 29, 'partial seconds did not pool across real deaths'); bonus(b, 0);
    tick(b); check(s.survivalTicks === 30, 'pooled second boundary'); bonus(b, increment);
    b.retreat(second, { permanent: true }); tick(b, 60);
    check(!present(second) && s.survivalTicks === 30, 'retreat must stop time without subtracting prior work'); bonus(b, increment);
    out.partial.push({ count, sample: sample(b), result: finish(b) });

    const failed = field(count), fs = state(failed), spawn = failed.spawnToken;
    failed.spawnToken = () => null; fs.queue.push({ type: 'miner', source: 'test' }); tick(failed, 60);
    check(fs.survivalTicks === 0 && fs.queue.length === 1, 'failed/queued attempts earned time'); bonus(failed, 0);
    failed.spawnToken = spawn; tick(failed);
    const survivor = fs.units.at(-1); survivor.profile.noAttack = true;
    failed.addBuff(survivor, { key: 'acceptance:stationary', flags: { noMove: true }, persist: true });
    check(present(survivor) && fs.queue.length === 0 && fs.survivalTicks === 0, 'first successful placement is not elapsed time');
    tick(failed, 30); bonus(failed, increment);
    failed.kill(op(failed)); tick(failed, 30);
    near(op(failed).findBuff('rem:survival').mods.atkPct, 2 * increment / 100, 'dead operator retains later earned reward');
    check(failed.redeploy(op(failed)), 'earned operator can redeploy'); bonus(failed, 2 * increment);
    failed.kill(survivor); const earned = fs.survivalTicks; tick(failed, 30);
    check(fs.survivalTicks === earned, 'dead final reinforcement continued accounting'); bonus(failed, 2 * increment);
    out.failed.push({ count, sample: sample(failed), result: finish(failed) });

    const shared = field(count, 'unite', null, 2), a = add(shared, 'miner', 'p1'); tick(shared, 30);
    bonus(shared, increment, 'p1'); bonus(shared, 0, 'p2');
    add(shared, 'boss', 'p2'); tick(shared, 30);
    bonus(shared, 2 * increment, 'p1'); bonus(shared, increment, 'p2');
    shared.kill(a); const ownTicks = state(shared).survivalTicks; tick(shared, 30);
    check(state(shared).survivalTicks === ownTicks, 'other owner leaked survival time');
    bonus(shared, 2 * increment, 'p1'); bonus(shared, 2 * increment, 'p2');
    out.owners.push({ count, sample: sample(shared), result: finish(shared) });

    const normal = field(count); add(normal); tick(normal, 149); bonus(normal, 4 * increment);
    const normalResult = finish(normal);
    check(normalResult.ticks.p1 === 149, 'normal result lost the partial survival second');
    const unite = field(count, 'unite', normalResult.ticks.p1); bonus(unite, 4 * increment);
    const incoming = sample(unite); add(unite); check(state(unite).survivalTicks === 149, 'unite arrival counted as elapsed time');
    tick(unite); check(state(unite).survivalTicks === 150, 'unite failed to finish the partial carried second'); bonus(unite, 5 * increment);
    const changed = sample(unite), unitedResult = finish(unite), fresh = field(count, 'normal', 149);
    check(state(fresh).survivalTicks === 0, 'new normal round carried old time'); bonus(fresh, 0);
    out.carry.push({ count, normal: normalResult, incoming, changed, unite: unitedResult, fresh: sample(fresh), freshResult: finish(fresh) });

    const capped = field(count); for (let i = 0; i < 4; i++) add(capped);
    tick(capped, 1500); bonus(capped, count === 6 ? 200 : 300);
    check(state(capped).survivalTicks <= 6000, 'bounded growth counter exceeded its saturation bound');
    for (const unit of state(capped).units) if (present(unit)) capped.retreat(unit, { permanent: true });
    const capTicks = state(capped).survivalTicks; tick(capped, 60);
    check(state(capped).survivalTicks === capTicks, 'empty field continued cap accounting'); bonus(capped, count === 6 ? 200 : 300);
    out.caps.push({ count, sample: sample(capped), result: finish(capped) });
  }
  for (const [layers, expectedAtk, expectedDamage] of [[0, 2500, 3800], [300, 4000, 6800], [600, 5500, 9800], [999, 7495, 13790]]) {
    const b = field(9); state(b).ps.bonds.remShip.layers = layers;
    const boss = add(b, 'boss'), enemy = b.spawnEnemy('survival_dummy', { pos: [Math.round(boss.y), Math.round(boss.x)] });
    check(!!enemy, 'boss damage target is actually spawned'); enemy.profile.noAttack = true;
    const hp = enemy.hp; near(boss.s.atk, expectedAtk, `boss ATK at ${layers} layers`);
    tick(b, 32); near(enemy.hp, hp, 'boss fuse was shortened'); tick(b, 32);
    near(hp - enemy.hp, expectedDamage, 'boss physical hit must use 200% launch ATK then subtract DEF');
    out.bosses.push({ layers, atk: boss.s.atk, damage: hp - enemy.hp, result: finish(b) });
  }
  const cached = field(9); state(cached).ps.bonds.remShip.layers = 300;
  const boss = add(cached, 'boss'), enemy = cached.spawnEnemy('survival_dummy', { pos: [Math.round(boss.y), Math.round(boss.x)] }), hp = enemy.hp;
  enemy.profile.noAttack = true; tick(cached, 32);
  cached.addBuff(boss, { key: 'acceptance:boss-atk', mods: { atkFlat: 1000, aspd: 500 }, persist: true });
  tick(cached, 32); near(hp - enemy.hp, 6800, 'first bomb changed its cached launch ATK');
  tick(cached, 32); near(hp - enemy.hp, 15600, 'second bomb did not use the later launch ATK');
  const launches = cached.drainEvents().filter(e => e[0] === 'fx' && e[1] === 'remPizza').length;
  check(launches === 3, 'attack speed changed the one-second bombing cadence');
  out.bosses.push({ cachedLaunchDamage: 6800, accumulatedDamage: hp - enemy.hp, launches, result: finish(cached) });
  return { checks, ...out };
}

export function nodeSurvivalAcceptance() {
  return exerciseSurvival({ ...specApi, DataSource, Battle, rem }, records());
}

test('Rem survival growth, ownership, death, safe carry and boss bombs match real Node and Chromium simulations', {
  skip: enabled ? false : 'set SIM_E2E=1 and CHROME_PATH (pure simulation; no art or renderer)', timeout: 120000,
}, async () => {
  const node = nodeSurvivalAcceptance();
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), problems = [], forbidden = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('request', request => { if (/\/(assets|vendor|render)\//.test(new URL(request.url()).pathname)) forbidden.push(request.url()); });
    page.on('response', response => { if (response.status() >= 400 && !/favicon/.test(response.url())) problems.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.goto(`http://127.0.0.1:${srv.port}/healthz`, { waitUntil: 'domcontentloaded' });
    const api = await page.evaluateHandle(async () => ({
      ...await import('/sim/spec.js'),
      DataSource: (await import('/sim/simdata.js')).DataSource,
      Battle: (await import('/sim/Battle.js')).Battle,
      rem: await import('/sim/content/rem.js'),
    }));
    const web = await page.evaluate(exerciseSurvival, api, records());
    await api.dispose();
    assert.deepEqual(web, JSON.parse(JSON.stringify(node)), 'every actual stat, counter and result digest must match across runtimes');
    assert.deepEqual(forbidden, [], 'pure simulation must not load renderer/vendor/art resources');
    assert.deepEqual(problems, []);
    console.log('Rem survival browser evidence:', JSON.stringify({ browser: await browser.version(), checks: node.checks, rateCases: node.rate.length,
      partial: node.partial, failed: node.failed, owners: node.owners, carry: node.carry, caps: node.caps, bosses: node.bosses, forbidden, problems }));
  } finally { await browser?.close(); await srv.close(); }
});
