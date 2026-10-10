// Native art for the Kazdel presets, using the existing offline/download pipeline and its mirrors.
import { readFileSync } from 'node:fs';
import { RAW } from './sources.mjs';
import { KAZDEL_BOND, KAZDEL_CHARACTERS } from '../../shared/kazdel.js';

const source = JSON.parse(readFileSync(new URL('../kazdel-data-source.json', import.meta.url), 'utf8'));
const model = (id, folder) => Object.fromEntries(['skel', 'atlas', 'png'].map(ext => [ext, { url: `${RAW.fexli}spine/${id}/${id}/${folder}/${id}.${ext}` }]));
export function kazdelArtInput(input) {
  const operators = { ...input.assets07.operators }, chess = [...input.ops03.chess];
  for (const id of Object.values(KAZDEL_CHARACTERS)) {
    const char = source.charTable[id];
    if (!char) continue;
    const subProfessionId = char.subProfessionId;
    operators[id] = {
      ...operators[id], name: char.name, subProfessionId,
      subProfessionIcon: `${RAW.aa2}arts/ui/subprofessionicon/sub_${subProfessionId}_icon.png`,
      avatar: { e0e1: { url: `${RAW.yuanyan}avatar/${id}.png` }, e2: { url: `${RAW.yuanyan}avatar/${id}_2.png` } },
      portrait: { e0e1: { url: `${RAW.yuanyan}portrait/${id}_1.png` }, e2: { url: `${RAW.yuanyan}portrait/${id}_2.png` } },
      battleSpine: operators[id]?.battleSpine ?? { front: model(id, 'Front'), back: model(id, 'Back') },
      skills: char.skills.map((s, index) => {
        const iconId = source.skillTable[s.skillId].iconId || s.skillId;
        return { index, skillId: s.skillId, iconId, icon: { url: `${RAW.yuanyan}skill/skill_icon_${iconId}.png` } };
      }),
    };
    if (!chess.some(c => c.charId === id)) chess.push({ chessId: `art_${id}`, charId: id, defaultSkillIndex: 0 });
  }
  return { assets07: { ...input.assets07, operators }, ops03: { ...input.ops03, chess } };
}

export function addKazdelArt(manifest) {
  manifest.bonds ||= {};
  manifest.bonds[KAZDEL_BOND] = '/art/kazdel/bond.png';
  if (manifest.stats) manifest.stats.bonds = Object.keys(manifest.bonds).length;
  return manifest;
}
