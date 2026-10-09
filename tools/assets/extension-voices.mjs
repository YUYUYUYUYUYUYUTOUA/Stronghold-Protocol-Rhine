// Incremental extension downloads include both voice languages introduced by upstream 0.2.2.
import { join } from 'node:path';
import { cachedJson } from './cache.mjs';
import { RAW } from './sources.mjs';
import { buildPlan } from './plan.mjs';
import { indexAudio } from './audio.mjs';
import { Downloader } from './downloader.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate } from './manifest.mjs';

export async function fetchExtensionVoices(root, inputs, manifest) {
  const cache = join(root, '.cache'), assetRoot = join(root, 'public/assets');
  const charword = await cachedJson({ cacheFile: join(cache, 'gamedata/excel/charword_table.json'),
    url: RAW.gamedata + 'excel/charword_table.json' });
  const plan = buildPlan({ ...inputs, audio: indexAudio({}), charword, modelsData: {}, enemies05: {}, maps05: {} });
  const template = { voice: plan.template.audio.voice, voiceJp: plan.template.audio.voiceJp };
  const dl = new Downloader({ root: assetRoot, ledgerPath: join(cache, 'extension-voices-ledger.json'),
    concurrency: 8, timeoutMs: 25000, retries: 2, keepExisting: true });
  await dl.loadLedger();
  await downloadLeaves(collectLeaves(template), dl, assetRoot, 'Extension Chinese/Japanese voices');
  const resolved = resolveTemplate(template, { root: assetRoot });
  if (resolved.misses.length) throw new Error(JSON.stringify(resolved.misses));
  manifest.audio ||= {};
  for (const key of ['voice', 'voiceJp']) manifest.audio[key] = { ...manifest.audio[key], ...resolved.value[key] };
  manifest.stats ||= {};
  manifest.stats.voiceChars = Object.keys(manifest.audio.voice).length;
  manifest.stats.voiceJpChars = Object.keys(manifest.audio.voiceJp).length;
}
