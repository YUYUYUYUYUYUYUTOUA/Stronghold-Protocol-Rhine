// SP_E2E=1, run this file alone. Requires a listening socket and headless Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';
const enabled = process.env.SP_E2E === '1' && hasChrome();
/** Resolve once `file` exists (a finished download: Chrome writes to a .crdownload name until then). */
async function waitForFile(file, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (fs.existsSync(file)) return;
  assert.fail(`no download ${path.basename(file)}`);
}

test('operator wizard -> borrowed official kit -> saved attributes -> trial -> game-renderer replay and comparison', { skip: !enabled, timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gameplay-e2e-'));
  const { startServer } = await import('../../server/index.js');
  const serverLog = [], requests = [], responses = [], inputEvents = [], requestFailures = [];
  const bounded = (list, value) => { list.push(value); if (list.length > 80) list.shift(); };
  const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => bounded(serverLog,
    { at: Date.now(), level, text: args.map(value => value instanceof Error ? value.stack : String(value)).join(' ')
      .replace(/([#?&]key=)[A-Za-z0-9_-]+/g, '$1[redacted]').slice(0, 2000) })]));
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, log, pluginsDir: path.join(tmp, 'plugins'), assetIndex: false });
  const P = (await import('puppeteer-core')).default;
  let browser, page, pluginId, stage = 'boot';
  const errors = [];
  try {
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--mute-audio'] });
    page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => {
      if (!message.text().startsWith('[studio-operator-input] ')) return;
      try { bounded(inputEvents, JSON.parse(message.text().slice('[studio-operator-input] '.length))); } catch { /* Passive diagnostic only. */ }
    });
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith('/studio/api/')) return;
      let draft;
      if (request.method() === 'POST' && pathname.endsWith('/authoring')) {
        try { const body = JSON.parse(request.postData()); draft = { template: body.template, revision: body.revision,
          normalAtk: body.options?.normal?.atk, kitRef: body.options?.kitRef }; } catch { /* Preserve other request evidence. */ }
      }
      bounded(requests, { at: Date.now(), path: pathname, method: request.method(), draft });
    });
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/studio/api/')) bounded(responses, { at: Date.now(), path: pathname, status: response.status() });
    });
    page.on('requestfailed', request => bounded(requestFailures,
      { at: Date.now(), path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
    // the pack button downloads the zip: into this test's folder, never the user's Downloads (and a download left
    // waiting for a prompt would keep Chrome from closing)
    const downloads = path.join(tmp, 'downloads'); fs.mkdirSync(downloads);
    await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__studio?.ready);
    stage = 'create-operator';
    await page.click('[data-testid="new-plugin"]'); await page.click('[data-template="operator"]');
    await page.type('[data-testid="target-search"]', '德克萨斯');
    await page.waitForSelector('[data-target="operator:char_102_texas"]'); await page.click('[data-target="operator:char_102_texas"]');
    await page.waitForFunction(() => /^[a-z0-9][a-z0-9-]{1,31}$/.test(document.querySelector('[data-testid="create-id"]')?.value || ''));
    await page.click('[data-testid="create-confirm"]');
    await page.waitForSelector('[data-testid="operator-wizard"]');
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="operator-wizard"] details[open] .st-stat-grid label:nth-child(2) input')?.value) > 0);
    const made = await page.evaluate(() => globalThis.__studio.state);
    pluginId = made.id;
    assert.equal(made.check.ok, true);
    const record = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', made.id, 'data/operator.json')));
    assert.equal(record.kit.ref, 'chess_char_1_08_a');
    assert.match(record.charId, /^char_x_/);
    const atk = '[data-testid="operator-wizard"] details[open] .st-stat-grid label:nth-child(2) input';
    stage = 'edit-attack';
    await page.evaluate(atk => {
      for (const type of ['input', 'change', 'blur', 'pointerdown', 'click']) document.addEventListener(type, event => {
        const attack = document.querySelector(atk), button = document.querySelector('[data-testid="save-wizard"]');
        if (event.target !== attack && !button?.contains(event.target)) return;
        console.log('[studio-operator-input] ' + JSON.stringify({ at: performance.now(), date: Date.now(), type,
          trusted: event.isTrusted, target: event.target === attack ? 'attack' : 'save-wizard',
          attack: attack?.value, saveDisabled: button?.disabled }));
      }, { capture: true, passive: true });
    }, atk);
    await page.waitForSelector(atk); await page.click(atk, { count: 3 }); await page.type(atk, '900');
    // page.click does not wait for a disabled button. Keep readiness, the one real click and the original saved-state
    // assertion inside the same 30s budget; do not spend a second deadline retrying a missed click.
    const saveDeadline = Date.now() + 30000;
    const saveRemaining = () => Math.max(1, saveDeadline - Date.now());
    stage = 'save-attack';
    await page.$eval('[data-testid="save-wizard"]', button => button.scrollIntoView({ block: 'center' }));
    const ready = await page.waitForFunction(atk => {
      const input = document.querySelector(atk), button = document.querySelector('[data-testid="save-wizard"]');
      if (!input || input.value !== '900' || !button || button.disabled) return false;
      const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && button.contains(hit)
        ? { attack: input.value, saveDisabled: button.disabled, hit: hit.dataset.testid || hit.className, x, y } : false;
    }, { timeout: saveRemaining() }, atk);
    console.log('Studio operator save ready:', JSON.stringify(await ready.jsonValue()));
    await ready.dispose();
    await page.click('[data-testid="save-wizard"]');
    await page.waitForFunction(() => globalThis.__studio?.state?.authoring?.options?.normal?.atk === 900, { timeout: saveRemaining() });
    const saves = requests.filter(request => request.method === 'POST' && request.path === `/studio/api/plugins/${made.id}/authoring`);
    assert.equal(saves.length, 1, 'one actual wizard save request');
    assert.equal(saves[0].draft.normalAtk, 900, 'the real UI submitted its complete attack draft');
    const savedRecord = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', made.id, 'data/operator.json')));
    assert.equal(savedRecord.forms.normal.stats.atk, 900);
    assert.equal(savedRecord.kit.ref, record.kit.ref, 'saving attributes retains the borrowed official kit');
    console.log('Studio operator saved:', JSON.stringify({ inputEvents, saves, responses: responses.filter(response => response.path.endsWith('/authoring')),
      attack: savedRecord.forms.normal.stats.atk, kit: savedRecord.kit }));
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-operator.png'), fullPage: true });
    stage = 'trial-and-replay';
    await page.click('[data-tab="trial"]'); await page.click('[data-testid="run-trial"]');
    await page.waitForSelector('[data-testid="trial-comparison"]', { timeout: 45000 });
    const result = await page.evaluate(() => globalThis.__studio.trial);
    assert.equal(result.ok, true); assert.ok(result.plugin.damage > result.vanilla.damage);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="trial-replay"]')].filter(e => e.dataset.ready === 'true').length === 2, { timeout: 45000 });
    // the game renderer: a three.js board canvas under the Pixi canvas in each of the two replays
    assert.equal(await page.$$eval('[data-testid="trial-replay"]', els => els.filter(e => e.querySelector('canvas')).length), 2);
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-trial.png'), fullPage: true });
    await page.click('[data-testid="replay-trial"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="trial-replay"]')].every(e => e.dataset.ready === 'true'));
    await page.click('[data-testid="pack"]');
    stage = 'pack';
    await page.waitForSelector('[data-testid="pack-result"].is-ok');
    assert.ok(fs.existsSync(path.join(tmp, 'plugins', made.id, 'plugin.lock.json')));
    await waitForFile(path.join(downloads, `${made.id}-1.0.0.zip`));
    const zip = await page.evaluate(async id => {
      const r = await fetch(`/studio/api/plugins/${id}/zip`); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
    }, made.id);
    assert.equal(zip.status, 200); assert.ok(zip.bytes > 100);
    // The UI wizard also uses the real game's frame host with fake data and opaque origin.
    const ui = await page.evaluate(async () => {
      const api = await import('/studio/js/api.js');
      return api.post('plugins', { template: 'ui', id: 'preview-widget', name: 'Preview', options: { slot: 'room.panel', title: 'Preview' } });
    });
    assert.equal(ui.check.ok, true);
    stage = 'ui-frame';
    await page.goto(srv.studio.pageUrl(srv.url).replace('/studio/#', '/studio/?plugin=preview-widget#'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="ui-sandbox-preview"] iframe');
    assert.equal(await page.$eval('[data-testid="ui-sandbox-preview"] iframe', e => e.getAttribute('sandbox')), 'allow-scripts');
    // every message the host posts, by type: the frame answers each demo battle with a storage write, so the last
    // message is usually the storage reply, not the battle
    await page.waitForFunction(() => !!globalThis.__SP_UI_PLUGINS__);
    await page.evaluate(() => {
      const api = globalThis.__SP_UI_PLUGINS__; let last = api.last; api.posted = [];
      Object.defineProperty(api, 'last', { configurable: true, get: () => last, set: m => { last = m; if (m?.t) api.posted.push(m.t); } });
    });
    await page.waitForFunction(() => globalThis.__SP_UI_PLUGINS__.posted.includes('battle'), { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-widget.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) {
    let disk;
    try {
      const record = pluginId && JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', pluginId, 'data/operator.json')));
      disk = record && { charId: record.charId, kit: record.kit, normal: record.forms?.normal?.stats };
    } catch (failure) { disk = { diagnosticError: failure.message }; }
    console.log('Studio operator failure:', JSON.stringify({ stage, error: String(error.stack || error), serverLog,
      requests, responses, inputEvents, requestFailures, errors, disk }));
    let timer;
    try {
      const ui = page && await Promise.race([page.evaluate(() => {
        const state = globalThis.__studio?.state, input = document.querySelector('[data-testid="operator-wizard"] details[open] .st-stat-grid label:nth-child(2) input');
        const button = document.querySelector('[data-testid="save-wizard"]'), rect = button?.getBoundingClientRect();
        const hit = rect && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { state: state && { id: state.id, authoring: state.authoring, check: state.check }, hooksErrors: globalThis.__studio?.errors,
          input: input && { value: input.value, badInput: input.validity.badInput, focused: input === document.activeElement },
          save: button && { disabled: button.disabled, rect: rect.toJSON(), hit: hit && { tag: hit.tagName, testid: hit.dataset.testid, className: hit.className } },
          authoringError: document.querySelector('[data-testid="authoring-error"]')?.textContent,
          modal: document.querySelector('.modal')?.textContent?.slice(0, 1000), scrollY, width: innerWidth, height: innerHeight };
      }), new Promise(resolve => { timer = setTimeout(() => resolve({ diagnosticTimeoutMs: 5000 }), 5000); })]);
      console.log('Studio operator UI failure:', JSON.stringify(ui));
    } catch (failure) { console.log('Studio operator UI failure:', JSON.stringify({ diagnosticError: failure.message })); }
    finally { clearTimeout(timer); }
    throw error;
  } finally { await browser?.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});


test('DSL wizard edits a compact operator, refuses failed validation, then runs and packs a real replay', { skip: !enabled, timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dsl-e2e-'));
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: path.join(tmp, 'plugins'), assetIndex: false });
  let browser;
  try {
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
    const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 1000 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const downloads = path.join(tmp, 'downloads'); fs.mkdirSync(downloads);
    await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await page.goto(srv.studio.pageUrl(srv.url), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__studio?.ready);
    await page.click('[data-testid="new-plugin"]'); await page.click('[data-template="dsl"]');
    await page.waitForFunction(() => /^[a-z0-9][a-z0-9-]{1,31}$/.test(document.querySelector('[data-testid="create-id"]')?.value || ''));
    await page.click('[data-testid="create-confirm"]');
    await page.waitForSelector('[data-testid="dsl-validation"].is-ok');
    const made = await page.evaluate(() => globalThis.__studio.state);
    const refuse = r => { if (r.url().endsWith('/studio/api/validate-dsl')) r.abort('failed'); else r.continue(); };
    await page.setRequestInterception(true);
    page.on('request', refuse);
    const value = '[data-testid="dsl-form"] .st-dsl-mods input[type="number"]';
    await page.click(value, { count: 3 }); await page.type(value, '0.75');
    await page.waitForFunction(() => document.querySelector('[data-testid="dsl-validation"]')?.textContent.includes('校验未完成'));
    await page.click('[data-testid="save-wizard"]');
    await page.waitForSelector('[data-testid="authoring-error"]');
    assert.equal(await page.evaluate(() => globalThis.__studio.state.authoring.revision), made.authoring.revision);
    page.off('request', refuse); await page.setRequestInterception(false);
    await page.click('[data-testid="save-wizard"]');
    await page.waitForFunction(() => globalThis.__studio.state.authoring.options.dsl?.skill.mods.atkPct === 0.75);
    await page.waitForSelector('[data-testid="dsl-validation"].is-ok');
    const saved = await page.evaluate(() => globalThis.__studio.state);
    const op = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', made.id, saved.manifest.operators[0])));
    assert.equal(op.kit.dsl.skill.mods.atkPct, 0.75); assert.ok(saved.manifest.dsl.length);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'studio-gameplay-dsl.png'), fullPage: true });
    await page.click('[data-tab="trial"]'); await page.click('[data-testid="run-trial"]');
    await page.waitForSelector('[data-testid="trial-comparison"]', { timeout: 45000 });
    const result = await page.evaluate(() => globalThis.__studio.trial);
    assert.equal(result.ok, true); assert.deepEqual(result.plugin.errors, []); assert.ok(result.plugin.damage > 0);
    assert.match(result.plugin.units[0].defId, /chess_x_.*_caster_a/);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="trial-replay"]')].filter(e => e.dataset.ready === 'true').length === 2, { timeout: 45000 });
    await page.click('[data-testid="pack"]'); await page.waitForSelector('[data-testid="pack-result"].is-ok');
    assert.ok(fs.existsSync(path.join(tmp, 'plugins', made.id, 'plugin.lock.json')));
    await waitForFile(path.join(downloads, `${made.id}-1.0.0.zip`));
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
