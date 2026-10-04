// Real assets and loadout controls for all six added operators, on a temporary local server.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
describe('Rhine added operators actual art, loadout stats and traps in Chromium', { skip: enabled ? false : 'set RENDER_E2E=1 with Chrome and downloaded assets' }, () => {
 let srv, browser;
 before(async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  mkdirSync(OUT, { recursive: true });
 });
 after(async () => { await browser?.close(); await srv?.close(); });
 test('all six operators show every skill, actual portrait, permitted modules and the chosen module stats', async () => {
  const page = await browser.newPage(), errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  try {
   await page.setViewport({width:1600,height:1000});
   await page.evaluateOnNewDocument(()=>{localStorage.setItem('sp.name','科研界面验收');sessionStorage.setItem('sp.entered','1');});
   await page.goto(`http://127.0.0.1:${srv.port}/`);
   await page.waitForSelector('[data-testid="loadout-open"]',{timeout:40000});
   await page.click('[data-testid="loadout-open"]');
   const cases = [
    ['mayer',2,['uniequip_002_otter']], ['wuhoo',2,['uniequip_002_turdus']],
    ['eunectes',3,['uniequip_002_zumama','uniequip_003_zumama']],
    ['ifrit',3,['uniequip_002_ifrit','uniequip_003_ifrit']],
    ['astgenne',2,['uniequip_002_halo']], ['dorothy',3,['uniequip_002_doroth']],
   ];
   for (const [key,count,modules] of cases) {
    const sel=`[data-chess="chess_rhine_${key}_a"]`;
    await page.waitForSelector(sel,{timeout:40000});
    await page.click(sel);
    await page.waitForFunction((count)=>document.querySelectorAll('.lo-detail [data-skill]').length===count,{},count);
    await page.waitForFunction(()=>{const image=document.querySelector('.lo-dhead__art img');return image?.complete&&image.naturalWidth>0;});
    const choices=await page.$$eval('.lo-detail [data-module]',ns=>ns.map(n=>n.dataset.module));
    assert.deepEqual(choices,[...modules,'none']);
    for (let skill=0;skill<count;skill++) {
     await page.click(`.lo-detail [data-skill="${skill}"]`);
     assert.equal(await page.$eval(`.lo-detail [data-skill="${skill}"]`,n=>n.getAttribute('aria-checked')),'true');
    }
    // 0.1.2 adds 局内数值: module changes must update the same stat block even with an alternate skill selected.
    const expected = await page.evaluate(async key => {
     const chess = await (await fetch('/data/chess.json')).json();
     const rec = chess[`chess_rhine_${key}_b`];
     return { baseAtk:rec.statsBase.atk, modules:rec.modules.map(m=>({id:m.uniEquipId, atk:rec.statsBase.atk+(m.attr.atk||0)})) };
    },key);
    const atk = () => page.$eval('.lo-sec--stats .dstats',n=>[...n.querySelectorAll('.dstat')].find(v=>v.querySelector('.dstat__k').textContent==='攻击').querySelector('.dstat__v').textContent);
    for (const module of expected.modules) {
     await page.click(`.lo-detail [data-module="${module.id}"]`);
     await page.waitForFunction((value)=>[...document.querySelectorAll('.lo-sec--stats .dstat')].some(n=>n.querySelector('.dstat__k').textContent==='攻击' && Number(n.querySelector('.dstat__v').textContent.replaceAll(',',''))===value),{},module.atk);
     assert.equal(Number((await atk()).replaceAll(',','')),module.atk);
    }
    await page.click('.lo-detail [data-module="none"]');
    await page.waitForFunction((value)=>[...document.querySelectorAll('.lo-sec--stats .dstat')].some(n=>n.querySelector('.dstat__k').textContent==='攻击' && Number(n.querySelector('.dstat__v').textContent.replaceAll(',',''))===value),{},expected.baseAtk);
    assert.equal(Number((await atk()).replaceAll(',','')),expected.baseAtk);
    await page.click(`.lo-detail [data-module="${modules[0]}"]`);
    await page.screenshot({path:path.join(OUT,`rhine-${key}-loadout.png`)});
   }
   assert.deepEqual(errors,[]);
  } finally {await page.close();}
 });
 test('new operator and trap models load; critical colour survives initial snapshot; chain and explosion draw in low quality', async () => {
  const page=await browser.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
   await page.setViewport({width:1600,height:900});
   await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&paused=1&board=2d&quality=low&panel=0`);
   await page.waitForFunction('window.__demo?.ready',{timeout:40000});
   await page.evaluate(()=>{
    const v=window.__demo.view;v.setCamera('normal',{instant:true});
    const ops=[{id:801,kind:'op',side:'ally',defId:'chess_rhine_astgenne_a',spine:'char_135_halo',avatar:'char_135_halo',x:4,y:10,maxHp:1000,skillIndex:0},
      {id:802,kind:'op',side:'ally',defId:'chess_rhine_dorothy_b',spine:'char_4048_doroth',avatar:'char_4048_doroth',x:7,y:11,maxHp:1000,skillIndex:2},
      {id:803,kind:'token',side:'ally',defId:'token_10025_doroth_recttp',x:6,y:10,maxHp:1000,form:'dorothyCritical'},
      {id:804,kind:'token',side:'ally',defId:'token_10025_doroth_recttp',x:8,y:10,maxHp:1000}];
    v.enterBattle({fieldId:'rhine-new-visual',kind:'normal',stageId:'act2autochess_m01',units:ops});
    v.pushSnapshot({gt:0,units:ops.map(u=>[u.id,u.x,u.y,1000,1000,0,0,0,0])});
   });
   await page.waitForFunction(()=>[801,802,803,804].every(id=>window.__demo.view.debug.views.get(id)?.spineReady),{timeout:40000});
   await page.waitForFunction(()=>[801,802,803,804].every(id=>window.__demo.view.debug.views.get(id)?.swapT===1),{timeout:10000});
   await page.waitForFunction(()=>window.__demo.view.debug.views.get(803).actor.spine.tint===0xff665c);
   assert.equal(await page.evaluate(()=>window.__demo.view.debug.views.get(804).actor.spine.tint),0xffffff);
   await page.screenshot({path:path.join(OUT,'rhine-new-models-critical.png')});
   const counts=await page.evaluate(()=>{
    const fx=window.__demo.view.debug.fx;
    fx.simFx('dorothyChain',8,10,{source:803,target:804,fromX:6,fromY:10,delay:2});
    fx.simFx('dorothyTrap',6,10,{id:803,critical:true,skill:'sktok_doroth_3'});
    return {beams:fx.beamList.length,rings:fx.rings.length};
   });
   assert.ok(counts.beams>=1);assert.ok(counts.rings>=2);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:path.join(OUT,'rhine-dorothy-chain-blast.png')});
   await page.evaluate(()=>window.__demo.view.debug.views.get(803).setForm('dorothyNormal'));
   await page.waitForFunction(()=>window.__demo.view.debug.views.get(803).actor.spine.tint===0xffffff);
   assert.deepEqual(errors,[]);
  } finally {await page.close();}
 });
});
