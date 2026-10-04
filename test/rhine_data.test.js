import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {applyRhineData,validateRhineData,RHINE_ADDITIONS} from '../tools/rhine-data.mjs';
import { bondMembers } from '../public/js/ui/gameLogic.js';
import { makeMatch, give } from './match/harness.js';
import { MetaRegistry } from '../server/match/effectsMeta.js';
import { registerMeta } from '../server/sim/content/rhineMeta.js';
import { RHINE_BALANCE, RHINE_DEVICES } from '../shared/rhineResearch.js';
import { DataSource } from '../server/sim/simdata.js';
import { loadoutRecord, resolveRecordLoadout } from '../shared/loadoutRecord.js';
const names=['chess','bonds','garrisons','tokens','effects','config','items'];
const files=Object.fromEntries(await Promise.all(names.map(async n=>[n,JSON.parse(await readFile(new URL(`../data/${n}.json`,import.meta.url),'utf8'))])));
const source=JSON.parse(await readFile(new URL('../tools/rhine-data-source.json',import.meta.url),'utf8'));

test('Rhine data: offline overlay is idempotent and preserves unrelated operator identities',async()=>{
  const before=JSON.stringify(files);const original=structuredClone(files.chess.chess_char_1_01_a);
  await applyRhineData(files);assert.equal(JSON.stringify(files),before);
  assert.deepEqual(files.chess.chess_char_1_01_a,original);assert.deepEqual(validateRhineData(files),[]);
});
test('Rhine data: exactly nine distinct visible members; existing IDs remain stable at tier III',()=>{
  assert.equal(files.bonds.rhineShip.visibleMembers.length,9);
  assert.equal(new Set(files.bonds.rhineShip.visibleMembers.map(id=>files.chess[id].charId)).size,9);
  for(const id of ['chess_char_4_21_a','chess_char_5_11_a'])assert.equal(files.chess[id].tier,3);
  assert.ok(Object.values(files.chess).filter(c=>c.name==='溯光星源').every(c=>c.bonds.includes('rhineShip')));
});
test('Rhine summons do not inherit the upstream tactical-point owner-range restriction',()=>{
  for(const id of ['token_10004_otter_motter',...RHINE_DEVICES.map(d=>d.tokenId)])assert.equal(files.tokens[id].ownerRange,false,id);
  for(const id of ['token_10028_vigil_wolf','token_10030_mlyss_wtrman'])assert.equal(files.tokens[id].ownerRange,true,id);
});
test('Rhine data: Astgenne alter receives only the extra bond on normal and elite records',async()=>{
  const input=structuredClone(files), ids=['chess_char_6_16_a','chess_char_6_16_b'];
  const original=Object.fromEntries(ids.map(id=>{
    input.chess[id].bonds=input.chess[id].bonds.filter(b=>b!=='rhineShip');
    return [id,structuredClone(input.chess[id])];
  }));
  await applyRhineData(input);
  for(const id of ids){
    assert.equal(input.chess[id].charId,'char_1047_halo2');
    assert.equal(input.chess[id].tier,6);
    assert.deepEqual(input.chess[id],{...original[id],bonds:[...original[id].bonds,'rhineShip']});
    assert.deepEqual(input.chess[id].bonds,['arcaneShip','skillfulShip','rhineShip']);
  }
  const members=bondMembers(input.bonds.rhineShip,{board:[{kind:'chess',id:ids[1]}]},[],id=>input.chess[id]);
  assert.equal(members.length,9);
  assert.deepEqual(members.find(c=>c.id===ids[0]),{id:ids[0],tier:6,name:'溯光星源',onBoard:true,owned:true,banned:false});
  assert.ok(input.bonds.arcaneShip.visibleMembers.includes(ids[0]));
  assert.ok(input.bonds.skillfulShip.visibleMembers.includes(ids[0]));
});
test('Rhine data: a real tier VI member unlocks research and each duplicate adds Ptilopsis layers',()=>{
  const registry=new MetaRegistry();registerMeta(registry);
  const h=makeMatch({mode:'solo',fake:true,registry}).start();h.toPrep(1);
  const ps=h.ps('p_0');
  for(const p of [...ps.board.values(),...ps.hand.filter(Boolean),...ps.temp.filter(Boolean)])if(p.kind==='chess')ps.returnCopies(p);
  ps.board.clear();ps.hand.fill(null);ps.temp.fill(null);ps.recompute();
  give(h.m,ps,'chess_rhine_mayer_a','board',[11,4]);
  give(h.m,ps,'chess_char_4_21_a','board',[12,4]);
  assert.equal(ps.bonds.rhineShip.count,2);assert.equal(ps.bonds.rhineShip.active,false);
  give(h.m,ps,'chess_char_6_16_a','board',[13,4]);
  assert.equal(ps.bonds.rhineShip.count,3);assert.equal(ps.researchView().capacity,1);
  h.m.dispatch(ps,'onPrepEnd',{round:1});
  assert.equal(ps.layers.rhineShip,3*RHINE_BALANCE.ptilopsisLayersPerMember[0]);
  give(h.m,ps,'chess_char_6_16_b','board',[14,4]);
  assert.equal(ps.bonds.rhineShip.count,3,'ordinary and elite are one member');
  h.m.dispatch(ps,'onPrepEnd',{round:1});
  assert.equal(ps.layers.rhineShip,7*RHINE_BALANCE.ptilopsisLayersPerMember[0],'duplicate member contributes a fourth real piece');
});
test('Rhine data: every official skill, requested defaults and real owner-specific otter stats',()=>{
  for(const spec of RHINE_ADDITIONS)for(const suffix of ['a','b']){
    const c=files.chess[`chess_rhine_${spec.key}_${suffix}`];assert.equal(c.charId,spec.charId);
    assert.deepEqual(c.skills.map(s=>s.skillId),source.charTable[spec.charId].skills.map(s=>s.skillId));
    assert.equal(c.skill.skillId,spec.skillId);assert.equal(c.skills.filter(s=>s.isDefault).length,1);
    assert.equal(c.skill.level,c.isGolden?7:4);assert.ok(c.stats.atk>0);assert.ok(c.rangeGrid.length>0);
  }
  const t=files.tokens.token_10004_otter_motter;
  assert.ok(t.variants.chess_rhine_mayer_b.stats.maxHp>t.variants.chess_rhine_mayer_a.stats.maxHp);
  assert.equal(t.variants.chess_rhine_mayer_a.count,1);assert.equal(t.variants.chess_rhine_mayer_b.count,2);
});
test('Rhine data: default modules compose real stats and none restores base traits and talents',()=>{
  const expected={mayer:['uniequip_002_otter'],wuhoo:['uniequip_002_turdus'],eunectes:['uniequip_002_zumama','uniequip_003_zumama'],ifrit:['uniequip_002_ifrit','uniequip_003_ifrit'],astgenne:['uniequip_002_halo'],dorothy:['uniequip_002_doroth']};
  const defaults={mayer:[0,'uniequip_002_otter'],wuhoo:[1,'uniequip_002_turdus'],eunectes:[2,'uniequip_002_zumama'],ifrit:[1,'uniequip_002_ifrit'],astgenne:[0,'uniequip_002_halo'],dorothy:[2,'uniequip_002_doroth']};
  const ds=new DataSource(files,null);
  for(const [key,ids] of Object.entries(expected)){
    const c=files.chess[`chess_rhine_${key}_b`], base=ds.getChess(c.chessId,{moduleId:'none'}), selected=ds.getChess(c.chessId);
    const [skillIndex,moduleId]=defaults[key];
    assert.deepEqual(c.modules.map(m=>m.uniEquipId),ids);
    assert.equal(resolveRecordLoadout(c).moduleId,moduleId);assert.equal(resolveRecordLoadout(c).skillIndex,skillIndex);
    assert.equal(files.chess[c.baseId].skill.index,skillIndex);
    assert.equal(selected,ds.getChess(c.chessId,{skillIndex,moduleId}),'implicit and explicit defaults share the resolved def');
    assert.deepEqual(base.raw.stats,c.statsBase);assert.deepEqual(base.traitBb,c.traitBase.bb);
    assert.deepEqual(base.raw.talents,c.talentsBase);assert.equal(base.raw.module?.active===true,false);
    assert.equal(selected.raw.module?.active===true,moduleId!=='none');
    assert.equal(files.chess[c.baseId].modules,undefined,'ordinary cards retain original no-module rules');
    assert.equal(ds.getChess(c.baseId).loadout.moduleId,null,'ordinary default never equips the elite module');
    for(const m of c.modules){
      assert.equal(m.level,1);assert.equal(m.isDefault,m.uniEquipId===moduleId);
      const equipped=ds.getChess(c.chessId,{moduleId:m.uniEquipId});
      for(const [k,amount] of Object.entries(m.attr))assert.equal(equipped.stats[k],base.stats[k]+amount,`${key} ${m.uniEquipId} ${k}`);
      assert.equal(ds.getChess(c.chessId,{moduleId:'none'}),base,'unequip returns the genuine baseline');
    }
  }
  const delta=ds.getChess('chess_rhine_ifrit_b',{moduleId:'uniequip_003_ifrit'});
  assert.equal(delta.traitBb.ep_damage_ratio,.08);
  assert.ok(!delta.talents.some(t=>t.bb.element_atk_scale),'Lv1 must not inherit the Lv2/3 elemental bonus');
  assert.equal(files.chess.chess_rhine_wuhoo_b.modules[0].typeName,'XAH-X');
  assert.equal(ds.getChess('chess_rhine_wuhoo_b').traitBb['chain.atk_scale'],.85);
  assert.equal(ds.getChess('chess_rhine_wuhoo_b',{moduleId:'none'}).traitBb['chain.atk_scale'],.75);
  assert.equal(ds.getChess('chess_rhine_eunectes_b').traitBb.sp_recover_ratio,-.8);
  assert.equal(ds.getChess('chess_rhine_eunectes_b',{moduleId:'none'}).traitBb.sp_recover_ratio,undefined);
  assert.equal(ds.getChess('chess_rhine_ifrit_b').traitBb.damage_scale,.1);
  assert.equal(ds.getChess('chess_rhine_ifrit_b',{moduleId:'none'}).traitBb.damage_scale,undefined);
});
test('Rhine data: higher levels remain supported and removed RA never becomes a selectable variant',async()=>{
  const upgraded=structuredClone(files);
  for(const tier of [1,4,5])upgraded.config.economy.chessStatus[tier].golden.equipLevel=3;
  await applyRhineData(upgraded);
  const get=(key,moduleId)=>{const c=upgraded.chess[`chess_rhine_${key}_b`];return loadoutRecord(c,resolveRecordLoadout(c,{moduleId}));};
  assert.equal(get('ifrit','uniequip_003_ifrit').talents.find(t=>t.bb.element_atk_scale).bb.element_atk_scale,.5);
  assert.equal(get('eunectes','uniequip_002_zumama').talents.find(t=>t.index===1).bb.sp_recovery_per_sec,.55);
  const stale=get('eunectes','uniequip_004_zumama'), hes=get('eunectes','uniequip_002_zumama');
  assert.equal(stale,hes,'removed RA selection falls back to the actual HES-X default');
  assert.ok(!stale.modules.some(m=>m.uniEquipId==='uniequip_004_zumama'));
  assert.ok(!stale.talents.some(t=>t.bb.range_radius||t.bb.block_cnt||t.bb.damage_scale),'sandbox-only effects never enter a combat record');
  assert.ok(source.battleEquipTable.uniequip_004_zumama.phases[2].parts.some(p=>p.validInGameTag==='sandbox'),'excluded raw source remains auditable');
  const otter=upgraded.tokens.token_10004_otter_motter.variants.chess_rhine_mayer_b;
  assert.equal(get('mayer','uniequip_002_otter').talents[0].bb.cnt,2,'module talent overrides cannot restore the upstream five-summon count');
  assert.equal(otter.count,2);
  assert.equal(otter.talents[0].bb.attack_speed,-30,'default module affects the default token variant');
  assert.deepEqual(Object.keys(otter.byModule),['none']);
  assert.equal(otter.byModule.none.talents[0].bb.attack_speed,-25,'unequipped token keeps the original slow');
  const ds=new DataSource(upgraded,null);
  for(const skillIndex of [0,1]){
    assert.equal(ds.getToken('token_10004_otter_motter','chess_rhine_mayer_b',{skillIndex}).talents[0].bb.attack_speed,-30);
    assert.equal(ds.getToken('token_10004_otter_motter','chess_rhine_mayer_b',{skillIndex,moduleId:'none'}).talents[0].bb.attack_speed,-25);
  }
});
test('Rhine data: both Mayer skills keep deployable otters with correct module variants',()=>{
  const ds=new DataSource(files,null), id='token_10004_otter_motter';
  for(const suffix of ['a','b'])for(const skillIndex of [0,1]){
    const owner=`chess_rhine_mayer_${suffix}`,v=files.tokens[id].variants[owner];
    assert.equal(v.skill.skillId,'sktok_motter_1');assert.deepEqual(Object.keys(v.bySkill),['1']);
    assert.equal(v.bySkill[1].skill.skillId,'sktok_motter_2');
    assert.equal(v.stats.deployLimit,suffix==='a'?1:2);
    assert.deepEqual((v.bySkill[skillIndex]||v).sources,['talent']);assert.equal((v.bySkill[skillIndex]||v).count,suffix==='a'?1:2);
    for(const moduleId of suffix==='a'?['none']:['none','uniequip_002_otter']){
      const token=ds.getToken(id,owner,{skillIndex,moduleId});
      assert.equal(token.talents[0].bb.max_deploy_count,suffix==='a'?1:2);
      if (v.byModule?.[moduleId]) assert.equal(v.byModule[moduleId].stats.deployLimit,suffix==='a'?1:2);
      assert.equal(token.talents[0].bb.attack_speed,-25);
    }
  }
});
test('Rhine data: every selectable skill has a manifest entry',async()=>{
  const assets=JSON.parse(await readFile(new URL('../data/assets.json',import.meta.url),'utf8'));
  for(const spec of RHINE_ADDITIONS)for(const s of files.chess[`chess_rhine_${spec.key}_a`].skills){
    const path=assets.skills[assets.skillsById[s.skillId]];
    assert.equal(typeof path,'string',s.skillId);
  }
});
test('Rhine data: installed selectable skill icons are nonempty',{skip:!existsSync(new URL('../public/assets/',import.meta.url))},async()=>{
  const assets=JSON.parse(await readFile(new URL('../data/assets.json',import.meta.url),'utf8'));
  for(const spec of RHINE_ADDITIONS)for(const s of files.chess[`chess_rhine_${spec.key}_a`].skills){
    const path=assets.skills[assets.skillsById[s.skillId]];
    const image=await readFile(new URL(`../public${path}`,import.meta.url));assert.ok(image.length>100,s.skillId);
  }
});
test('Rhine data: moved copy traits and distinct research currencies',()=>{
  const g=id=>files.garrisons[files.chess[id].garrisonIds[0]];
  assert.equal(g('chess_rhine_wuhoo_a').effectKey,'SERVER_FRONT_SAME_EFFECT_PREP_START');
  assert.equal(g('chess_rhine_eunectes_a').effectKey,'SERVER_FRONT_SAME_EFFECT_PREP_FIN');
  assert.equal(g('chess_char_4_21_a').effectKey,'RHINE_RESEARCH_BY_MEMBER');
  assert.equal(g('chess_char_4_21_a').bb.layer,2);
  assert.equal(g('chess_char_5_11_a').effectKey,'RHINE_SARIA_HEALING');
  for(const t of Object.values(files.tokens).filter(t=>t.tokenId.startsWith('token_rhine_')))assert.equal(t.stats.atk,300);
});

test('Rhine data: Astgenne keeps the requested tier, dual bonds and first-cast trait across both skills',()=>{
  const ds=new DataSource(files,null);
  for(const [suffix,layer] of [['a',3],['b',6]]){
    const c=files.chess[`chess_rhine_astgenne_${suffix}`],g=files.garrisons[c.garrisonIds[0]];
    assert.equal(c.tier,2);assert.deepEqual(c.bonds,['rhineShip','preciShip']);
    assert.equal(g.effectKey,'RHINE_ASTGENNE_FIRST_SKILL');assert.equal(g.bb.layer,layer);
    assert.equal(g.bbStr.bond_ids,'rhineShip,preciShip');
    for(const skillIndex of [0,1]){
      const v=ds.getChess(c.chessId,{skillIndex,moduleId:'none'});
      assert.equal(v.skill.id,`skchr_halo_${skillIndex+1}`);
      assert.equal(v.raw.talents[0].bb.interval,15);assert.equal(v.raw.talents[0].bb.max_stack_cnt,5);
    }
  }
  assert.equal(ds.getChess('chess_rhine_astgenne_b').traitBb['attack@chain.atk_scale'],1);
  assert.equal(ds.getChess('chess_rhine_astgenne_b',{moduleId:'none'}).traitBb['attack@chain.atk_scale'],undefined);
});

test('Rhine data: Dorothy has three skills, only TRP-Y and a consistent four/five trap limit in every loadout',async()=>{
  const ds=new DataSource(files,null),token='token_10025_doroth_recttp';
  for(const [suffix,count,layer,maxLayer] of [['a',4,2,24],['b',5,4,48]]){
    const id=`chess_rhine_dorothy_${suffix}`,c=files.chess[id],g=files.garrisons[c.garrisonIds[0]];
    assert.equal(c.tier,5);assert.deepEqual(c.bonds,['rhineShip']);assert.deepEqual(c.tokens,[token]);
    assert.equal(c.talents[0].bb.cnt,count);assert.equal(c.talents[0].bb['attack@max_cnt'],2);
    assert.ok(c.talents[0].desc.includes(`同时最多部署${count}个`));
    assert.equal(g.effectKey,'RHINE_DOROTHY_TRAP_RESEARCH');assert.deepEqual(g.bb,{layer,max_layer:maxLayer});
    for(const skillIndex of [0,1,2])for(const moduleId of suffix==='a'?['none']:['none','uniequip_002_doroth']){
      const owner=ds.getChess(id,{skillIndex,moduleId}),v=ds.getToken(token,id,{skillIndex,moduleId});
      assert.equal(owner.skill.id,`skchr_doroth_${skillIndex+1}`);assert.equal(owner.skill.trigger.rule,'SP_FULL');
      assert.equal(owner.raw.talents[0].bb.cnt,count);assert.equal(v.skill.id,`sktok_doroth_${skillIndex+1}`);
      assert.equal(v.skill.trigger.rule,'DOROTHY_TRAP');assert.equal(v.count,count);
      const raw=files.tokens[token].variants[id];assert.equal(raw.stats.deployLimit,count);assert.equal(raw.stats.deckStack,count);
      assert.equal((raw.bySkill[skillIndex]||raw).count,count);
    }
  }
  const elite=ds.getChess('chess_rhine_dorothy_b');
  assert.deepEqual(elite.raw.modules.map(m=>m.uniEquipId),['uniequip_002_doroth']);
  assert.equal(elite.traitBb.prob,.2);assert.equal(elite.traitBb.atk_scale,2);
  assert.equal(ds.getChess('chess_rhine_dorothy_b',{moduleId:'none'}).traitBb.prob,undefined);
  assert.equal(ds.getChess('chess_rhine_dorothy_b',{moduleId:'uniequip_003_doroth'}),elite,'excluded first module never loads');
  const upgraded=structuredClone(files);upgraded.config.economy.chessStatus[5].golden.equipLevel=3;
  await applyRhineData(upgraded);
  const upper=new DataSource(upgraded,null).getChess('chess_rhine_dorothy_b');
  assert.equal(upper.raw.talents[0].bb.cnt,5);assert.equal(upper.raw.talents[1].bb.atk,.04);
  assert.equal(upgraded.tokens[token].variants.chess_rhine_dorothy_b.stats.deployLimit,5);
});
