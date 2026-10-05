import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeLabUnit, formatLabStats } from '../../public/dev/test-lab-ui.js';

const read = name => JSON.parse(readFileSync(new URL(`../../data/${name}.json`,import.meta.url)));
const records = { chess:read('chess'), bonds:read('bonds'), garrisons:read('garrisons') };
test('lab descriptions use the chosen skill and resolved module rather than the record default', () => {
  const rec = records.chess.chess_rhine_ifrit_b;
  const text = describeLabUnit(rec,{skillIndex:2,moduleId:'none'},records,[{id:'rhineShip',count:6,layers:100,active:true}]);
  assert.match(text,/【技能】灼地/);
  assert.match(text,/【模组】\n未装备/);
  assert.match(text,/【协议特质】/);
  assert.match(text,/6 人 \/ 100 层 \/ 生效/);
  assert.doesNotMatch(text,/<@|<\/>|最高达到110%/);
  const equipped = describeLabUnit(rec,{skillIndex:1,moduleId:'uniequip_002_ifrit'},records);
  assert.match(equipped,/【技能】炎爆/);
  assert.match(equipped,/BLA-X/);
  assert.match(equipped,/最高达到110%/);
});
test('lab descriptions cover absent units and enemy skills without inventing module data', () => {
  assert.match(describeLabUnit(null,null,records),/请选择/);
  const text=describeLabUnit({name:'敌人',desc:'敌人说明',talents:{bb:{},bbStr:{}},skills:[{name:'测试技能',desc:'造成<@ba.vup>100</>伤害'}]},null,records);
  assert.match(text,/【技能】测试技能\n造成100伤害/);
  assert.match(text,/【说明】\n敌人说明/);
  assert.doesNotMatch(text,/【模组】/);
});
test('lab header summarizes combat and performance without dumping internal render state', () => {
  const text=formatLabStats({damage:12345.6,killed:2,total:10,errors:0,fps:59.9,particles:7,board3d:{triangles:40000},spine:{loaded:8}});
  assert.equal(text,'伤害 12,346 · 击杀 2/10 · 错误 0\n60 FPS · 粒子 7');
  assert.doesNotMatch(text,/board3d|triangles|spine|loaded/);
  assert.equal(formatLabStats(null),'');
});
