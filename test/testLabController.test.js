import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDataProfile } from '../server/data.js';
import { createBattleFromSpec } from '../server/sim/spec.js';
import { DataSource, setSimData } from '../server/sim/simdata.js';
import { absoluteRangeKeys } from '../server/sim/targeting.js';
import { createLabController } from '../public/dev/test-lab-controller.js';

const log={info(){},warn(){},error(){}};
const profiles={rhine:getDataProfile(true,{log}),vanilla:getDataProfile(false,{log})};
function setup(){
 let callback,clock=0,closed=false;
 const events=[],view={debug:{views:new Map(),interp:{snapToNewest(){}},fx:{update(){},simFx(){}},ctx:{}},
  stats(){return{};},on(){return()=>{};},setStage(){},enterBattle(){},setCamera(){},setLocalFeed(){},
  highlightTiles(){},pushSnapshot(){},pushEvents(ev){events.push(...ev.ev);},destroy(){closed=true;}};
 setSimData(profiles.rhine);
 const controller=createLabController({records:profiles.rhine,view,loadProfile:async p=>{setSimData(profiles[p]);return profiles[p];},
  sim:{createBattleFromSpec,DataSource,setSimData,absoluteRangeKeys,fxKinds:['rhinePulse']},
  frame:fn=>{callback=fn;return 1;},cancelFrame:()=>{callback=null;},now:()=>clock});
 return {controller,events,view,get closed(){return closed;},pump(ms){clock+=ms;callback?.(clock);}};
}

test('lab pauses the actual engine clock, steps exactly one tick, and scales playback without a network',()=>{
 const {controller:c,pump}=setup();
 try{
  const t=c.battle.time;pump(100);assert.equal(c.battle.time,t);
  c.step();assert.ok(Math.abs(c.battle.time-t-1/30)<1e-9);
  c.start();pump(100);assert.ok(Math.abs(c.battle.time-t-4/30)<1e-9);
  c.pause();const paused=c.battle.time;pump(100);assert.equal(c.battle.time,paused);
  c.setSpeed(4);c.start();pump(100);assert.ok(Math.abs(c.battle.time-paused-.4)<1e-9);
  c.reset();assert.equal(c.battle.time,t);assert.equal(c.state().playing,false);
  assert.deepEqual(c.battle.errors,[]);
 }finally{c.destroy();}
});

test('changing research layers rebuilds actual attack and inherited damage; invalid input preserves the prior battle',()=>{
 const {controller:c}=setup();
 try{
  const next=c.exportScenario();next.bonds.rhineShip.layers=0;c.setScenario(next);
  const before=c.battle.allyUnits.find(u=>u.uid===2).s.atk;
  next.bonds.rhineShip.layers=200;c.setScenario(next);
  assert.ok(c.battle.allyUnits.find(u=>u.uid===2).s.atk>before);
  const live=c.battle;next.units[0].row=99;
  assert.throws(()=>c.setScenario(next),/row/);assert.equal(c.battle,live);assert.equal(live.finished,false);
  c.select(null);assert.equal(c.state().selectedUid,null);
  const copy=c.exportScenario();copy.units[0].row=99;assert.notEqual(c.scenario.units[0].row,99);
 }finally{c.destroy();}
});

test('forcing a real skill fires the actual energy hooks and damage while visual previews leave simulation unchanged',()=>{
 const {controller:c}=setup();
 try{
  const uid=3,u=c.battle.allyUnits.find(x=>x.uid===uid),energy=c.battle.allyUnits.find(x=>x.uid===8);
  assert.ok(u.sp<u.spMax);const charge=energy.researchCharges??0;
  assert.equal(c.castSkill(uid),true);
  assert.equal(energy.researchCharges,charge+1);
  assert.deepEqual(c.battle.errors,[]);
  const t=c.battle.time,hp=c.battle.enemies[0].hp;
  assert.equal(c.previewFx('rhinePulse'),true);assert.equal(c.battle.time,t);assert.equal(c.battle.enemies[0].hp,hp);
  assert.equal(c.previewFx('unknown'),false);assert.match(c.state().error,/未知/);
 }finally{c.destroy();}
});

test('profile switching is isolated and failed cross-profile import restores the previous data and battle',async()=>{
 const {controller:c}=setup();
 try{
  const saved=c.exportScenario();await c.changeProfile('vanilla');
  assert.equal(c.scenario.profile,'vanilla');assert.ok(!c.records.bonds.rhineShip);
  await c.importScenario(JSON.stringify(saved));assert.equal(c.scenario.profile,'rhine');
  const battle=c.battle,bad={...saved,profile:'vanilla'};
  await assert.rejects(c.importScenario(bad),/unknown|unavailable/);
  assert.equal(c.battle,battle);assert.equal(c.scenario.profile,'rhine');assert.equal(c.records,profiles.rhine);
  c.preset('rhine-ecology');assert.ok(c.scenario.units.some(u=>u.id==='token_rhine_ecology'));
  assert.deepEqual(c.battle.errors,[]);assert.ok(c.battle.allyUnits.find(u=>u.defId==='token_rhine_ecology').researchActive);
 }finally{c.destroy();}
});

test('layer-gain control survives reset, JSON and profile switching, and old scenes restore default gains in the real engine',async()=>{
 const {controller:c}=setup();
 try{
  assert.equal(c.scenario.layerGainsEnabled,true);
  const next=c.exportScenario();next.layerGainsEnabled=false;c.setScenario(next);
  assert.equal(c.battle.flags.layerGainsEnabled,false);
  assert.equal(c.castSkill(3),true);
  assert.equal(c.battle.getPlayer('lab').bonds.rhineShip.layers,100);
  assert.equal(c.battle.allyUnits.find(u=>u.uid===8).researchCharges,1,'disabling layer gains preserves real skill hooks');
  c.reset();assert.equal(c.battle.flags.layerGainsEnabled,false);
  const saved=JSON.stringify(c.exportScenario());
  await c.changeProfile('vanilla');
  assert.equal(c.scenario.layerGainsEnabled,false);assert.equal(c.battle.flags.layerGainsEnabled,false);
  await c.changeProfile('rhine');
  assert.equal(c.scenario.layerGainsEnabled,false);assert.equal(c.battle.flags.layerGainsEnabled,false);
  await c.importScenario(saved);
  assert.equal(c.scenario.layerGainsEnabled,false);assert.equal(c.battle.flags.layerGainsEnabled,false);
  const legacy=JSON.parse(saved);delete legacy.layerGainsEnabled;
  await c.changeProfile('vanilla');await c.importScenario(JSON.stringify(legacy));
  assert.equal(c.scenario.layerGainsEnabled,true);assert.equal(c.battle.flags.layerGainsEnabled,true);
  assert.equal(c.castSkill(3),true);
  assert.equal(c.battle.getPlayer('lab').bonds.rhineShip.layers,103);
  assert.deepEqual(c.battle.errors,[]);
 }finally{c.destroy();}
});
