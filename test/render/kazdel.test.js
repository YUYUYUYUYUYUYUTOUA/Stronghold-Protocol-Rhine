import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { renderInfo, showsDeathFx } from '../../public/js/render/app/info.js';
import { FxSystem } from '../../public/js/render/fx.js';
import { cannonTiles } from '../../public/js/render/fx/kazdel.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';

let fake, UnitView, look;
before(async () => { fake=installFakePixi();({UnitView,KAZDEL_SOUL_LOOK:look}=await import('../../public/js/render/units.js')); });
after(()=>fake.restore());
const cam=presetCamera('normal',{width:1280,height:720});
const state=(ownerId='p1',stage=2,until=10)=>({ownerId,stage,charge:13,maxCharge:15,warning:{x:6,y:10,until}});

test('a soul starts in its persistent donor form with translucent body and opaque HUD, without expiring',()=>{
  const info=renderInfo({id:11,kind:'token',side:'ally',defId:'token_kazdel_soul',spine:'char_290_vigna',avatar:'char_290_vigna',kazdelSoul:true,soulOf:1,form:'kazdelSoul',x:5,y:10,maxHp:2000});
  assert.equal(info.spine,'char_290_vigna');assert.equal(info.soulOf,1);assert.equal(info.kazdelSoul,true);
  const v=new UnitView(fakeViewCtx(fake.P,{cam:()=>cam}),info);
  assert.equal(v._formSpec(),look);v.update(.1,cam,1);v.update(.1,cam,180);
  assert.equal(v.body.alpha,.58);assert.equal(v.form,'kazdelSoul');assert.equal(v.remove,false);
  assert.ok(v.hud.alpha>v.body.alpha);assert.equal(showsDeathFx(info),false);
  const ordinary=renderInfo({id:12,kind:'op',side:'ally',spine:'char_290_vigna'});
  assert.equal('kazdelSoul' in ordinary,false);assert.equal(showsDeathFx(ordinary),true);
  v.destroy();
});

test('cannon footprint includes every diagonal of the nine cells and clips only outside the field',()=>{
  const cells=cannonTiles(6,10);assert.equal(cells.length,9);
  assert.ok(cells.some(([r,c])=>r===9&&c===5));assert.ok(cells.some(([r,c])=>r===11&&c===7));
  assert.deepEqual(cannonTiles(2,9,{r0:9,r1:12,c0:2,c1:10}),[[9,2],[9,3],[10,2],[10,3]]);
  assert.deepEqual(cannonTiles(NaN,2),[]);
});

test('persistent warnings use render-time snapshots, freeze on pause and clear independently per owner',()=>{
  const polygons=[],fx=Object.create(FxSystem.prototype),g={clear(){polygons.length=0;return this;},lineStyle(){return this;},beginFill(){return this;},drawPolygon(p){polygons.push(p);return this;},endFill(){return this;},moveTo(){return this;},lineTo(){return this;}};
  Object.assign(fx,{ctx:{cam:()=>cam,heightAt:()=>0},kazdelGfx:g});
  fx.syncKazdel([state(),state('p2',3,11)],9);fx._updateKazdel();assert.equal(polygons.length,18);
  const paused=structuredClone(polygons);fx._updateKazdel();assert.deepEqual(polygons,paused);
  fx.syncKazdel([state(),state('p2',3,11)],10.5);fx._updateKazdel();assert.equal(polygons.length,9);
  fx.syncKazdel([],10.5);fx._updateKazdel();assert.equal(polygons.length,0);
});

test('impact replaces event warning with square flashes and a visible strike, including low quality',()=>{
  for(const quality of ['low','high']){
    const fx=Object.create(FxSystem.prototype),flashes=[],particles=[],beams=[];
    const soul={x:5,y:10,z:0},body={x:5,y:10,z:0};
    Object.assign(fx,{ctx:{cam:()=>cam,heightAt:()=>0,settings:{quality},view:id=>id===1?body:soul,timeScale:()=>1},
      tileFlashes:[],tileFlash:(...x)=>flashes.push(x),particle:(...x)=>particles.push(x),burst(){},smoke(){},_beam:(...x)=>beams.push(x),
      ring(){throw Error('a square cannon must not draw a circular footprint');}});
    fx.simFx('kazdelCannonWarning',6,10,{ownerId:'p1',dur:2});assert.equal(flashes[0][0].length,9);assert.equal(flashes[0][4].key,'kazdel-warning:p1');
    fx.tileFlashes.push({key:'kazdel-warning:p1'},{key:'another'});
    fx.simFx('kazdelCannonImpact',6,10,{ownerId:'p1'});assert.deepEqual(fx.tileFlashes,[{key:'another'}]);
    assert.equal(flashes[1][0].length,9);assert.equal(particles[0][0],'pillar');
    fx.simFx('kazdelSoulHeal',5,10,{source:1,target:2});assert.equal(beams.length,1);
    fx.simFx('kazdelSoulEnd',5,10,{id:2,soulOf:1,reason:'kazdelReturn'});assert.equal(beams.length,2);
  }
});

test('supplemental state never reads a warning from a future snapshot',()=>{
  const b=new SnapshotBuffer();const first={t:5,units:[],kazdel:[]},future={t:8,units:[],kazdel:[state()]};
  b.push(first,0);b.push(future,3);
  assert.equal(b.rawAt(7),first);assert.equal(b.rawAt(8),future);assert.equal(b.rawAt(NaN),null);
});

test('effect lifecycle frees the separate warning graphics and never retains an old field warning',()=>{
  const fx=new FxSystem(fakeViewCtx(fake.P,{cam:()=>cam,view:()=>null}));
  fx.syncKazdel([state()],9);assert.equal(fx.kazdelWarnings.length,1);
  fx.clear();assert.deepEqual(fx.kazdelWarnings,[]);fx.destroy();assert.equal(fx.kazdelGfx.destroyed,true);
});
