#!/usr/bin/env node
// Download the user-selected original logo, then regenerate its manifest entry. No art is committed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPlan } from './assets/plan.mjs';
import { indexAudio } from './assets/audio.mjs';
import { processModels } from './assets/spine.mjs';
import { cachedJson } from './assets/cache.mjs';
import { RAW } from './assets/sources.mjs';
import { remArtInput, REM_ENEMY_ART, addRemArtPlan, addRemArt } from './assets/rem-plan.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate, contentHash } from './assets/manifest.mjs';
import { isCompletePng } from './assets/formats.mjs';
import { Downloader } from './assets/downloader.mjs';
import { restartForEnvProxy } from './assets/env-proxy.mjs';
async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const assetRoot = join(root, 'public/assets'), cache = join(root, '.cache');
  const units = process.argv.includes('--units');
  if (units && process.argv.includes('--manifest-only')) throw new Error('--manifest-only is for the faction logo; use --units for incremental model downloads');
  const dl = new Downloader({ root: assetRoot, ledgerPath: join(cache, 'rem-assets-ledger.json'), concurrency: 8, timeoutMs: 20000, retries: 1, keepExisting: true });
  await mkdir(cache, { recursive: true }); await dl.loadLedger();
  let plan = null;
  if (units) {
    const modelsData = await cachedJson({ cacheFile:join(cache,'ark-models/models_data.json'), url:RAW.arkModels+'models_data.json', timeoutMs:20000 });
    plan = buildPlan({ ...remArtInput({assets07:{operators:{}},ops03:{chess:[]}}), modelsData, audio:indexAudio({}), extraEnemyIds:Object.values(REM_ENEMY_ART) });
  }
  const template = units ? { chars:plan.template.chars, enemies:plan.template.enemies, skills:plan.template.skills, skillsById:plan.template.skillsById, prof:{sub:plan.template.prof.sub} } : addRemArtPlan({});
  if (!process.argv.includes('--manifest-only')) {
    await mkdir(cache, { recursive: true });

    await downloadLeaves(collectLeaves(template), dl, assetRoot, 'Rem art');
  }
  if (!units) {
    const logo = await readFile(join(assetRoot, 'bond/rem.png'));
    if (!isCompletePng(logo)) throw new Error('Original Rem logo is not a complete PNG');
  }
  const spine = units ? await processModels(plan.models,{root:assetRoot,dl,cachePath:join(cache,'rem-spine-cache.json'),writable:rel=>dl.written.has(rel)}) : {entries:{},problems:[]};
  const resolved = resolveTemplate(template, { root: assetRoot, spine:spine.entries });
  if (resolved.misses.length || spine.problems.length) throw new Error(`Rem assets incomplete: ${JSON.stringify({misses:resolved.misses,models:spine.problems})}`);
  const path = join(root, 'data/assets.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const key of ['bonds','chars','enemies','skills','skillsById']) if (resolved.value[key]) manifest[key] = { ...manifest[key], ...resolved.value[key] };
  if (resolved.value.prof) manifest.prof.sub = {...manifest.prof.sub,...resolved.value.prof.sub};
  if (manifest.stats) for (const key of ['chars','enemies','skills']) manifest.stats[key] = Object.keys(manifest[key]||{}).length;
  if (manifest.stats) manifest.stats.bonds = Object.keys(manifest.bonds).length;
  addRemArt(manifest);
  const { hash: _hash, ...body } = manifest;
  manifest.hash = contentHash(body);
  await writeFile(path, JSON.stringify(manifest) + '\n');
  console.log(units ? 'Rem operators and reinforcements manifest ready.' : 'Original Rem faction logo manifest ready.');
}
if (process.argv.includes('--manifest-only') || !restartForEnvProxy()) await main();
