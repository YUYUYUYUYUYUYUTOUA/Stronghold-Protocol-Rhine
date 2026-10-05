import { createFieldView } from '../js/render/app.js';
import { data, CORE_DATA_FILES } from '../js/data.js';
import { assets } from '../js/assets.js';
import { createBattleFromSpec } from '/sim/spec.js';
import { DataSource, setSimData } from '/sim/simdata.js';
import { absoluteRangeKeys } from '/sim/targeting.js';
import { FX_KINDS } from '../js/render/fx.js';
import { createLabController } from './test-lab-controller.js';
import { mountLabUI } from './test-lab-ui.js';

async function loadProfile(profile) {
  if(profile!=='rhine'&&profile!=='vanilla')throw new Error('数据档须为莱茵或原版');
  data.selectProfile(profile);
  await data.loadAll(CORE_DATA_FILES,'local','assets');
  if(!data.isReady(CORE_DATA_FILES))throw new Error('游戏数据加载失败，请刷新或检查本地完整整合包');
  const records=Object.fromEntries(CORE_DATA_FILES.map(name=>[name,data.get(name)]));
  setSimData(records);return records;
}
const hook={ready:false,error:null};window.__lab=hook;
try {
  const records=await loadProfile('rhine'); await assets.ready();
  const facade={lookup:(name,id)=>data.lookup(name,id),chess:id=>data.lookup('chess',id),token:id=>data.lookup('tokens',id),
    enemy:id=>data.lookup('enemies',id),item:id=>data.lookup('items',id),get:name=>data.get(name)};
  const view=await createFieldView(document.querySelector('#lab-field'),{data:facade,assets,settings:{quality:'high',damageNumbers:true}});
  const controller=createLabController({records,view,loadProfile,sim:{createBattleFromSpec,DataSource,setSimData,absoluteRangeKeys,fxKinds:Object.keys(FX_KINDS)}});
  hook.controller=controller;hook.view=view;
  mountLabUI({root:document.querySelector('#lab-ui'),controller,records});
  window.addEventListener('pagehide',()=>controller.destroy(),{once:true});
  hook.ready=true;
} catch(error) {
  hook.error=error.message;
  const target=document.querySelector('#lab-ui');
  if(target){target.textContent=`测试台启动失败：${error.message}。请使用完整整合包启动，并检查控制台。`;target.classList.add('lab-start-error');}
  console.error(error);
}
