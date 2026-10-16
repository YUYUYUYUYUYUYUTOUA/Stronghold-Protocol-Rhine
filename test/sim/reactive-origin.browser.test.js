// SIM_E2E=1 CHROME_PATH=/usr/bin/chromium node --test test/sim/reactive-origin.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SIM_E2E === '1' && chrome && existsSync(chrome);
function exercise(b, pair) {
  b.start();
  const [u, v] = b.allyUnits;
  for (const a of b.allyUnits) { a.base.maxHp = 1e8; a.hp = 1e8 - 1000; a.markDirty(); a.profile.noAttack = true; }
  const active = pair === 'vendla' ? v : pair === 'bubble' ? u : null;
  if (active) {
    if (v) { v.base.maxHp = 10000; v.hp = 9000; v.markDirty(); }
    active.skill.sp = active.skill.spCost; active.skill.charges = Math.max(1, active.skill.charges);
    active.skill.activate('manual');
  }
  const enemy = b.spawnEnemy(pair === 'bubble' ? 'enemy_9018_actrpa' : 'enemy_9023_acdums', { pos: [10, 5], mods: { hpMul: 100, speedMul: 0 } });
  const damage = [], heals = [];
  b.on('damaged', c => damage.push({ source: c.source?.id ?? null, target: c.target.id, amount: c.amount, type: c.type, tags: c.dmg?.tags ?? [] }));
  b.on('heal', c => heals.push({ source: c.source?.id ?? null, target: c.target.id, amount: c.amount }));
  for (let i = 0; i < 2; i++) b.dealDamage(u, enemy, { amount: 1, type: pair === 'bubble' ? 'phys' : 'true' });
  for (let i = 0; i < 91; i++) b.step();
  const snapshot = b.snapshot();
  b.forceEnd();
  return { damage, heals, snapshot, events: b.drainEvents(), errors: b.errors, result: b.result() };
}

test('reactive damage origins agree in Chromium and Node for Mlynar, Vendla and Bubble in every field kind', {
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
    for (const kind of ['normal', 'unite', 'boss', 'hidden']) for (const pair of ['mlynar', 'vendla', 'bubble']) {
      const ids = pair === 'vendla' ? ['chess_char_6_05_a', 'chess_char_1_06_a'] : [pair === 'bubble' ? 'chess_char_2_08_a' : 'chess_char_5_19_a'];
      const spec = buildBattleSpec({ fieldId: `reactive:${kind}:${pair}`, kind, seed: 731, stageId: 'act2autochess_m01',
        rect: { r0: 0, r1: 18, c0: 0, c1: 20 }, timeLimit: 30,
        players: [{ playerId: 'p1', seat: 0, coords: 'field', units: ids.map((chessId, i) => ({ uid: i + 1, chessId, row: 10, col: 5 - i })) }],
        flags: { autoFinish: false, startOpCooldown: 0 }, spawns: [] });
      const node = exercise(createBattleFromSpec(spec, ds), pair);
      const battle = await page.evaluateHandle(async spec => {
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec: S, ds } = await loadBrowserSim();
        return S.createBattleFromSpec(spec, ds);
      }, spec);
      const web = await page.evaluate(exercise, battle, pair);
      await battle.dispose();
      assert.deepEqual(node.errors, [], `${kind}/${pair}`);
      assert.ok(node.damage.some(c => c.tags.includes(pair === 'mlynar' ? 'reflect' : 'counter')), 'fixture exercises reactive chain');
      assert.deepEqual(web, JSON.parse(JSON.stringify(node)), `${kind}/${pair}`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});
