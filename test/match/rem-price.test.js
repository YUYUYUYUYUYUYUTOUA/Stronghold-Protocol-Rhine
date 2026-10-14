import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
test('April fixed cards keep tier II, cost one, clamp discounts to zero and cannot rebuy a sold slot',()=>{
  const h=makeMatch({mode:'solo',difficulty:'TRAINING',humans:1,seed:101,fake:true}).start().toPrep(1);
  try {
    const ps=h.ps('p_0');
    assert.equal(ps.gd.chessPrice('chess_rem_aprl_a'),1);
    assert.equal(ps.gd.chessPrice('chess_rem_aprl_b'),1);
    assert.equal(ps.gd.tierOf('chess_rem_aprl_a'),2);
    assert.equal(ps.gd.sellPrice('chess_rem_aprl_a'),1);
    const dispatch=h.m.dispatch.bind(h.m);
    h.m.dispatch=(player,event,payload,opts)=>{dispatch(player,event,payload,opts);if(event==='onPrice'&&payload.id==='chess_rem_aprl_a')payload.price-=3;};
    ps.shop.slots[0]={kind:'chess',id:'chess_rem_aprl_a',basePrice:1,frozen:false,sold:false};
    assert.equal(ps.priceOf(ps.shop.slots[0]),0);
    const before=ps.funds;
    assert.deepEqual(ps.buy(0),{ok:true}); assert.equal(ps.funds,before,'zero cost never credits funds');
    assert.ok(ps.buy(0).error); assert.equal(ps.funds,before);
  } finally {h.m.dispose();}
});
