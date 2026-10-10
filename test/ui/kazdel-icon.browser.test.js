// Icon-only visual regression on the real HTTP/UI/Pixi paths. No downloaded game art is required or fabricated.
// RENDER_E2E=1 CHROME_PATH=<system Chrome> node --test test/ui/kazdel-icon.browser.test.js
// Other missing art remains visible as the application's normal fallback and is recorded in the evidence JSON.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const ICON = '/art/kazdel/bond.png';
const SHA = '89f121f7b472917ac8da7b46c55011426a0343be4ac0824a288302a8e1a4d201';
const CHROME = process.env.CHROME_PATH;
const enabled = process.env.RENDER_E2E === '1' && !!CHROME && existsSync(CHROME);

describe('supplied Kazdel icon: real interface and transparent Pixi display', { skip: enabled ? false : 'set RENDER_E2E=1 and CHROME_PATH' }, () => {
  let srv, browser, base;
  const evidence = { missingArt: [], screenshots: [], checks: [] };
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
    evidence.browser = await browser.version();
  });
  after(async () => {
    evidence.missingArt = [...new Set(evidence.missingArt)];
    writeFileSync(path.join(OUT, 'kazdel-icon-evidence.json'), JSON.stringify(evidence, null, 2));
    await browser?.close();
    await srv?.close();
  });
  async function open(url) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && /\/(assets|fonts)\//.test(r.url())) evidence.missingArt.push(new URL(r.url()).pathname); });
    await page.setRequestInterception(true);
    page.on('request', r => new URL(r.url()).origin === base || /^(data|blob):/.test(r.url()) ? r.continue() : r.abort());
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', '图标验收'); sessionStorage.setItem('sp.entered', '1');
      window.__iconQaRejections = [];
      window.addEventListener('unhandledrejection', e => {
        const r = e.reason, target = r?.target;
        window.__iconQaRejections.push({ name: r?.constructor?.name, message: String(r), type: r?.type, url: target?.currentSrc || target?.src || target?.responseURL, stack: r?.stack });
      });
    });
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    return { page, errors };
  }
  async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT, name) });
    evidence.screenshots.push(name);
  }
  async function icons(page, selector) {
    return page.$$eval(selector, els => els.map(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return { natural: [el.naturalWidth, el.naturalHeight], box: [r.width, r.height], fit: s.objectFit, filter: s.filter, src: new URL(el.currentSrc).pathname };
    }));
  }
  function assertIcons(list) {
    assert.ok(list.length > 0, 'the real entry must render its icon');
    for (const icon of list) { assert.deepEqual(icon.natural, [812, 876]); assert.equal(icon.src, ICON); assert.equal(icon.fit, 'contain'); assert.ok(icon.box.every(x => x > 0)); }
  }
  async function assertPageErrors(page, errors, entry) {
    const rejections = await page.evaluate(() => window.__iconQaRejections);
    // Without downloaded art, the existing async Texture.from shadow loader rejects an Image error Event.
    // Accept only that exact missing file, corroborated by its failed local HTTP response; keep the evidence.
    const expected = rejections.filter(r => r.name === 'Event' && r.type === 'error' && r.url &&
      new URL(r.url).pathname === '/assets/ui/battle/sprite_shadow.png' &&
      evidence.missingArt.includes('/assets/ui/battle/sprite_shadow.png'));
    evidence.checks.push({ entry: `${entry} page diagnostics`, errors, rejections, expectedMissingShadow: expected.length });
    assert.equal(rejections.length, expected.length, 'unexpected unhandled rejection');
    assert.deepEqual(errors.filter(e => e !== 'Event'), [], 'unexpected page error');
    assert.equal(errors.length, expected.length, 'every page error must match the confirmed missing shadow image');
  }

  test('HTTP serves the original bytes and real loadout card/details use the small high-contrast icon', async () => {
    const response = await fetch(base + ICON), bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'image/png');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), SHA);
    assert.deepEqual(bytes, readFileSync(path.join(ROOT, 'public', ICON.slice(1))));
    const { page, errors } = await open('/');
    try {
      await page.waitForSelector('.lobby-screen [data-testid="loadout-open"]', { timeout: 30000 });
      await page.click('.lobby-screen [data-testid="loadout-open"]');
      await page.waitForSelector('.lo-search input');
      await page.type('.lo-search input', '红豆');
      await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1);
      await page.click('.lo-card__pick');
      await page.waitForFunction(() => [...document.querySelectorAll('.lo-card__bond,.lo-bond__icon')].filter(x => x.src.endsWith('/art/kazdel/bond.png')).length === 2);
      const list = await icons(page, '.lo-card__bond[src="/art/kazdel/bond.png"],.lo-bond__icon[src="/art/kazdel/bond.png"]');
      assertIcons(list); assert.ok(list.every(x => x.filter.includes('invert')));
      evidence.checks.push({ entry: 'real loadout card and detail', icons: list, sha256: SHA });
      await shot(page, 'kazdel-icon-loadout.png');
      await assertPageErrors(page, errors, 'loadout');
    } finally { await page.close(); }
  });

  test('native preview header/HUD and real bond components cover 12–32px, light/dark, active/inactive/off states', async () => {
    const { page, errors } = await open('/dev/kazdel-demo.html?paused=1&count=6&t=6.3');
    try {
      await page.waitForFunction(() => window.__kazdelDemo?.ready, { timeout: 60000 });
      const list = await icons(page, '.kpreview h1 img,.kazdel-cannon header img');
      assertIcons(list); assert.ok(list.every(x => x.filter.includes('invert')));
      evidence.checks.push({ entry: 'native preview header and cannon HUD', icons: list });
      await shot(page, 'kazdel-icon-native-preview.png');
      await page.evaluate(async () => {
        const [{ render }, { html, BondDisc }, { BondGlyph }, { MatchBondRow, matchInfoModel }, { data }] = await Promise.all([
          import('/vendor/preact.module.js'), import('/js/ui/components.js'), import('/js/ui/gameComponents.js'), import('/js/ui/matchInfo.js'), import('/js/data.js'),
        ]);
        const style = document.createElement('style');
        style.textContent = '.icon-qa{position:fixed;inset:0;z-index:1000;padding:30px;background:#111814;color:#e7eee9;font:15px/1.5 system-ui;overflow:auto}.icon-qa h2{font-size:20px;margin:0 0 14px}.icon-qa section{margin:16px 0;padding:12px;border:1px solid #496058}.icon-qa .row{display:flex;align-items:center;gap:24px}.icon-qa .sample{display:inline-flex;align-items:center;gap:8px}.icon-qa .light{background:#f5f6f4;color:#111;padding:16px}.icon-qa img.qa-raw{object-fit:contain}.icon-qa .bglyph{width:32px;height:32px}.icon-qa .brief-bonds{width:360px}.icon-qa .brief-h{font-size:14px}.icon-qa .brief-bonds__row{justify-content:flex-start}.icon-qa .bond{--disc:66px}.icon-qa .bond__name{font-size:12px}';
        document.head.append(style);
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/screens/briefing.css'; document.head.append(css);
        const mount = document.createElement('main'); mount.className = 'icon-qa'; document.body.append(mount);
        const b = data.lookup('bonds', 'kazdelShip');
        const on = matchInfoModel({}, { bonds: [b] }), off = matchInfoModel({ disabledBonds: ['kazdelShip'] }, { bonds: [b] });
        render(html`<h2>Kazdel original PNG · real component inspection</h2>
          <section><div>Dark surface · existing monochrome display</div><div class="row">${[12,13,16,22,32].map(n => html`<span class="sample"><img class="lo-card__bond" src="/art/kazdel/bond.png" style=${`width:${n}px;height:${n}px`} /><span>${n}px</span></span>`)}</div></section>
          <section class="light"><div>Light surface · original pixels</div><div class="row">${[12,13,16,22,32].map(n => html`<span class="sample"><img class="qa-raw" src="/art/kazdel/bond.png" style=${`width:${n}px;height:${n}px`} /><span>${n}px</span></span>`)}</div></section>
          <section><div>BondDisc · active / inactive / disabled</div><div class="row">${[0,1,2].map(n => html`<${BondDisc} name=${b.name} icon="/art/kazdel/bond.png" active=${n===0} disabled=${n===2} tier=${n===0?2:0} layers=${8} maxTier=${3} />`)}</div></section>
          <section><div>BondGlyph · detail, info and popover display states</div><div class="row"><${BondGlyph} bondId="kazdelShip" /><span class="dbond is-off"><span class="dbond__icon"><${BondGlyph} bondId="kazdelShip" /></span></span><span class="ibond is-off"><${BondGlyph} bondId="kazdelShip" /></span><div class="bpop__disc"><${BondGlyph} bondId="kazdelShip" /></div><div class="bpop__disc is-active"><${BondGlyph} bondId="kazdelShip" /></div></div></section>
          <section><div>Real MatchBondRow · enabled / disabled</div><div class="row"><${MatchBondRow} title="Enabled" micro="CORE" bonds=${[b]} model=${on} /><${MatchBondRow} title="Disabled" micro="CORE" bonds=${[b]} model=${off} /></div></section>`, mount);
      });
      await page.waitForFunction(() => [...document.querySelectorAll('.icon-qa img')].every(x => x.complete && x.naturalWidth === 812));
      const gallery = await icons(page, '.icon-qa img'); assertIcons(gallery);
      assert.ok(gallery.some(x => x.box[0] === 12) && gallery.some(x => x.box[0] === 32));
      const disabled = await icons(page, '.icon-qa .dbond.is-off img,.icon-qa .ibond.is-off img');
      assert.ok(disabled.every(x => x.filter.includes('invert(0.55)')));
      evidence.checks.push({ entry: 'real shared components and 12/13/16/22/32px light/dark sample', icons: gallery });
      await shot(page, 'kazdel-icon-states.png');
      await page.evaluate(async () => {
        const [{ render }, { html }, { BondStrip, BondPopup }, { BondChips }, { ChessCard }, { EnemyDrawer }, { data }] = await Promise.all([
          import('/vendor/preact.module.js'), import('/js/ui/components.js'), import('/js/ui/bondStrip.js'), import('/js/ui/detailPanel.js'),
          import('/js/ui/shopBar.js'), import('/js/ui/enemyDrawer.js'), import('/js/data.js'),
        ]);
        const old = document.querySelector('.icon-qa'); old.remove();
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/screens/game-shop.css'; document.head.append(css);
        const style = document.createElement('style');
        style.textContent = '.icon-entry-qa{position:fixed;inset:0;z-index:1000;background:#111814;color:#e7eee9;padding:22px;font:15px/1.4 system-ui;display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;overflow:auto}.icon-entry-qa section{padding:12px;border:1px solid #496058}.icon-entry-qa h2{font-size:18px;margin:0 0 12px}.icon-entry-qa .bpop,.icon-entry-qa .edrawer{position:static;inset:auto;width:100%;max-height:540px;margin:12px 0;transform:none}.icon-entry-qa .scard{width:210px;margin:14px 0}.icon-entry-qa .row{display:flex;gap:16px;align-items:center}.icon-entry-qa .bstrip{margin:12px 0}';
        document.head.append(style);
        const mount = document.createElement('main'); mount.className = 'icon-entry-qa'; document.body.append(mount);
        const b = data.lookup('bonds', 'kazdelShip'), entry = { bondId: 'kazdelShip', active: true, count: 6, tier: 2, layers: 8, thresholds: b.thresholds };
        const inactive = { ...entry, active: false, count: 1, tier: 0 }, noop = () => {}, priv = { board: [], hand: [], temp: [] };
        const c = data.list('chess').find(c => c.visible && !c.isGolden && c.bonds?.[0] === 'kazdelShip');
        if (!c) throw new Error('a real Kazdel shop record is required');
        render(html`<section><h2>Real BondStrip and BondChips</h2>
          <${BondStrip} bonds=${[entry]} onOpen=${noop} /><${BondStrip} bonds=${[inactive]} onOpen=${noop} /><${BondStrip} bonds=${[{...inactive, off:true}]} onOpen=${noop} />
          <${BondChips} bondIds=${['kazdelShip']} bonds=${[entry]} /><${BondChips} bondIds=${['kazdelShip']} bonds=${[inactive]} /><${BondChips} bondIds=${['kazdelShip']} bonds=${[entry]} off=${new Set(['kazdelShip'])} />
          <h2>Real ChessCard watermark and bond chip</h2><${ChessCard} slot=${{id:c.chessId,price:c.price}} idx=${0} priv=${priv} onBuy=${noop} onDetail=${noop} />
        </section><section><h2>Real BondPopup — active</h2><${BondPopup} bondId="kazdelShip" entry=${entry} priv=${priv} onClose=${noop} /></section>
        <section><h2>Real BondPopup — inactive</h2><${BondPopup} bondId="kazdelShip" entry=${inactive} priv=${priv} onClose=${noop} />
          <h2>Real EnemyDrawer — disabled bond</h2><${EnemyDrawer} tab="info" pub=${{disabledBonds:['kazdelShip']}} priv=${priv} onTab=${noop} onClose=${noop} onEnemy=${noop} onChess=${noop} />
        </section>`, mount);
      });
      const selector = '.icon-entry-qa img[src="/art/kazdel/bond.png"]';
      await page.waitForFunction(sel => [...document.querySelectorAll(sel)].length >= 11 && [...document.querySelectorAll(sel)].every(x => x.complete && x.naturalWidth === 812), {}, selector);
      for (const entry of ['.bstrip', '.dbonds', '.scard__water', '.scard__bonds', '.bpop.is-active', '.bpop', '.ibond.is-off']) {
        // Popup activation lives on its disc, rather than its outer dialog.
        const actual = entry === '.bpop.is-active' ? '.bpop__disc.is-active' : entry;
        const list = await icons(page, `.icon-entry-qa ${actual} img[src="/art/kazdel/bond.png"]`);
        assertIcons(list); evidence.checks.push({ entry: `real production component ${actual}`, icons: list });
      }
      await shot(page, 'kazdel-icon-production-entries.png');
      await assertPageErrors(page, errors, 'preview');
    } finally { await page.close(); }
  });

  test('a real layer event uses the supplied Pixi texture, keeps ratio and bright transparent edges', async () => {
    const { page, errors } = await open('/dev/game-mock.html?shot=1&render=engine&phase=COMBAT');
    try {
      await page.waitForFunction(() => window.__SP_VIEW__?.raw?.mode === 'battle' && window.__MOCK__, { timeout: 30000 });
      await page.evaluate(async () => {
        const { net } = await import('/js/net.js');
        const { data } = await import('/js/data.js');
        await PIXI.Assets.load('/art/kazdel/bond.png');
        const S = window.__MOCK__.S();
        const members = data.list('chess').filter(c => c.visible && !c.isGolden && c.bonds?.includes('kazdelShip')).slice(0,3);
        if (members.length !== 3) throw new Error('three real Kazdel members are required');
        window.__MOCK__.mutate(s => {
          s.layers.kazdelShip = 8;
          s.priv.board = s.priv.board.map((p,i) => i < 3 ? {...p, id:members[i].chessId, golden:false} : p);
        });
        const gt = (await new Promise(resolve => { const off = net.on('b.snap', m => { off(); resolve(m.gt); }); })) + .01;
        net._emit('b.ev', { t: 'b.ev', fieldId: S.battle.fieldRef.id, gt, ev: [['layer', 'p1', 'kazdelShip', 3]] });
      });
      const strip = await icons(page, '.bslot[data-bond="kazdelShip"] img'); assertIcons(strip);
      evidence.checks.push({ entry: 'real game-mock BondStrip computed from three Kazdel members', icons: strip });
      await page.waitForFunction(() => window.__SP_VIEW__.raw.debug.fx.pops.some(p => p.t > .25 && p.t < 1 && p.c.children.some(s => s.filters?.length)), { timeout: 10000 });
      await shot(page,'kazdel-icon-layer-pop.png');
      const result = await page.evaluate(async () => {
        const fx = window.__SP_VIEW__.raw.debug.fx, pop = fx.pops.find(p => p.c.children.some(s => s.filters?.length)), sp = pop.c.children.find(s => s.filters?.length);
        const original = new Image(); original.src = '/art/kazdel/bond.png'; await original.decode();
        const canvas = document.createElement('canvas'); canvas.width = 812; canvas.height = 876;
        const ctx = canvas.getContext('2d'); ctx.drawImage(original, 0, 0); const source = ctx.getImageData(0,0,812,876).data;
        const app = new PIXI.Application({ width:812, height:876, resolution:1, backgroundAlpha:0, antialias:false });
        const sample = new PIXI.Sprite(sp.texture); sample.filters = sp.filters; app.stage.addChild(sample);
        const shown = app.renderer.extract.pixels(app.stage); let alphaMismatch = 0, opaqueBright = 0, translucentBright = 0, sourcePartial = 0;
        for (let i=0;i<source.length;i+=4) {
          if (Math.abs(source[i+3]-shown[i+3])>1) alphaMismatch++;
          if (source[i+3]===255 && shown[i]>250) opaqueBright++;
          if (source[i+3]>0 && source[i+3]<255) { sourcePartial++; if(shown[i]>240) translucentBright++; }
        }
        const result = { natural:[sp.texture.width,sp.texture.height], scale:[sp.scale.x,sp.scale.y], longest:Math.max(sp.width,sp.height), matrix:Array.from(sp.filters[0].matrix), alphaMismatch, opaqueBright, translucentBright, sourcePartial };
        sample.filters = null; app.destroy(true,{children:true,texture:false,baseTexture:false}); return result;
      });
      assert.deepEqual(result.natural,[812,876]); assert.equal(result.scale[0],result.scale[1]); assert.ok(Math.abs(result.longest-46)<.1);
      assert.equal(result.alphaMismatch,0); assert.equal(result.opaqueBright,166517);
      assert.ok(result.translucentBright>result.sourcePartial*.95, 'anti-aliased edges must stay bright rather than being darkened twice by alpha');
      evidence.checks.push({ entry:'real layer event → app → FxSystem.pop → GPU pixel extraction', ...result });
      await assertPageErrors(page, errors, 'layer');
    } finally { await page.close(); }
  });
});
