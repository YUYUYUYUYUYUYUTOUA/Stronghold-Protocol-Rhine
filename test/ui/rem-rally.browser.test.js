import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../server/index.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SP_E2E === '1' && existsSync(chrome);
test('rally panel drags, collapses, stays recoverable and isolates board, map and owner interactions', { skip: !enabled, timeout:60000 }, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1000,height:800});
    await page.goto(`http://127.0.0.1:${srv.port}/healthz`);
    await page.evaluate(async () => {
      const { render, h } = await import('/vendor/preact.module.js');
      const { RemRally } = await import('/js/ui/remRally.js');
      document.body.style='margin:0;background:#26373d;color:white';
      document.body.innerHTML = '<main id="test" style="position:relative;width:100%;height:100vh"></main>';
      window.selection=[];window.boardDown=0;
      document.querySelector('#test').addEventListener('pointerdown',()=>window.boardDown++);
      const views = Object.fromEntries(['normal','bossR'].map(field=>[field,{ highlightTiles(tiles) { window.tiles=tiles; }, tileScreen(r,c) {
        return r===10&&c===4 ? {poly:field==='normal'?[[400,400],[440,400],[440,440],[400,440]]:[[700,400],[740,400],[740,440],[700,440]]}:null;
      } }]));
      window.mountRally = ({editable=true,owner='p1',field='normal',enabled=true}={}) => render(h(RemRally, {
        enabled,editable,point:null,view:views[field],contextKey:`${owner}:${field}`,
        placeCtx:{field,deploy:{melee:new Set(['10,4'])}},
        onSet:(row,col)=>window.selection.push({owner,field,row,col}),
      }),document.querySelector('#test'));
      window.mountRally();
    });
    const set='[data-testid="rem-rally-set"]', fold='[data-testid="rem-rally-collapse"]', handle='[data-testid="rem-rally-drag"]';
    await page.waitForSelector(set);
    const rect=()=>page.$eval('.rem-rally',e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};});
    const original=await rect();
    await page.click(set);await page.waitForFunction('window.tiles?.length===1');
    await page.keyboard.press('Escape');await page.mouse.click(420,420);
    assert.equal(await page.evaluate(()=>window.selection.length),0);
    await page.click(set);await page.mouse.click(420,420);
    assert.deepEqual(await page.evaluate(()=>window.selection),[{owner:'p1',field:'normal',row:10,col:4}]);
    await page.evaluate(()=>window.boardDown=0);
    // Drag the dedicated title, never the buttons; captured pointer events do not reach the board.
    const drag=async(dx,dy)=>{const b=await page.$eval('[data-testid="rem-rally-drag"]',e=>{const b=e.getBoundingClientRect();return {x:b.x+55,y:b.y+12};});await page.mouse.move(b.x,b.y);await page.mouse.down();await page.mouse.move(b.x+dx,b.y+dy,{steps:8});await page.mouse.up();};
    await drag(150,80);const moved=await rect();assert.ok(moved.x>original.x+100&&moved.y>original.y+40);
    assert.equal(await page.evaluate(()=>window.boardDown),0);
    await page.click(set);await page.click(fold);await page.waitForFunction('!document.querySelector("[data-testid=rem-rally-body]")');
    const folded=await rect();assert.ok(folded.height<moved.height);
    await page.mouse.click(420,420);assert.equal(await page.evaluate(()=>window.selection.length),1,'collapse cancels selection');
    await page.click(fold);await page.waitForSelector(set);
    assert.equal(await page.$eval(set,e=>e.getAttribute('aria-pressed')),'false');
    for(let i=0;i<2;i++){await page.click(fold);await page.click(fold);} // repeated round trips
    await drag(2000,2000);let b=await rect();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=1001&&b.y+b.height<=801);
    await page.setViewport({width:320,height:240});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.waitForFunction(()=>{const b=document.querySelector('.rem-rally').getBoundingClientRect();return b.right<=innerWidth+1&&b.bottom<=innerHeight+1;});
    await page.click(fold);await page.click(fold);
    await page.setViewport({width:1000,height:800});
    const cdp=await page.createCDPSession();await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});
    await page.waitForFunction(()=>{const b=document.querySelector('.rem-rally').getBoundingClientRect(),v=visualViewport;return b.right<=v.offsetLeft+v.width+1&&b.bottom<=v.offsetTop+v.height+1;});
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await drag(-2000,-2000);b=await rect();assert.equal(b.x,0);assert.equal(b.y,0);
    // Escape cancels an active drag; further movement cannot move the panel.
    await page.mouse.move(60,20);await page.mouse.down();await page.mouse.move(100,50);await page.keyboard.press('Escape');
    const cancelled=await rect();await page.mouse.move(250,200);await page.mouse.up();assert.deepEqual(await rect(),cancelled);
    await page.click(set);await page.evaluate(()=>window.mountRally({owner:'p2',field:'bossR'}));
    await page.waitForFunction(()=>document.querySelector('[data-testid="rem-rally-set"]').getAttribute('aria-pressed')==='false');
    await page.mouse.click(420,420);assert.equal(await page.evaluate(()=>window.selection.length),1,'map switch cancels old-board picking');
    await page.click(set);await page.mouse.click(720,420);
    assert.deepEqual(await page.evaluate(()=>window.selection.at(-1)),{owner:'p2',field:'bossR',row:10,col:4});
    await page.evaluate(()=>window.mountRally({editable:false,owner:'p2',field:'bossR'}));
    assert.equal(await page.$eval(set,e=>e.disabled),true);
    await drag(40,40);await page.click(fold);await page.click(fold); // combat still permits window management
    await page.evaluate(()=>window.mountRally({enabled:false}));await page.waitForFunction('!document.querySelector(".rem-rally")');
    await page.evaluate(()=>window.mountRally());await page.waitForSelector(set);
    await page.focus(handle);const keyBefore=await rect();await page.keyboard.press('ArrowRight');assert.ok((await rect()).x>keyBefore.x);
    if(existsSync('public/assets/bond/rem.png'))assert.equal(await page.$eval('.rem-rally img',async e=>{await e.decode();return e.naturalWidth>0;}),true);
    mkdirSync('test/e2e/out',{recursive:true});await page.screenshot({path:'test/e2e/out/rem-rally-movable-expanded.png'});
    await page.click(fold);await page.screenshot({path:'test/e2e/out/rem-rally-movable-collapsed.png'});
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await srv.close(); }
});
