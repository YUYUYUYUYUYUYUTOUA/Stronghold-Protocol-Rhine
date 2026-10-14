// SIM_E2E=1 CHROME_PATH=/usr/bin/chromium node --test test/sim/rhine.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
const chrome = process.env.CHROME_PATH;
const enabled = process.env.SIM_E2E === '1' && chrome && existsSync(chrome);
function exercise(b) {
  b.start();
  const enemy = b.spawnEnemy('enemy_1000_gopro', { pos: [10, 8] });
  enemy.base.maxHp = 1e8; enemy.hp = 1e8; enemy.base.atk = 0; enemy.base.moveSpeed = 0; enemy.markDirty();
  b.step();
  const drones = b.allyUnits.filter(u => u.defId === 'token_10005_mgllan_drone3');
  const owners = b.allyUnits.filter(u => u.kind === 'op');
  const opening = drones.map(u => ({ alive: u.alive, owner: u.ownerId, bonus: u.findBuff('rhine:magallan')?.mods.atkFlat }));
  for (const u of owners) { u.skill.addCharge(1); u.skill.activate('test'); }
  for (let i = 0; i < 60; i++) b.step();
  const active = drones.map(u => ({ alive: u.alive, atk: u.s.atk, native: u.findBuff('mgllan:s3:drone')?.mods.atkPct,
    bonus: u.findBuff('rhine:magallan')?.mods.atkFlat }));
  b.getPlayer('p1').bonds.rhineShip.layers = 200; b.step();
  const changed = drones.map(u => u.findBuff('rhine:magallan')?.mods.atkFlat);
  b.retreat(owners[0]); b.step();
  return { opening, active, changed, afterRetreat: drones.map(u => u.alive), errors: b.errors, result: b.result() };
}
test('fixed Magallan native drones, layers and ownership agree in Chromium and Node', {
  skip: enabled ? false : 'set SIM_E2E=1 and CHROME_PATH (no art required)', timeout: 90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run', '--no-sandbox'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const ds = new DataSource(getData({ log: { warn() {}, error() {}, info() {} } }));
    for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
      const spec = buildBattleSpec({ fieldId: `rhine:${kind}`, kind, seed: 717, stageId: 'act2autochess_m01',
        rect: { r0: 0, r1: 18, c0: 0, c1: 20 }, timeLimit: 30,
        players: ['p1', 'p2'].map((playerId, seat) => ({ playerId, seat, coords: 'field',
          bonds: { rhineShip: { active: true, count: 6, layers: 100 } },
          units: [{ uid: 1, chessId: `chess_rhine_magallan_${seat ? 'b' : 'a'}`, row: 10 + seat, col: 4, skillIndex: 2, moduleId: 'none' },
            { uid: 2, kind: 'token', tokenId: 'token_10005_mgllan_drone3', ownerUid: 1, row: 10 + seat, col: 6 }],
        })), flags: { autoFinish: false, dpInit: 99, dpPerSec: 0 }, spawns: [] });
      const node = exercise(createBattleFromSpec(spec, ds));
      const web = await page.evaluate(async ({ spec, body }) => {
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec: S, ds } = await loadBrowserSim();
        return (0, eval)(`(${body})`)(S.createBattleFromSpec(spec, ds));
      }, { spec, body: exercise.toString() });
      assert.deepEqual(node.opening, [{ alive: true, owner: 'p1', bonus: 100 }, { alive: true, owner: 'p2', bonus: 200 }]);
      assert.ok(node.active.every(u => u.alive && u.native > 0));
      assert.deepEqual(node.changed, [200, 200]);
      assert.deepEqual(node.afterRetreat, [false, true]);
      assert.deepEqual(node.errors, []);
      assert.deepEqual(web, JSON.parse(JSON.stringify(node)), kind);
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});
