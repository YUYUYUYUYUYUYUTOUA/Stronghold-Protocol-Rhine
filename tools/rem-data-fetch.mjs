// Refresh the small, pinned source subset used by rem-data.mjs. No bulk asset download.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const revision = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
const base = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${revision}/zh_CN/gamedata/excel/`;
const names = ['character_table', 'skill_table', 'range_table', 'uniequip_table', 'battle_equip_table'];
const tables = await Promise.all(names.map(async name => {
  return JSON.parse(execFileSync('curl', ['-fsSL', `${base}${name}.json`], { maxBuffer: 100 * 1024 * 1024 }).toString());
}));
const [chars, skills, ranges, equipment, battleEquipment] = tables;
const moduleOwners = ['char_4237_jcinta','char_449_glider','char_365_aprl','char_4081_warmy','char_4236_tmslot','char_230_savage','char_378_asbest'];
const ids = [...moduleOwners];
for (const id of ids) if (!chars[id]) throw new Error(`Missing pinned character ${id}`);
const charTable = Object.fromEntries(ids.map(id => [id, chars[id]]));
const skillIds = [...new Set(Object.values(charTable).flatMap(c => (c.skills || []).map(s => s.skillId)))];
const skillTable = Object.fromEntries(skillIds.map(id => [id, skills[id]]));
const charEquip = Object.fromEntries(moduleOwners.map(id => [id, equipment.charEquip[id]]));
const moduleIds = [...new Set(Object.values(charEquip).flat())];
const equipDict = Object.fromEntries(moduleIds.map(id => {
  const e = equipment.equipDict[id];
  return [id, Object.fromEntries(['uniEquipId','uniEquipName','uniEquipIcon','typeIcon','typeName1','typeName2','type','charId','isSpecialEquip','showEvolvePhase','unlockEvolvePhase','charLevel'].filter(k => k in e).map(k => [k, e[k]]))];
}));
const uniequipTable = { charEquip, equipDict };
const battleEquipTable = Object.fromEntries(moduleIds.filter(id => battleEquipment[id]).map(id => [id, battleEquipment[id]]));
const rangeIds = new Set();
function visit(x) { if (!x || typeof x !== 'object') return; for (const [k,v] of Object.entries(x)) { if (k === 'rangeId' && v) rangeIds.add(v); else visit(v); } }
visit(charTable); visit(skillTable); visit(battleEquipTable);
const rangeTable = Object.fromEntries([...rangeIds].sort().map(id => [id, ranges[id]]));
const source = { source: { repository: 'https://github.com/Kengxxiao/ArknightsGameData', revision,
  note: 'Extracted original client game data; no trust or potential bonuses. Optional modules retain all levels and mode conditions. This repository mirrors client data and is not an official Hypergryph repository.',
  verifiedAgainst: ['嘉辛塔','蜜莓','四月','温米','时隙','暴行','石棉'].map(name => `https://prts.wiki/w/${encodeURIComponent(name)}`),
  files: names.map(name => `${base}${name}.json`) }, charTable, skillTable, rangeTable, uniequipTable, battleEquipTable };
await writeFile(new URL('./rem-data-source.json', import.meta.url), JSON.stringify(source, null, 2) + '\n');
console.log(`Wrote ${ids.length} characters/tokens and ${skillIds.length} skills at ${revision}`);
