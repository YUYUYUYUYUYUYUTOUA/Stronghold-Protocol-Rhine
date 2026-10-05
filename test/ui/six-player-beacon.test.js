import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ItemDetail} from '../../public/js/ui/detailPanel.js';

function* walk(node) {
  if(Array.isArray(node)){for(const child of node)yield* walk(child);return;}
  if(!node||typeof node!=='object')return;
  yield node;
  yield* walk(node.props?.children);
}

for(const profile of ['data','data/vanilla']){
  const item=JSON.parse(readFileSync(new URL(`../../${profile}/items.json`,import.meta.url),'utf8')).chess_item_5_04_e_a;
  test(`${profile}: R14 reward beacon detail communicates immediate delivery without changing other beacons`,()=>{
    const regular=[...walk(ItemDetail({item,piece:{uid:'shop-beacon'},editable:false}))];
    const reward=[...walk(ItemDetail({item,piece:{uid:'reward-beacon',giftTiming:'immediate'},editable:false}))];
    const description=nodes=>nodes.find(node=>node.props?.class==='dtext')?.props.text;
    assert.equal(description(regular),item.descRaw,'ordinary and R10/R12 descriptions retain their delayed transfer');
    assert.match(description(reward),/立即向相应盟约人数最多的队友发送1个原干员/);
    assert.doesNotMatch(description(reward),/下个休整期/);
    assert.ok(reward.some(node=>Array.isArray(node.props?.children)&&node.props.children.includes('第14回合六人补给信标 · 使用后立即转赠')));
    assert.match(item.descRaw,/下个休整期/,'the shared game data record is unchanged');
  });
}
