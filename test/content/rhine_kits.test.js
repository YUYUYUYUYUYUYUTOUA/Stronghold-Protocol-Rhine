import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import kits from '../../server/sim/content/kits/rhine.js';
const ds=getDefaultSource();
const id=k=>`chess_rhine_${k}_a`;
const raw=k=>ds.rawChess(id(k));
const dummy=key=>enemyRec({key,hp:1e7,speed:0,atk:0});
function run(key,{skillIndex,moduleId,...opts}={}) {
  return makeBattle({autoFinish:false,timeLimit:200,seed:7,captureNoisy:true,hooks:['damaged','heal','skillStart','statusApplied'],
    kits,defs:{chess:{[id(key)]:{...raw(key),bonds:[],garrisonIds:[]}},enemies:{e:dummy('e')}},
    units:[{chessId:id(key),row:10,col:4,skillIndex,moduleId}],...opts});
}
function done(h){assert.deepEqual(h.b.errors,[]);checkInvariants(h.b);}

test('Mayer: real otter stats, block slow, explosion arts/stun, recovery and automatic redeployment',()=>{
  const h=run('mayer',{skillIndex:1,enemies:[{key:'e',pos:[10,5]}]});h.run(0.5);
  const u=h.unit(id('mayer')), otter=h.b.allyUnits.find(x=>x.defId==='token_10004_otter_motter'&&x.alive);
  assert.ok(otter,'deploys her own summon');assert.equal(otter.ownerUnit,u);assert.ok(otter.s.atk>0);
  const enemy=h.b.enemies[0];assert.ok(enemy.findBuff('mayer:otterBlock'));
  u.skill.gainSp(999,'test');assert.equal(u.skill.activate('test'),true);
  const hits=h.hooksOf('damaged').filter(c=>c.source===u&&c.dmg.tags?.includes('mayerExplosion'));
  assert.ok(hits.length>0);assert.equal(hits[0].dmg.type,'arts');assert.ok(enemy.s.flags.stun);
  assert.ok(!otter.alive);h.run(1.2);
  assert.ok(h.b.allyUnits.some(x=>x.defId===otter.defId&&x.alive&&x!==otter));done(h);
});

test('Eunectes: SP requires blocking; S3 grants ATK, DEF, three blocks, regeneration, then stun',()=>{
  const h=run('eunectes',{skillIndex:2,moduleId:'none'});h.run(0.1);const u=h.unit(id('eunectes'));
  const sp=u.skill.sp;h.run(2);assert.equal(u.skill.sp,sp);u.skill.gainSp(10,'gift');assert.equal(u.skill.sp,sp);
  h.spawn('e',{pos:[10,4]});h.run(1);assert.ok(u.blocking.length);assert.ok(u.skill.sp>sp);
  u.skill.gainSp(999,'test');u.skill.activate('test');
  assert.equal(u.s.blockCnt,3);assert.ok(u.s.atk>u.base.atk*2);assert.ok(u.s.def>u.base.def);
  u.hp=u.s.maxHp*0.3;h.run(1);assert.ok(u.hp>u.s.maxHp*0.3);assert.ok(u.findBuff('eunectes:shelter'));
  assert.equal(u.s.physTakenMul,0.8);assert.equal(u.s.artsTakenMul,0.8);assert.equal(u.s.trueTakenMul,1);
  u.skill.end('test');assert.ok(u.s.flags.stun);assert.equal(u.s.blockCnt,1);done(h);
});

test('Mayer: a full hand-placed otter roster consumes her capacity before automatic placement',()=>{
  const h=run('mayer',{units:[{chessId:id('mayer'),uid:1,row:10,col:4},
    ...[[9,4],[10,5],[11,4],[10,3]].map(([row,col],i)=>({kind:'token',tokenId:'token_10004_otter_motter',ownerUid:1,uid:i+2,row,col}))]});
  h.run(11);const u=h.unit(1);
  assert.equal(h.b.allyUnits.filter(a=>a.defId==='token_10004_otter_motter'&&a.alive).length,4);
  assert.equal(u.mem.otterStock,0);done(h);
});

test('Ifrit: regular attack hits the entire straight line; S3 burns ground only, reduces RES and drains own HP',()=>{
  const fly=enemyRec({key:'fly',hp:1e7,speed:0,atk:0,motion:'FLY'});
  const h=run('ifrit',{skillIndex:2,moduleId:'none',defs:{chess:{[id('ifrit')]:{...raw('ifrit'),bonds:[],garrisonIds:[]}},enemies:{e:dummy('e'),fly}},
    enemies:[{key:'e',pos:[10,5]},{key:'e',pos:[10,7]},{key:'e',pos:[11,5]},{key:'fly',pos:[10,6]}]});
  h.run(3.3);const u=h.unit(id('ifrit'));
  const attacks=h.hooksOf('damaged').filter(c=>c.source===u&&c.dmg.isAttack);
  assert.ok(new Set(attacks.map(c=>c.target.id)).size>=3);
  assert.ok(attacks.every(c=>Math.round(c.target.y)===10));
  const hp=u.hp;u.skill.gainSp(999,'test');u.skill.activate('test');h.run(2.1);
  const burns=h.hooksOf('damaged').filter(c=>c.dmg.tags?.includes('ifritBurn'));
  assert.ok(burns.length>=4);assert.ok(burns.every(c=>!c.target.isFlying));assert.ok(u.hp<hp);
  assert.ok(h.b.enemies.filter(e=>Math.round(e.y)===10).every(e=>e.findBuff(`ifrit:res:${u.id}`)));
  done(h);
});

test('Wuhoo: chain heals three allies and herself as an extra hop; S2 adds camouflage and healing over time',()=>{
  const ally=chessRec({id:'patient',hp:10000,atk:0,rangeGrid:[],skill:{spCost:999}});
  const h=run('wuhoo',{defs:{chess:{[id('wuhoo')]:{...raw('wuhoo'),bonds:[],garrisonIds:[]},patient:ally},enemies:{}},
    units:[{chessId:id('wuhoo'),uid:'doc',row:10,col:4},
      {chessId:'patient',uid:'a',row:10,col:5},{chessId:'patient',uid:'b',row:11,col:4},{chessId:'patient',uid:'c',row:11,col:5}]});
  h.run(0.1);const u=h.unit('doc');for(const a of h.b.allyUnits)a.hp=a.s.maxHp*0.5;
  // Force A as primary; Wuhoo has lowest HP ratio and is therefore the first bounce.
  u.hp=u.s.maxHp*0.2;const a=h.unit('a');const hp=u.hp;
  h.b.heal(u,a,u.s.atk);
  const chain=h.hooksOf('heal').filter(c=>c.opts?.rhineBounce);
  assert.equal(chain.length,3);assert.ok(u.hp>hp);assert.ok(chain.some(c=>c.target===u));
  u.skill.gainSp(999,'test');u.skill.activate('test');
  const hidden=h.b.allyUnits.filter(a=>a.s.flags.camou);assert.ok(hidden.length>=3);
  const heals=h.hooksOf('heal').length;h.run(1.1);assert.ok(h.hooksOf('heal').length>heals);done(h);
});

test('Wuhoo: starting a heal on herself also strengthens it and grants the extra undiminished jump',()=>{
  const ally=chessRec({id:'patient',hp:10000,atk:0,rangeGrid:[],skill:{spCost:999}});
  const h=run('wuhoo',{defs:{chess:{[id('wuhoo')]:{...raw('wuhoo'),bonds:[],garrisonIds:[]},patient:ally},enemies:{}},
    units:[{chessId:id('wuhoo'),uid:'doc',row:10,col:4},
      ...[[10,5],[11,4],[11,5]].map(([row,col],i)=>({chessId:'patient',uid:`a${i}`,row,col}))]});
  h.run(0.1);const u=h.unit('doc');for(const a of h.b.allyUnits)a.hp=a.s.maxHp*0.1;
  const before=u.hp;h.b.heal(u,u,u.s.atk);
  assert.ok(Math.abs((u.hp-before)-u.s.atk*1.2)<1e-6);
  const chain=h.hooksOf('heal').filter(c=>c.opts?.rhineBounce);assert.equal(chain.length,3);
  // PRTS: her self-heal multiplier carries forward; the extra next jump keeps that strengthened amount.
  assert.ok(Math.abs(chain[0].amount-u.s.atk*1.2)<1e-6);done(h);
});

for(const key of ['mayer','wuhoo','eunectes','ifrit'])test(`${key}: normal and elite install without generic skill fallback`,()=>{
  const defaults={mayer:[0,'uniequip_002_otter'],wuhoo:[1,'uniequip_002_turdus'],eunectes:[2,'uniequip_002_zumama'],ifrit:[1,'uniequip_002_ifrit']};
  for(const suffix of ['a','b']){
    const cid=`chess_rhine_${key}_${suffix}`,h=makeBattle({autoFinish:false,kits,units:[{chessId:cid,row:10,col:4}],enemies:[]});
    h.run(1);const u=h.unit(cid);assert.ok(u.kit.talents?.length);assert.equal(u.skill.id,ds.rawChess(cid).skill.skillId);done(h);
    assert.equal(u.def.loadout.skillIndex,defaults[key][0]);
    assert.equal(u.def.loadout.moduleId,suffix==='b'?defaults[key][1]:null);
    assert.equal(u.kit.skillSource,'skills');
  }
});
