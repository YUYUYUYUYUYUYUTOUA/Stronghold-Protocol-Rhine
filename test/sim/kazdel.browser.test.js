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
  const ps = b.getPlayer('p1'), stage = ps.bonds.kazdelShip.count === 9 ? 3 : 2;
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
      assert.deepEqual(node.hit, [count === 6 ? 400 : 0, 0, 800]);
      assert.deepEqual(node.errors, []);
      assert.deepEqual(web, JSON.parse(JSON.stringify(node)), `${kind}/${count}`);
      assert.deepEqual(node.layers, kind === 'normal' ? [1, 2] : [0, 0]);
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});
