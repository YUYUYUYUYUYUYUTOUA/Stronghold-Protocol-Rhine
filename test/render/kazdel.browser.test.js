// Real Chrome checks of native Battle → snapshot/events → renderer/HUD/roster, not invented visual packets.
// RENDER_E2E=1 CHROME_PATH=<Chrome> node --test test/render/kazdel.browser.test.js
// A temporary loopback server is closed after the test. Optional KAZDEL_E2E_BASE_URL reuses a preview server.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),OUT=path.join(ROOT,'test/e2e/out');
const CHROME=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=process.env.KAZDEL_E2E_BASE_URL;
const enabled=process.env.RENDER_E2E==='1'&&existsSync(CHROME)&&existsSync(path.join(ROOT,'public/assets'));

describe('Kazdel native-battle visual integration in Chrome',{skip:enabled?false:'set RENDER_E2E=1 with Chrome and downloaded art'},()=>{
  let srv,browser;
  before(async()=>{
    const puppeteer=(await import('puppeteer-core')).default;
    if(!BASE){const {startServer}=await import('../../server/index.js');srv=await startServer({port:0,host:'127.0.0.1',quiet:true});}
    browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-first-run']});mkdirSync(OUT,{recursive:true});
    writeFileSync(path.join(OUT,'kazdel-browser-version.txt'),await browser.version());
  });
  after(async()=>{await browser?.close();await srv?.close();});
  async function open(query){const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:900});await page.goto(`${BASE||`http://127.0.0.1:${srv.port}`}/dev/kazdel-demo.html?paused=1&${query}`);await page.waitForFunction('window.__kazdelDemo?.ready',{timeout:60000});return {page,errors};}

  test('six-person cannon warning covers exactly nine cells, donor soul survives pause, and all ten roster cards work',async()=>{
    const {page,errors}=await open('count=6&t=6.3');
    try{
      await page.waitForFunction('window.__kazdelDemo.view.debug.fx.kazdelWarnings.length===1');
      await page.waitForFunction('[...window.__kazdelDemo.view.debug.views.values()].find(v=>v.info.kazdelSoul)?.spineReady');
      const state=await page.evaluate(()=>{const d=window.__kazdelDemo,v=[...d.view.debug.views.values()].find(v=>v.info.kazdelSoul),s=d.battle.snapshot().kazdel[0];return {stage:s.stage,charge:s.charge,warning:s.warning,soul:{form:v.form,spine:v.info.spine,alpha:v.body.alpha},roster:document.querySelectorAll('[data-roster]').length,errors:d.errors};});
      assert.equal(state.stage,2);assert.ok(state.charge>12&&state.charge<15);assert.equal(state.soul.spine,'char_290_vigna');assert.equal(state.soul.form,'kazdelSoul');assert.equal(state.soul.alpha,.58);assert.equal(state.roster,10);assert.deepEqual(state.errors,[]);
      assert.match(await page.$eval('#hud',e=>e.textContent),/敌我均伤/);
      const footprint=await page.evaluate(async()=>{const {cannonTiles}=await import('/js/render/fx/kazdel.js');const d=window.__kazdelDemo,s=d.battle.snapshot().kazdel[0];return cannonTiles(s.warning.x,s.warning.y,d.battle.rect);});assert.equal(footprint.length,9);
      await page.screenshot({path:path.join(OUT,'kazdel-six-warning.png')});
      const before=await page.evaluate(()=>window.__kazdelDemo.battle.time);await new Promise(r=>setTimeout(r,350));assert.equal(await page.evaluate(()=>window.__kazdelDemo.battle.time),before,'paused preview must not advance battle warning');
      for(const charId of ['char_4131_odda','char_219_meteo','char_4071_peper','char_4133_logos','char_1035_wisdel']){
        await page.click(`[data-roster="${charId}"]`);await page.waitForSelector('.dpanel__name,.dhead__name');
        const content=await page.$eval('#details',e=>e.textContent);assert.match(content,/技能/);assert.match(content,/特质/);
      }
      await new Promise(r=>setTimeout(r,300));
      await page.screenshot({path:path.join(OUT,'kazdel-ten-roster-details.png')});assert.deepEqual(errors,[]);
      await page.click('.dpanel__close');
      const soulTile=await page.evaluate(()=>window.__kazdelDemo.view.tileScreen(10,5));
      await page.mouse.click(soulTile.x,soulTile.y);
      await page.waitForFunction('document.querySelector("#details")?.textContent.includes("亡魂仅接受")');
      assert.match(await page.$eval('#details',e=>e.textContent),/红豆 · 众魂/);
      assert.match(await page.$eval('#details',e=>e.textContent),/攻击范围/);
      assert.match(await page.$eval('#details',e=>e.textContent),/无时间限制/);
      await new Promise(r=>setTimeout(r,300));
      await page.screenshot({path:path.join(OUT,'kazdel-soul-details.png')});
    }finally{await page.close();}
  });

  test('real cannon firing resets its meter and emits square impact; nine-person mode restores enemy-only after reset',async()=>{
    const {page,errors}=await open('count=6&t=7.7');
    try{
      await page.evaluate(()=>window.__kazdelDemo.advance(.3));
      await page.waitForFunction('window.__kazdelDemo.events.some(e=>e[0]==="fx"&&e[1]==="kazdelCannonImpact")');
      const fire=await page.evaluate(()=>{const d=window.__kazdelDemo;return {charge:d.battle.snapshot().kazdel[0].charge,fire:d.events.filter(e=>e[0]==='fx'&&e[1]==='kazdelCannonImpact').length,warning:d.battle.snapshot().kazdel[0].warning};});
      assert.equal(fire.fire,1);assert.ok(fire.charge<1);assert.equal(fire.warning,null);
      await page.waitForFunction('window.__kazdelDemo.view.debug.fx.tileFlashes.some(f=>!f.warn&&f.tiles.length===9)',{timeout:10000});
      await page.screenshot({path:path.join(OUT,'kazdel-cannon-impact.png')});
      await page.click('[data-count="9"]');assert.match(await page.$eval('#hud',e=>e.textContent),/仅伤敌军/);
      const nine=await page.evaluate(()=>{window.__kazdelDemo.seek(6.3);return window.__kazdelDemo.battle.snapshot().kazdel[0];});assert.equal(nine.stage,3);
      await page.waitForFunction('window.__kazdelDemo.view.debug.fx.kazdelWarnings.length===1');
      await page.screenshot({path:path.join(OUT,'kazdel-nine-warning.png')});
      await page.click('#heal');await page.waitForFunction('window.__kazdelDemo.events.some(e=>e[0]==="fx"&&e[1]==="kazdelSoulHeal")');
      await page.screenshot({path:path.join(OUT,'kazdel-soul-healing.png')});
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
  });
});
