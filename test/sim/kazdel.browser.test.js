// SIM_E2E=1 CHROME_PATH=/usr/bin/chromium node --test test/sim/kazdel.browser.test.js
// Loads the real browser sim/data without needing game art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { cannonSource, tickCannon } from '../../server/sim/content/kazdel/cannon.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SIM_E2E === '1' && chrome && existsSync(chrome);

function exercise(b, source, tick) {
  b.start();
  const [a, ally] = b.allyUnits;
  for (const u of b.allyUnits) u.profile.noAttack = true;
  const e = b.spawnEnemy('enemy_1000_gopro', { pos: [10, 5] });
  e.base.maxHp = 1e8; e.hp = 1e8; e.base.atk = 0; e.base.moveSpeed = .01; e.markDirty();
  const ps = b.getPlayer('p1'), stage = 2;
  const state = { ps, stage, cannon: source(ps, stage), charge: 15, lastFireAt: -Infinity,
    warning: { x: 5, y: 10, startedAt: -3, until: 0 } };
  const before = [a.hp, ally.hp, e.hp];
  tick(b, state, 0, 0, () => {});
  const hit = [before[0] - a.hp, before[1] - ally.hp, before[2] - e.hp];
  for (let i = 0; i < 91; i++) b.step();
  const out = { hit, owners: b.allyUnits.map(u => u.ownerId), layers: b.players.map(p => p.bonds.kazdelShip.layers),
    hp: b.allyUnits.map(u => u.hp), slow: e.s.moveSpeed, kazdel: b.snapshot().kazdel, errors: b.errors };
  b.forceEnd();
  return { ...out, result: b.result() };
}

test('Kazdel cannon ownership and Ascalon native data/clock agree in Chromium and Node across field kinds', {
  skip: enabled ? false : 'set SIM_E2E=1 and CHROME_PATH (no art required)', timeout: 90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--no-sandbox'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const ds = new DataSource(getData({ log: { warn() {}, error() {}, info() {} } }));
    for (const kind of ['normal', 'unite', 'boss', 'hidden']) for (const count of [6, 9]) {
      const spec = buildBattleSpec({ fieldId: `kaz:${kind}`, kind, seed: 417, stageId: 'act2autochess_m01',
        rect: { r0: 0, r1: 18, c0: 0, c1: 20 }, timeLimit: 30, players: ['p1', 'p2'].map((playerId, seat) => ({
          playerId, seat, coords: 'field', bonds: { kazdelShip: { active: true, count, layers: 0 } },
          units: [{ uid: seat + 1, chessId: `chess_kazdel_ascalon_${seat ? 'b' : 'a'}`, row: 10, col: 5 + seat, moduleId: 'none' }],
        })), flags: { autoFinish: false }, spawns: [] });
      const node = exercise(createBattleFromSpec(spec, ds), cannonSource, tickCannon);
      const web = await page.evaluate(async ({ spec, body }) => {
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec: S, ds } = await loadBrowserSim();
        const C = await import('/sim/content/kazdel/cannon.js');
        return (0, eval)(`(${body})`)(S.createBattleFromSpec(spec, ds), C.cannonSource, C.tickCannon);
      }, { spec, body: exercise.toString() });
      assert.deepEqual(node.hit, [800, 0, 800]);
      assert.deepEqual(node.errors, []);
      assert.deepEqual(web, JSON.parse(JSON.stringify(node)), `${kind}/${count}`);
      assert.deepEqual(node.layers, kind === 'normal' ? [1, 2] : [0, 0]);
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});

function exerciseEquipment(b) {
  b.start();
  const [owner, other] = b.allyUnits;
  for (const u of b.allyUnits) u.profile.noAttack = true;
  const e = b.spawnEnemy('enemy_1000_gopro', { pos: [10, 8] });
  e.base.maxHp = 1e8; e.hp = 1e8; e.base.atk = 0; e.base.moveSpeed = 0; e.markDirty();
  b.kill(owner); b.kill(other);
  const souls = [owner.kazdelSoulUnit, other.kazdelSoulUnit];
  for (const u of souls) u.profile.noAttack = true;
  const hit = souls.map(u => b.dealDamage(u, e, { amount: 100, type: 'true' }));
  const before = souls.map(u => [u.s.maxHp, u.s.atk]);
  for (let i = 0; i < 60; i++) b.step();
  return { hit, before, after: souls.map(u => [u.s.maxHp, u.s.atk]), stages: b.snapshot().kazdel.map(s => s.stage), errors: b.errors };
}

test('Kazdel equipment generated data, inheritance and owner-only combo agree in Node/Chromium in all fields', {
  skip: enabled ? false : 'set SIM_E2E=1 and CHROME_PATH (no art required)', timeout: 90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const ds = new DataSource(getData({ log: { warn() {}, error() {}, info() {} } }));
    for (const kind of ['normal', 'unite', 'boss', 'hidden']) for (const q of ['a', 'b']) {
      const spec = buildBattleSpec({ fieldId: `equipment:${kind}`, kind, seed: 418, stageId: 'act2autochess_m01',
        rect: { r0: 0, r1: 18, c0: 0, c1: 20 }, timeLimit: 30, players: ['p1', 'p2'].map((playerId, seat) => ({
          playerId, seat, coords: 'field', bonds: { kazdelShip: { active: true, count: 9, layers: 100 } },
          units: [{ uid: seat + 1, chessId: 'chess_kazdel_ascalon_a', row: 10, col: 5 + seat, moduleId: 'none',
            items: [`chess_item_kazdel_blade_${q}`, ...(seat ? [] : [`chess_item_kazdel_sigil_${q}`])] }],
        })), flags: { autoFinish: false }, spawns: [] });
      const node = exerciseEquipment(createBattleFromSpec(spec, ds));
      const web = await page.evaluate(async ({ spec, body }) => {
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec: S, ds } = await loadBrowserSim();
        return (0, eval)(`(${body})`)(S.createBattleFromSpec(spec, ds));
      }, { spec, body: exerciseEquipment.toString() });
      assert.deepEqual(node.hit, [135, 120]); assert.deepEqual(node.stages, [2, 2]);
      assert.deepEqual(node.before, node.after); assert.deepEqual(node.errors, []);
      assert.deepEqual(web, JSON.parse(JSON.stringify(node)), `${kind}/${q}`);
    }
    const footprint = await page.evaluate(async () => {
      const { cannonTiles } = await import('/js/render/fx/kazdel.js');
      const { cannonKeys } = await import('/sim/content/kazdel/cannon.js');
      return [undefined, { r0: 10, r1: 12, c0: 5, c1: 10 }].map(bounds => {
        const tiles = cannonTiles(5, 10, bounds), keys = [...cannonKeys(5, 10, bounds)];
        return { tiles: tiles.map(([r, c]) => r * 21 + c), keys };
      });
    });
    for (const f of footprint) assert.deepEqual(f.tiles, f.keys);
    assert.deepEqual(footprint.map(f => f.keys.length), [21, 8]);
  } finally { await browser?.close(); await srv.close(); }
});
