import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyRemData, REM_ADDITIONS } from '../tools/rem-data.mjs';
const names=['chess','bonds','garrisons','tokens','effects','config','items','backups'];
const files=Object.fromEntries(await Promise.all(names.map(async n=>[n,JSON.parse(await readFile(new URL(`../data/${n}.json`,import.meta.url),'utf8'))])));
test('Rim roster: eleven distinct fixed cards retain approved tiers, bonds and native skill choices',()=>{
  const members=files.bonds.remShip.visibleMembers.map(id=>files.chess[id]);
  assert.equal(members.length,11); assert.equal(new Set(members.map(c=>c.charId)).size,11);
  assert.deepEqual([1,2,3,4,5,6].map(t=>members.filter(c=>c.tier===t).length),[2,2,2,2,2,1]);
  for(const spec of REM_ADDITIONS) for(const grade of ['a','b']){
    const c=files.chess[`chess_rem_${spec.key}_${grade}`];
    assert.deepEqual(c.bonds,spec.bonds); assert.equal(c.tier,spec.tier);
    assert.equal(c.skill.index,['thumpy','ray'].includes(spec.key)?2:1);
    assert.equal(c.skills.length,['thumpy','ray'].includes(spec.key)?3:2);
    assert.equal(c.skill.level,grade==='b'?7:4);
    assert.equal(c.isDiy,false); assert.equal(c.chessType,'PRESET');
  }
  for(const grade of ['a','b']){const c=files.chess[`chess_rem_aprl_${grade}`];assert.equal(c.price,1);assert.equal(c.sellPrice,1);assert.deepEqual(c.bonds,['remShip']);}
});
test('Rim additions preserve native Ayerscarpe/Leonhardt identities and all DIY forms',async()=>{
  const rebuilt=structuredClone(files),beforeBackups=structuredClone(files.backups);
  const existing=['chess_char_3_02_a','chess_char_3_02_b','chess_char_4_14_a','chess_char_4_14_b'];
  const before=existing.map(id=>structuredClone(files.chess[id]));
  await applyRemData(rebuilt);
  assert.deepEqual(rebuilt.backups,beforeBackups);
  assert.deepEqual(existing.map(id=>rebuilt.chess[id]),before);
  for(const n of names)assert.deepEqual(rebuilt[n],files[n],`${n} idempotence`);
});
test('Rim fixed Ray exposes native sandbeast sources at every skill and original art keys',()=>{
  const t=files.tokens.token_10034_ray_sndbst;
  for(const grade of ['a','b']){
    const v=t.variants[`chess_rem_ray_${grade}`];
    assert.ok(v.sources.includes('talent'));
    for(const i of [0,1])assert.ok(v.bySkill[i].sources.includes('talent'));
  }
  assert.equal(files.tokens.token_rem_child,undefined,'reinforcement combat definitions stay layer-scaled, not fake asset-only tokens');
});
test('Asbestos has the approved Solo add-on without restoring Steadfast, keeping native skills and reinforcement trait',()=>{
  for(const grade of ['a','b']){
    const c=files.chess[`chess_rem_asbest_${grade}`];
    assert.deepEqual(c.bonds,['remShip','soloShip']);
    assert.equal(c.skills.length,2);
    assert.equal(c.skill.skillId,'skchr_asbest_2');
    const g=files.garrisons[`garrison_rem_asbest_${grade}`];
    assert.deepEqual(g.bb,grade==='a'?{def:20,res:3}:{def:40,res:6});
    assert.ok(c.garrisonIds.includes(g.garrisonId));
    assert.ok(!files.bonds.steadShip.members.includes(c.chessId));
  }
  assert.ok(files.bonds.soloShip.members.includes('chess_rem_asbest_a'));
  assert.ok(files.bonds.soloShip.visibleMembers.includes('chess_rem_asbest_a'));
});
test('Savage keeps the approved shared kill limits while Rem growth uses reinforcement survival time',()=>{
  for(const grade of ['a','b']){
    const g=files.garrisons[`garrison_rem_savage_${grade}`];
    assert.deepEqual(g.bb,grade==='a'?{layer:2,max_layer:24}:{layer:4,max_layer:48});
    assert.match(g.desc,/真实死亡/);
    assert.match(g.desc,/每个敌人只结算一次/);
    assert.match(g.desc,/同玩家每回合共享上限/);
  }
  assert.match(files.bonds.remShip.desc,/每累计1援军·秒/);
  assert.match(files.bonds.remShip.desc,/增加1%\/2%/);
  assert.match(files.bonds.remShip.desc,/200%\/300%/);
  assert.match(files.bonds.remShip.desc,/死亡或退场停止贡献，已得加成保留/);
  assert.match(files.bonds.remShip.desc,/本回合联防继承，下回合清零/);
  assert.match(files.bonds.remShip.desc,/火力覆盖内的合法可达敌人/);
  assert.match(files.bonds.remShip.desc,/同战场友方（包含合作队友）/);
  assert.match(files.bonds.remShip.desc,/援军彼此移动和停留可重叠/);
  assert.match(files.bonds.remShip.desc,/老板攻击力1000\+2S/);
  assert.match(files.bonds.remShip.desc,/200%攻击力的对地物理伤害/);
  assert.doesNotMatch(files.bonds.remShip.desc,/4%\/8%|每实际成功生成一个己方援军|设置的集合点/);
  for(const grade of ['a','b']) assert.deepEqual(files.garrisons[`garrison_rem_warmy_${grade}`].bb,
    grade==='a'?{layer:1,max_layer:16}:{layer:2,max_layer:32},'Warmy still rewards actual successful generations');
});
