// Rebuild a requested tagged release using verified resources, then publish only after package checks pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const automation = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = path.dirname(automation);
const request = JSON.parse(fs.readFileSync(path.join(automation, '.github/rhine-release-request.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY;
const root = path.join(process.env.RUNNER_TEMP || workspace, 'rhine-release');
const source = path.join(workspace, 'source');
const quiet = { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
assert.equal(repo, 'YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine');
assert.match(request.tag, /^v\d+\.\d+\.\d+-rhine\.\d+$/);
assert.match(request.previousTag, /^v\d+\.\d+\.\d+-rhine\.\d+$/);
assert.match(request.sourceCommit, /^[0-9a-f]{40}$/);
assert.match(request.previousArchiveSha256, /^[0-9a-f]{64}$/);
assert.match(request.runtimeVersion, /^v24\.\d+\.\d+$/);
if (request.draftReleaseId != null) assert.ok(Number.isSafeInteger(request.draftReleaseId) && request.draftReleaseId > 0);
assert.equal(request.previousArchiveName, `Stronghold-Protocol-Rhine-${request.previousTag}-Windows-x64.zip`);
if (request.upstreamResources) {
  const resources = request.upstreamResources;
  assert.equal(resources.repository, 'sganggs/Stronghold-Protocol');
  assert.equal(resources.tag, request.tag.split('-')[0]);
  assert.equal(resources.archiveName, `Stronghold-Protocol-${resources.tag}.zip`);
  assert.match(resources.commit, /^[0-9a-f]{40}$/);
  assert.match(resources.sha256, /^[0-9a-f]{64}$/);
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { ...quiet, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${path.basename(executable)} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
const api = endpoint => JSON.parse(command('gh', ['api', `repos/${repo}/${endpoint}`]));
async function sha(file) {
  const hash = createHash('sha256');
  if (fs.statSync(file).size <= 4 * 1024 * 1024) hash.update(fs.readFileSync(file));
  else for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyApprovedArt(directory) {
  for (const [relative, expected] of Object.entries(request.approvedArt || {})) {
    assert.match(relative, /^public\/art\/(?:kazdel|rhine)\/[a-z0-9-]+\.png$/);
    assert.match(expected, /^[0-9a-f]{64}$/);
    assert.equal(await sha(path.join(directory, relative)), expected, relative);
  }
}
async function verifyRemOriginal(directory) {
  if (!request.remOriginal) return;
  assert.equal(request.remOriginal.path, 'public/assets/bond/rem.png');
  assert.equal(request.remOriginal.bytes, 21152);
  assert.equal(request.remOriginal.sha256, '3089f0cb87a7c85b1d12eb1bf6aff6e1dd8ed1d2ae6caaf2cda359b2658c546e');
  const file = path.join(directory, request.remOriginal.path);
  assert.equal(fs.statSync(file).size, request.remOriginal.bytes);
  assert.equal(await sha(file), request.remOriginal.sha256);
}
const progress = message => console.log(`${new Date().toISOString()} ${message}`);
function extract(archive, destination) {
  assert.equal(fs.existsSync(destination), false, destination);
  command('python', [path.join(automation, '.github/scripts/rhine-release-archive.py'), 'extract', archive, destination]);
}
function dependencyLock(directory) {
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  delete lock.name; delete lock.version;
  delete lock.packages[''].name; delete lock.packages[''].version;
  return lock;
}
async function upstreamResources(downloads) {
  const resources = request.upstreamResources;
  command('gh', ['release', 'download', resources.tag, '--repo', resources.repository,
    '--pattern', resources.archiveName, '--dir', downloads]);
  const archive = path.join(downloads, resources.archiveName);
  assert.equal(await sha(archive), resources.sha256);
  extract(archive, path.join(root, 'upstream'));
  const directory = path.join(root, 'upstream/Stronghold-Protocol');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.format, 1);
  assert.equal(manifest.app, resources.tag.slice(1));
  const seen = new Set();
  for (const [relative, entry] of Object.entries(manifest.files)) {
    assert.ok(!relative.includes('\\') && !relative.includes(':') && !path.posix.isAbsolute(relative));
    assert.ok(relative.split('/').every(p => p && p !== '.' && p !== '..'));
    assert.equal(seen.has(relative.toLowerCase()), false); seen.add(relative.toLowerCase());
    const file = path.join(directory, relative), stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, entry.size, relative); assert.equal(await sha(file), entry.sha256, relative);
  }
  const vanilla = JSON.parse(fs.readFileSync(path.join(source, 'data/vanilla/manifest.json'), 'utf8'));
  assert.equal(vanilla.source, resources.commit); assert.equal(vanilla.upstreamVersion, resources.tag.slice(1));
  for (const entry of vanilla.files) {
    assert.equal(await sha(path.join(directory, 'data', entry.path)), entry.sha256, entry.path);
    assert.equal(await sha(path.join(source, 'data/vanilla', entry.path)), entry.sha256, entry.path);
  }
  assert.deepEqual(dependencyLock(directory), dependencyLock(source));
  progress(`Verified upstream ${resources.tag} archive, ${seen.size} manifest files and ${vanilla.files.length} fixed data snapshots.`);
  return directory;
}
async function verifyTree(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'bundle-manifest.json'), 'utf8'));
  assert.equal(manifest.fileCount, manifest.files.length);
  assert.equal(manifest.sourceDirty, false);
  const seen = new Set();
  for (const entry of manifest.files) {
    assert.ok(!entry.path.includes('\\') && !entry.path.includes(':') && !path.posix.isAbsolute(entry.path));
    assert.ok(entry.path.split('/').every(p => p && p !== '.' && p !== '..'));
    assert.equal(seen.has(entry.path.toLowerCase()), false, entry.path);
    seen.add(entry.path.toLowerCase());
    const file = path.join(directory, entry.path), stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), entry.path);
    assert.equal(stat.size, entry.size, entry.path);
    assert.equal(await sha(file), entry.sha256, entry.path);
  }
  assert.equal(manifest.totalBytes, manifest.files.reduce((sum, f) => sum + f.size, 0));
  const actual = [];
  const visit = (dir, prefix = '') => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      assert.equal(item.isSymbolicLink(), false, item.name);
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) visit(path.join(dir, item.name), relative);
      else { assert.ok(item.isFile()); actual.push(relative); }
    }
  };
  visit(directory);
  assert.deepEqual(actual.sort(), [...manifest.files.map(f => f.path), 'bundle-manifest.json'].sort());
  return manifest;
}
function runTests(node, directory, files, log, options = {}) {
  const result = spawnSync(node, ['--test', '--test-reporter=spec', `--test-concurrency=${options.concurrency ?? 3}`, ...(options.args || []), ...files], {
    ...quiet, cwd: directory, timeout: options.timeout ?? 300000,
    // Hash-cache persistence is covered by source CI; keep these package acceptance runs from writing runner caches.
    env: { ...process.env, NO_COLOR: '1', SP_STUDIO: 'off', SP_ASSET_INDEX: '0', SP_E2E: '0', SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0', ...options.env },
  });
  const text = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(log, text);
  console.log(result.error || result.status !== 0 ? text : text.split('\n').slice(-12).join('\n'));
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Packaged regression failed; release remains a draft.');
  const totals = {};
  for (const key of ['tests', 'pass', 'fail', 'skipped']) {
    const matches = [...text.matchAll(new RegExp(`^[ℹ#] ?${key} (\\d+)$`, 'gm'))];
    assert.ok(matches.length, `Missing test total: ${key}`);
    totals[key === 'tests' ? 'total' : key] = Number(matches.at(-1)[1]);
  }
  assert.equal(totals.fail, 0);
  assert.ok(totals.total > 0);
  return totals;
}
function zip(directory, destination) {
  assert.equal(fs.existsSync(destination), false);
  command('python', [path.join(automation, '.github/scripts/rhine-release-archive.py'), 'zip', directory, destination]);
}
async function main() {
  if (request.draftReleaseId == null) {
    const found = spawnSync('gh', ['api', `repos/${repo}/releases/tags/${request.tag}`], quiet);
    if (found.status === 0) request.draftReleaseId = JSON.parse(found.stdout).id;
    else {
      assert.equal(process.argv[2], 'request', 'Only request validation may create a release draft.');
      assert.match(found.stderr || '', /HTTP 404/, 'Release lookup failed; do not create a duplicate.');
      assert.equal(api(`git/ref/tags/${request.tag}`).object.sha, request.sourceCommit);
      assert.ok(typeof request.releaseNotes === 'string' && request.releaseNotes.trim());
      const matches = api('releases?per_page=100').filter(release => release.tag_name === request.tag);
      assert.ok(matches.length <= 1, 'Ambiguous release drafts; refusing to create another.');
      const created = matches[0] || JSON.parse(command('gh', ['api', '--method', 'POST', `repos/${repo}/releases`, '--input', '-'], {
        input: JSON.stringify({ tag_name: request.tag, target_commitish: request.sourceCommit,
          name: request.releaseName || `${request.tag} · 莱茵与卡兹戴尔扩展`, body: request.releaseNotes, draft: true, prerelease: false }),
      }));
      assert.equal(created.draft, true);
      request.draftReleaseId = created.id;
    }
  }
  const draft = api(`releases/${request.draftReleaseId}`);
  assert.equal(draft.tag_name, request.tag);
  const tag = api(`git/ref/tags/${request.tag}`);
  assert.equal(tag.object.type, 'commit');
  assert.equal(tag.object.sha, request.sourceCommit);
  if (process.argv[2] === 'request') {
    // GitHub's by-tag endpoint may hide drafts; carry the verified numeric ID to the next process.
    fs.writeFileSync(path.join(automation, '.github/rhine-release-request.json'), JSON.stringify(request, null, 2) + '\n');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_commit=${request.sourceCommit}\npublished=${!draft.draft}\n`);
    console.log(`Requested ${request.tag} at ${request.sourceCommit}; published=${!draft.draft}`);
    return;
  }
  assert.equal(process.argv[2], 'publish');
  assert.equal(process.platform, 'win32', 'This job validates the real bundled Windows runtime.');
  assert.equal(draft.draft, true, 'Published releases must never be overwritten by a rebuild.');
  assert.equal(command('git', ['-C', source, 'rev-parse', 'HEAD']).trim(), request.sourceCommit);
  await verifyApprovedArt(source);
  fs.mkdirSync(root);
  progress('Downloading and checking the previous release.');
  const downloads = path.join(root, 'downloads'); fs.mkdirSync(downloads);
  command('gh', ['release', 'download', request.previousTag, '--repo', repo, '--pattern', request.previousArchiveName,
    '--pattern', 'SHA256SUMS.txt', '--dir', downloads]);
  const previousZip = path.join(downloads, request.previousArchiveName);
  assert.equal(await sha(previousZip), request.previousArchiveSha256);
  const sums = fs.readFileSync(path.join(downloads, 'SHA256SUMS.txt'), 'utf8');
  assert.ok(sums.split(/\r?\n/).some(line => line.trim() === `${request.previousArchiveSha256}  ${request.previousArchiveName}`));
  extract(previousZip, path.join(root, 'previous'));
  const previous = path.join(root, 'previous/Stronghold-Protocol-Rhine');
  const oldManifest = await verifyTree(previous);
  progress(`Verified ${oldManifest.fileCount} previous payload files; checking official Windows Node.`);
  const fresh = request.upstreamResources ? await upstreamResources(downloads) : null;
  // A major upstream adaptation may add runtime dependencies (0.3.0 adds SES and Acorn).
  // Fresh resources were checked against the tagged source lock above; never reuse the old node_modules for them.
  if (!fresh) {
    for (const file of ['package-lock.json', 'data/assets.json']) {
      assert.equal(await sha(path.join(previous, file)), await sha(path.join(source, file)),
        `${file} changed: prepare fresh verified resources before reusing a previous package.`);
    }
  }
  assert.equal(oldManifest.runtime.version, request.runtimeVersion);
  const runtimeArchiveName = `node-${request.runtimeVersion}-win-x64.zip`;
  const runtimeBase = `https://nodejs.org/dist/${request.runtimeVersion}/`;
  const sumsResponse = await fetch(runtimeBase + 'SHASUMS256.txt'); assert.equal(sumsResponse.status, 200);
  const officialSums = await sumsResponse.text();
  const runtimeSha = officialSums.split(/\r?\n/).find(line => line.endsWith('  ' + runtimeArchiveName))?.split(/\s+/)[0];
  assert.match(runtimeSha, /^[0-9a-f]{64}$/);
  const runtimeResponse = await fetch(runtimeBase + runtimeArchiveName); assert.equal(runtimeResponse.status, 200);
  const runtimeZip = path.join(downloads, runtimeArchiveName);
  fs.writeFileSync(runtimeZip, Buffer.from(await runtimeResponse.arrayBuffer()));
  assert.equal(await sha(runtimeZip), runtimeSha);
  extract(runtimeZip, path.join(root, 'official-runtime'));
  const runtime = path.join(root, 'official-runtime', `node-${request.runtimeVersion}-win-x64`);
  const bundledNode = path.join(runtime, 'node.exe');
  assert.equal(command(bundledNode, ['--version']).trim(), request.runtimeVersion);
  const runtimeIdentity = JSON.parse(command(bundledNode, ['-p',
    'JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})']));
  assert.deepEqual(runtimeIdentity, { platform: 'win32', arch: 'x64', version: request.runtimeVersion });
  for (const relative of ['public/assets', 'public/fonts', 'public/vendor', ...(fresh ? [] : ['node_modules'])]) {
    assert.equal(fs.existsSync(path.join(source, relative)), false, relative);
    fs.cpSync(path.join(previous, relative), path.join(source, relative), { recursive: true });
    if (fresh && relative !== 'node_modules') fs.cpSync(path.join(fresh, relative), path.join(source, relative), { recursive: true });
  }
  for (const relative of ['data/local-assets.json', 'data/local-fx.json']) {
    const localOrigin = fresh && fs.existsSync(path.join(fresh, relative)) ? fresh : previous;
    if (fs.existsSync(path.join(localOrigin, relative))) {
      fs.copyFileSync(path.join(localOrigin, relative), path.join(source, relative));
    }
  }
  if (fresh) {
    assert.equal(fs.existsSync(path.join(source, 'node_modules')), false);
    // Install the exact new lock, including tooling needed by packaged tests, with the verified Windows runtime.
    // Explicitly run only our vendor step, rather than arbitrary dependency lifecycle scripts.
    command(bundledNode, [path.join(runtime, 'node_modules/npm/bin/npm-cli.js'), 'ci', '--include=dev',
      '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: source });
    command(bundledNode, ['tools/vendor.mjs'], { cwd: source });
    for (const relative of ['node_modules/ses/dist/ses.umd.js', 'node_modules/acorn/dist/acorn.mjs',
      'public/vendor/ses.umd.js', 'public/vendor/acorn.mjs']) assert.ok(fs.statSync(path.join(source, relative)).size > 0, relative);
    progress('Installed tagged Windows dependencies and rebuilt client vendor files, including SES and Acorn.');
    command(bundledNode, ['--input-type=module', '-e',
      "import fs from 'node:fs'; import {fetchExtensionVoices} from './tools/assets/extension-voices.mjs'; import {rhineArtInput} from './tools/assets/rhine-plan.mjs'; import {kazdelArtInput} from './tools/assets/kazdel-plan.mjs'; const expected=JSON.parse(fs.readFileSync('data/assets.json')); const actual=structuredClone(expected); await fetchExtensionVoices(process.cwd(),kazdelArtInput(rhineArtInput()),actual); const {default:assert}=await import('node:assert/strict'); assert.deepEqual(actual,expected,'Rebuilt extension voices must exactly match tagged metadata.');"], { cwd: source });
    progress('New extension voice assets downloaded and checked against the tagged manifest.');
  }
  if (request.remOriginal) {
    const manifestFile = path.join(source, 'data/assets.json');
    const manifestBytes = fs.readFileSync(manifestFile);
    const manifestBefore = await sha(manifestFile);
    command(bundledNode, ['tools/fetch-rem-assets.mjs', '--units'], { cwd: source });
    command(bundledNode, ['tools/fetch-rem-assets.mjs'], { cwd: source });
    // The incremental downloader hashes a different envelope from the upstream full generator
    // and adds a newline. Require identical resource metadata and restore the tagged bytes;
    // neither a newly resolved model nor any changed URL/statistic may enter the package.
    const { hash: originalHash, ...originalContent } = JSON.parse(manifestBytes);
    const { hash: downloadedHash, ...downloadedContent } = JSON.parse(fs.readFileSync(manifestFile));
    assert.match(originalHash, /^[0-9a-f]{12}$/);
    assert.match(downloadedHash, /^[0-9a-f]{12}$/);
    assert.deepEqual(downloadedContent, originalContent,
      'Downloaded Rem assets must resolve to the exact tagged resource metadata.');
    fs.writeFileSync(manifestFile, manifestBytes);
    assert.equal(await sha(manifestFile), manifestBefore, 'Preserve the exact tagged asset manifest bytes.');
    await verifyRemOriginal(source);
    progress('New Rem models and exact original logo downloaded; tagged manifest unchanged.');
  }
  const { buildBundle } = await import(pathToFileURL(path.join(source, 'tools/build-rhine-bundle.mjs')));
  const built = await buildBundle({ source, out: path.join(root, 'stage'), runtimeDir: runtime,
    runtimeVersion: request.runtimeVersion, runtimeSourceUrl: runtimeBase + runtimeArchiveName, runtimeSha256: runtimeSha });
  assert.equal(built.manifest.sourceCommit, request.sourceCommit);
  assert.equal(built.manifest.sourceDirty, false);
  await verifyApprovedArt(built.destination);
  await verifyRemOriginal(built.destination);
  progress(`Built ${built.manifest.fileCount} files from ${request.sourceCommit}; running native Windows regression.`);
  const node = path.join(built.destination, 'runtime/node/node.exe');
  const tests = runTests(node, built.destination, [
    'test/content/rem.test.js', 'test/content/rem-traits.test.js', 'test/content/rem-balance.test.js', 'test/content/rem_native_kits.test.js',
    'test/content/rem-pizza-fx.test.js', 'test/rem_data.test.js', 'test/match/rem-rally.test.js',
    'test/match/rem-price.test.js', 'test/match/kazdel-unite.test.js', 'test/content/rhine_magallan.test.js',
    'test/tools/rem-asset-plan.test.js',
    'test/content/community-round29.test.js', 'test/content/echo-counter-023.test.js',
    'test/content/op_clemnt.test.js', 'test/content/new-modules-023.test.js',
    'test/content/lemuen-wanted-023.test.js', 'test/content/necras-trigger-023.test.js', 'test/content/heal-triggers-023.test.js',
    'test/match/shared-stock.test.js', 'test/match/rhine-upstream024.test.js',
    'test/match/setup-reroll.test.js', 'test/match/setup-reroll-ws.test.js',
    'test/content/kazdel.test.js', 'test/content/kazdel_kits.test.js', 'test/content/op_wisdel.test.js',
    'test/content/kazdel_soul_skills.test.js', 'test/content/kazdel_equipment.test.js', 'test/kazdel_equipment_data.test.js',
    'test/content/reactive-origin.test.js', 'test/content/rhine.test.js', 'test/match/rhineResearch.test.js',
    'test/match/rhine-client-layers.test.js', 'test/content/garrisons_battle.test.js',
    'test/content/rhine_device_rework.test.js', 'test/match/rhine-laser-field-share.test.js',
    'test/kazdel_data.test.js', 'test/rhine_data.test.js', 'test/i18n.test.js', 'test/i18n-packs.test.js',
    'test/tools/verify-rhine-release.test.js', 'test/rhine-bundle-update.test.js', 'test/rhine-online-update.test.js',
    'test/rhine-bundle-launch.test.js',
    'test/extension-potential.test.js', 'test/room-rhine-profile.test.js', 'test/vanilla-data.test.js',
    'test/match/potential.test.js', 'test/sim/potential-battle.test.js', 'test/ui/inspect-range.test.js',
    'test/match/round-communicators.test.js', 'test/match/rem-round-carry.test.js', 'test/match/rhine-opening-bans.test.js',
    'test/match/original-profile-host.test.js',
    'test/match/kazdel-client-layers.test.js', 'test/match/six-player.test.js', 'test/match/six-player-round-beacons.test.js',
    'test/protocol-seats.test.js', 'test/rhine-update-boot.test.js', 'test/ui/kazdel.test.js',
    'test/tools/rhine-bundle.test.js', 'test/plugins/schema.test.js', 'test/plugins/dsl-data.test.js',
    'test/plugins/contentBattle.test.js', 'test/plugins/script-integration.test.js',
    'test/plugins/script-sandbox-integration.test.js', 'test/plugins/profile-content-sets.test.js',
    'test/plugins/rhine-shared-tokens.test.js',
    'test/plugins/tool.test.js', 'test/plugins/forgeImport.test.js', 'test/plugins/script-review.test.js',
    'test/ui/profile-plugins.test.js',
    'test/studio/trial.test.js', 'test/studio/room-settings.test.js', 'test/studio/gameplay.test.js',
    'test/golden-diy.test.js',
  ], path.join(root, 'packaged-tests.log'), {
    // This expanded acceptance batch includes real package/upgrade fixtures and plugin composition.
    // Keep individual test deadlines intact while allowing the complete Windows batch to finish.
    timeout: 900000, env: { SP_UPDATE_E2E: '1', SP_STUDIO: 'lan' },
  });
  // The normal release author-resource test needs a Git checkout to select its stage inputs.
  // Exercise it with the same verified Windows runtime in the clean tagged source checkout.
  const sourceAuthorTests = runTests(node, source, ['test/plugin-package.test.js'],
    path.join(root, 'source-author-tests.log'), { concurrency: 1, timeout: 300000 });
  const hostTests = runTests(node, built.destination, ['test/match/plugin-host.test.js', 'test/plugins/sandbox-host.test.js'],
    path.join(root, 'packaged-plugin-host-tests.log'), { concurrency: 1, timeout: 300000 });
  let browserTests = null;
  if (fresh) {
    const edge = [process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', process.env.ProgramFiles || 'C:/Program Files']
      .map(dir => path.join(dir, 'Microsoft/Edge/Application/msedge.exe')).find(file => fs.existsSync(file));
    assert.ok(edge, 'Microsoft Edge is required for the native Windows renderer checks.');
    const browserOutput = path.join(built.destination, 'test/e2e/out');
    assert.equal(fs.existsSync(browserOutput), false);
    browserTests = {
      remSimulation: runTests(node, built.destination, ['test/sim/rem.browser.test.js', 'test/sim/rhine.browser.test.js'],
        path.join(root, 'browser-rem-sim.log'), { concurrency: 1, env: { SIM_E2E: '1', CHROME_PATH: edge } }),
      remRenderer: runTests(node, built.destination, ['test/render/rem-art.browser.test.js', 'test/render/rem-movement.browser.test.js'],
        path.join(root, 'browser-rem-render.log'), { concurrency: 1, env: { RENDER_E2E: '1', CHROME_PATH: edge } }),
      remRally: runTests(node, built.destination, ['test/ui/rem-rally.browser.test.js'],
        path.join(root, 'browser-rem-rally.log'), { concurrency: 1, env: { SP_E2E: '1', CHROME_PATH: edge } }),
      kazdelSimulation: runTests(node, built.destination, ['test/sim/kazdel.browser.test.js', 'test/sim/reactive-origin.browser.test.js'],
        path.join(root, 'browser-kazdel-sim.log'), { concurrency: 1, env: { SIM_E2E: '1', CHROME_PATH: edge } }),
      renderer: runTests(node, built.destination, ['test/render/kazdel.browser.test.js', 'test/render/rhineDevices.browser.test.js', 'test/ui/kazdel-icon.browser.test.js'],
        path.join(root, 'browser-render.log'), { concurrency: 1, timeout: 600000, env: { RENDER_E2E: '1', CHROME_PATH: edge } }),
      rhineOperators: runTests(node, built.destination, ['test/render/rhineOperators.browser.test.js'],
        path.join(root, 'browser-rhine-operators.log'), { concurrency: 1, timeout: 600000, env: { RENDER_E2E: '1', CHROME_PATH: edge } }),
      upstreamRenderer: runTests(node, built.destination, ['test/render/held-pose.browser.test.js', 'test/render/recovery.browser.test.js'],
        path.join(root, 'browser-upstream-render.log'), { concurrency: 1, timeout: 600000, env: { RENDER_E2E: '1', CHROME_PATH: edge } }),
      upstreamUi: runTests(node, built.destination, ['test/ui/followup-023.e2e.test.js', 'test/ui/data-profile.browser.test.js',
        'test/ui/rhine-profiles.e2e.test.js'],
        path.join(root, 'browser-upstream-ui.log'), { concurrency: 1, timeout: 600000, env: { SP_E2E: '1', CHROME_PATH: edge } }),
      sixSeatUi: runTests(node, built.destination, ['test/ui/six-player-layout.e2e.test.js', 'test/ui/six-player-balance.e2e.test.js'],
        path.join(root, 'browser-six-seat.log'), { concurrency: 1, timeout: 600000, env: { SP_E2E: '1', CHROME_PATH: edge, SP_E2E_SWIFTSHADER: '1' } }),
      statsLandscape: runTests(node, built.destination, ['test/ui/stats.e2e.test.js'], path.join(root, 'browser-stats.log'),
        { concurrency: 1, args: ['--test-name-pattern=phone in landscape'], env: { SP_E2E: '1', CHROME_PATH: edge } }),
      upstreamPlugins: runTests(node, built.destination, ['test/ui/plugins-content.e2e.test.js', 'test/ui/plugins-sandbox.e2e.test.js',
        'test/ui/studio-gameplay.e2e.test.js'], path.join(root, 'browser-plugins.log'),
        { concurrency: 1, timeout: 600000, env: { SP_E2E: '1', CHROME_PATH: edge, SP_STUDIO: 'local' } }),
    };
    fs.renameSync(browserOutput, path.join(root, 'browser-evidence'));
    progress('Native Windows Edge renderer and stats-page checks passed; screenshots moved outside the payload.');
  }
  const server = spawn(node, ['server/index.js'], { cwd: built.destination, windowsHide: true,
    // HTTP data-byte validation uses the unrewritten tagged manifests; browser suites above cover UI and rendering.
    // Do not create this runner's private Studio key or asset cache inside the release payload.
    env: { ...process.env, HOST: '127.0.0.1', PORT: '3214', SP_STUDIO: 'off', SP_ASSET_INDEX: '0' }, stdio: 'ignore' });
  let smoke;
  const smokeReport = path.join(built.destination, 'rhine-equipment-verification.json');
  assert.equal(fs.existsSync(smokeReport), false);
  try {
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      try { healthy = (await fetch('http://127.0.0.1:3214/healthz')).ok; } catch { /* Startup in progress. */ }
      if (healthy) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(healthy, true, 'Bundled Windows service did not become healthy.');
    smoke = JSON.parse(command(node, ['tools/verify-rhine-release.mjs', 'http://127.0.0.1:3214'], { cwd: built.destination }));
  } finally { server.kill(); }
  assert.deepEqual(JSON.parse(fs.readFileSync(smokeReport, 'utf8')), smoke);
  fs.renameSync(smokeReport, path.join(root, 'packaged-http-verification.json'));
  await verifyTree(built.destination);
  progress('Native Windows tests and HTTP/WebSocket checks passed; compressing verified payload.');
  const assets = path.join(root, 'assets'); fs.mkdirSync(assets);
  const archiveName = `Stronghold-Protocol-Rhine-${request.tag}-Windows-x64.zip`;
  const archive = path.join(assets, archiveName); zip(built.destination, archive);
  extract(archive, path.join(root, 'unpacked-verification'));
  const unpacked = path.join(root, 'unpacked-verification/Stronghold-Protocol-Rhine');
  const verified = await verifyTree(unpacked);
  await verifyApprovedArt(unpacked);
  await verifyRemOriginal(unpacked);
  assert.deepEqual(verified, built.manifest);
  progress('Compressed package passed full file-manifest verification; preparing updater toolkit.');
  const toolDirectory = path.join(root, 'Rhine-Update-Tool-Windows'); fs.mkdirSync(toolDirectory);
  const toolManifest = { schemaVersion: 1, tool: 'Rhine-Update-Tool-Windows', sourceCommit: request.sourceCommit, files: [],
    requires: 'An installed manifest-based Rhine Windows x64 package with bundled Node; GitHub public Releases network access' };
  for (const relative of ['更新旧版.bat', '联网更新.bat', 'scripts/rhine-online-update.mjs', 'scripts/rhine-online-update.ps1',
    'scripts/rhine-online-update-runner.ps1', 'scripts/rhine-bundle-update.mjs', 'scripts/rhine-bundle-update.ps1',
    'README.md', 'LICENSE', 'NOTICE.md']) {
    const file = path.join(source, relative === 'README.md' ? 'docs/RHINE-UPDATE.md' : relative);
    const target = path.join(toolDirectory, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    toolManifest.files.push({ path: relative, size: fs.statSync(target).size, sha256: await sha(target) });
  }
  fs.writeFileSync(path.join(toolDirectory, 'TOOL-MANIFEST.json'), JSON.stringify(toolManifest, null, 2) + '\n');
  const toolName = 'Rhine-Update-Tool-Windows.zip', toolZip = path.join(assets, toolName); zip(toolDirectory, toolZip);
  extract(toolZip, path.join(root, 'tool-verification'));
  const extractedTool = path.join(root, 'tool-verification/Rhine-Update-Tool-Windows');
  for (const entry of toolManifest.files) {
    const file = path.join(extractedTool, entry.path);
    assert.equal(fs.statSync(file).size, entry.size);
    assert.equal(await sha(file), entry.sha256);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(extractedTool, 'TOOL-MANIFEST.json'), 'utf8')), toolManifest);
  const updater = await import(pathToFileURL(path.join(source, 'scripts/rhine-bundle-update.mjs')));
  const updatePlan = await updater.planUpdate({ source: unpacked, target: previous });
  assert.deepEqual(updatePlan.conflicts, []);
  const privateFixture = path.join(previous, 'release-validation-private.txt');
  fs.writeFileSync(privateFixture, 'preserve private player files');
  const privateConfigs = ['.env', 'scripts/service.env.cmd', 'plugins/config.json', 'plugins/.studio-key',
    'plugins/release-validation-private/plugin.json', 'plugins/release-validation-private/.studio.json'];
  for (const relative of privateConfigs) {
    const file = path.join(previous, relative);
    assert.equal(fs.existsSync(file), false, 'Release payload must not contain private configuration');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'release validation synthetic private configuration');
  }
  const checkPrivateConfigs = () => {
    for (const relative of privateConfigs) assert.equal(fs.readFileSync(path.join(previous, relative), 'utf8'),
      'release validation synthetic private configuration', relative);
  };
  const updated = await updater.applyUpdate({ source: unpacked, target: previous });
  assert.equal(updated.status, 'updated');
  assert.equal(JSON.parse(fs.readFileSync(path.join(previous, 'bundle-manifest.json'))).sourceCommit, request.sourceCommit);
  assert.equal(fs.readFileSync(privateFixture, 'utf8'), 'preserve private player files');
  checkPrivateConfigs();
  assert.equal((await updater.applyUpdate({ source: unpacked, target: previous })).status, 'already-current');
  checkPrivateConfigs();
  assert.equal((await updater.rollbackUpdate({ target: previous, backup: updated.backup })).status, 'rolled-back');
  assert.equal(JSON.parse(fs.readFileSync(path.join(previous, 'bundle-manifest.json'))).sourceCommit, oldManifest.sourceCommit);
  assert.equal(fs.readFileSync(privateFixture, 'utf8'), 'preserve private player files');
  checkPrivateConfigs();
  const updateChecks = { from: request.previousTag, to: request.tag, changedFiles: updated.changedFiles,
    conflicts: 0, apply: 'passed', privateFilesPreserved: 'passed', repeat: 'already-current', rollback: 'passed',
    privateConfigurationsPreserved: privateConfigs, platform: process.platform, realWindowsProcessGuard: true };
  progress('Actual previous-package update, private-file preservation, repeat update and rollback passed.');
  const archiveSha = await sha(archive), toolSha = await sha(toolZip);
  fs.writeFileSync(path.join(assets, 'SHA256SUMS.txt'), `${archiveSha}  ${archiveName}\n`);
  fs.writeFileSync(path.join(assets, 'UPDATE-TOOL-SHA256.txt'), `${toolSha}  ${toolName}\n`);
  const report = { ...request.sourceValidation, createdAt: new Date().toISOString(), sourceCommit: request.sourceCommit,
    approvedArt: request.approvedArt || {},
    remOriginal: request.remOriginal || null,
    archive: { name: archiveName, bytes: fs.statSync(archive).size, sha256: archiveSha, payloadFilesVerified: verified.fileCount, zipFilesVerified: verified.fileCount + 1 },
    updateToolkit: { name: toolName, bytes: fs.statSync(toolZip).size, sha256: toolSha, sourceCommit: request.sourceCommit, verifiedFiles: toolManifest.files.length + 1 },
    updateChecks,
    packagedWindows: { node: request.runtimeVersion, platform: runtimeIdentity.platform, arch: runtimeIdentity.arch,
      tests, sourceAuthorTests, hostTests, browserTests, http: smoke.checks[0].http, webSocket: smoke.checks[0].webSocket,
      httpArtifactsVerified: Object.keys(smoke.checks[0].artifacts).length, runtimeArchiveSha256: runtimeSha },
    automation: { commit: process.env.GITHUB_SHA, run: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` },
    limitations: [
      ...(request.sourceValidation?.limitations || []),
      'Manual browser/BAT launch and balance evaluation were not run; automated native Windows service, browser and launcher checks are recorded separately.',
    ] };
  fs.writeFileSync(path.join(assets, 'RELEASE-VALIDATION.json'), JSON.stringify(report, null, 2) + '\n');
  const assetNames = fs.readdirSync(assets).sort();
  progress(`Uploading ${assetNames.length} validated release assets.`);
  command('gh', ['release', 'upload', request.tag, '--repo', repo, '--clobber', ...assetNames.map(name => path.join(assets, name))]);
  const uploaded = api(`releases/${request.draftReleaseId}`);
  assert.equal(uploaded.draft, true);
  assert.deepEqual(uploaded.assets.map(asset => asset.name).sort(), assetNames);
  for (const asset of uploaded.assets) {
    const file = path.join(assets, asset.name);
    assert.equal(asset.size, fs.statSync(file).size, asset.name);
    assert.equal(asset.digest, `sha256:${await sha(file)}`, asset.name);
  }
  const downloaded = path.join(root, 'downloaded-release-verification'); fs.mkdirSync(downloaded);
  command('gh', ['release', 'download', request.tag, '--repo', repo, '--dir', downloaded]);
  for (const name of assetNames) {
    assert.equal(fs.statSync(path.join(downloaded, name)).size, fs.statSync(path.join(assets, name)).size, name);
    assert.equal(await sha(path.join(downloaded, name)), await sha(path.join(assets, name)), name);
  }
  progress('All five uploaded attachments were downloaded again and their byte counts and SHA256 hashes verified.');
  if (request.prepareOnly === true) {
    progress('All five assets are verified. Release remains a draft for the final source-validation check.');
    return;
  }
  const body = uploaded.body.replace(/本次在 Linux 环境[^\n]+/, `本次使用包内 Node.js ${request.runtimeVersion} 验证原生 Windows 服务与回归：${tests.pass} 项通过、${tests.skipped} 项条件跳过、0 失败；HTTP／WebSocket 和全量文件校验通过。交互式浏览器／BAT 启动未作人工验收。`);
  const publication = path.join(root, 'publication.json');
  fs.writeFileSync(publication, JSON.stringify({ draft: false, prerelease: false, make_latest: 'true', target_commitish: request.sourceCommit, body }));
  command('gh', ['api', '--method', 'PATCH', `repos/${repo}/releases/${request.draftReleaseId}`, '--input', publication]);
  const latest = api('releases/latest');
  assert.equal(latest.tag_name, request.tag); assert.equal(latest.draft, false); assert.equal(latest.prerelease, false);
  const online = await import(pathToFileURL(path.join(source, 'scripts/rhine-online-update.mjs')));
  const selected = online.selectRelease(latest);
  assert.equal(selected.tag, request.tag); assert.equal(selected.commit, request.sourceCommit);
  assert.equal(selected.zip.sha256, archiveSha);
  assert.equal(online.parseChecksum(fs.readFileSync(path.join(downloaded, 'SHA256SUMS.txt'), 'utf8'), archiveName), archiveSha);
  assert.equal(latest.assets.length, 5);
  console.log(`Published and verified: ${latest.html_url}; online updater selects ${selected.tag} at ${selected.commit}`);
}
try {
  await main();
} catch (error) {
  // Draft-only diagnostics let release preparation failures be inspected through the asset API.
  let draftFailure = false;
  try { draftFailure = process.argv[2] === 'publish' && api(`releases/${request.draftReleaseId}`).draft === true; } catch { /* Preserve the original failure. */ }
  if (draftFailure) {
    const logs = {};
    for (const name of ['browser-rem-sim.log', 'browser-rem-render.log', 'browser-rem-rally.log', 'packaged-tests.log', 'source-author-tests.log', 'packaged-plugin-host-tests.log', 'browser-render.log', 'browser-stats.log', 'browser-kazdel-sim.log', 'browser-upstream-render.log', 'browser-upstream-ui.log', 'browser-rhine-operators.log', 'browser-six-seat.log', 'browser-plugins.log']) {
      const file = path.join(root, name);
      if (fs.existsSync(file)) logs[name] = fs.readFileSync(file, 'utf8').slice(-48000);
    }
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, 'RELEASE-VALIDATION.json');
    fs.writeFileSync(file, JSON.stringify({ status: 'validation-failed', sourceCommit: request.sourceCommit,
      error: String(error?.message || error).slice(-4000), logs }, null, 2) + '\n');
    spawnSync('gh', ['release', 'upload', request.tag, '--repo', repo, '--clobber', file], quiet);
  }
  throw error;
}
