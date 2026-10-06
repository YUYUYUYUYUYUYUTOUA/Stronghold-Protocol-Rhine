// UI contract checks with an explicit controller double. The independent real-Battle lab tests cover simulation.
// Opt in with RENDER_E2E=1 and CHROME_PATH. Only a temporary static loopback server is created.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const CHROME=process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const enabled=process.env.RENDER_E2E==='1' && existsSync(CHROME);
test('test-lab tools preserve the field and submit complete scenarios through the controller contract', {skip:enabled?false:'set RENDER_E2E=1 and CHROME_PATH'}, async()=>{
  const html=readFileSync(path.join(ROOT,'public/dev/test-lab.html'),'utf8').replace('<script type="module" src="/dev/lab-bootstrap.js"></script>','');
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    const base=/^\/(shared|data)\//.test(url.pathname)?ROOT:path.join(ROOT,'public');
    const file=path.resolve(base,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
    readFile(file,(err,bytes)=>{if(err){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const puppeteer=(await import('puppeteer-core')).default;
    browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-first-run']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1280,height:720});
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await page.evaluate(async()=>{
      const {mountLabUI}=await import('/dev/test-lab-ui.js');
      const names=['chess','tokens','enemies','items','stages','bonds','garrisons'];
      const records=Object.fromEntries(await Promise.all(names.map(async n=>[n,await(await fetch(`/data/${n}.json`)).json()])));
      const s={scenario:{version:1,profile:'rhine',stageId:'act2autochess_m01',seed:1,round:1,units:[],enemies:[],bonds:{}},selectedUid:null,playing:false,time:0,speed:1};
      let listener=()=>{};const calls=[];window.labCalls=calls;
      const emit=()=>listener({...s});
      const c={records,get scenario(){return s.scenario;},
        setScenario(next){s.scenario=next;s.playing=false;emit();},select(uid){s.selectedUid=uid;emit();},
        start(){s.playing=true;emit();},pause(){s.playing=false;emit();},step(){s.time+=.05;emit();},reset(){s.time=0;s.playing=false;emit();},setSpeed(n){s.speed=n;emit();},
        castSkill(uid){calls.push(['cast',uid]);},animations(){return [{name:'Attack',duration:1.2}];},playAnimation(...a){calls.push(['animation',...a]);},previewFx(k){calls.push(['fx',k]);},inspect(){return null;},
        subscribe(fn){listener=fn;emit();return()=>{listener=()=>{};};},exportScenario(){return structuredClone(s.scenario);},
        async importScenario(json){calls.push(['import',json]);s.scenario=JSON.parse(json);emit();},async changeProfile(profile){s.scenario={...s.scenario,profile};emit();},preset(name){calls.push(['preset',name]);}};
      window.labController=c;window.labUI=mountLabUI({root:document.querySelector('#lab-ui'),controller:c,records});
      document.querySelectorAll('details').forEach(d=>{d.open=true;});
    });
    const layout=await page.evaluate(()=>{const f=document.querySelector('#lab-field').getBoundingClientRect(),p=document.querySelector('#lab-ui').getBoundingClientRect();return {fieldRight:f.right,panelLeft:p.left,width:f.width,height:f.height,scroll:document.querySelector('#lab-ui').scrollHeight>p.height};});
    assert.ok(layout.fieldRight<=layout.panelLeft && layout.width>=900 && layout.height>=600 && layout.scroll);
    assert.equal(await page.$$eval('#lab-stage option',x=>x.length),8);
    assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),true,'older scenarios display the enabled default');
    await page.click('#lab-layer-gains');
    await page.evaluate(()=>window.labUI.refresh({time:1}));
    assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),false,'routine notifications preserve the unapplied checkbox draft');
    await page.click('#lab-apply-scene');
    await page.waitForFunction(()=>window.labController.scenario.layerGainsEnabled===false);
    await page.type('#lab-unit-search','伊芙利特');await page.select('#lab-unit-kind','chess_rhine_ifrit_a');await page.select('#lab-quality','elite');
    await page.select('#lab-skill','2');await page.select('#lab-module','none');
    await page.$eval('[data-item-slot]',e=>{e.value='chess_item_rhine_terminal_a';});
    await page.click('#lab-add-unit');await page.waitForFunction('window.labController.scenario.units.length===1');
    let u=await page.evaluate(()=>window.labController.scenario.units[0]);
    assert.equal(u.id,'chess_rhine_ifrit_b');assert.equal(u.skillIndex,2);assert.equal(u.moduleId,'none');assert.deepEqual(u.items,['chess_item_rhine_terminal_a']);
    await page.select('#lab-quality','normal');await page.click('#lab-apply-unit');await page.waitForFunction('window.labController.scenario.units[0].id==="chess_rhine_ifrit_a"');
    u=await page.evaluate(()=>window.labController.scenario.units[0]);assert.equal(u.moduleId,undefined,'switching quality drops the old module selection');
    await page.click('#lab-cast');await page.click('#lab-play-animation');await page.click('#lab-preview-fx');
    assert.deepEqual(await page.evaluate(()=>window.labCalls.slice(0,3)),[['cast',u.uid],['animation',u.uid,'Attack',false],['fx','rhinePulse']]);
    assert.equal(await page.evaluate(()=>{const first=document.querySelector('#lab-animation').firstElementChild;for(let i=0;i<5;i++)window.labUI.refresh({animationNames:[{name:'Attack',duration:1.2}]});return first===document.querySelector('#lab-animation').firstElementChild;}),true,'unchanged controller notifications keep the open animation menu intact');
    await page.$eval('#lab-enemy-hp',e=>{e.value='12345';});await page.$eval('#lab-enemy-count',e=>{e.value='3';});await page.click('#lab-add-enemy');
    await page.waitForFunction('window.labController.scenario.enemies.length===1');
    const e=await page.evaluate(()=>window.labController.scenario.enemies[0]);assert.equal(e.count,3);assert.equal(e.stats.maxHp,12345);
    await page.type('#lab-bond-search','莱茵');await page.select('#lab-bond-kind','rhineShip');await page.select('#lab-bond-mode','override');
    await page.$eval('#lab-bond-count',e=>{e.value='6';});await page.$eval('#lab-bond-layers',e=>{e.value='100';});await page.click('#lab-apply-bond');
    await page.waitForFunction('window.labController.scenario.bonds.rhineShip?.layers===100');
    assert.deepEqual(await page.evaluate(()=>window.labController.scenario.bonds.rhineShip),{layers:100,count:6});
    await page.click('#lab-save');await page.click('#lab-export');
    const saved=await page.$eval('#lab-json',e=>e.value);assert.equal(JSON.parse(saved).units.length,1);
    assert.equal(JSON.parse(saved).layerGainsEnabled,false);
    await page.$eval('#lab-json',e=>{e.value='{ invalid';});await page.click('#lab-import');
    try { await page.waitForFunction('document.querySelector("#lab-message").classList.contains("is-error")',{timeout:3000}); }
    catch(error){console.log('pageerrors',errors);console.log(await page.evaluate(()=>{const b=document.querySelector('#lab-import'),r=b.getBoundingClientRect();return {message:document.querySelector('#lab-message').textContent,status:document.querySelector('#lab-run-status').textContent,calls:window.labCalls, json:document.querySelector('#lab-json').value,rect:{x:r.x,y:r.y,width:r.width,height:r.height},cover:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};}));throw error;}
    await page.click('#lab-load');await page.waitForFunction('!document.querySelector("#lab-message").classList.contains("is-error")');
    assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),false);
    await page.$eval('#lab-seed',e=>{e.value='0';});await page.click('#lab-apply-scene');
    await page.waitForFunction('document.querySelector("#lab-message").classList.contains("is-error")');
    assert.equal(await page.evaluate(()=>window.labController.scenario.seed),1,'invalid configuration is rejected before resetting battle');
    await page.$eval('#lab-seed',e=>{e.value='1';});await page.click('#lab-apply-scene');
    await page.select('#lab-profile','vanilla');await page.waitForFunction('window.labController.scenario.profile==="vanilla"');
    assert.equal(await page.$eval('#lab-device-energy',e=>e.disabled),true);
    assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),false);
    await page.click('#lab-start');await page.waitForFunction('document.querySelector("#lab-run-status").textContent==="运行中"');
    await page.click('#lab-pause');await page.click('#lab-step');await page.waitForFunction('document.querySelector("#lab-clock").textContent==="0.05 秒"');
    await page.click('#lab-toggle-tools');assert.equal(await page.$eval('#lab-ui',e=>getComputedStyle(e).display),'none');
    assert.ok(await page.$eval('#lab-field',e=>e.getBoundingClientRect().width)>=1279);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
