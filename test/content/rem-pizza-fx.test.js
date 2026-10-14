import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import * as rem from '../../server/sim/content/rem.js';

test('boss throw and impact FX preserve cached point, radius and one-second damage timing', () => {
  const h=makeBattle({content:'generic',extraContent:[rem],autoFinish:false,timeLimit:10,bonds:{remShip:{active:true,count:9,layers:100}}});
  const events=[],original=h.b.fx.bind(h.b);
  h.b.fx=(kind,ex)=>{ if(kind==='remPizza'||kind==='remPizzaImpact')events.push({kind,time:h.b.time,...ex}); return original(kind,ex); };
  h.run(3.1);
  const shot=events.find(e=>e.kind==='remPizza'),hit=events.find(e=>e.kind==='remPizzaImpact');
  assert.ok(shot);assert.ok(hit);
  assert.equal(shot.r,.45);assert.equal(shot.t,1);assert.equal(hit.r,.45);
  assert.equal(hit.x,shot.x);assert.equal(hit.y,shot.y);assert.equal(hit.src,shot.src);
  assert.ok(Math.abs(hit.time-shot.time-1)<1e-8);
  assert.deepEqual(h.b.errors,[]);
});
