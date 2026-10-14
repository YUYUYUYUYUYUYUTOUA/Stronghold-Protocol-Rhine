// Keep official translations only while their original Chinese source still matches.
// Changed expansion rules fall back to the current Chinese text, never an outdated rule.
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyRecordOverlay, buildRecordOverlay, getPath, textHash2, walkOverlay } from '../shared/i18nData.js';

export async function refreshRhineTranslations(out) {
  const directory = path.join(out, 'i18n');
  let names;
  try { names = await fs.readdir(directory); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const name of names.filter(n => /^[a-zA-Z-]+\.json$/.test(n))) {
    const file = path.join(directory, name), overlay = JSON.parse(await fs.readFile(file, 'utf8'));
    let changed = false;
    for (const [table, records] of Object.entries(overlay.files)) {
      const data = JSON.parse(await fs.readFile(path.join(out, `${table}.json`), 'utf8'));
      for (const [id, record] of Object.entries(records)) {
        if (!applyRecordOverlay(data[id], record).stale) continue;
        const leaves = [];
        let index = 0;
        walkOverlay(record, (p, en) => {
          const zh = getPath(data[id], p), hash = record._h.slice(index++ * 2, index * 2);
          if (typeof zh === 'string' && textHash2(zh) === hash) leaves.push({ path: p, zh, en });
        });
        const next = buildRecordOverlay(leaves);
        if (next) records[id] = next; else delete records[id];
        changed = true;
      }
    }
    // Keep Warmy's maintained extension text in every shipped language after data regeneration.
    const ui = JSON.parse(await fs.readFile(new URL(`../public/i18n/${name}`, import.meta.url), 'utf8'));
    const garrisons = JSON.parse(await fs.readFile(path.join(out, 'garrisons.json'), 'utf8'));
    for (const id of ['garrison_rem_warmy_a', 'garrison_rem_warmy_b']) {
      const source = garrisons[id];
      if (!source || !ui[source.desc]) continue;
      const next = buildRecordOverlay(['desc', 'descRaw'].map(p => ({ path: [p], zh: source[p], en: ui[source.desc] })));
      overlay.files.garrisons ??= {};
      if (JSON.stringify(overlay.files.garrisons[id]) !== JSON.stringify(next)) {
        overlay.files.garrisons[id] = next; changed = true;
      }
    }
    if (changed) await fs.writeFile(file, JSON.stringify(overlay));
  }
}
