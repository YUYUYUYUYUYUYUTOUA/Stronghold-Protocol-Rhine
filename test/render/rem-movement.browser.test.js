import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import * as rem from '../../server/sim/content/rem.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { ANIM } from '../../shared/constants.js';
import { startServer } from '../../server/index.js';
const chrome=process.env.CHROME_PATH||'/usr/bin/chromium';
const enabled=process.env.RENDER_E2E==='1'&&existsSync(chrome)&&existsSync('public/assets/bond/rem.png');
test('actual reinforcement art follows authoritative fractional samples with the same move clip as enemies', {skip:!enabled,timeout:60000},async()=>{
  let content=rem;
  const before=process.env.REM_MOTION_BEFORE==='1';
  if(before){
    const moduleUrl=new URL('../../server/sim/content/rem.js',import.meta.url);
    const old=execFileSync('git',['show','v0.2.4-rhine.5:server/sim/content/rem.js'],{encoding:'utf8'});
    const source=old.replace(/from '([^']+)'/g,(_,url)=>`from '${new URL(url,moduleUrl).href}'`);
    content=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  }
  const h=makeBattle({content:'generic',extraContent:[content],autoFinish:false,
    defs:{chess:{r:chessRec({id:'r',bonds:[],skill:null,stats:{atk:0}})},enemies:{target:enemyRec({key:'target',hp:1e9,atk:0,speed:0})}},units:[{chessId:'r',row:12,col:8}],bonds:{}});
  h.step();const state=h.b.remState.get('p1');state.gate=[10,3];state.vehicleStop=[10,8];
  if(before)state.rally=[10,8];
  const op=h.unit('r');op.rangeGrid=Array.from({length:8},(_,i)=>[10-op.tileR,3+i-op.tileC]);h.b._refreshRange(op);
  h.spawn('target',{pos:[10,10]});state.queue.push({type:'miner',source:'test'});h.step();
  const u=state.units[0];u.deployedAt=-10;const info=unitInfo(u),snapshots=[];
  for(let i=0;i<60;i++){h.step();const snap=h.b.snapshot();snap.fieldId='rem-motion';snap.units=snap.units.filter(t=>t[0]===u.id);snapshots.push(snap);}
  const jumps=snapshots.slice(1).map((s,i)=>Math.abs(s.units[0][1]-snapshots[i].units[0][1])+Math.abs(s.units[0][2]-snapshots[i].units[0][2]));
  if(before)assert.ok(Math.max(...jumps)>=1);else assert.ok(Math.max(...jumps)<=.041);
  const srv=await startServer({port:0,host:'127.0.0.1',quiet:true});
  const puppeteer=(await import('puppeteer-core')).default;
  const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1200,height:800});
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&paused=1&board=2d&quality=low&panel=0`);
    await page.waitForFunction('window.__demo?.ready');
    await page.evaluate(({info,snapshot})=>{
      window.__demo.view.enterBattle({fieldId:'rem-motion',kind:'normal',stageId:'act2autochess_m01',units:[info,{...info,id:9999,side:'enemy',kind:'enemy',y:info.y-2}]});
      window.__demo.view.pushSnapshot({...snapshot,units:[...snapshot.units,[9999,snapshot.units[0][1],snapshot.units[0][2]-2,...snapshot.units[0].slice(3,8),1]]});
    },{info,snapshot:snapshots[0]});
    await page.waitForFunction(id=>[id,9999].every(k=>window.__demo.view.debug.views.get(k)?.spineReady),{},u.id);
    const trace=await page.evaluate(({snapshots,id})=>{
      const view=window.__demo.view,buf=view.debug.interp,trace=[];
      for(const snap of snapshots)buf.push({...snap,units:[...snap.units,[9999,snap.units[0][1],snap.units[0][2]-2,...snap.units[0].slice(3,8),1]]},snap.t);
      for(let t=.65;t<1.55;t+=1/60){
        const samples=buf.sample(t),unit=view.debug.views.get(id),enemy=view.debug.views.get(9999);
        unit.sync(samples.get(id),t);enemy.sync(samples.get(9999),t);unit.update(1/60,view.debug.cam,t);enemy.update(1/60,view.debug.cam,t);
        trace.push({t,x:unit.x,sample:samples.get(id).x,anim:unit.anim,base:unit.actor.base,enemyBase:enemy.actor.base, facing:unit.visFacing,enemyFacing:enemy.visFacing});
      }
      view.debug.app.renderer.render(view.debug.app.stage);
      return trace;
    },{snapshots,id:u.id});
    assert.ok(trace.every(f=>Math.abs(f.x-f.sample)<1e-9));
    if(!before)assert.ok(trace.every(f=>f.anim===ANIM.MOVE&&f.base==='move'&&f.enemyBase==='move'&&f.facing===f.enemyFacing));
    mkdirSync('test/e2e/out',{recursive:true});await page.screenshot({path:`test/e2e/out/rem-motion-${before?'before':'after'}.png`});
    console.log(JSON.stringify({before,maxSimulationStep:Math.max(...jumps),renderedFrames:trace.length,moveFrames:trace.filter(f=>f.base==='move').length}));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await srv.close();}
});
