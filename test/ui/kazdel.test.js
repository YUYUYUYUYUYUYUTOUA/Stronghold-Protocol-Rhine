import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cannonStates } from '../../public/js/kazdelState.js';
import { KazdelCannonHud, cannonModeText } from '../../public/js/ui/kazdelHud.js';
import { snapHud } from '../../public/js/ui/gameLogic/format.js';
import { data } from '../../public/js/data.js';
import { resolveDetail, TokenDetail } from '../../public/js/ui/detailPanel.js';
import { kazdelRoster } from '../../public/dev/kazdel-fixture.js';

function nodes(v){return Array.isArray(v)?v.flatMap(nodes):v&&typeof v==='object'?[v,...nodes(v.props?.children)]:[];}
function text(v){return Array.isArray(v)?v.map(text).join(''):v&&typeof v==='object'?text(v.props?.children):typeof v==='string'||typeof v==='number'?String(v):'';}
const state={ownerId:'p1',stage:2,charge:7.5,maxCharge:15};

test('cannon progress validates malformed packets without confusing owners or exceeding capacity',()=>{
  assert.deepEqual(cannonStates(null),[]);
  assert.equal(cannonStates([{},null,{...state,stage:1}]).length,0);
  const list=cannonStates([state,{...state,ownerId:'p2',stage:3,charge:99},{...state,ownerId:3,charge:-2,maxCharge:0,warning:{x:1,y:2,until:NaN}}]);
  assert.deepEqual(list.map(s=>[s.ownerId,s.charge,s.max]),[['p1',7.5,15],['p2',15,15],[3,0,15]]);
  assert.equal(list[2].warning,null);
});

test('HUD differentiates six-person friendly fire, nine-person enemy-only and an accessible paused warning',()=>{
  assert.equal(KazdelCannonHud({states:[]}),null);
  assert.notEqual(cannonModeText(2),cannonModeText(3));
  const vnode=KazdelCannonHud({states:[state,{...state,ownerId:'p2',stage:3,warning:{x:6,y:10,until:10}}],gameTime:9.5,players:[{playerId:'p2',name:'队友'}]});
  const bars=nodes(vnode).filter(n=>n.props?.role==='progressbar');assert.equal(bars.length,2);
  assert.equal(bars[0].props['aria-valuenow'],7.5);assert.equal(bars[0].props['aria-valuemax'],15);
  assert.match(text(vnode),/敌我均伤/);assert.match(text(vnode),/0.5秒/);assert.match(text(vnode),/队友/);
  assert.match(text(KazdelCannonHud({states:[{...state,stage:3}],gameTime:12})),/仅伤敌军/);
});

test('normal battle HUD shape stays unchanged; Kazdel follows authoritative game time and state',()=>{
  assert.deepEqual(snapHud({killed:1,total:3,dp:10}),{killed:1,total:3,dp:10,boss:null});
  const hud=snapHud({gt:8.25,killed:1,total:3,dp:10,kazdel:[state]});
  assert.equal(hud.gameTime,8.25);assert.equal(hud.kazdel[0].charge,7.5);
});

test('all ten roster members resolve normally, while souls show donor art/name and no editable owner piece',async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async url=>{try{const body=readFileSync(new URL(`../../data/${String(url).split('/').pop()}`,import.meta.url),'utf8');return {ok:true,status:200,json:async()=>JSON.parse(body)};}catch{return {ok:false,status:404};}};
  try{
    await data.loadAll('chess','tokens','assets','backups');const roster=kazdelRoster(data.get('chess'));assert.equal(roster.length,10);
    for(const c of roster)assert.equal(resolveDetail({kind:'chess',id:c.chessId},new Map()).chess.charId,c.charId);
    const unit={id:91,uid:1,side:'ally',kind:'token',defId:'token_kazdel_soul',kazdelSoul:true,soulOf:11,name:'红豆 · 众魂',avatar:'char_290_vigna',maxHp:2345};
    const detail=resolveDetail({kind:'unit',unit},new Map([[1,{piece:{kind:'chess',id:roster[0].chessId}}]]));
    assert.equal(detail.type,'token');assert.equal(detail.soulState,unit);assert.equal(detail.piece,undefined);
    const vnode=TokenDetail({token:detail.token,soulState:unit,live:{src:'battle',maxHp:2345,atk:999,def:120,blockCnt:1,range:[[0,0],[0,1]]}});
    assert.match(text(vnode),/红豆 · 众魂/);assert.match(text(vnode),/不继承主动技能/);assert.match(text(vnode),/无时间限制/);
    assert.ok(nodes(vnode).some(n=>n.props?.src===data.get('assets').chars.char_290_vigna.avatar));
  }finally{globalThis.fetch=oldFetch;}
});
