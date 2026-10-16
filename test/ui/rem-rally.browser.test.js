// The production GameScreen stays usable without the retired rally control, including stale private metadata.
// This narrow UI check uses only the supported 2D board; it is not a 3D initialization/reload test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { startServer } from '../../server/index.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SP_E2E === '1' && existsSync(chrome);
test('real 2D game UI omits the retired rally control in prep, combat and shared fields', { skip: !enabled, timeout: 90000 }, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const evidence = { checks: [] };
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?phase=PREP&board=2d&render=engine&shot=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__MOCK__ && window.__SP_VIEW__?.kind === 'engine' && window.__SP_VIEW__?.raw?.stats, { timeout: 30000 });
    for (const [phase, variant] of [['PREP', ''], ['COMBAT', ''], ['UNITE', ''], ['PREP', 'bossR']]) {
      await page.evaluate(async (phase, variant) => {
        const { data } = await import('/js/data.js');
        window.__MOCK__.setPhase(phase, variant);
        const members = data.list('chess').filter(c => c.visible && !c.isGolden && c.bonds?.includes('remShip')).slice(0, 3);
        if (members.length !== 3) throw new Error('three real Rem operators required');
        window.__MOCK__.mutate(s => {
          s.priv.board = s.priv.board.map((p, i) => i < 3 ? { ...p, id: members[i].chessId, golden: false } : p);
          // A cached old private frame must never bring the removed panel back.
          s.priv.remRally = { row: 10, col: 4 };
        });
      }, phase, variant);
      await page.waitForSelector('.bslot[data-bond="remShip"]');
      const sample = await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const { actions } = await import('/js/ui/gameActions.js');
        const mock = window.__MOCK__, view = window.__SP_VIEW__;
        return {
          phase: mock.S().pub.phase,
          remCount: mock.S().priv.bonds.find(b => b.bondId === 'remShip')?.count,
          oldMetadataPresent: !!mock.store.get().match.private?.remRally,
          rallyControls: document.querySelectorAll('.rem-rally, [data-testid^="rem-rally"]').length,
          rallyAction: Object.hasOwn(actions, 'remRally'),
          rallyHighlight: view.raw.debug.tiles.highlights.has('remRally'),
          kind: view.kind,
          board3dOn: view.raw.stats().board3d.on,
          canvas: !!view.raw.debug.app.view.isConnected,
          sentRallyCommands: mock.S().requests.filter(([t]) => t === 'g.remRally').length,
        };
      });
      assert.equal(sample.phase, phase);
      assert.ok(sample.remCount >= 3, 'the real Rem bond is shown, so the old conditional UI would have been enabled');
      assert.equal(sample.oldMetadataPresent, true, 'exercise a stale private frame');
      assert.equal(sample.rallyControls, 0);
      assert.equal(sample.rallyAction, false);
      assert.equal(sample.rallyHighlight, false);
      assert.equal(sample.kind, 'engine');
      assert.equal(sample.board3dOn, false);
      assert.equal(sample.canvas, true);
      assert.equal(sample.sentRallyCommands, 0);
      evidence.checks.push({ variant, ...sample });
    }
    mkdirSync('test/e2e/out', { recursive: true });
    await page.screenshot({ path: 'test/e2e/out/rem-no-rally-2d.png' });
    evidence.errors = errors;
    writeFileSync('test/e2e/out/rem-no-rally-2d-evidence.json', JSON.stringify(evidence, null, 2));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await srv.close(); }
});
