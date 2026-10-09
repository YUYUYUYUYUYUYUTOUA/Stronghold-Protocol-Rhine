// Rebuild an offline extension at every potential rank using the native annotation format.
import { atRank, stripPotential, FULL_RANK } from '../shared/potential.js';
import { attachPotential } from './build-data.mjs';

function atPotential(files, rank) {
  const out = structuredClone(files);
  for (const [id, record] of Object.entries(out.chess)) out.chess[id] = stripPotential(atRank(record, rank));
  for (const unit of Object.values(out.backups?.units || {})) {
    for (const [key, form] of Object.entries(unit.forms)) unit.forms[key] = stripPotential(atRank(form, rank));
  }
  for (const table of [out.tokens, out.backups?.tokens]) {
    for (const token of Object.values(table || {})) {
      for (const [owner, variant] of Object.entries(token.variants || {})) token.variants[owner] = stripPotential(atRank(variant, rank));
    }
  }
  return out;
}

export async function applyPotentialOverlay(files, apply, source) {
  const passes = [];
  for (let rank = 0; rank <= FULL_RANK; rank++) {
    const current = atPotential(files, rank);
    await apply(current, { ...source, potRank: rank });
    passes.push(current);
  }
  const errors = attachPotential(passes.map(p => ({ chess: p.chess, tokens: p.tokens, backups: p.backups || { units: {}, tokens: {} } })));
  if (errors.length) throw new Error(errors.join('\n'));
  Object.assign(files, passes[FULL_RANK]);
  return files;
}
