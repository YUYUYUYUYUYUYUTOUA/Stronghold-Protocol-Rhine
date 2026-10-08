// Real Chromium checks of the game selection/placement path and the rendered charge/attack cues.
// Opt-in: RENDER_E2E=1 CHROME_PATH=<browser> node --test test/render/rhineDevices.browser.test.js
// This starts only a temporary loopback server, closes it on completion, and writes screenshots to test/e2e/out.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXTERNAL_BASE = process.env.RHINE_E2E_BASE_URL;
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));

describe('Rhine grid ranges, charge gauge and pulse cues in Chromium', { skip: enabled ? false : 'set RENDER_E2E=1 with Chrome and downloaded assets' }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    if (!EXTERNAL_BASE) { const { startServer } = await import('../../server/index.js'); srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true }); }
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open(url, hook) {
    const page = await browser.newPage(), problems = [];
    page.on('pageerror', e => problems.push(e.message));
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(`${EXTERNAL_BASE || `http://127.0.0.1:${srv.port}`}/${url}`);
    await page.waitForFunction(hook, { timeout: 40000 });
    return { page, problems };
  }

  test('actual game clicks show full selected grid tiles; arming a device shows the same clipped placement preview', async () => {
    const { page, problems } = await open('dev/game-mock.html?phase=PREP&variant=rhineRange&board=2d&shot=1',
      'window.__MOCK__ && window.__SP_VIEW__ && window.__SP_VIEW__.raw?.debug?.views.get("p:900")');
    try {
      const pos = await page.evaluate(() => window.__SP_VIEW__.tileScreen(10, 6));
      await page.mouse.click(pos.x, pos.y);
      await page.waitForFunction('window.__SP_VIEW__.raw.debug.tiles.highlights.get("selRange")');
      const selected = await page.evaluate(async () => {
        const { researchRangeTiles } = await import('/shared/rhineRange.js');
        const h = window.__SP_VIEW__.raw.debug.tiles.highlights.get('selRange');
        return { circle: !!h.circle, color: h.style.color, stripes: h.style.stripes,
          tiles: h.tiles, expected: researchRangeTiles(10, 6, 3) };
      });
      assert.equal(selected.circle, false);
      assert.equal(selected.color, 0xff9c33);
      assert.equal(selected.stripes, true);
      assert.deepEqual(selected.tiles.sort(), selected.expected.sort());
      await page.screenshot({ path: path.join(OUT, 'rhine-grid-selected.png') });
      await page.click('[data-research="energy"] .rhine-card__select');
      await page.waitForFunction('window.__SP_VIEW__.raw.debug.tiles.highlights.get("research")');
      const target = await page.evaluate(() => {
        const v = window.__SP_VIEW__, [row, col] = v.raw.debug.tiles.highlights.get('research').tiles.at(-1);
        return { ...v.tileScreen(row, col), row, col };
      });
      await page.mouse.move(target.x, target.y);
      await page.waitForFunction('window.__SP_VIEW__.raw.debug.tiles.highlights.get("researchPreview")');
      const preview = await page.evaluate(async ({ row, col }) => {
        const { researchRangeTiles } = await import('/shared/rhineRange.js');
        const h = window.__SP_VIEW__.raw.debug.tiles.highlights.get('researchPreview');
        return { circle: !!h.circle, tiles: h.tiles, expected: researchRangeTiles(row, col, 3) };
      }, target);
      assert.equal(preview.circle, false);
      assert.deepEqual(preview.tiles.sort(), preview.expected.sort());
      await page.screenshot({ path: path.join(OUT, 'rhine-grid-placement.png') });
      await page.keyboard.press('Escape');
      await page.waitForFunction('!window.__SP_VIEW__.raw.debug.tiles.highlights.has("researchPreview")');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('boss left/right mirrors preserve complete range cells, including valid lower battle cells', async () => {
    const { page, problems } = await open('dev/render-demo.html?scene=prep&paused=1&board=2d&panel=0',
      'window.__demo?.ready');
    try {
      const mapped = await page.evaluate(async () => {
        const { showRange } = await import('/js/ui/facingWheel.js');
        const { researchRange, researchRangeTiles } = await import('/shared/rhineRange.js');
        const { GEO } = await import('/shared/constants.js');
        const v = window.__demo.view, grid = researchRange({ id: 'token_rhine_medical', stage: 2 }).grid;
        const out = [];
        for (const side of ['L', 'R']) {
          v.setCamera('bossPrep', { side, instant: true });
          showRange(v, grid, 10, 6, 'LEFT', { group: 'selRange' }, 3);
          const h = v.debug.tiles.highlights.get('selRange');
          out.push({ tiles: h.tiles, circle: !!h.circle, expected: researchRangeTiles(3, side === 'L' ? 6 : 14, 3, GEO.BOSS_RECT) });
        }
        return out;
      });
      for (const m of mapped) { assert.equal(m.circle, false); assert.deepEqual(m.tiles.sort(), m.expected.sort()); }
      assert.ok(mapped[1].tiles.some(([r]) => r === 0));
      await page.screenshot({ path: path.join(OUT, 'rhine-grid-boss-right.png') });
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('network snapshots drive the under-device gauge, and low quality retains the firing beam and hit', async () => {
    const { page, problems } = await open('dev/render-demo.html?scene=prep&paused=1&board=2d&quality=low&panel=0',
      'window.__demo?.ready');
    try {
      await page.evaluate(() => {
        const v = window.__demo.view;
        v.setCamera('normal', { instant: true });
        v.enterBattle({ fieldId: 'rhine-ui-test', kind: 'normal', stageId: 'act2autochess_m01',
          units: [{ id: 701, kind: 'token', side: 'ally', defId: 'token_rhine_energy', x: 6, y: 10, maxHp: 1, sp: 2, spMax: 3, researchStage: 2 },
            { id: 702, kind: 'enemy', side: 'enemy', defId: 'enemy_1007_slime', x: 8, y: 10, maxHp: 1000 }] });
        v.pushSnapshot({ gt: 0, units: [[701,6,10,1,1,2,3,0,0], [702,8,10,1000,1000,0,0,0,0]] });
      });
      await page.waitForFunction('window.__demo.view.debug.views.get(701)?.spFill.visible && window.__demo.view.debug.views.get(701)?._pic?.shown === "img"');
      const partial = await page.evaluate(() => {
        const u = window.__demo.view.debug.views.get(701);
        return { share: u.spFill.width / (u.spBg.width - 2), below: u.spFill.y > u.screen.y, tint: u.spFill.tint };
      });
      assert.ok(Math.abs(partial.share - 2 / 3) < .001); assert.equal(partial.below, true); assert.equal(partial.tint, 0xffbc70);
      await page.screenshot({ path: path.join(OUT, 'rhine-charge-partial.png') });
      await page.evaluate(() => window.__demo.view.pushSnapshot({ gt: .5, units: [[701,6,10,1,1,3,3,0,0], [702,8,10,1000,1000,0,0,0,0]] }));
      await page.waitForFunction('window.__demo.view.debug.views.get(701).spGlow.visible && window.__demo.view.debug.views.get(701).researchActor.core.tint === 0xffe8c4');
      const readyAt = await page.evaluate(() => performance.now());
      await page.waitForFunction(start => performance.now() - start > 5000 && window.__demo.view.debug.views.get(701).spGlow.visible,
        { timeout: 10000 }, readyAt);
      assert.equal(await page.evaluate(() => window.__demo.view.debug.views.get(701).researchActor.pulse), 0, 'full charge waits without pretending to fire');
      await page.screenshot({ path: path.join(OUT, 'rhine-charge-ready.png') });
      const activation = await page.evaluate(async () => {
        const { energyPulseRange } = await import('/shared/rhineRange.js');
        const v = window.__demo.view, fx = v.debug.fx;
        fx.simFx('rhinePulse', 8, 10, { source: 701, stage: 2 });
        const rect = fx.ctx.fieldRect();
        return { beams: fx.beamList.length, rings: fx.rings.length, pulse: v.debug.views.get(701).researchActor.pulse,
          tiles: fx.tileFlashes.at(-1).tiles,
          expected: energyPulseRange(2).grid.map(([r,c]) => [10+r,8+c]).filter(([r,c]) => r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) };
      });
      assert.equal(activation.beams, 1); assert.ok(activation.rings >= 2); assert.equal(activation.pulse, 1);
      assert.deepEqual(activation.tiles, activation.expected);
      await page.screenshot({ path: path.join(OUT, 'rhine-pulse-low-quality.png') });
      await page.evaluate(() => window.__demo.view.pushSnapshot({ gt: 1, units: [[701,6,10,1,1,0,3,0,0], [702,8,10,900,1000,0,0,0,0]] }));
      await page.waitForFunction('window.__demo.view.debug.views.get(701).sp < .01');
      await page.waitForFunction('window.__demo.view.debug.fx.beamList.length === 0 && window.__demo.view.debug.views.get(701).researchActor.pulse === 0');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('a mid-battle ecology UnitInfo restores the continuous grid without any periodic fx replay', async () => {
    const { page, problems } = await open('dev/render-demo.html?scene=prep&paused=1&board=2d&quality=low&panel=0',
      'window.__demo?.ready');
    try {
      await page.evaluate(() => {
        const v = window.__demo.view;
        v.setCamera('normal', { instant: true });
        v.enterBattle({ fieldId: 'rhine-join-test', kind: 'normal', stageId: 'act2autochess_m01',
          units: [{ id: 703, kind: 'token', side: 'ally', defId: 'token_rhine_medical', x: 5, y: 10, maxHp: 1, researchStage: 2, researchActive: true },
            { id: 704, kind: 'token', side: 'ally', defId: 'token_rhine_medical', x: 9, y: 11, maxHp: 1, researchStage: 2, researchActive: false }] });
        v.pushSnapshot({ gt: 15, units: [[703,5,10,1,1,0,0,0,0], [704,9,11,1,1,0,0,0,0]] });
      });
      await page.waitForFunction('window.__demo.view.debug.fx.tileFlashes.some(f => f.key === "rhineEcology:703")');
      const area = await page.evaluate(async () => {
        const { researchRangeTiles } = await import('/shared/rhineRange.js');
        const fx = window.__demo.view.debug.fx, field = fx.tileFlashes.find(f => f.key === 'rhineEcology:703');
        return { tiles: field.tiles, expected: researchRangeTiles(10, 5, 3, fx.ctx.fieldRect()),
          persistent: field.dur === Infinity, pulse: field.anchor.researchActor.pulse,
          stoppedField: fx.tileFlashes.some(f => f.key === 'rhineEcology:704') };
      });
      assert.deepEqual(area.tiles, area.expected);
      assert.equal(area.persistent, true);
      assert.equal(area.pulse, 0, 'restoring the continuous slow does not replay a bind');
      assert.equal(area.stoppedField, false, 'inactive UnitInfo must not restore a stale field after reconnect');
      await page.waitForFunction('window.__demo.view.debug.fx.tileFlashes.some(f => f.key === "rhineEcology:703" && f.t > 5)', { timeout: 10000 });
      await page.screenshot({ path: path.join(OUT, 'rhine-ecology-reconnect.png') });
      await page.evaluate(() => window.__demo.view.debug.fx.simFx('rhineEcology', 5, 10, { source: 703, stage: 2, continuous: true, active: false }));
      await page.waitForFunction('window.__demo.view.debug.views.get(703).info.researchActive === false && !window.__demo.view.debug.fx.tileFlashes.some(f => f.key === "rhineEcology:703")');
      await page.evaluate(() => window.__demo.view.debug.fx.simFx('rhineEcology', 5, 10, { source: 703, stage: 2, radius: 3, continuous: true, active: true }));
      await page.waitForFunction('window.__demo.view.debug.fx.tileFlashes.some(f => f.key === "rhineEcology:703" && f.dur === Infinity)');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('laser card exposes the nine-member gate, one level, decoded local SVG and global selection cells', async () => {
    const { page, problems } = await open('dev/game-mock.html?phase=PREP&variant=rhineRange&researchDevice=laser&rhineCount=9&board=2d&shot=1',
      'window.__SP_VIEW__?.raw?.debug?.views.get("p:902")?._pic?.shown === "img"');
    try {
      const card = await page.$eval('[data-research="laser"]', el => ({ text: el.innerText, progress: !!el.querySelector('.rhine-card__progress'), next: !!el.querySelector('.rhine-card__next'), image: el.querySelector('img').naturalWidth }));
      assert.match(card.text, /单级.*9莱茵生命/); assert.equal(card.progress, false); assert.equal(card.next, false); assert.ok(card.image > 0);
      const art = await page.evaluate(async () => {
        const r = await fetch('/art/rhine/laser.svg');
        return { ok: r.ok, type: r.headers.get('content-type'), lamps: window.__SP_VIEW__.raw.debug.views.get('p:902').researchActor.lights.length };
      });
      assert.equal(art.ok, true); assert.match(art.type, /image\/svg\+xml/); assert.equal(art.lamps, 1);
      const p = await page.evaluate(() => window.__SP_VIEW__.tileScreen(10, 6)); await page.mouse.click(p.x, p.y);
      await page.waitForFunction('window.__SP_VIEW__.raw.debug.tiles.highlights.get("selRange")?.tiles.length === 44');
      await page.waitForSelector('.pbanner--overlay', { hidden: true });
      await page.screenshot({ path: path.join(OUT, 'rhine-laser-global-grid.png') });
      await page.goto(`${EXTERNAL_BASE || `http://127.0.0.1:${srv.port}`}/dev/game-mock.html?phase=PREP&variant=rhine&rhineCount=6&board=2d&shot=1`);
      await page.waitForSelector('[data-research="laser"].is-locked');
      const locked = await page.$eval('[data-research="laser"]', el => ({ text: el.innerText, disabled: el.querySelector('.rhine-card__select').disabled }));
      assert.match(locked.text, /未解锁.*9名/); assert.equal(locked.disabled, true);
      await page.waitForSelector('.pbanner--overlay', { hidden: true });
      await page.screenshot({ path: path.join(OUT, 'rhine-laser-nine-member-gate.png') });
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('low quality first output and reconnect restore the laser, twenty seconds changes its core, and pause/death retracts it', async () => {
    const { page, problems } = await open('dev/render-demo.html?scene=prep&paused=1&board=2d&quality=low&panel=0', 'window.__demo?.ready');
    try {
      await page.evaluate(() => {
        const v = window.__demo.view; v.setCamera('normal', { instant: true });
        v.enterBattle({ fieldId: 'laser-initial-spawn', kind: 'normal', stageId: 'act2autochess_m01', units: [
          { id: 711, kind: 'token', side: 'ally', defId: 'token_rhine_laser', x: 5, y: 10, maxHp: 1, researchStage: 0, researchActive: false,
            researchLaserTarget: null, researchLaserProgress: 0, researchLaserActive: false },
          { id: 712, kind: 'enemy', side: 'enemy', defId: 'enemy_1007_slime', x: 9, y: 11, maxHp: 10000 },
        ] });
        v.pushSnapshot({ gt: 0, units: [[711,5,10,1,1,0,0,0,0], [712,9,11,10000,10000,0,0,0,0]] });
      });
      await page.waitForFunction('window.__demo.view.debug.views.get(711)?._pic?.shown === "img"');
      assert.equal(await page.evaluate(() => window.__demo.view.debug.views.get(711).researchActor.beamActive), false);
      await page.evaluate(() => window.__demo.view.debug.fx.simFx('rhineLaser', 9, 11, { source: 711, target: 712, active: true, progress: .25 }));
      await page.waitForFunction('window.__demo.view.debug.views.get(711).researchActor.beamActive');
      assert.equal(await page.evaluate(() => window.__demo.view.debug.views.get(711).info.researchActive), false,
        'the first output event must work with the initially inactive generic spawn flag');
      await page.screenshot({ path: path.join(OUT, 'rhine-laser-first-output-low.png') });
      await page.evaluate(() => {
        const v = window.__demo.view; v.setCamera('normal', { instant: true });
        v.enterBattle({ fieldId: 'laser-reconnect', kind: 'normal', stageId: 'act2autochess_m01', units: [
          { id: 711, kind: 'token', side: 'ally', defId: 'token_rhine_laser', x: 5, y: 10, maxHp: 1, researchStage: 0, researchActive: true,
            researchLaserTarget: 712, researchLaserProgress: 10, researchLaserActive: true },
          { id: 712, kind: 'enemy', side: 'enemy', defId: 'enemy_1007_slime', x: 9, y: 11, maxHp: 10000 },
        ] });
        v.pushSnapshot({ gt: 10, units: [[711,5,10,1,1,0,0,0,0], [712,9,11,10000,10000,0,0,0,0]] });
      });
      await page.waitForFunction('window.__demo.view.debug.views.get(711)?._pic?.shown === "img" && window.__demo.view.debug.views.get(711).researchActor.beamActive');
      const first = await page.evaluate(() => {
        const a = window.__demo.view.debug.views.get(711).researchActor;
        return { tint: a.core.tint, lamps: a.lights.length, drawn: a.laserGfx.geometry.graphicsData.length > 0 };
      });
      assert.equal(first.tint, 0xe6a4ff); assert.equal(first.lamps, 1); assert.equal(first.drawn, true);
      await page.screenshot({ path: path.join(OUT, 'rhine-laser-reconnect-low.png') });
      await page.evaluate(() => window.__demo.view.debug.fx.simFx('rhineLaser', 9, 11, { source: 711, target: 712, active: true, progress: 20 }));
      await page.waitForFunction('window.__demo.view.debug.views.get(711).researchActor.core.tint === 0xff674f');
      await page.screenshot({ path: path.join(OUT, 'rhine-laser-full-output-low.png') });
      await page.evaluate(() => window.__demo.view.debug.fx.simFx('rhineLaser', 9, 11, { source: 711, target: 712, active: false, progress: 20 }));
      assert.equal(await page.evaluate(() => window.__demo.view.debug.views.get(711).researchActor.beamActive), false);
      assert.equal(await page.evaluate(() => window.__demo.view.debug.views.get(711).info.researchLaserProgress), 20);
      await page.screenshot({ path: path.join(OUT, 'rhine-laser-paused-low.png') });
      await page.evaluate(() => {
        const v = window.__demo.view;
        v.debug.fx.simFx('rhineLaser', 9, 11, { source: 711, target: 712, active: true, progress: 20 });
        v.debug.views.get(712).die();
      });
      await page.waitForFunction('!window.__demo.view.debug.views.get(711).researchActor.beamActive && !window.__demo.view.debug.views.get(711).researchActor.laserGfx.visible');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });
});
