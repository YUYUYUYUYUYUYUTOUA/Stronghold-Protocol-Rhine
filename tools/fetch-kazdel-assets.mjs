#!/usr/bin/env node
// Incremental Kazdel art generation preserves existing animation overrides and local-client summon models.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPlan } from './assets/plan.mjs';
import { kazdelArtInput, addKazdelArt } from './assets/kazdel-plan.mjs';
import { indexAudio } from './assets/audio.mjs';
import { Downloader } from './assets/downloader.mjs';
import { processModels } from './assets/spine.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate, contentHash } from './assets/manifest.mjs';
import { fetchExtensionVoices } from './assets/extension-voices.mjs';
import { restartForEnvProxy } from './assets/env-proxy.mjs';
async function main() {
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = join(root, 'public', 'assets'), cache = join(root, '.cache');
const inputs = kazdelArtInput({ assets07: { operators: {} }, ops03: { chess: [] } });
const plan = buildPlan({ ...inputs, audio: indexAudio({}), modelsData: {}, enemies05: {}, maps05: {} });
const template = { chars: plan.template.chars, skills: plan.template.skills, skillsById: plan.template.skillsById, prof: { sub: plan.template.prof.sub } };
const dl = new Downloader({ root: assetRoot, ledgerPath: join(cache, 'kazdel-assets-ledger.json'), concurrency: 8, timeoutMs: 25000, retries: 2, keepExisting: true });
await mkdir(cache, { recursive: true });
await dl.loadLedger();
await downloadLeaves(collectLeaves(template), dl, assetRoot, 'Kazdel art');
const spine = await processModels(plan.models, { root: assetRoot, dl, cachePath: join(cache, 'kazdel-spine-cache.json'), writable: rel => dl.written.has(rel) });
const resolved = resolveTemplate(template, { root: assetRoot, spine: spine.entries });
if (resolved.misses.length || spine.problems.length) {
  throw new Error(JSON.stringify({ misses: resolved.misses, problems: spine.problems }));
}
const path = join(root, 'data', 'assets.json');
const manifest = JSON.parse(await readFile(path, 'utf8'));
for (const [id, entry] of Object.entries(resolved.value.chars)) manifest.chars[id] = { ...manifest.chars[id], ...entry };
for (const key of ['skills', 'skillsById']) manifest[key] = { ...manifest[key], ...resolved.value[key] };
manifest.prof.sub = { ...manifest.prof.sub, ...resolved.value.prof.sub };
addKazdelArt(manifest);
await fetchExtensionVoices(root, inputs, manifest);
manifest.stats.chars = Object.keys(manifest.chars).length;
manifest.stats.skills = Object.keys(manifest.skills).length;
const { hash: _hash, ...body } = manifest;
manifest.hash = contentHash(body);
await writeFile(path, JSON.stringify(manifest) + '\n');
console.log('Kazdel art ready: all ten operator portraits, avatars, skill icons, models and faction icon.');
}
if (!restartForEnvProxy()) await main();
