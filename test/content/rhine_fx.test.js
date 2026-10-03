import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { RHINE_BALANCE as B } from '../../shared/rhineResearch.js';

function setup(key, stage) {
  const tokenId = `token_rhine_${key}`;
  const actors = [['a',10,4],['b',11,5],['c',9,5]];
  const units = actors.map(([uid,row,col]) => ({uid,chessId:`${uid}_a`,row,col}));
  units.push({uid:'device',kind:'token',tokenId,row:10,col:5});
  const chess = Object.fromEntries(actors.map(([uid]) => [`${uid}_a`, chessRec({id:`${uid}_a`,stats:{maxHp:2000,atk:100,blockCnt:0},skill:{}})]));
  const kits = Object.fromEntries(actors.map(([uid]) => [`${uid}_a`, () => ({trait:{noAttack:true},skill:{kind:'instant',trigger:{rule:'NEVER'}}})]));
  const h = makeBattle({autoFinish:false,kits,defs:{chess,enemies:{dummy:enemyRec({key:'dummy',hp:100000,speed:0})}},
    players:[{playerId:'p1',seat:0,side:'L',colOffset:0,units,bonds:{rhineShip:{active:true,count:3,layers:0}},
      research:{active:true,devices:[{uid:'device',key,tokenId,onBoard:true,stage}]}}]});
  h.step();return h;
}
const fx = (h,kind) => h.eventsOf('fx').filter(e=>e[1]===kind);
const done = h => {assert.deepEqual(h.b.errors,[]);checkInvariants(h.b);};

test('Rhine healing FX: one event per effective target, even when the heal also creates a shield',()=>{
  const h=setup('medical',2), d=h.unit('device');
  for(const id of ['a','b'])h.unit(id).hp=h.unit(id).s.maxHp-1;
  h.run(B.medicalInterval);
  const events=fx(h,'rhineHeal');assert.equal(events.length,2);
  for(const [i,id] of ['a','b'].entries()){
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
  assert.equal(fx(shielded,'rhineHeal').length,1);assert.ok(shielded.unit('a').s.shield>0);done(shielded);
  const full=setup('medical',0);full.run(B.medicalInterval);
  assert.equal(fx(full,'rhineHeal').length,0);done(full);
  const cancelled=setup('medical',1);cancelled.b.on('heal',ctx=>{ctx.amount=0;});cancelled.run(B.medicalInterval);
  assert.equal(fx(cancelled,'rhineHeal').length,0);assert.equal(cancelled.unit('a').s.shield,0);done(cancelled);
});

test('Rhine visual metadata: all three spawn stages serialize and pulse/ecology name the source device',()=>{
  for(const stage of [0,1,2]){
    const energy=setup('energy',stage), d=energy.unit('device');energy.spawn('dummy',{pos:[10,6]});
    for(const uid of ['a','b','c'])assert.equal(energy.unit(uid).skill.activate('test',{free:true}),true);
    assert.equal(fx(energy,'rhinePulse').length,1);
    assert.deepEqual(fx(energy,'rhinePulse')[0][4],{source:d.id,stage});
    assert.equal(unitInfo(d).researchStage,stage);
    assert.equal(energy.eventsOf('spawn').find(e=>e[1].id===d.id)[1].researchStage,stage);
    assert.equal('researchStage' in JSON.parse(JSON.stringify(unitInfo(energy.unit('a')))),false);
    const ecology=setup('ecology',stage);ecology.run(B.ecologyInterval);
    assert.equal(fx(ecology,'rhineEcology').length,1);
    assert.deepEqual(fx(ecology,'rhineEcology')[0][4],{source:ecology.unit('device').id,stage,radius:B.radius+(stage>=2?1:0)});
    done(energy);done(ecology);
  }
});
