import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {rhineArtInput,RHINE_ART_OPERATORS,DOROTHY_TOKEN} from '../../tools/assets/rhine-plan.mjs';
import {buildPlan,GUIDE_PAGES} from '../../tools/assets/plan.mjs';
import {EMOTE_CATALOG} from '../../shared/constants.js';
import {indexAudio} from '../../tools/assets/audio.mjs';
import {moduleTypeIconUrl,subProfIconUrl} from '../../public/js/ui/assetUrls.js';

test('Rhine art plan includes both new operators, every selectable skill and the deployable trap',()=>{
  const input=rhineArtInput(),plan=buildPlan({...input,audio:indexAudio({}),modelsData:{},enemies05:{},maps05:{}});
  assert.equal(RHINE_ART_OPERATORS.length,6);
  for(const [id,count,index] of [['char_135_halo',2,0],['char_4048_doroth',3,2]]){
    assert.equal(input.assets07.operators[id].skills.length,count);
    assert.equal(input.ops03.chess.find(c=>c.charId===id).defaultSkillIndex,index);
    assert.ok(plan.template.chars[id]);
    for(const s of input.assets07.operators[id].skills)assert.equal(plan.template.skillsById[s.skillId],s.iconId);
  }
  assert.equal(plan.template.tokens[DOROTHY_TOKEN].owner,'char_4048_doroth');
  assert.ok(plan.models.has(`token:${DOROTHY_TOKEN}`));assert.ok(plan.template.prof.sub.traper);
  // The local art input must also retain the native 0.1.2 additions when the complete asset pipeline is rebuilt.
  for(const e of EMOTE_CATALOG)assert.ok(plan.template.ui[`emoticon/${e.dir}/${e.picId}`],e.id);
  for(const key of GUIDE_PAGES)assert.ok(plan.template.ui[`guide/${key}`],key);
});

test('Rhine installed art resolves new cards, all skill icons, trap Spine and both module glyphs',{skip:!existsSync(new URL('../../public/assets/',import.meta.url))},()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../data/assets.json',import.meta.url),'utf8'));
  const local=JSON.parse(readFileSync(new URL('../../data/local-assets.json',import.meta.url),'utf8'));
  const paths=[];
  for(const id of ['char_135_halo','char_4048_doroth']){
    const c=manifest.chars[id];assert.ok(c);paths.push(c.avatar,c.avatarE2,c.portrait,c.portraitE2);
    for(const s of Object.values(c.spine))paths.push(s.skel,s.atlas,...s.textures);
    paths.push(subProfIconUrl(manifest,{subProfessionId:id==='char_135_halo'?'chain':'traper'}));
  }
  const trap=manifest.tokens[DOROTHY_TOKEN];paths.push(trap.avatar,trap.spine.skel,trap.spine.atlas,...trap.spine.textures);
  for(const id of ['skchr_halo_1','skchr_halo_2','skchr_doroth_1','skchr_doroth_2','skchr_doroth_3'])paths.push(manifest.skills[manifest.skillsById[id]]);
  for(const type of ['CHA-Y','TRP-Y'])paths.push(moduleTypeIconUrl(local,type));
  for(const path of paths){assert.equal(typeof path,'string');assert.ok(readFileSync(new URL(`../../public${path}`,import.meta.url)).length>100,path);}
});
