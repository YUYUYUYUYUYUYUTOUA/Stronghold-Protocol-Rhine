import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitInfo, unitTuple } from '../../server/sim/snapshot.js';
import { RHINE_BALANCE as B } from '../../shared/rhineResearch.js';

function setup(key, stage) {
  const tokenId = `token_rhine_${key}`;
  const actors = [['a',10,4],['b',11,5],['c',9,5]];
  const units = actors.map(([uid,row,col]) => ({uid,chessId:`${uid}_a`,row,col}));
  units.push({uid:'device',kind:'token',tokenId,row:10,col:5});
  const chess = Object.fromEntries(actors.map(([uid]) => [`${uid}_a`, chessRec({id:`${uid}_a`,stats:{maxHp:2000,atk:100,blockCnt:0},skill:{}})]));
  const kits = Object.fromEntries(actors.map(([uid]) => [`${uid}_a`, () => ({trait:{noAttack:true},skill:{kind:'instant',trigger:{rule:'NEVER'}}})]));
  const h = makeBattle({autoFinish:false,kits,defs:{chess,enemies:{dummy:enemyRec({key:'dummy',hp:100000,speed:0})}},
    players:[{playerId:'p1',seat:0,side:'L',colOffset:0,units,bonds:{rhineShip:{active:true,count:key==='laser'?9:3,layers:0}},
      research:{active:true,devices:[{uid:'device',key,tokenId,onBoard:true,stage}]}}]});
  h.step();return h;
}
const fx = (h,kind) => h.eventsOf('fx').filter(e=>e[1]===kind);
const done = h => {assert.deepEqual(h.b.errors,[]);checkInvariants(h.b);};

test('Rhine healing FX: one event per effective target, even when the heal also creates a shield',()=>{
  const h=setup('medical',2), d=h.unit('device');
  for(const id of ['a','b'])h.unit(id).hp=h.unit(id).s.maxHp-1;
  h.run(B.medicalInterval);
  const events=fx(h,'rhineHeal');assert.equal(events.length,3);
  for(const [i,id] of ['a','b','c'].entries()){
    const target=h.unit(id);
    assert.deepEqual(events[i],['fx','rhineHeal',target.x,target.y,{source:d.id,target:target.id,stage:2}]);
    assert.equal(target.hp,target.s.maxHp);assert.ok(target.s.shield>0);
  }
  done(h);
});

test('Rhine healing FX: healing-only and shield-only emit; full-health stage zero and cancelled heals stay silent',()=>{
  const healed=setup('medical',0);healed.unit('a').hp=100;healed.run(B.medicalInterval);
  assert.equal(fx(healed,'rhineHeal').length,1);assert.equal(fx(healed,'rhineHeal')[0][4].stage,0);done(healed);
  const shielded=setup('medical',1);shielded.run(B.medicalInterval);
  assert.equal(fx(shielded,'rhineHeal').length,2);assert.ok(shielded.unit('a').s.shield>0);done(shielded);
  const full=setup('medical',0);full.run(B.medicalInterval);
  assert.equal(fx(full,'rhineHeal').length,0);done(full);
  const cancelled=setup('medical',1);cancelled.b.on('heal',ctx=>{ctx.amount=0;});cancelled.run(B.medicalInterval);
  assert.equal(fx(cancelled,'rhineHeal').length,0);assert.equal(cancelled.unit('a').s.shield,0);done(cancelled);
});

test('Rhine visual metadata: all three research stages serialize and pulse/medical field name the source device',()=>{
  for(const stage of [0,1,2]){
    const energy=setup('energy',stage), d=energy.unit('device');energy.spawn('dummy',{pos:[10,6]});
    for(const uid of ['a','b','c'])assert.equal(energy.unit(uid).skill.activate('test',{free:true}),true);
    assert.equal(fx(energy,'rhinePulse').length,1);
    const target=energy.b.enemies[0];
    assert.deepEqual(fx(energy,'rhinePulse')[0][4],{fromX:d.x,fromY:d.y,source:d.id,target:target.id,stage});
    assert.equal(unitInfo(d).researchStage,stage);
    assert.equal(energy.eventsOf('spawn').find(e=>e[1].id===d.id)[1].researchStage,stage);
    assert.equal('researchStage' in JSON.parse(JSON.stringify(unitInfo(energy.unit('a')))),false);
    const ecology=setup('medical',stage);ecology.run(B.ecologyInterval);
    assert.equal(fx(ecology,'rhineEcology').length,2);
    for(const [i,event] of fx(ecology,'rhineEcology').entries()){
      assert.deepEqual(event[4],{source:ecology.unit('device').id,stage,active:true,radius:B.radius+(stage>=2?1:0),
        continuous:true,duration:B.ecologyInterval,bind:i>0&&stage>=2});
    }
    done(energy);done(ecology);
  }
});

test('medical field active state keeps its stage for reconnects and emits one stop/restart without an immediate bind',()=>{
  const h=setup('medical',2), d=h.unit('device'), bond=h.b.getPlayer('p1').bonds.rhineShip;
  const target=h.spawn('dummy',{pos:[10,7]});h.step();
  assert.equal(unitInfo(d).researchActive,true);assert.equal(unitInfo(d).researchStage,2);
  assert.equal(target.findBuff('slow').mods.moveMul,0.5);
  bond.active=false;h.step(4);
  assert.equal(unitInfo(d).researchActive,false);assert.equal(unitInfo(d).researchStage,2);
  assert.equal(target.findBuff('slow'),null);
  assert.deepEqual(fx(h,'rhineEcology').map(e=>[e[4].active,e[4].bind]),[[true,false],[false,false]]);
  h.step(4);assert.equal(fx(h,'rhineEcology').length,2,'disabled ticks do not repeat stop events');
  bond.active=true;h.step();
  assert.equal(unitInfo(d).researchActive,true);assert.equal(unitInfo(d).researchStage,2);
  assert.equal(target.findBuff('slow').mods.moveMul,0.5);assert.equal(!!target.s.flags.bind,false);
  assert.deepEqual(fx(h,'rhineEcology').map(e=>[e[4].active,e[4].bind]),[[true,false],[false,false],[true,false]]);
  bond.count=2;h.step();assert.equal(unitInfo(d).researchActive,false);
  bond.count=3;h.step();assert.equal(unitInfo(d).researchActive,true);
  assert.deepEqual(fx(h,'rhineEcology').slice(-2).map(e=>e[4].active),[false,true]);
  assert.equal('researchActive' in JSON.parse(JSON.stringify(unitInfo(h.unit('a')))),false);
  h.b.retreat(d,{permanent:true});assert.equal(unitInfo(d).researchActive,false);
  assert.equal(fx(h,'rhineEcology').at(-1)[4].active,false);
  done(h);
});

test('laser FX and reconnect metadata preserve the fixed stage, target and effective seconds while pausing the beam',()=>{
  const h=setup('laser',2), d=h.unit('device'), target=h.spawn('dummy',{pos:[10,9]});
  h.run(1);
  assert.equal(unitInfo(d).researchStage,0);
  assert.equal(h.eventsOf('spawn').find(e=>e[1].id===d.id)[1].researchStage,0);
  assert.equal(unitInfo(d).researchLaserTarget,target.id);
  assert.equal(unitInfo(d).researchLaserProgress,1);
  assert.equal(unitInfo(d).researchLaserActive,true);
  const active=fx(h,'rhineLaser').at(-1);
  assert.deepEqual(active.slice(2,4),[target.x,target.y]);
  assert.deepEqual(active[4],{source:d.id,target:target.id,fromX:d.x,fromY:d.y,active:true,progress:1});
  target.hidden=true;h.step();
  assert.equal(fx(h,'rhineLaser').at(-1)[4].active,false);
  assert.equal(unitInfo(d).researchLaserTarget,target.id);
  assert.equal(unitInfo(d).researchLaserProgress,1);
  assert.equal(unitInfo(d).researchLaserActive,false);
  target.hidden=false;h.run(.3);
  assert.equal(fx(h,'rhineLaser').at(-1)[4].active,true);
  assert.equal(unitInfo(d).researchLaserProgress,1.25);
  done(h);
});

test('laser clearing publishes an empty lock when its target dies without a successor',()=>{
  const h=setup('laser',0), d=h.unit('device'), target=h.spawn('dummy',{pos:[10,9]});
  h.run(1);assert.equal(unitInfo(d).researchLaserProgress,1);
  h.b.kill(target);h.step();
  assert.deepEqual(fx(h,'rhineLaser').at(-1),['fx','rhineLaser',d.x,d.y,
    {source:d.id,target:null,fromX:d.x,fromY:d.y,active:false,progress:0}]);
  const info=unitInfo(d);
  assert.deepEqual([info.researchLaserTarget,info.researchLaserProgress,info.researchLaserActive],[null,0,false]);
  const count=fx(h,'rhineLaser').length;h.step(5);
  assert.equal(fx(h,'rhineLaser').length,count,'an empty lock does not repeat clear events');
  done(h);
});

test('laser clearing after device disable publishes empty state even when its locked beam was already paused',()=>{
  for(const paused of [false,true]){
    const h=setup('laser',0), d=h.unit('device'), target=h.spawn('dummy',{pos:[10,9]});
    h.run(1);
    if(paused){target.hidden=true;h.step();assert.equal(fx(h,'rhineLaser').at(-1)[4].progress,1);}
    const count=fx(h,'rhineLaser').length;
    h.b.getPlayer('p1').input.research.active=false;h.step();
    assert.equal(fx(h,'rhineLaser').length,count+1);
    assert.deepEqual(fx(h,'rhineLaser').at(-1)[4],
      {source:d.id,target:null,fromX:d.x,fromY:d.y,active:false,progress:0});
    const info=unitInfo(d);
    assert.deepEqual([info.researchLaserTarget,info.researchLaserProgress,info.researchLaserActive],[null,0,false]);
    h.step(5);assert.equal(fx(h,'rhineLaser').length,count+1);
    done(h);
  }
});

test('energy full charge remains visible to snapshots and late joins until a target triggers one pulse',()=>{
  const h=setup('energy',1), d=h.unit('device');
  for(const uid of ['a','b','c'])assert.equal(h.unit(uid).skill.activate('test',{free:true}),true);
  h.run(B.energyContributorCooldown+0.1);
  assert.deepEqual(unitTuple(d,h.b.time).slice(5,7),[B.energyCharges,B.energyCharges]);
  assert.deepEqual([unitInfo(d).sp,unitInfo(d).spMax],[B.energyCharges,B.energyCharges]);
  assert.equal(fx(h,'rhinePulse').length,0);
  h.spawn('dummy',{pos:[10,6]});h.step();
  assert.equal(fx(h,'rhinePulse').length,1);
  assert.deepEqual(unitTuple(d,h.b.time).slice(5,7),[0,B.energyCharges]);
  h.step(5);assert.equal(fx(h,'rhinePulse').length,1);
  done(h);
});

test('energy charging serializes the actual progress for spawn, live snapshots and late joins, then resets after a pulse',()=>{
  const h=setup('energy',0), d=h.unit('device');
  assert.deepEqual([unitInfo(d).sp,unitInfo(d).spMax],[0,B.energyCharges]);
  assert.deepEqual(h.eventsOf('spawn').find(e=>e[1].id===d.id)[1].spMax,B.energyCharges);
  h.spawn('dummy',{pos:[10,6]});
  for(const [i,uid] of ['a','b'].entries()){
    assert.equal(h.unit(uid).skill.activate('test',{free:true}),true);
    assert.deepEqual(unitTuple(d,h.b.time).slice(5,7),[i+1,B.energyCharges]);
    assert.deepEqual([unitInfo(d).sp,unitInfo(d).spMax],[i+1,B.energyCharges]);
  }
  assert.equal(h.unit('c').skill.activate('test',{free:true}),true);
  assert.deepEqual(unitTuple(d,h.b.time).slice(5,7),[0,B.energyCharges]);
  assert.equal(fx(h,'rhinePulse').length,1);
  h.run(B.energyContributorCooldown+0.1);h.unit('a').skill.activate('test',{free:true});
  assert.equal(unitInfo(d).sp,1);
  h.b.getPlayer('p1').bonds.rhineShip.active=false;h.step();
  assert.deepEqual(unitTuple(d,h.b.time).slice(5,7),[0,B.energyCharges]);
  assert.equal('spMax' in JSON.parse(JSON.stringify(unitInfo(h.unit('a')))),false);
  done(h);
});
