#!/usr/bin/env node
// Downloads, post-processes and indexes every art/audio/font asset the game
// needs, from community dumps of the official client (research 07):
//   public/assets/**   images, Spine models, audio   (git-ignored)
//   public/fonts/**    Bender / Novecento (.otf/.ttf + .woff2) and fonts.css
//   data/assets.json   manifest used by the client (schema: docs/ASSETS.md)
//
// Idempotent: existing files with the right size are skipped, so re-running is
// cheap. Downloads use ~16 parallel connections, 3 retries per source and a
// jsDelivr mirror fallback. Spine atlases get `size:` (and `pma: true` for
// enemies); every skeleton is parsed to resolve animation roles.
//
// Usage: node tools/fetch-assets.mjs [--concurrency=16] [--force] [--offline]
//                                    [--dry-run] [--refresh-index] [--prune] [--help]

import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Downloader } from './assets/downloader.mjs';
import { loadIndexes } from './assets/cache.mjs';
import { indexAudio } from './assets/audio.mjs';
import { buildPlan } from './assets/plan.mjs';
import { rhineArtInput, addRhineArt } from './assets/rhine-plan.mjs';
import { processModels } from './assets/spine.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate, totalBytes, contentHash, MANIFEST_VERSION } from './assets/manifest.mjs';
import { fontJobs, buildFonts } from './assets/fonts.mjs';
import { skelParserAvailable } from './assets/skel.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const FONTS = join(ROOT, 'public', 'fonts');
const CACHE = join(ROOT, '.cache');
const MANIFEST = join(ROOT, 'data', 'assets.json');
const REPORT = join(CACHE, 'assets-report.json');

const HELP = `Usage: node tools/fetch-assets.mjs [options]
  --concurrency=N   parallel downloads (default 16)
  --force           re-download files even when present
  --offline         no network: post-process what is on disk and rebuild data/assets.json
  --dry-run         print the plan and exit
  --refresh-index   re-download audio_data.json / models_data.json indexes
  --prune           delete files under public/assets that the manifest no longer references
  --help            this text`;

/**
 * Parse CLI flags.
 * @param {string[]} argv
 * @returns {{concurrency:number, force:boolean, offline:boolean, dryRun:boolean, refreshIndex:boolean, prune:boolean, help:boolean}}
 */
function parseArgs(argv) {
  const o = { concurrency: 16, force: false, offline: false, dryRun: false, refreshIndex: false, prune: false, help: false };
  for (const a of argv) {
    const [k, v] = a.split('=');
    if (k === '--concurrency') o.concurrency = Math.max(1, Math.min(64, parseInt(v, 10) || 16));
    else if (k === '--force') o.force = true;
    else if (k === '--offline') o.offline = true;
    else if (k === '--dry-run') o.dryRun = true;
    else if (k === '--refresh-index') o.refreshIndex = true;
    else if (k === '--prune') o.prune = true;
    else if (k === '--help' || k === '-h') o.help = true;
    else throw new Error(`unknown option ${a}\n${HELP}`);
  }
  return o;
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const log = (m) => console.log(m);

async function readJson(rel) {
  const p = join(ROOT, rel);
  try { return JSON.parse(await readFile(p, 'utf8')); } catch (e) { throw new Error(`cannot read ${rel}: ${e.message}`); }
}

async function writeJsonAtomic(path, value, indent) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(value, null, indent) + '\n');
  await rename(path + '.tmp', path);
}

/** All files under a directory, as forward-slash paths relative to it. */
async function listFiles(dir, base = dir, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFiles(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

/** Remove fields that only make sense next to a resolved spine. */
function tidyManifest(m) {
  for (const e of Object.values(m.enemies || {})) if (!e.spine) delete e.spineAliasOf;
  for (const t of Object.values(m.tokens || {})) if (!t.spine) delete t.spineVariant;
  if (m.skillsById) {
    for (const [sid, iconId] of Object.entries(m.skillsById)) if (!m.skills?.[iconId]) delete m.skillsById[sid];
  }
  for (const c of Object.values(m.chars || {})) if (c.spine && !Object.keys(c.spine).length) delete c.spine;
}

function countStats(m, bytes, files) {
  const vals = (o) => Object.values(o || {});
  const spines = new Set();
  for (const c of vals(m.chars)) for (const s of vals(c.spine)) spines.add(s.skel);
  for (const e of vals(m.enemies)) if (e.spine) spines.add(e.spine.skel);
  for (const t of vals(m.tokens)) if (t.spine) spines.add(t.spine.skel);
  return {
    files,
    bytes,
    chars: Object.keys(m.chars || {}).length,
    charsWithBack: vals(m.chars).filter((c) => c.spine?.back).length,
    enemies: Object.keys(m.enemies || {}).length,
    enemiesWithSpine: vals(m.enemies).filter((e) => e.spine).length,
    tokens: Object.keys(m.tokens || {}).length,
    tokensWithSpine: vals(m.tokens).filter((t) => t.spine).length,
    spineModels: spines.size,
    bonds: Object.keys(m.bonds || {}).length,
    items: Object.keys(m.items || {}).length,
    bands: Object.keys(m.bands || {}).length,
    skills: Object.keys(m.skills || {}).length,
    ui: Object.keys(m.ui || {}).length,
    sfxUnits: Object.keys(m.audio?.sfx?.units || {}).length,
  };
}

/** Required assets whose absence makes the run fail (exit code 1). */
function requiredMisses(m, charIds) {
  const out = [];
  for (const id of charIds) {
    const c = m.chars?.[id];
    if (!c?.avatar) out.push(`${id}.avatar`);
    if (!c?.portrait) out.push(`${id}.portrait`);
    if (!c?.spine?.front) out.push(`${id}.spine.front`);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { log(HELP); return 0; }
  const t0 = Date.now();
  log(`[assets] root ${ROOT}`);
  if (!skelParserAvailable()) throw new Error('@pixi-spine/runtime-3.8 not found — run `npm install` first');

  const [assets07, ops03, enemies05, maps05] = await Promise.all([
    readJson('docs/research/07-assets.json'),
    readJson('docs/research/03-operators.json'),
    readJson('docs/research/05-enemies.json'),
    readJson('docs/research/05-maps.json'),
  ]);
  const { audioData, modelsData } = await loadIndexes(ROOT, { refresh: opts.refreshIndex && !opts.offline, offline: opts.offline, log });
  const audio = indexAudio(audioData);
  // The game data built by tools/build-data.mjs (when present) may reference more
  // spawnable enemies/tokens than research lists (e.g. 机变 enemy swaps): cover them too.
  const [dataEnemies, dataTokens, dataBosses] = await Promise.all(
    ['data/enemies.json', 'data/tokens.json', 'data/bosses.json'].map((f) => readJson(f).catch(() => null)));
  const extraHandbook = {};
  for (const b of Object.values(dataBosses || {})) if (b?.enemyKey && typeof b.handbookId === 'string') extraHandbook[b.enemyKey] = b.handbookId;
  const plan = buildPlan({
    ...rhineArtInput(assets07, ops03), enemies05, maps05, audio, modelsData,
    extraEnemyIds: Object.keys(dataEnemies || {}),
    extraTokenIds: Object.keys(dataTokens || {}),
    extraHandbook,
  });
  const leaves = collectLeaves(plan.template);
  log(`[plan] ${leaves.length} files + ${plan.models.size} Spine models ` +
    `(${Object.keys(plan.template.chars).length} chars, ${Object.keys(plan.template.enemies).length} enemies, ` +
    `${Object.keys(plan.template.tokens).length} tokens, ${Object.keys(plan.template.ui).length} UI sprites, ` +
    `${Object.keys(plan.template.audio.sfx.units).length} units with SFX)`);
  if (opts.dryRun) {
    for (const n of plan.notes) log(`  note: ${n}`);
    return 0;
  }

  const dl = new Downloader({
    root: ASSETS, ledgerPath: join(CACHE, 'assets-ledger.json'),
    concurrency: opts.concurrency, force: opts.force, log,
  });
  await dl.loadLedger();
  const downloadErrors = opts.offline ? [] : await downloadLeaves(leaves, dl, ASSETS, 'files');

  // Fonts
  let fontErrors = [];
  if (!opts.offline) {
    const fdl = new Downloader({ root: FONTS, ledgerPath: join(CACHE, 'fonts-ledger.json'), concurrency: 4, force: opts.force, log });
    await fdl.loadLedger();
    await fdl.run(fontJobs(), 'fonts');
    dl.totals.bytesDownloaded += fdl.totals.bytesDownloaded;
    for (const k of ['ok', 'skip', 'miss', 'error']) dl.totals[k] += fdl.totals[k];
  }
  const fonts = await buildFonts(FONTS, log);
  fontErrors = fonts.errors;

  // Spine
  const spine = await processModels(plan.models, {
    root: ASSETS, dl, cachePath: join(CACHE, 'spine-info.json'), download: !opts.offline, log,
  });

  // Manifest
  const resolved = resolveTemplate(plan.template, { root: ASSETS, spine: spine.entries, sourceOf: (rel) => dl.ledger.files[rel]?.url });
  const body = addRhineArt(resolved.value);
  tidyManifest(body);
  const fontFaces = {};
  for (const [name, f] of Object.entries(fonts.files)) fontFaces[name] = f;
  body.fonts = existsSync(join(FONTS, 'fonts.css')) ? { css: '/fonts/fonts.css', faces: fontFaces } : { faces: fontFaces };
  const bytes = totalBytes(ASSETS, resolved.files);
  const manifest = {
    version: MANIFEST_VERSION,
    hash: contentHash(body),
    generator: 'tools/fetch-assets.mjs',
    stats: countStats(body, bytes, resolved.files.size),
    ...body,
  };
  await writeJsonAtomic(MANIFEST, manifest);

  // Orphans: files on disk that the manifest does not reference (e.g. after a mapping change).
  const orphans = (await listFiles(ASSETS)).filter((r) => !resolved.files.has(r));
  if (opts.prune) for (const r of orphans) { try { await unlink(join(ASSETS, r)); } catch { /* ignore */ } }

  const charIds = Object.keys(assets07.operators || {});
  const required = requiredMisses(manifest, charIds);
  const report = {
    downloadedBytes: dl.totals.bytesDownloaded,
    totals: dl.totals,
    stats: manifest.stats,
    requiredMisses: required,
    misses: resolved.misses,
    downloadErrors, // leaves whose primary failed transiently (fallbacks not tried; re-run to retry)
    fallbacks: resolved.fallbacks,
    spineProblems: spine.problems,
    fontErrors,
    orphans: opts.prune ? [] : orphans,
    pruned: opts.prune ? orphans : [],
    notes: plan.notes,
  };
  await writeJsonAtomic(REPORT, report, 1);

  // Summary
  const s = manifest.stats;
  log('');
  log('=== fetch-assets summary ===');
  log(`downloaded this run : ${mb(dl.totals.bytesDownloaded)} (ok ${dl.totals.ok}, skipped ${dl.totals.skip}, missing ${dl.totals.miss}, errors ${dl.totals.error}` +
    `${dl.totals.sizeChanged ? `, ${dl.totals.sizeChanged} changed upstream` : ''})`);
  log(`on disk (manifest)  : ${mb(s.bytes)} in ${s.files} files`);
  log(`chars ${s.chars} (Back model ${s.charsWithBack}) · enemies ${s.enemies} (Spine ${s.enemiesWithSpine}) · tokens ${s.tokens} (Spine ${s.tokensWithSpine}) · Spine models ${s.spineModels}`);
  log(`bonds ${s.bonds} · items ${s.items} · bands ${s.bands} · skill icons ${s.skills} · UI ${s.ui} · units with SFX ${s.sfxUnits}`);
  log(`fonts: ${Object.values(fonts.files).map((f) => f.woff2 || f.original).join(', ') || 'none'}`);
  if (resolved.fallbacks.length) { log(`fallbacks used (${resolved.fallbacks.length}):`); for (const f of resolved.fallbacks.slice(0, 20)) log(`  ${f}`); }
  if (downloadErrors.length) log(`download errors (${downloadErrors.length}, re-run to retry): ${downloadErrors.slice(0, 10).join(', ')}`);
  if (resolved.misses.length) {
    log(`missing (${resolved.misses.length}, omitted from manifest; client uses fallbacks):`);
    for (const m of resolved.misses.slice(0, 40)) log(`  ${m}`);
    if (resolved.misses.length > 40) log(`  … see ${REPORT}`);
  }
  if (spine.problems.length) { log(`spine notes (${spine.problems.length}):`); for (const p of spine.problems.slice(0, 20)) log(`  ${p}`); }
  for (const e of fontErrors) log(`font error: ${e}`);
  if (orphans.length) log(opts.prune ? `pruned ${orphans.length} unreferenced files` : `${orphans.length} unreferenced files on disk (run with --prune to delete)`);
  log(`manifest: ${MANIFEST} · report: ${REPORT} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (required.length) {
    log(`ERROR: ${required.length} required assets missing: ${required.slice(0, 10).join(', ')}`);
    return 1;
  }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  console.error(`[assets] FAILED: ${process.env.DEBUG ? e?.stack || e : e?.message || e}`);
  process.exitCode = 1;
});
