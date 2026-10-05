// Opt-in: SP_E2E=1 node --test test/ui/data-profile.browser.test.js
// Isolated browser hooks with deferred fetches: no game session or production data is changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);

test('mounted browser data hooks switch profiles, keep old in-flight work isolated and refresh memoized lookups when returning to a cached profile',
  { skip: !enabled && 'set SP_E2E=1 (needs Chrome)', timeout: 30000 }, async () => {
    const srv = createServer((req, res) => {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body><div id="app"></div>'); return; }
      const url = new URL(req.url, 'http://localhost');
      const file = path.resolve(ROOT, url.pathname.startsWith('/shared/') ? `.${url.pathname}` : `public${url.pathname}`);
      if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/plain');
      res.end(readFileSync(file));
    });
    await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      const puppeteer = (await import('puppeteer-core')).default;
      browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-sandbox'] });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(`http://127.0.0.1:${srv.address().port}/`);
      await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const { useGameData } = await import('/js/ui/gameComponents.js');
        const { render, h } = await import('/vendor/preact.module.js');
        const calls = [], waiting = new Map();
        globalThis.fetch = url => {
          calls.push(url);
          return new Promise(resolve => waiting.set(url, resolve));
        };
        function Panel({ id }) {
          const gd = useGameData();
          return h('output', { id }, gd.ready ? `${gd.config.profile}:${gd.chess('chess_test_a').tier}:${gd.chess('chess_rhine_a') ? 'extra' : 'original'}` : 'loading');
        }
        render(h('div', null, h(Panel, { id: 'a' }), h(Panel, { id: 'b' })), document.getElementById('app'));
        globalThis.__profileHarness = { data, calls,
          finish(prefix, profile, tier) {
            for (const [url, resolve] of waiting) {
              if (prefix === '/data/' ? url.includes('/vanilla/') : !url.startsWith(prefix)) continue;
              const name = url.split('/').pop();
              const body = name === 'chess.json' ? {
                chess_test_a: { chessId: 'chess_test_a', tier },
                ...(profile === 'rhine' ? { chess_rhine_a: { chessId: 'chess_rhine_a', tier: 5 } } : {}),
              } : { profile };
              resolve({ ok: true, status: 200, json: async () => body });
              waiting.delete(url);
            }
          },
        };
      });
      await page.waitForFunction(() => globalThis.__profileHarness.calls.includes('/data/chess.json'));
      await page.evaluate(() => globalThis.__profileHarness.data.selectProfile(false));
      await page.waitForFunction(() => globalThis.__profileHarness.calls.includes('/data/vanilla/chess.json'));
      await page.evaluate(() => globalThis.__profileHarness.finish('/data/', 'rhine', 3));
      assert.deepEqual(await page.$$eval('output', rows => rows.map(row => row.textContent)), ['loading', 'loading']);
      await page.evaluate(() => globalThis.__profileHarness.finish('/data/vanilla/', 'vanilla', 2));
      await page.waitForFunction(() => document.getElementById('a').textContent === 'vanilla:2:original');
      const count = await page.evaluate(() => globalThis.__profileHarness.calls.length);
      await page.evaluate(() => globalThis.__profileHarness.data.selectProfile(true));
      await page.waitForFunction(() => document.getElementById('a').textContent === 'rhine:3:extra');
      assert.deepEqual(await page.$$eval('output', rows => rows.map(row => row.textContent)), ['rhine:3:extra', 'rhine:3:extra']);
      const calls = await page.evaluate(() => globalThis.__profileHarness.calls);
      assert.equal(calls.length, count, 'the cached profile is reused');
      assert.equal(calls.filter(url => url === '/data/chess.json').length, 1, 'two hooks share their download');
      assert.equal(calls.filter(url => url === '/data/vanilla/chess.json').length, 1);
      assert.equal(calls.filter(url => url === '/data/assets.json').length, 1, 'art is shared across profiles');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise(resolve => srv.close(resolve));
    }
  });
