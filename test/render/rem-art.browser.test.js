// RENDER_E2E=1 CHROME_PATH=/usr/bin/chromium node --test test/render/rem-art.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getData } from '../../server/data.js';
import { REM_ENEMY_ART } from '../../tools/assets/rem-plan.mjs';
const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.RENDER_E2E === '1' && existsSync(chrome);
test('eleven Rem operators, eight original reinforcement models and the exact original logo decode and render', {
  skip:enabled ? false:'set RENDER_E2E=1 with downloaded art and Chrome', timeout:60000,
}, async () => {
  // Compare the served image with the actual supplied original, not an obsolete upload's digest.
  const original = readFileSync(process.env.REM_LOGO_REFERENCE || 'public/assets/bond/rem.png');
  const originalDigest = createHash('sha256').update(original).digest('hex');
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({port:0,host:'127.0.0.1',quiet:true});
  let browser;
  try {
    browser = await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
    const page = await browser.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1800,height:1040});
    const base=`http://127.0.0.1:${srv.port}`;
    await page.goto(`${base}/healthz`);
    const data = getData({log:{warn(){},error(){},info(){}}});
    const operators=Object.values(data.chess).filter(c=>!c.isGolden&&c.bonds.includes('remShip')).map(c=>({id:c.charId,name:c.name}));
    assert.equal(operators.length,11);
    const entries=[...operators,...Object.entries(REM_ENEMY_ART).map(([name,id])=>({name,id}))];
    const result=await page.evaluate(async entries=>{
      const {ensurePixi}=await import('/js/render/app/pixi.js');
      const PIXI=await ensurePixi();
      const {assets}=await import('/js/assets.js');
      const {SpineActor}=await import('/js/render/spine.js');
      await assets.ready();
      document.body.innerHTML=''; document.body.style='margin:0;background:#122027';
      const app=new PIXI.Application({width:1800,height:1040,backgroundColor:0x122027,antialias:true,preserveDrawingBuffer:true,autoStart:false});
      document.body.appendChild(app.view);
      const results=[];
      for(const [i,item] of entries.entries()) {
        const entry=assets.spineEntry(item.id);
        if(!entry) throw new Error(`Missing model ${item.id}`);
        const actor=new SpineActor(await assets.spine.acquire(entry),entry);
        actor.setBase(i>=11?'move':'idle'); actor.update(.3);
        const bounds=actor.spine.getLocalBounds();
        const scale=Math.min(1,220/Math.max(1,bounds.width),165/Math.max(1,bounds.height));
        actor.spine.scale.set(scale);
        const col=i%5,row=Math.floor(i/5);
        actor.spine.position.set(col*360+180-(bounds.x+bounds.width/2)*scale,row*250+205-(bounds.y+bounds.height)*scale);
        app.stage.addChild(actor.spine);
        const label=new PIXI.Text(item.name,{fontFamily:'sans-serif',fontSize:20,fill:0xe5eadc});
        label.position.set(col*360+22,row*250+218); app.stage.addChild(label);
        const url=assets.picture(item.id), image=new Image(); image.src=url; await image.decode();
        results.push({id:item.id,width:bounds.width,height:bounds.height,icon:image.naturalWidth,anims:actor.names.size});
      }
      const logoUrl=assets.bondIcon('remShip');
      if(!logoUrl) throw new Error('Missing original Rem logo mapping');
      const response=await fetch(logoUrl);
      if(!response.ok) throw new Error(`Rem logo HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      const logo=new Image(); logo.src=logoUrl; await logo.decode();
      const probe=document.createElement('canvas'); probe.width=logo.naturalWidth; probe.height=logo.naturalHeight;
      const ctx=probe.getContext('2d'); ctx.drawImage(logo,0,0);
      const pixels=ctx.getImageData(0,0,probe.width,probe.height).data;
      let transparent=0,visible=0;
      for(let i=3;i<pixels.length;i+=4) if(pixels[i]) visible++; else transparent++;
      const sprite=PIXI.Sprite.from(logo); sprite.position.set(1500,800); sprite.width=180; sprite.height=180;
      app.stage.addChild(sprite); app.render();
      return {models:results,logo:{url:logoUrl,bytes:bytes.byteLength,digest,width:logo.naturalWidth,height:logo.naturalHeight,transparent,visible}};
    },entries);
    assert.equal(result.models.length,19);
    assert.ok(result.models.every(e=>e.width>0&&e.height>0&&e.icon>0&&e.anims>0));
    assert.equal(result.logo.bytes,original.length);
    assert.equal(result.logo.digest,originalDigest);
    assert.deepEqual([result.logo.width,result.logo.height],[510,510]);
    assert.ok(result.logo.visible>0,'the supplied original has visible artwork');
    assert.deepEqual(errors,[]);
    mkdirSync('test/e2e/out',{recursive:true});
    await page.screenshot({path:'test/e2e/out/rem-original-models.png'});
  } finally { await browser?.close(); await srv.close(); }
});
