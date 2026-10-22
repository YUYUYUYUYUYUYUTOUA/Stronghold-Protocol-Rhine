// SIM_E2E=1 CHROME_PATH=/usr/bin/chromium node --test test/sim/rem-equipment.browser.test.js
// Real generated Rem operators, equipment, Battle/spec and damage paths; no renderer or art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import * as specApi from '../../server/sim/spec.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SIM_E2E === '1' && existsSync(chrome);

// Puppeteer serializes this function verbatim. All runtime helpers stay inside it.
export function exerciseRemEquipment(api) {
  let checks = 0;
  const check = (condition, label) => { checks++; if (!condition) throw new Error(label); };
  const close = (a, b, label) => check(Math.abs(a - b) < 1e-7, `${label}: ${a} != ${b}`);
  const up = u => u.alive && u.deployed && !u.removed;
  class EquipmentBattle extends api.Battle {
    constructor(options) { super({ ...options, autoFinish: false, devices: false }); }
  }
  const cases = [];
  for (const aq of ['a', 'b']) for (const mq of ['a', 'b']) {
    const spec = api.buildBattleSpec({
      battleId: `rem.equipment.${aq}.${mq}`, fieldId: 'rem:equipment', kind: 'unite', round: 2,
      stageId: 'act2autochess_m01', seed: 74191, timeLimit: 120,
      rect: { r0: 0, r1: 18, c0: 0, c1: 20 }, spawns: [], routes: [],
      flags: { startOpCooldown: 0, dpInit: 99, dpPerSec: 0 },
      players: [
        { playerId: 'owner', seat: 0, coords: 'field', bonds: {}, units: [{ uid: 1,
          chessId: `chess_rem_warmy_${aq}`, row: 10, col: 7, moduleId: 'none',
          items: [`chess_item_rem_armor_${aq}`, `chess_item_rem_amplifier_${mq}`] }] },
        { playerId: 'other', seat: 1, coords: 'field', bonds: {}, units: [{ uid: 2,
          chessId: 'chess_rem_warmy_a', row: 10, col: 15, moduleId: 'none' }] },
      ],
    });
    const b = api.createBattleFromSpec(spec, api.ds, { BattleClass: EquipmentBattle, quiet: true });
    b.start(); b.step();
    const holder = b.getPlayer('owner').units.find(u => u.uid === 1);
    const other = b.getPlayer('other').units.find(u => u.uid === 2);
    check(up(holder) && up(other), 'both real preset operators deploy');
    check(holder.def.charId === 'char_4081_warmy' && holder.def.bonds.includes('remShip'), 'the carrier is the production Rem preset');
    const hpRatio = aq === 'a' ? 1.2 : 1.35, atkRatio = mq === 'a' ? 1.25 : 1.4;
    const damageKeep = aq === 'a' ? .9 : .85, ignore = mq === 'a' ? .25 : .35;
    close(holder.s.maxHp, holder.base.maxHp * hpRatio, 'carrier HP bonus');
    close(holder.s.atk, holder.base.atk * atkRatio, 'carrier attack bonus');
    close(other.s.maxHp, other.base.maxHp, 'teammate receives no equipment HP');
    for (const p of b.players) for (const op of p.units) {
      op.profile.noAttack = true; op.skill?.setTrigger('NEVER');
    }
    const original = [holder.x, holder.y, other.x, other.y];
    const own = b.remState.get('owner'), foreign = b.remState.get('other');
    own.queue.push({ type: 'miner', source: 'equipment-browser', point: [9, 8] },
      { type: 'food', source: 'equipment-browser', point: [9, 8] });
    foreign.queue.push({ type: 'miner', source: 'equipment-browser', point: [9, 8] });
    b.step();
    const miner = own.units.find(u => u.remType === 'miner'), food = own.units.find(u => u.remType === 'food');
    const outsider = foreign.units.find(u => u.remType === 'miner');
    check([miner, food, outsider].every(up), 'two owned troops and one other-owner troop are actually generated');
    const position = (u, r, c) => {
      u.x = c; u.y = r; u.tileR = Math.round(r); u.tileC = Math.round(c); b._refreshRange(u);
      check(b.grid.groundPassable(u.tileR, u.tileC), 'the real mapped position is on legal ground');
      check(!b._occ.includes(u), 'a reinforcement never occupies the operator slot');
    };
    for (const u of [miner, food, outsider]) {
      b.addBuff(u, { key: 'equipment-browser:stationary', persist: true, flags: { noMove: true } });
      u.profile.noAttack = true; position(u, 9, 8);
    }
    close(miner.s.atk, 500, 'carrier attack does not alter the miner base');
    close(food.s.atk, 1500, 'carrier attack does not alter vehicle collision ATK');
    const enemy = b.spawnEnemy('enemy_1000_gopro', { pos: [9, 8] });
    check(!!enemy, 'the real enemy record spawns');
    Object.assign(enemy.base, { maxHp: 1e8, atk: 0, def: 400, res: 20, moveSpeed: 0 });
    enemy.hp = 1e8; enemy.profile.noAttack = true; enemy.markDirty();
    const strike = u => b.dealDamage(u, enemy, { amount: 1000, type: 'phys', canDodge: false, isAttack: true });
    const hurt = u => b.dealDamage(null, u, { amount: 100, type: 'true', canDodge: false });
    const measurements = [];
    const measure = label => {
      const sample = { label, ownDamage: strike(miner), foreignDamage: strike(outsider),
        ownHurt: hurt(miner), foreignHurt: hurt(outsider), position: [miner.x, miner.y] };
      measurements.push(sample); return sample;
    };
    const activeDamage = 1000 - 400 * (1 - ignore);
    let sample = measure('inside');
    close(sample.ownDamage, activeDamage, 'paired physical penetration');
    close(sample.ownHurt, 100 * damageKeep, 'own reinforcement damage reduction');
    close(sample.foreignDamage, 600, 'nearby other-owner reinforcement receives no penetration');
    close(sample.foreignHurt, 100, 'nearby other-owner reinforcement receives no reduction');
    close(hurt(food), 100 * damageKeep, 'the owned vehicle also receives reduction');
    close(hurt(holder), 100, 'the holder receives ordinary HP stats, not its reinforcement aura');
    // The rounded tile stays column 8 on both sides of this boundary. Only the
    // authoritative fractional x/y decides whether the aura applies.
    position(miner, 9, 8.0001); sample = measure('outside-world-boundary');
    close(sample.ownDamage, 600, 'fractional exit removes penetration');
    close(sample.ownHurt, 100, 'fractional exit removes reduction');
    position(miner, 9, 8); sample = measure('returned-inside');
    close(sample.ownDamage, activeDamage, 'return restores current penetration');
    close(sample.ownHurt, 100 * damageKeep, 'return restores current reduction');

    const collisions = [], trace = [];
    b.on('damaged', c => {
      if (c.source === food && c.target === enemy) collisions.push({ amount: c.amount, tags: [...c.dmg.tags] });
    });
    for (let n = 0; n < 12; n++) {
      b.step();
      if (n % 3 === 0) trace.push({ tick: b.tickCount, hp: [holder.hp, miner.hp, food.hp, outsider.hp, enemy.hp],
        positions: [miner, food, outsider].map(u => [u.x, u.y]) });
    }
    check(collisions.length === 1 && collisions[0].tags.includes('remFood'), 'the real food special hits the enemy once');
    close(collisions[0].amount, 1500 - 400 * (1 - ignore), 'food collision uses the same physical penetration once');
    holder.hidden = true; sample = measure('hidden-carrier');
    close(sample.ownDamage, 600, 'hidden holder provides no penetration');
    close(sample.ownHurt, 100, 'hidden holder provides no reduction');
    holder.hidden = false;
    b.retreat(holder); sample = measure('withdrawn-carrier');
    close(sample.ownDamage, 600, 'withdrawn holder provides no penetration');
    close(sample.ownHurt, 100, 'withdrawn holder provides no reduction');
    check(b.redeploy(holder, { free: true }), 'the real holder successfully redeploys');
    holder.profile.noAttack = true; holder.skill?.setTrigger('NEVER');
    sample = measure('redeployed-carrier');
    close(sample.ownDamage, activeDamage, 'redeploy restores exactly one penetration aura');
    close(sample.ownHurt, 100 * damageKeep, 'redeploy restores exactly one reduction aura');
    close(holder.s.maxHp, holder.base.maxHp * hpRatio, 'carrier HP bonus stays singular across redeploy');
    close(holder.s.atk, holder.base.atk * atkRatio, 'carrier attack bonus stays singular across redeploy');
    check(original.every((v, i) => Math.abs(v - [holder.x, holder.y, other.x, other.y][i]) < 1e-8), 'ordinary operator positions do not change');
    check(b.errors.length === 0, `simulation errors: ${JSON.stringify(b.errors)}`);
    const stats = { holder: { hp: holder.s.maxHp, atk: holder.s.atk }, miner: { hp: miner.s.maxHp, atk: miner.s.atk },
      food: { hp: food.s.maxHp, atk: food.s.atk } };
    b.forceEnd();
    const result = b.result(), digest = api.resultDigest(result).hash;
    check(digest === api.resultDigest(api.compactResult(result)).hash, 'compact result preserves the authoritative digest');
    cases.push({ armorGrade: aq, amplifierGrade: mq, measurements, collisions, trace, stats, digest, ticks: b.tickCount });
  }
  return { checks, cases };
}

test('Rem equipment real carrier stats, owner auras and collision damage agree in Node and Chromium', {
  skip: enabled ? false : 'set SIM_E2E=1 and CHROME_PATH (pure simulation; no art or renderer)', timeout: 120000,
}, async () => {
  const ds = new DataSource(getData({ log: { warn() {}, error() {}, info() {} } }));
  const node = exerciseRemEquipment({ ...specApi, Battle, ds });
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), problems = [], forbidden = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('request', request => {
      if (/\/(assets|vendor|render)\//.test(new URL(request.url()).pathname)) forbidden.push(request.url());
    });
    page.on('response', response => {
      if (response.status() >= 400 && !/favicon/.test(response.url())) problems.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(`http://127.0.0.1:${srv.port}/healthz`, { waitUntil: 'domcontentloaded' });
    const api = await page.evaluateHandle(async () => {
      const { loadBrowserSim } = await import('/js/battle/simLoader.js');
      const { spec, ds } = await loadBrowserSim();
      return { ...spec, ds, Battle: (await import('/sim/Battle.js')).Battle };
    });
    const web = await page.evaluate(exerciseRemEquipment, api);
    await api.dispose();
    assert.deepEqual(web, JSON.parse(JSON.stringify(node)), 'real stats, hit amounts, traces and result digests match');
    assert.deepEqual(problems, []); assert.deepEqual(forbidden, [], 'pure sim never requests art, renderer or vendor resources');
    console.log('Rem equipment browser evidence:', JSON.stringify({ browser: await browser.version(), checks: node.checks,
      cases: node.cases.map(({ trace, measurements, ...c }) => ({ ...c, traceSamples: trace.length, samples: measurements.length })), problems, forbidden }));
  } finally { await browser?.close(); await srv.close(); }
});
