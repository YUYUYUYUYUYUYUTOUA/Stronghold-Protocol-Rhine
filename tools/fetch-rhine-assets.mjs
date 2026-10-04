#!/usr/bin/env node
// Incremental expansion download; does not fetch or rewrite existing base-game assets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPlan } from './assets/plan.mjs';
import { rhineArtInput, addRhineArt } from './assets/rhine-plan.mjs';
import { indexAudio } from './assets/audio.mjs';
import { Downloader } from './assets/downloader.mjs';
import { processModels } from './assets/spine.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate, contentHash } from './assets/manifest.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = join(root, 'public', 'assets');
const cache = join(root, '.cache');
const inputs = rhineArtInput();
const plan = buildPlan({ ...inputs, audio: indexAudio({}), modelsData: {}, enemies05: {}, maps05: {} });
const template = { chars: plan.template.chars, tokens: plan.template.tokens, skills: plan.template.skills, skillsById: plan.template.skillsById,
  prof: { sub: plan.template.prof.sub } };
const dl = new Downloader({ root: assetRoot, ledgerPath: join(cache, 'rhine-assets-ledger.json'), concurrency: 8, timeoutMs: 25000, retries: 2 });
await mkdir(cache, { recursive: true });
await dl.loadLedger();
await downloadLeaves(collectLeaves(template), dl, assetRoot, 'Rhine art');
const spine = await processModels(plan.models, { root: assetRoot, dl, cachePath: join(cache, 'rhine-spine-cache.json') });
const resolved = resolveTemplate(template, { root: assetRoot, spine: spine.entries });
if (resolved.misses.length || spine.problems.length) {
  console.error(JSON.stringify({ misses: resolved.misses, problems: spine.problems }, null, 2));
  process.exitCode = 1;
} else {
  const path = join(root, 'data', 'assets.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const [key, value] of Object.entries(resolved.value)) {
    if (key === 'prof') manifest.prof = { ...manifest.prof, sub: { ...manifest.prof?.sub, ...value.sub } };
    else manifest[key] = { ...manifest[key], ...value };
  }
  addRhineArt(manifest);
  const { hash, ...body } = manifest;
  manifest.hash = contentHash(body);
  await writeFile(path, JSON.stringify(manifest) + '\n');
  console.log('Rhine art ready: six operators, Mayer summon, Dorothy trap, three devices and faction icon.');
}
