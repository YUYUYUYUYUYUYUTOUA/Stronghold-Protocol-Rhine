// Refresh the small pinned client-data subset used by the offline Kazdel overlay.
import { readFile, writeFile } from 'node:fs/promises';
const revision = JSON.parse(await readFile(new URL('./rhine-data-source.json', import.meta.url), 'utf8')).source.revision;
const base = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${revision}/zh_CN/gamedata/excel/`;
const names = ['character_table', 'skill_table', 'range_table', 'uniequip_table', 'battle_equip_table'];
const tables = await Promise.all(names.map(async name => {
  const response = await fetch(`${base}${name}.json`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}));
const [chars, skills, ranges, equipment, battleEquipment] = tables;
const ownerIds = ['char_290_vigna', 'char_4131_odda', 'char_219_meteo', 'char_4151_tinman', 'char_4071_peper',
  'char_4088_hodrer', 'char_4087_ines', 'char_311_mudrok', 'char_4133_logos', 'char_1035_wisdel', 'char_4132_ascln'];
const tokenIds = new Set();
function visitToken(x) {
  if (!x || typeof x !== 'object') return;
  for (const [key, value] of Object.entries(x)) {
    if ((key === 'tokenKey' || key === 'overrideTokenKey') && value) tokenIds.add(value);
    else if (key === 'displayTokenDict') for (const id of Object.keys(value || {})) tokenIds.add(id);
    else visitToken(value);
  }
}
for (const id of ownerIds) {
  if (!chars[id]) throw new Error(`Missing pinned character ${id}`);
  visitToken(chars[id]);
}
const ids = [...ownerIds, ...tokenIds];
const charTable = Object.fromEntries(ids.map(id => [id, chars[id]]));
const skillIds = [...new Set(Object.values(charTable).flatMap(c => (c.skills || []).map(s => s.skillId).filter(Boolean)))];
const skillTable = Object.fromEntries(skillIds.map(id => [id, skills[id]]));
const charEquip = Object.fromEntries(ownerIds.map(id => [id, equipment.charEquip[id] || []]));
const moduleIds = [...new Set(Object.values(charEquip).flat())];
const equipDict = Object.fromEntries(moduleIds.map(id => {
  const meta = equipment.equipDict[id];
  return [id, Object.fromEntries(['uniEquipId', 'uniEquipName', 'uniEquipIcon', 'typeIcon', 'typeName1', 'typeName2', 'type', 'charId', 'isSpecialEquip', 'showEvolvePhase', 'unlockEvolvePhase', 'charLevel'].filter(k => k in meta).map(k => [k, meta[k]]))];
}));
const uniequipTable = { charEquip, equipDict };
const battleEquipTable = Object.fromEntries(moduleIds.filter(id => battleEquipment[id]).map(id => [id, battleEquipment[id]]));
const rangeIds = new Set();
function visitRange(x) {
  if (!x || typeof x !== 'object') return;
  for (const [key, value] of Object.entries(x)) {
    if (key === 'rangeId' && value) rangeIds.add(value);
    else visitRange(value);
  }
}
visitRange(charTable); visitRange(skillTable); visitRange(battleEquipTable);
const rangeTable = Object.fromEntries([...rangeIds].sort().map(id => [id, ranges[id]]));
const source = { source: { repository: 'https://github.com/Kengxxiao/ArknightsGameData', revision,
  note: 'Pinned mirror of original client tables. Full-potential attributes, skill levels and ordinary module phases are compiled offline; no trust bonus.',
  verifiedAgainst: ownerIds.map(id => `https://prts.wiki/w/${encodeURIComponent(chars[id].name)}`),
  files: names.map(name => `${base}${name}.json`) }, charTable, skillTable, rangeTable, uniequipTable, battleEquipTable };
await writeFile(new URL('./kazdel-data-source.json', import.meta.url), JSON.stringify(source, null, 2) + '\n');
console.log(`Wrote ${ids.length} characters/tokens and ${skillIds.length} skills at ${revision}`);
