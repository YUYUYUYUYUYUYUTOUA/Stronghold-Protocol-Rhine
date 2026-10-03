// Refresh the small, pinned source subset used by rhine-data.mjs. No bulk asset download.
import { writeFile } from 'node:fs/promises';
const revision = 'a550f5e048bb94e7cdefc6eb97a4091f0c4c7add';
const base = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${revision}/zh_CN/gamedata/excel/`;
const names = ['character_table', 'skill_table', 'range_table', 'uniequip_table', 'battle_equip_table'];
const tables = await Promise.all(names.map(async name => {
  const r = await fetch(`${base}${name}.json`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}));
const [chars, skills, ranges, equipment, battleEquipment] = tables;
const ids = ['char_242_otter','char_4224_turdus','char_416_zumama','char_134_ifrit','char_128_plosis','char_202_demkni','token_10004_otter_motter'];
const charTable = Object.fromEntries(ids.map(id => [id, chars[id]]));
const skillIds = [...new Set(Object.values(charTable).flatMap(c => (c.skills || []).map(s => s.skillId)))];
const skillTable = Object.fromEntries(skillIds.map(id => [id, skills[id]]));
const moduleOwners = ids.slice(0, 4);
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
  verifiedAgainst: ['梅尔','乌啾','森蚺','伊芙利特'].map(name => `https://prts.wiki/w/${encodeURIComponent(name)}`),
  files: names.map(name => `${base}${name}.json`) }, charTable, skillTable, rangeTable, uniequipTable, battleEquipTable };
await writeFile(new URL('./rhine-data-source.json', import.meta.url), JSON.stringify(source, null, 2) + '\n');
console.log(`Wrote ${ids.length} characters/tokens and ${skillIds.length} skills at ${revision}`);
