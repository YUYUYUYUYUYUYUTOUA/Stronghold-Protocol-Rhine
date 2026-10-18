// A standalone diagnostic branch. Never imports the publisher or creates a package/release/tag/deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserAcceptancePolicy } from './rhine-browser-acceptance.mjs';

const automation = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.resolve(process.env.RHINE_DIAGNOSTIC_SOURCE || path.join(path.dirname(automation), 'source'));
const output = path.resolve(process.env.RHINE_DIAGNOSTIC_OUTPUT || path.join(os.tmpdir(), 'rhine-browser-diagnostic10/evidence'));
const scratch = path.dirname(output);
const SOURCE = 'c2bcb246d407e8f4c014d39c480c85358e79fdeb';
const REPOSITORY = 'YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine';
const BRANCH = 'refs/heads/codex/rhine-030-browser-diagnostic10';
const archiveName = 'Stronghold-Protocol-Rhine-v0.3.0-rhine.8-Windows-x64.zip';
const archiveSha256 = '58b0c84884478d327ec8e135fd8e373e7caab4ed331b9595e69dced684b8179b';
const scripts = path.join(automation, '.github/scripts');
const observer = path.join(scripts, 'rhine-browser-diagnostic10-observer.mjs');
const sampler = path.join(scripts, 'rhine-browser-diagnostic10-system.ps1');
const rendererPatch = path.join(scripts, 'rhine-browser-diagnostic10-renderer-patch.py');
const request = JSON.parse(fs.readFileSync(path.join(automation, '.github/rhine-release-request.json'), 'utf8'));
const selectedFiles = ['test/ui/rhine-profiles.e2e.test.js', 'test/ui/six-player-balance.e2e.test.js'];
const protectedFiles = [...selectedFiles, 'test/e2e/client.mjs', 'test/e2e/mechanismGraphics.mjs',
  'test/e2e/sixWarmupObserver.mjs', 'test/e2e/fastServer.mjs', 'public/js/battle/runner.js', 'public/js/battle/simHost.js'];
const flags = { NO_COLOR: '1', SP_STUDIO: 'off', SP_ASSET_INDEX: '0', SP_E2E: '1',
  SP_E2E_SWIFTSHADER: '1', SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0', SP_PROFILE_CPU_DIAG: '0',
  RHINE_DIAGNOSTIC_SOURCE: source, RHINE_DIAGNOSTIC_OUTPUT: output };
const quiet = { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
const emit = (event, data = {}) => {
  const record = { at: new Date().toISOString(), event, ...data };
  fs.appendFileSync(path.join(output, 'orchestrator.jsonl'), JSON.stringify(record) + '\n');
  console.log(JSON.stringify(record));
};
const errorOf = error => ({ name: error?.name, message: String(error?.message || error), stack: error?.stack });
const hash = async file => {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, { ...quiet, cwd: source, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${exe} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function plan() {
  assert.equal(request.sourceCommit, SOURCE);
  assert.equal(request.runtimeVersion, 'v24.21.0');
  const policy = browserAcceptancePolicy(request);
  assert.equal(policy.excludedTests.length, 2);
  assert.ok(policy.excludedTests.every(item => item.group === 'upstreamRenderer'
    && item.file === 'test/render/recovery.browser.test.js'));
  return { diagnosticOnly: true, sourceCommit: SOURCE, repository: REPOSITORY, branch: BRANCH,
    previousAutomationReference: '6c846fb9d6fd3e664add0645338408364808519d',
    originalCaseTimeoutMs: 300000, originalGroupTimeoutMs: 600000, caseAssertionsAndDeadlines: 'unchanged',
    resourceArchive: { tag: 'v0.3.0-rhine.8', name: archiveName, sha256: archiveSha256 },
    fullReleaseBrowserPolicy: policy, policyBoundary: 'The two exact legacy 3D exclusions remain unchanged. Their file and all other unselected groups are outside this three-case diagnostic; none is counted as passing or skipped here.',
    groups: [{ name: 'profiles', files: [selectedFiles[0]], expectedTests: 1 },
      { name: 'six-balance', files: [selectedFiles[1]], expectedTests: 2 }],
    sampleIntervalMs: 10000, flags, protectedFiles,
    noRetry: true, noAddedWarmup: true, noPublisherImport: true, noReleaseMutation: true,
    observationBoundary: 'Passive collector hooks add CDP setup before navigation and bounded reads after failure/at cleanup. This fresh isolated run is not a strictly interference-free timing experiment or a replay of the full native acceptance order.',
    noTag: true, noDistributable: true, noDeployment: true };
}
async function sourceFingerprints() {
  return Object.fromEntries(await Promise.all(protectedFiles.map(async relative => [relative, await hash(path.join(source, relative))])));
}
async function verifyArchive(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'bundle-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, 'a3a98d798a21d2913631ea13eb4f9eab77e7afb0');
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.fileCount, manifest.files.length);
  assert.equal(manifest.runtime.version, 'v24.21.0');
  const seen = new Set();
  for (const entry of manifest.files) {
    assert.ok(!entry.path.includes('\\') && !entry.path.includes(':') && !path.posix.isAbsolute(entry.path));
    assert.ok(entry.path.split('/').every(part => part && part !== '.' && part !== '..'));
    assert.equal(seen.has(entry.path.toLowerCase()), false); seen.add(entry.path.toLowerCase());
    const absolute = path.join(directory, entry.path), stat = fs.lstatSync(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, entry.size, entry.path);
    assert.equal(await hash(absolute), entry.sha256, entry.path);
  }
  assert.equal(manifest.totalBytes, manifest.files.reduce((sum, entry) => sum + entry.size, 0));
  const actual = [];
  const visit = (absolute, prefix = '') => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(absolute, entry.name), relative);
      else { assert.ok(entry.isFile()); actual.push(relative); }
    }
  };
  visit(directory);
  assert.deepEqual(actual.sort(), [...manifest.files.map(entry => entry.path), 'bundle-manifest.json'].sort());
  return manifest;
}
async function prepareResources() {
  const downloads = path.join(scratch, 'downloads'); fs.mkdirSync(downloads);
  // Authenticated read-only download; this is resource preparation, never anonymous delivery proof.
  command('gh', ['release', 'download', 'v0.3.0-rhine.8', '--repo', REPOSITORY,
    '--pattern', archiveName, '--pattern', 'SHA256SUMS.txt', '--dir', downloads]);
  const archive = path.join(downloads, archiveName);
  assert.equal(fs.statSync(archive).size, 932468955);
  assert.equal(await hash(archive), archiveSha256);
  assert.ok(fs.readFileSync(path.join(downloads, 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/)
    .some(line => line.trim() === `${archiveSha256}  ${archiveName}`));
  const extracted = path.join(scratch, 'verified-eight');
  command('python', [path.join(scripts, 'rhine-release-archive.py'), 'extract', archive, extracted]);
  const previous = path.join(extracted, 'Stronghold-Protocol-Rhine');
  const manifest = await verifyArchive(previous);
  // Only resources/runtime are reused. Source, tests and npm dependencies come from fixed S.
  for (const relative of ['public/assets', 'public/fonts', 'public/vendor']) {
    assert.equal(fs.existsSync(path.join(source, relative)), false, relative);
    fs.cpSync(path.join(previous, relative), path.join(source, relative), { recursive: true });
  }
  for (const relative of ['data/local-assets.json', 'data/local-fx.json']) {
    assert.equal(fs.existsSync(path.join(source, relative)), false, relative);
    fs.copyFileSync(path.join(previous, relative), path.join(source, relative));
  }
  assert.equal(await hash(path.join(previous, 'data/assets.json')), await hash(path.join(source, 'data/assets.json')),
    'The complete previous art metadata must exactly match fixed S.');
  for (const [relative, expected] of Object.entries(request.approvedArt || {})) {
    assert.equal(await hash(path.join(source, relative)), expected, relative);
  }
  const node = path.join(previous, 'runtime/node/node.exe');
  const identity = JSON.parse(command(node, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,priority:require("node:os").getPriority(process.pid)})']));
  assert.deepEqual(identity, { version: 'v24.21.0', platform: 'win32', arch: 'x64', priority: os.constants.priority.PRIORITY_NORMAL });
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  assert.ok(fs.statSync(npm).isFile());
  assert.equal(fs.existsSync(path.join(source, 'node_modules')), false);
  const install = command(node, [npm, 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  fs.writeFileSync(path.join(output, 'npm-ci.log'), install);
  fs.writeFileSync(path.join(output, 'vendor.log'), command(node, ['tools/vendor.mjs']));
  fs.writeFileSync(path.join(output, 'setup-check.log'), command(node, ['tools/setup.mjs', '--check', '--no-local']));
  const report = { sourceCommit: SOURCE, archive: archiveName, archiveSha256,
    archiveBytes: fs.statSync(archive).size, manifestSource: manifest.sourceCommit,
    manifestFileCount: manifest.fileCount, manifestTotalBytes: manifest.totalBytes,
    runtime: { ...identity, sha256: await hash(node) },
    resourceMetadata: await Promise.all(['data/assets.json', 'data/local-assets.json', 'data/local-fx.json'].map(async relative => ({
      path: relative, bytes: fs.statSync(path.join(source, relative)).size, sha256: await hash(path.join(source, relative)) }))),
    resourceMetadataBoundary: 'The ignored local metadata files are verified against the fixed complete .8 archive manifest. The tracked assets.json is additionally byte-identical to fixed S; there is no independent .10 assembly hash for the ignored files in this diagnostic.',
    noOldNodeModulesReused: true, freshNpmCi: true, setupCheck: true };
  fs.writeFileSync(path.join(output, 'resources.json'), JSON.stringify(report, null, 2) + '\n');
  emit('verified-resources', report);
  return node;
}
let sampleQueue = Promise.resolve();
const sampleStats = { requested: 0, completed: 0, failed: 0, fieldErrors: 0 };
function sample(phase) {
  sampleStats.requested++;
  sampleQueue = sampleQueue.then(() => new Promise(resolve => {
    const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', sampler,
      '-OwnerRoot', String(process.pid)], { windowsHide: true });
    let stdout = '', stderr = '';
    const limit = setTimeout(() => { child.kill('SIGKILL'); }, 8000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(limit); sampleStats.failed++;
      emit('system-sample-error', { phase, error: errorOf(error) }); resolve(); });
    child.once('close', code => {
      clearTimeout(limit);
      try {
        assert.equal(code, 0);
        const record = { phase, ...JSON.parse(stdout.replace(/^\uFEFF/, '')) };
        fs.appendFileSync(path.join(output, 'windows-system-samples.jsonl'), JSON.stringify(record) + '\n');
        sampleStats.completed++;
        emit('system-sample', { phase, at: record.at, memory: record.memory, performanceMemory: record.performanceMemory,
          ownedNodeAndEdgeCount: record.ownedNodeAndEdge?.length,
          tcpStateCounts: record.tcpStateCounts, ownedTcpStateCounts: record.ownedTcpStateCounts,
          ownedTcpCount: record.ownedTcpCount, errors: record.errors, optionalErrors: record.optionalErrors });
        if (record.errors?.length) { sampleStats.fieldErrors += record.errors.length;
          emit('system-sample-fields-failed', { phase, errors: record.errors }); }
      } catch (error) { sampleStats.failed++; emit('system-sample-error', { phase, code, stderr, stdout, error: errorOf(error) }); }
      resolve();
    });
  }));
  return sampleQueue;
}
async function runGroup(node, group, edge) {
  await sample(`before-${group.name}`);
  const startedAt = Date.now();
  const args = ['--import', pathToFileURL(observer).href, '--test', '--test-reporter=spec', '--test-concurrency=1', ...group.files];
  const child = spawn(node, args, { cwd: source, windowsHide: true, env: { ...process.env, ...flags, CHROME_PATH: edge } });
  const raw = fs.createWriteStream(path.join(output, `${group.name}.raw.log`));
  const stdout = fs.createWriteStream(path.join(output, `${group.name}.stdout.log`));
  const stderr = fs.createWriteStream(path.join(output, `${group.name}.stderr.log`));
  let text = '', failureObserved = false, deadlineExpired = false;
  const receive = (chunk, stream) => {
    raw.write(chunk); stream.write(chunk); text += String(chunk);
    process.stdout.write(chunk);
    if (!failureObserved && /\[rhine-diagnostic-failure\]|Six-seat failure:|✖/.test(text)) {
      failureObserved = true; void sample(`failure-observed-${group.name}`);
    }
  };
  child.stdout.on('data', chunk => receive(chunk, stdout));
  child.stderr.on('data', chunk => receive(chunk, stderr));
  emit('group-start', { name: group.name, pid: child.pid, args, originalGroupTimeoutMs: 600000 });
  const timer = setInterval(() => { void sample(`interval-${group.name}`); }, 10000);
  // Same outer publisher group deadline; no case or operation timeout is changed.
  const deadline = setTimeout(() => {
    deadlineExpired = true;
    emit('group-deadline', { name: group.name, pid: child.pid });
    // The original 600 s outer limit has already failed. Clean only this owned child tree.
    if (child.exitCode !== null || child.signalCode !== null) {
      emit('group-deadline-cleanup-already-exited', { name: group.name, pid: child.pid,
        exitCode: child.exitCode, signalCode: child.signalCode });
      return;
    }
    const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    let cleanupText = '';
    let fallbackAttempted = false;
    const fallbackKill = () => {
      if (fallbackAttempted || child.exitCode !== null || child.signalCode !== null) return;
      fallbackAttempted = true;
      try { emit('group-deadline-kill-fallback', { name: group.name, pid: child.pid, killReturned: child.kill('SIGKILL') }); }
      catch (killError) { emit('group-deadline-kill-fallback-error', { name: group.name, pid: child.pid, error: errorOf(killError) }); }
    };
    cleanup.stdout.on('data', chunk => { cleanupText += chunk; });
    cleanup.stderr.on('data', chunk => { cleanupText += chunk; });
    cleanup.once('close', code => {
      emit('group-deadline-cleanup-exit', { name: group.name, pid: child.pid,
        taskkillExitCode: code, output: cleanupText.slice(0, 4000) });
      if (code !== 0) fallbackKill();
    });
    cleanup.once('error', error => {
      emit('group-deadline-cleanup-error', { name: group.name, pid: child.pid, error: errorOf(error) });
      fallbackKill();
    });
  }, 600000);
  let error;
  const ended = await new Promise(resolve => {
    child.once('error', value => { error = value; });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearInterval(timer); clearTimeout(deadline);
  await Promise.all([raw, stdout, stderr].map(stream => new Promise(resolve => stream.end(resolve))));
  await sample(`after-${group.name}`);
  const outcome = { name: group.name, pid: child.pid, elapsedMs: Date.now() - startedAt, ...ended,
    error: error && errorOf(error), totals: {}, failureObserved, deadlineExpired };
  try {
    if (error) throw error;
    assert.equal(deadlineExpired, false, 'The original 600000 ms outer deadline expired; late output cannot pass.');
    for (const key of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
      const matches = [...text.matchAll(new RegExp(`^[ℹ#] ?${key} (\\d+)\\r?$`, 'gm'))];
      assert.ok(matches.length, `Missing real runner total: ${key}`);
      outcome.totals[key] = Number(matches.at(-1)[1]);
    }
    assert.equal(ended.code, 0);
    assert.equal(outcome.totals.tests, group.expectedTests);
    assert.equal(outcome.totals.pass, group.expectedTests);
    for (const key of ['fail', 'skipped', 'cancelled']) assert.equal(outcome.totals[key], 0);
    outcome.status = 'passed';
  } catch (value) { outcome.status = 'failed'; outcome.validationError = errorOf(value); }
  emit('group-end', outcome);
  return outcome;
}
async function main() {
  const selected = plan();
  if (process.argv.includes('--validate-only')) { console.log(JSON.stringify(selected, null, 2)); return; }
  fs.mkdirSync(output, { recursive: true });
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.21.0');
  assert.equal(process.env.GITHUB_REPOSITORY, REPOSITORY); assert.equal(process.env.GITHUB_REF, BRANCH);
  assert.equal(command('git', ['rev-parse', 'HEAD']).trim(), SOURCE);
  assert.equal(command('git', ['status', '--porcelain', '--untracked-files=no']), '');
  const beforePriority = os.getPriority(process.pid);
  os.setPriority(process.pid, os.constants.priority.PRIORITY_NORMAL);
  const scheduling = { scope: 'owned diagnostic orchestrator only; inherited bundled runtime priority checked separately',
    pid: process.pid, beforePriority, requestedPriority: os.constants.priority.PRIORITY_NORMAL,
    afterPriority: os.getPriority(process.pid) };
  assert.equal(scheduling.afterPriority, os.constants.priority.PRIORITY_NORMAL);
  emit('owned-orchestrator-priority', scheduling);
  const fingerprints = await sourceFingerprints();
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify({ ...selected, originalFingerprints: fingerprints }, null, 2) + '\n');
  await sample('startup-before-resource-setup');
  const node = await prepareResources();
  assert.equal(command('git', ['status', '--porcelain', '--untracked-files=no']), '');
  assert.ok(fs.statSync(rendererPatch).isFile(), 'The separately reviewed passive renderer patch must be present.');
  const patchOutput = command('python', [rendererPatch, source]);
  fs.writeFileSync(path.join(output, 'renderer-patch.log'), patchOutput);
  const diffNames = command('git', ['diff', '--name-only']).trim().split(/\r?\n/);
  assert.deepEqual(diffNames, ['public/js/render/app.js']);
  fs.writeFileSync(path.join(output, 'diagnostic-source.diff'), command('git', ['diff', '--', 'public/js/render/app.js']));
  assert.deepEqual(await sourceFingerprints(), fingerprints, 'Original test/Client/Worker source changed.');
  const edge = [process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', process.env.ProgramFiles || 'C:/Program Files']
    .map(directory => path.join(directory, 'Microsoft/Edge/Application/msedge.exe')).find(file => fs.existsSync(file));
  assert.ok(edge, 'The publisher Windows Edge lookup must succeed.');
  const outcomes = [];
  for (const group of selected.groups) outcomes.push(await runGroup(node, group, edge));
  await sampleQueue;
  assert.deepEqual(await sourceFingerprints(), fingerprints, 'Original assertions/deadlines/helpers changed during diagnostics.');
  assert.deepEqual(command('git', ['diff', '--name-only']).trim().split(/\r?\n/), ['public/js/render/app.js']);
  const summary = { ...selected, automationCommit: command('git', ['rev-parse', 'HEAD'], { cwd: automation }).trim(),
    originalFingerprints: fingerprints, patchedRendererSha256: await hash(path.join(source, 'public/js/render/app.js')),
    rendererPatchSha256: await hash(rendererPatch), observerSha256: await hash(observer), samplerSha256: await hash(sampler),
    scheduling, outcomes, sampleStats, systemSamplingComplete: sampleStats.failed === 0 && sampleStats.fieldErrors === 0,
    allSelectedCasesPassed: outcomes.every(group => group.status === 'passed'),
    resultBoundary: 'Three original cases only, in an isolated fresh diagnostic environment with passive collectors. This is not a full package acceptance run, a publication, or proof that the earlier failures are repaired.' };
  fs.writeFileSync(path.join(output, 'diagnostic-results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  assert.equal(summary.allSelectedCasesPassed, true, 'Original diagnostic case failed; no release operation was attempted.');
  assert.equal(summary.systemSamplingComplete, true, 'Required system sampling failed; inspect preserved diagnostic fields/errors.');
}
await main().catch(error => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'orchestrator-failure.json'), JSON.stringify(errorOf(error), null, 2) + '\n');
  console.error(error); process.exitCode = 1;
});
