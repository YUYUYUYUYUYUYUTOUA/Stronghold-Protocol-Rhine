import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SP_E2E === '1' && existsSync(chrome);
test('rally component selects a legal tile and becomes read-only during combat', { skip: !enabled }, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${srv.port}/healthz`);
    await page.evaluate(async () => {
      const { render, h } = await import('/vendor/preact.module.js');
      const { RemRally } = await import('/js/ui/remRally.js');
      document.body.innerHTML = '<main id="test"></main>';
      const props = { enabled: true, editable: true, point: null,
        placeCtx: { deploy: { melee: new Set(['10,4']) } },
        view: { highlightTiles(tiles) { window.tiles = tiles; }, tileScreen(r,c) {
          return r === 10 && c === 4 ? { poly: [[400,400],[440,400],[440,440],[400,440]] } : null;
        } }, onSet(row,col) { window.selection = { row,col }; } };
      window.mountRally = editable => render(h(RemRally, { ...props, editable }), document.querySelector('#test'));
      window.mountRally(true);
    });
    await page.waitForSelector('.rem-rally button');
    await page.click('.rem-rally button');
    await page.waitForFunction('window.tiles?.length === 1');
    await page.mouse.click(420,420);
    await page.waitForFunction('window.selection?.row === 10');
    assert.deepEqual(await page.evaluate(() => window.selection), { row:10, col:4 });
    await page.evaluate(() => window.mountRally(false));
    assert.equal(await page.$eval('.rem-rally button', e => e.disabled), true);
    if (existsSync('public/assets/bond/rem.png')) {
      assert.equal(await page.$eval('.rem-rally img', async e => { await e.decode(); return e.naturalWidth > 0; }), true);
      mkdirSync('test/e2e/out', { recursive:true });
      await page.screenshot({ path:'test/e2e/out/rem-rally-original-icon.png' });
    }
  } finally { await browser.close(); await srv.close(); }
});
