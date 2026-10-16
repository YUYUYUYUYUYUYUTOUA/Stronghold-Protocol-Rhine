// SP_E2E=1 node --test test/ui/plugins-sandbox.e2e.test.js (coordinator: run this file alone).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client,hasChrome,sleep,problemsOf} from '../e2e/client.mjs';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {startServer} from '../../server/index.js';
const enabled=process.env.SP_E2E==='1' && hasChrome();
test('two sandbox-script players start without consent and Worker battles verify under site CSP', {skip:!enabled,timeout:300000},async t=>{
 const f=scriptFixture(t,{mode:'sandbox'});f.put('training',`export default sp => sp.content.register({install(b){b.on('battleStart',()=>{for(const u of b.allyUnits)b.addBuff(u,{key:'training',mods:{atkFlat:2}});});}});`);
 const previous=process.env.SP_PLUGIN_SCRIPTS;process.env.SP_PLUGIN_SCRIPTS='sandbox';
 t.after(()=>{if(previous===undefined)delete process.env.SP_PLUGIN_SCRIPTS;else process.env.SP_PLUGIN_SCRIPTS=previous;});
 const serverLog=[];
 const log=Object.fromEntries(['info','warn','error','debug'].map(level=>[level,(...args)=>{
  serverLog.push({at:Date.now(),level,text:args.map(x=>x instanceof Error?x.stack:String(x)).join(' ')});
  if(serverLog.length>400)serverLog.shift();
 }]));
 // Exercise the production 2x battle clock. Artificial 16x needs 480 Worker ticks/s and shortened the unchanged
 // timeLimit/speed + 15s result deadline below this full-renderer/SES fixture's measured cold-load + simulation time.
 const srv=await startServer({port:0,host:'127.0.0.1',quiet:true,log,pluginsDir:f.pluginsDir,assetIndex:false,matchHost:{matchOptions:{verify:'all',timerScale:0.1,combatSpeed:2,botRehearsal:0}}});
 t.after(()=>srv.close());
 const policy=(await fetch(srv.url)).headers.get('content-security-policy');
 assert.match(policy,/connect-src 'self';/);assert.ok(!/script-src[^;]*(?:data:|blob:|unsafe-eval)/.test(policy));
 const P=(await import('puppeteer-core')).default;
 const host=new Client(P,srv.url,'host',{prefix:'plugins-sandbox',w:1600,h:900}), guest=new Client(P,srv.url,'guest',{prefix:'plugins-sandbox',w:1600,h:900});
 // Browser context destruction releases the retained entry handles even if a diagnostic CDP read has stalled.
 t.after(async()=>{await host.close();await guest.close();});
 await host.open();await host.enter('凯尔希');await host.click('.mode-card','同盟模拟');await host.click('.diff-card','标准模拟');await host.click('.create-box button','创建同盟');
 const code=(await host.waitFor(s=>!!s.room?.code,'room created')).room.code;
 await guest.open();await guest.enter('阿米娅');await guest.click('.join-row input');await guest.page.keyboard.type(code);await guest.click('.join-row button','加入同盟');await guest.page.waitForSelector('.room-screen');
 await host.page.evaluate(()=>globalThis.__SP__.net.request('room.setPlugins',{plugins:[{id:'training'}]}));
 for(const c of [host,guest])await c.page.waitForFunction(()=>globalThis.__SP__.store.get().room?.content?.execution==='sandbox');
 await host.click('[data-testid="plugin-tag"]');
 await host.page.waitForSelector('[data-plugin="training"]');
 assert.match(await host.page.$eval('[data-plugin="training"]',e=>e.textContent),/脚本（沙箱）/);
 await host.click('.modal__actions button','完成');
 for(const c of [host,guest]) {
  assert.equal(await c.page.$('[data-testid="trusted-banner"]'),null);
  assert.equal(await c.page.evaluate(()=>globalThis.__SP__.store.get().room.content.trusted),undefined);
 }
 for(const c of [host,guest])await c.page.waitForFunction(()=>globalThis.__SP__.store.get().room.seats.filter(s=>s&&!s.isBot).every(s=>s.content==='ready'));
 // Observe production messages and runner state without changing their content, delivery or clocks.
 for(const c of [host,guest])await c.page.evaluate(()=>{
  const trace=globalThis.__SP_SANDBOX_E2E__={starts:[],ends:[],states:[]};
  globalThis.__SP__.net.on('b.start',m=>trace.starts.push({at:performance.now(),battleId:m.battleId,authoritative:m.authoritative,
   elapsed:m.elapsed,speed:m.speed,cs:m.spec?.cs,timeLimit:m.spec?.timeLimit,spawns:m.spec?.spawns?.length}));
  globalThis.__SP__.net.on('b.end',m=>trace.ends.push({at:performance.now(),...m}));
  let previous='';
  globalThis.__SP_RUNNER__.on('state',state=>{
   const key=JSON.stringify([state?.battleId,state?.loading,state?.authoritative,state?.done]);
   if(key!==previous){previous=key;trace.states.push({at:performance.now(),...state});}
  });
 });
 await guest.click('.room-bar__right button','准备就绪');await host.click('.room-bar__right button','开始模拟');
 await host.waitFor(s=>s.phase==='COMBAT','battle',120000);
 await host.page.waitForFunction(()=>[...globalThis.__SP_RUNNER__._entries.values()].some(e=>
   e.host?.remote && e.host.worker instanceof Worker && !e.battle.step && !e.battle.data));
 const firstEntries=await Promise.all([host,guest].map(c=>c.page.waitForFunction(()=>{
  const pid=globalThis.__SP__.store.get().me.playerId;
  return [...globalThis.__SP_RUNNER__._entries.values()].find(e=>e.kind==='normal'&&e.members.includes(pid));
 })));
 const battleIds=await Promise.all(firstEntries.map(entry=>entry.evaluate(e=>e.battleId)));
 for(const entry of firstEntries)assert.equal(await entry.evaluate(e=>e.host?.remote&&e.host.worker instanceof Worker
  &&!e.battle.step&&!e.battle.data),true,'each player uses an actual isolated simulation Worker');
 assert.equal(srv.lobby.getRoom(code).content.execution,'sandbox');
 const match=srv.lobby.getRoom(code).match;let accepted=false,last;
 const finished=new Map();
 for(const begin=Date.now();Date.now()-begin<90000;){
  last=await match.diag();
  for(const field of last.fields||[])if(field.done&&battleIds.includes(field.battleId))finished.set(field.battleId,field);
  if(battleIds.every(id=>finished.has(id))){accepted=battleIds.every(id=>finished.get(id).resultSource==='client')&&last.verifyStats.checked>=2;break;}
  await sleep(50);
 }
 // Print server evidence first: a stalled browser must not conceal the actual takeover reason. These diagnostic
 // reads have their own short bound; neither the 90s verification wait nor any gameplay/RPC deadline is extended.
 console.log('Sandbox server verification:',JSON.stringify(accepted?{server:last,firstBattles:[...finished.values()]}:{server:last,firstBattles:[...finished.values()],serverLog}));
 const clients=await Promise.all([host,guest].map(async(c,i)=>{
  let timer;
  try{return await Promise.race([(async()=>({label:c.label,problems:c.problems,
   firstEntry:await firstEntries[i].evaluate(e=>({battleId:e.battleId,authoritative:e.authoritative,delivery:e.delivery,
    resultSent:e.resultSent,done:e.done,failed:e.failed,cs:e.spec.cs,simCs:e.sim?.cs,time:e.battle?.time,ticks:e.battle?.tickCount,
    remote:e.host?.remote,stopped:e.host?.stopped,result:e.host?.packet?.result})),
   page:await c.page.evaluate(async()=>{
    const {errorLog}=await import('/js/diag.js');
    const s=globalThis.__SP__.store.get();
    return {trace:globalThis.__SP_SANDBOX_E2E__,content:s.room?.content,runner:globalThis.__SP_RUNNER__.stats(),errors:errorLog(),
     hidden:document.hidden,view:globalThis.__SP_VIEW__?.stats?.(),
     entries:[...globalThis.__SP_RUNNER__._entries.values()].map(e=>({battleId:e.battleId,authoritative:e.authoritative,
      delivery:e.delivery,resultSent:e.resultSent,done:e.done,failed:e.failed,time:e.battle?.time,ticks:e.battle?.tickCount,
      remote:e.host?.remote,stopped:e.host?.stopped,pending:e.host?.pending?.size}))};
   })}))(),new Promise(resolve=>{timer=setTimeout(()=>resolve({label:c.label,diagnosticTimeoutMs:5000,problems:c.problems}),5000);})]);
  }catch(error){return {label:c.label,diagnosticError:error.message,problems:c.problems};}
  finally{clearTimeout(timer);}
 }));
 console.log('Sandbox client verification diagnostics:',JSON.stringify(accepted?clients.map(c=>({label:c.label,firstEntry:c.firstEntry,
  problems:c.problems,errors:c.page?.errors,diagnosticError:c.diagnosticError,diagnosticTimeoutMs:c.diagnosticTimeoutMs})):clients));
 assert.ok(accepted,JSON.stringify({server:last,firstBattles:[...finished.values()]}));
 assert.deepEqual(battleIds.map(id=>finished.get(id)?.resultSource),['client','client'],'both captured battles were accepted from their real clients');
 assert.ok(last.verifyStats.checked>=2,'both real client results were re-simulated');
 assert.equal(last.verifyStats.rejected,0);assert.equal(last.verifyStats.mismatches,0);
 assert.deepEqual(problemsOf([host,guest]),[],'no browser console, page or request errors');
 for(const c of [host,guest])assert.equal(await c.page.$('[data-testid="trusted-banner"]'),null);
});
