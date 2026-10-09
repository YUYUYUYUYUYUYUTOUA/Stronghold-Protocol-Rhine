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
assert.ok(Number.isSafeInteger(request.draftReleaseId) && request.draftReleaseId > 0);
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
function runTests(node, directory, files, log) {
  const result = spawnSync(node, ['--test', '--test-reporter=spec', '--test-concurrency=3', ...files], {
    ...quiet, cwd: directory, env: { ...process.env, NO_COLOR: '1', SP_E2E: '0', SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0' },
  });
  const text = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(log, text);
  console.log(text.split('\n').slice(-12).join('\n'));
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
  const draft = api(`releases/${request.draftReleaseId}`);
  assert.equal(draft.tag_name, request.tag);
  const tag = api(`git/ref/tags/${request.tag}`);
  assert.equal(tag.object.type, 'commit');
  assert.equal(tag.object.sha, request.sourceCommit);
  if (process.argv[2] === 'request') {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `source_commit=${request.sourceCommit}\npublished=${!draft.draft}\n`);
    console.log(`Requested ${request.tag} at ${request.sourceCommit}; published=${!draft.draft}`);
    return;
  }
  assert.equal(process.argv[2], 'publish');
  assert.equal(process.platform, 'win32', 'This job validates the real bundled Windows runtime.');
  assert.equal(draft.draft, true, 'Published releases must never be overwritten by a rebuild.');
  assert.equal(command('git', ['-C', source, 'rev-parse', 'HEAD']).trim(), request.sourceCommit);
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
  for (const relative of ['public/assets', 'public/fonts', 'public/vendor', 'node_modules']) {
    assert.equal(fs.existsSync(path.join(source, relative)), false, relative);
    const origin = relative === 'node_modules' && fresh ? fresh : previous;
    fs.cpSync(path.join(origin, relative), path.join(source, relative), { recursive: true });
    if (fresh && relative !== 'node_modules') fs.cpSync(path.join(fresh, relative), path.join(source, relative), { recursive: true });
  }
  const localOrigin = fresh && fs.existsSync(path.join(fresh, 'data/local-assets.json')) ? fresh : previous;
  if (fs.existsSync(path.join(localOrigin, 'data/local-assets.json'))) {
    fs.copyFileSync(path.join(localOrigin, 'data/local-assets.json'), path.join(source, 'data/local-assets.json'));
  }
  if (fresh) {
    command(bundledNode, ['--input-type=module', '-e',
      "import fs from 'node:fs'; import {fetchExtensionVoices} from './tools/assets/extension-voices.mjs'; import {rhineArtInput} from './tools/assets/rhine-plan.mjs'; import {kazdelArtInput} from './tools/assets/kazdel-plan.mjs'; const expected=JSON.parse(fs.readFileSync('data/assets.json')); const actual=structuredClone(expected); await fetchExtensionVoices(process.cwd(),kazdelArtInput(rhineArtInput()),actual); const {default:assert}=await import('node:assert/strict'); assert.deepEqual(actual,expected,'Rebuilt extension voices must exactly match tagged metadata.');"], { cwd: source });
    progress('New extension voice assets downloaded and checked against the tagged manifest.');
  }
  const { buildBundle } = await import(pathToFileURL(path.join(source, 'tools/build-rhine-bundle.mjs')));
  const built = await buildBundle({ source, out: path.join(root, 'stage'), runtimeDir: runtime,
    runtimeVersion: request.runtimeVersion, runtimeSourceUrl: runtimeBase + runtimeArchiveName, runtimeSha256: runtimeSha });
  assert.equal(built.manifest.sourceCommit, request.sourceCommit);
  assert.equal(built.manifest.sourceDirty, false);
  progress(`Built ${built.manifest.fileCount} files from ${request.sourceCommit}; running native Windows regression.`);
  const node = path.join(built.destination, 'runtime/node/node.exe');
  const tests = runTests(node, built.destination, [
    'test/content/kazdel.test.js', 'test/content/kazdel_kits.test.js', 'test/content/op_wisdel.test.js',
    'test/content/rhine_device_rework.test.js', 'test/match/rhine-laser-field-share.test.js',
    'test/kazdel_data.test.js', 'test/rhine_data.test.js', 'test/i18n.test.js', 'test/i18n-packs.test.js',
    'test/tools/verify-rhine-release.test.js', 'test/rhine-bundle-update.test.js', 'test/rhine-online-update.test.js',
    'test/rhine-bundle-launch.test.js',
    'test/extension-potential.test.js', 'test/room-rhine-profile.test.js', 'test/vanilla-data.test.js',
    'test/match/potential.test.js', 'test/sim/potential-battle.test.js', 'test/ui/inspect-range.test.js',
  ], path.join(root, 'packaged-tests.log'));
  const server = spawn(node, ['server/index.js'], { cwd: built.destination, windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '3214' }, stdio: 'ignore' });
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
  const archiveSha = await sha(archive), toolSha = await sha(toolZip);
  fs.writeFileSync(path.join(assets, 'SHA256SUMS.txt'), `${archiveSha}  ${archiveName}\n`);
  fs.writeFileSync(path.join(assets, 'UPDATE-TOOL-SHA256.txt'), `${toolSha}  ${toolName}\n`);
  const report = { ...request.sourceValidation, createdAt: new Date().toISOString(), sourceCommit: request.sourceCommit,
    archive: { name: archiveName, bytes: fs.statSync(archive).size, sha256: archiveSha, payloadFilesVerified: verified.fileCount, zipFilesVerified: verified.fileCount + 1 },
    updateToolkit: { name: toolName, bytes: fs.statSync(toolZip).size, sha256: toolSha, sourceCommit: request.sourceCommit, verifiedFiles: toolManifest.files.length + 1 },
    packagedWindows: { node: request.runtimeVersion, tests, http: smoke.checks[0].http, webSocket: smoke.checks[0].webSocket,
      httpArtifactsVerified: Object.keys(smoke.checks[0].artifacts).length, runtimeArchiveSha256: runtimeSha },
    automation: { commit: process.env.GITHUB_SHA, run: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` },
    limitations: [
      'Interactive browser/BAT launch and manual balance evaluation were not run; native Windows Node service and launcher regression tests were exercised.',
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
  const body = uploaded.body.replace(/本次在 Linux 环境[^\n]+/, `本次使用包内 Node.js ${request.runtimeVersion} 验证原生 Windows 服务与回归：${tests.pass} 项通过、${tests.skipped} 项条件跳过、0 失败；HTTP／WebSocket 和全量文件校验通过。交互式浏览器／BAT 启动未作人工验收。`);
  const publication = path.join(root, 'publication.json');
  fs.writeFileSync(publication, JSON.stringify({ draft: false, prerelease: false, make_latest: 'true', target_commitish: request.sourceCommit, body }));
  command('gh', ['api', '--method', 'PATCH', `repos/${repo}/releases/${request.draftReleaseId}`, '--input', publication]);
  const latest = api('releases/latest');
  assert.equal(latest.tag_name, request.tag); assert.equal(latest.draft, false); assert.equal(latest.prerelease, false);
  console.log(`Published and verified: ${latest.html_url}`);
}
await main();
