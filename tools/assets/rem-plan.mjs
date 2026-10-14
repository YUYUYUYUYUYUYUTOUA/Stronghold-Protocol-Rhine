import { readFileSync } from 'node:fs';
import { RAW } from './sources.mjs';
// Maintainer-supplied original, pinned to the verified handoff commit. Art stays in ignored public/assets.
export const REM_LOGO_URL = 'https://raw.githubusercontent.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/13df9cfd5f607a07ce4b1fa766439c3b012657cb/public/assets/bond/rem.png';
export function addRemArtPlan(template) {
  template.bonds ||= {};
  template.bonds.remShip = { alts: [{ rel: 'bond/rem.png', urls: [REM_LOGO_URL], kind: 'png' }] };
  return template;
}

// Actual operator-side reinforcement appearances are enemy models; the renderer resolves enemy keys directly.
export const REM_ENEMY_ART = Object.freeze({
  child: 'enemy_10221_agporc', miner: 'enemy_10222_agtski', combined: 'enemy_10223_agtrac',
  chef: 'enemy_10229_agactr', enthusiast: 'enemy_10226_agprnk', food: 'enemy_10228_agball',
  bus: 'enemy_10225_agpbus', boss: 'enemy_10230_agkiro',
});

/** Seven new native operators; the four existing operators retain their established art entries. */
export function remArtInput(input) {
  const source = JSON.parse(readFileSync(new URL('../rem-data-source.json', import.meta.url), 'utf8'));
  const operators = { ...input.assets07.operators }, chess = [...input.ops03.chess];
  for (const [id, char] of Object.entries(source.charTable)) {
    const model = folder => Object.fromEntries(['skel', 'atlas', 'png'].map(ext => [ext, { url: `${RAW.fexli}spine/${id}/${id}/${folder}/${id}.${ext}` }]));
    operators[id] = { name: char.name, subProfessionId: char.subProfessionId,
      subProfessionIcon: `${RAW.aa2}arts/ui/subprofessionicon/sub_${char.subProfessionId}_icon.png`,
      avatar: { e0e1: { url: `${RAW.yuanyan}avatar/${id}.png` }, e2: { url: `${RAW.yuanyan}avatar/${id}_2.png` } },
      portrait: { e0e1: { url: `${RAW.yuanyan}portrait/${id}_1.png` }, e2: { url: `${RAW.yuanyan}portrait/${id}_2.png` } },
      battleSpine: { front: model('Front'), back: model('Back') },
      skills: char.skills.map((skill,index) => {
        const iconId = source.skillTable[skill.skillId].iconId || skill.skillId;
        return { index, skillId: skill.skillId, iconId, icon: { url: `${RAW.yuanyan}skill/skill_icon_${iconId}.png` } };
      }),
    };
    chess.push({ chessId:`art_${id}`, charId:id, defaultSkillIndex:1 });
  }
  return { assets07:{...input.assets07,operators}, ops03:{...input.ops03,chess} };
}
