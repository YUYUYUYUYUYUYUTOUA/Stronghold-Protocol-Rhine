import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { startRealServer, CHROME, OUT, hasChrome, sleep } from './client.mjs';

const enabled=(process.env.SP_E2E==='1'||!process.env.NODE_TEST_CONTEXT)&&hasChrome();
test('real browser laboratory edits and renders actual combat without creating an online match',{skip:!enabled,timeout:180000},async t=>{
 const {default:puppeteer}=await import('puppeteer-core');
 const server=await startRealServer();let browser;
 const problems=[];
 try{
  browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--mute-audio','--disable-background-timer-throttling'],protocolTimeout:90000});
  const page=await browser.newPage();await page.setViewport({width:1600,height:900});
  page.on('pageerror',e=>problems.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error')problems.push(m.text());});
  await page.goto(server.base+'/dev/test-lab.html',{waitUntil:'networkidle0',timeout:90000});
  await page.waitForFunction(()=>window.__lab?.ready||window.__lab?.error,{timeout:90000});
  assert.equal(await page.evaluate(()=>__lab.error),null);
  const state=()=>page.evaluate(()=>{const s=__lab.controller.state();return{...s,records:undefined,inspect:s.inspect?{...s.inspect,record:undefined}:null};});
  const reveal=async id=>{
   const summary=await page.$eval('#'+id,e=>{const d=e.closest('details');return d&&!d.open?d.querySelector('summary').textContent:null;});
   if(summary){const h=await page.$('#'+id);const s=await h.evaluateHandle(e=>e.closest('details').querySelector('summary'));await s.click();}
   await page.$eval('#'+id,e=>e.scrollIntoView({block:'center'}));
  };
  const click=async id=>{await reveal(id);await page.click('#'+id);};
  const select=async(id,value)=>{await reveal(id);await page.select('#'+id,String(value));};
  const fill=async(id,value)=>{await reveal(id);await page.click('#'+id,{clickCount:3});await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type(String(value));};
  const commit=async id=>{const rev=(await state()).revision;await click(id);await page.waitForFunction(r=>__lab.controller.state().revision>r,{},rev);const s=await state();assert.equal(s.error,'',JSON.stringify({error:s.error,battle:await page.evaluate(()=>__lab.controller.battle.errors)}));};
  mkdirSync(OUT,{recursive:true});

  await t.test('loads genuine models and a paused scene, with a clear non-overlapping desktop layout',async()=>{
   await page.waitForFunction(()=>__lab.controller.animations(1).length>0,{timeout:30000});await sleep(3500);
   const s=await state();assert.equal(s.playing,false);assert.equal(s.scenario.units.length,8);assert.equal(s.stats.errors,0);
   assert.ok(s.animationNames.some(a=>a.name==='Attack'));
   const boxes=await page.evaluate(()=>{const f=document.querySelector('#lab-field').getBoundingClientRect(),u=document.querySelector('#lab-ui').getBoundingClientRect();return{right:f.right,left:u.left,h:f.height};});
   assert.ok(boxes.right<=boxes.left+.1&&boxes.h>500);
   await page.screenshot({path:path.join(OUT,'test-lab-desktop.png')});
  });
  await t.test('manual covenant layers and counts change actual computed attack and activation',async()=>{
   await select('lab-unit-select',2);const atk=(await state()).inspect.stats.atk;
   await select('lab-bond-kind','rhineShip');await fill('lab-bond-layers',250);await select('lab-bond-mode','override');await fill('lab-bond-count',6);
   await commit('lab-apply-bond');const s=await state();assert.ok(s.inspect.stats.atk>atk);assert.equal(s.scenario.bonds.rhineShip.layers,250);
   assert.equal(s.inspect.bonds.find(b=>b.id==='rhineShip').count,6);
  });
  await t.test('elite, skill, module and equipment settings use the live engine loadout and description',async()=>{
   await select('lab-unit-select',2);await select('lab-quality','elite');await select('lab-skill',2);
   const first=await page.$eval('#lab-module',e=>[...e.options].find(o=>o.value!=='none').value);await select('lab-module',first);
   await reveal('lab-apply-unit');await page.select('[data-item-slot]','chess_item_rhine_terminal_a');await commit('lab-apply-unit');
   const s=await state();assert.equal(s.scenario.units.find(u=>u.uid===2).id,'chess_rhine_ifrit_b');assert.equal(s.inspect.loadout.skillIndex,2);assert.equal(s.inspect.loadout.moduleId,first);
   const actual=await page.evaluate(()=>{const u=__lab.controller.battle.allyUnits.find(u=>u.uid===2);return{skill:u.def.skill.index,module:u.def.loadout.moduleId,items:u.items};});
   assert.equal(actual.skill,2);assert.equal(actual.module,first);assert.ok(JSON.stringify(actual.items).includes('chess_item_rhine_terminal_a'));
   const text=await page.$eval('#lab-description',e=>e.value);assert.match(text,/技能|模组/);assert.match(text,/灼地|伊芙利特/);assert.doesNotMatch(text,/<script/i);
  });
  await t.test('real skill activation charges the energy device; start, pause and one tick control true simulation time',async()=>{
   await select('lab-unit-select',3);const before=await page.evaluate(()=>__lab.controller.battle.allyUnits.find(u=>u.uid===8).researchCharges??0);
   await click('lab-cast');assert.equal((await state()).error,'');assert.equal(await page.evaluate(()=>__lab.controller.battle.allyUnits.find(u=>u.uid===8).researchCharges),before+1);
   const a=(await state()).time;await click('lab-start');await sleep(650);await click('lab-pause');const b=(await state()).time;assert.ok(b>a);
   await sleep(200);assert.equal((await state()).time,b);await click('lab-step');assert.ok(Math.abs((await state()).time-b-1/30)<1e-9);
   assert.equal((await state()).stats.errors,0);
  });
  await t.test('actual Spine clip preview and particle preview remain separate from combat damage and clock',async()=>{
   await select('lab-unit-select',1);await page.waitForFunction(()=>document.querySelector('#lab-animation').options.length>0);
   await select('lab-animation','Attack');await click('lab-animation-loop');const a=await state();await click('lab-play-animation');await sleep(350);
   assert.equal(await page.evaluate(()=>__lab.view.debug.views.get(__lab.controller.inspect(1).unitId).actor.spine.state.tracks[0]?.animation.name),'Attack');
   assert.equal((await state()).time,a.time);
   const before=(await state()).stats.particles;await select('lab-fx','rhinePulse');await click('lab-preview-fx');assert.equal((await state()).error,'');
   assert.ok((await state()).stats.particles>before);assert.equal((await state()).stats.damage,a.stats.damage);assert.equal((await state()).time,a.time);
   await page.screenshot({path:path.join(OUT,'test-lab-animation.png')});
  });
  await t.test('enemy editor adds a real stationary group with exact custom defense',async()=>{
   await fill('lab-enemy-row',10);await fill('lab-enemy-col',9);await fill('lab-enemy-count',2);await fill('lab-enemy-hp',5000000);await fill('lab-enemy-atk',0);await fill('lab-enemy-def',432);await fill('lab-enemy-res',20);await fill('lab-enemy-speed',0);
   await commit('lab-add-enemy');const s=await state();assert.equal(s.inspect.stats.def,432);assert.equal(s.inspect.stats.moveSpeed,0);assert.equal(s.scenario.enemies.at(-1).count,2);assert.equal(s.stats.total,3);
  });
  await t.test('map switching, JSON export/local save/import, and profile round trips preserve genuine scenario state',async()=>{
   await select('lab-stage','act1autochess_m03');await commit('lab-apply-scene');assert.equal((await state()).scenario.stageId,'act1autochess_m03');
   await click('lab-export');const exported=await page.$eval('#lab-json',e=>e.value);const saved=JSON.parse(exported);assert.equal(saved.bonds.rhineShip.layers,250);
   await click('lab-save');await select('lab-profile','vanilla');await page.waitForFunction(()=>__lab.controller.scenario.profile==='vanilla');
   assert.equal(await page.evaluate(()=>__lab.controller.records.bonds.rhineShip??null),null);
   await click('lab-load');await page.waitForFunction(()=>__lab.controller.scenario.profile==='rhine');assert.deepEqual((await state()).scenario,saved);
   await fill('lab-json','{"version":1,"profile":"vanilla","units":[{"uid":1,"id":"missing","row":10,"col":5}]}');await click('lab-import');await sleep(250);
   assert.match(await page.$eval('#lab-message',e=>e.textContent),/unknown/);assert.deepEqual((await state()).scenario,saved);
   assert.equal(await page.$eval('#lab-profile',e=>e.value),'rhine');
   await fill('lab-json',exported);await commit('lab-import');
  });
  await t.test('layer-gain checkbox controls real skills and survives local storage, profile switching and legacy JSON',async()=>{
   assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),true);
   const initial=(await state()).scenario.bonds.rhineShip.layers;
   await click('lab-layer-gains');await sleep(300);
   assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),false,'periodic notifications preserve an unapplied draft');
   await commit('lab-apply-scene');
   assert.equal(await page.evaluate(()=>__lab.controller.battle.flags.layerGainsEnabled),false);
   await select('lab-unit-select',3);await click('lab-cast');
   assert.equal((await state()).error,'');
   assert.equal(await page.evaluate(()=>__lab.controller.battle.getPlayer('lab').bonds.rhineShip.layers),initial);
   assert.equal(await page.evaluate(()=>__lab.controller.battle.allyUnits.find(u=>u.uid===8).researchCharges),1,'real skills still charge research');
   await click('lab-export');const saved=JSON.parse(await page.$eval('#lab-json',e=>e.value));
   assert.equal(saved.layerGainsEnabled,false);await click('lab-save');
   await select('lab-profile','vanilla');await page.waitForFunction(()=>__lab.controller.scenario.profile==='vanilla');
   assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),false);
   assert.equal(await page.evaluate(()=>__lab.controller.battle.flags.layerGainsEnabled),false);
   await click('lab-load');await page.waitForFunction(()=>__lab.controller.scenario.profile==='rhine');
   assert.deepEqual((await state()).scenario,saved);assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),false);
   await click('lab-layer-gains');await commit('lab-apply-scene');await click('lab-cast');
   assert.equal(await page.evaluate(()=>__lab.controller.battle.flags.layerGainsEnabled),true);
   assert.equal(await page.evaluate(()=>__lab.controller.battle.getPlayer('lab').bonds.rhineShip.layers),initial+3);
   delete saved.layerGainsEnabled;await fill('lab-json',JSON.stringify(saved));await commit('lab-import');
   assert.equal(await page.$eval('#lab-layer-gains',e=>e.checked),true);
   assert.equal(await page.evaluate(()=>__lab.controller.battle.flags.layerGainsEnabled),true);
   assert.equal((await state()).stats.errors,0);
  });
  await t.test('ecology preset deploys an active device, canvas unit clicks select it, and the tools can collapse',async()=>{
   await select('lab-preset','rhine-ecology');await commit('lab-load-preset');const s=await state();const device=s.scenario.units.find(u=>u.id==='token_rhine_ecology');
   assert.ok(device);assert.equal(await page.evaluate(()=>__lab.controller.battle.allyUnits.find(u=>u.defId==='token_rhine_ecology').researchActive),true);
   await select('lab-unit-select',2);const point=await page.evaluate(()=>{const u=__lab.controller.scenario.units.find(u=>u.uid===1);return __lab.view.tileScreen(u.row,u.col);});
   await page.mouse.click(point.x,point.y-30);await page.waitForFunction(()=>__lab.controller.state().selectedUid===1,{timeout:10000});
   await page.setViewport({width:1280,height:720});await click('lab-toggle-tools');assert.equal(await page.$eval('#lab-ui',e=>getComputedStyle(e).display),'none');
   await page.screenshot({path:path.join(OUT,'test-lab-map-720.png')});await click('lab-toggle-tools');
   await page.setViewport({width:600,height:800});await sleep(300);assert.ok(await page.$eval('#lab-field',e=>e.getBoundingClientRect().height>200));
   await page.screenshot({path:path.join(OUT,'test-lab-narrow.png')});
  });
  assert.deepEqual(problems,[]);
  const health=await(await fetch(server.base+'/healthz')).json();
  assert.equal(health.matches,0);assert.equal(health.rooms,0);assert.equal(health.sockets,0);
 }finally{await browser?.close();await server.stop();}
});
