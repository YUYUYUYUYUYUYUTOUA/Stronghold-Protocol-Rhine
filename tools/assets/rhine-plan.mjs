// Local fan-expansion assets. Reuse the original downloader and Spine normalization pipeline.
import { RAW } from './sources.mjs';
import { readFileSync } from 'node:fs';
import { RHINE_DEVICES, RHINE_BOND } from '../../shared/rhineResearch.js';
export const RHINE_ART_OPERATORS = [
  ['char_242_otter', '梅尔', 'skchr_otter_1', 0],
  ['char_4224_turdus', '乌啾', 'skchr_turdus_2', 1],
  ['char_416_zumama', '森蚺', 'skchr_zumama_3', 2],
  ['char_134_ifrit', '伊芙利特', 'skchr_ifrit_2', 1],
  ['char_135_halo', '星源', 'skchr_halo_1', 0],
  ['char_4048_doroth', '多萝西', 'skchr_doroth_3', 2],
];
export const MAYER_TOKEN = 'token_10004_otter_motter';
export const DOROTHY_TOKEN = 'token_10025_doroth_recttp';
const source = JSON.parse(readFileSync(new URL('../rhine-data-source.json', import.meta.url), 'utf8'));
const model = (id, folder) => Object.fromEntries(['skel', 'atlas', 'png'].map(ext => [ext, { url: `${RAW.fexli}spine/${id}/${id}/${folder}/${id}.${ext}` }]));
export function rhineArtInput(assets07 = {}, ops03 = {}) {
  const operators = { ...assets07.operators };
  const chess = [...(ops03.chess || [])];
  for (const [id, name, skillId, index] of RHINE_ART_OPERATORS) {
    const subProfessionId = source.charTable[id].subProfessionId;
    operators[id] = { name, subProfessionId,
      subProfessionIcon: `${RAW.aa2}arts/ui/subprofessionicon/sub_${subProfessionId}_icon.png`,
      avatar: { e0e1: { url: `${RAW.yuanyan}avatar/${id}.png` }, e2: { url: `${RAW.yuanyan}avatar/${id}_2.png` } },
      portrait: { e0e1: { url: `${RAW.yuanyan}portrait/${id}_1.png` }, e2: { url: `${RAW.yuanyan}portrait/${id}_2.png` } },
      battleSpine: { front: model(id, 'Front'), back: model(id, 'Back') },
      skills: source.charTable[id].skills.map((s, i) => {
        const iconId = source.skillTable[s.skillId].iconId || s.skillId;
        return { index: i, skillId: s.skillId, iconId, icon: { url: `${RAW.yuanyan}skill/skill_icon_${iconId}.png` } };
      }),
    };
    chess.push({ chessId: `art_${id}`, charId: id, defaultSkillIndex: index });
  }
  return {
    assets07: { ...assets07, operators, tokens: { ...assets07.tokens, [MAYER_TOKEN]: {
      avatar: { url: `${RAW.yuanyan}avatar/${MAYER_TOKEN}.png` },
      battleSpineSkinVariantsOnly: [MAYER_TOKEN + '_ghost_1'],
    }, [DOROTHY_TOKEN]: {
      avatar: { url: `${RAW.yuanyan}avatar/${DOROTHY_TOKEN}.png` },
      // The mirrored client dump exposes this trap's official witch skin model only.
      battleSpineSkinVariantsOnly: [DOROTHY_TOKEN + '_witch_4'],
    } } },
    ops03: { ...ops03, chess, tokensUsedByPool: { ...ops03.tokensUsedByPool, [MAYER_TOKEN]: { usedByChess: ['art_char_242_otter'] }, [DOROTHY_TOKEN]: { usedByChess: ['art_char_4048_doroth'] } } },
  };
}
export function addRhineArt(manifest) {
  manifest.bonds ||= {}; manifest.tokens ||= {}; manifest.items ||= {};
  delete manifest.tokens.token_rhine_ecology;
  manifest.bonds[RHINE_BOND] = '/art/rhine/bond.svg';
  for (const d of RHINE_DEVICES) manifest.tokens[d.tokenId] = { avatar: d.sprite || d.icon };
  manifest.items.trap_rhine_terminal = '/art/rhine/terminal.png';
  manifest.items.trap_rhine_mainframe = '/art/rhine/mainframe.png';
  if (manifest.stats) for (const key of ['chars', 'tokens', 'bonds', 'items', 'skills', 'modules']) {
    if (manifest[key]) manifest.stats[key] = Object.keys(manifest[key]).length;
  }
  return manifest;
}
