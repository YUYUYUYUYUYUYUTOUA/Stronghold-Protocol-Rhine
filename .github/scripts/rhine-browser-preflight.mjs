// Diagnostic branch only: reproduce the publisher's full-resource Windows browser environment.
// This helper never imports the publisher, creates a release, builds a distributable or deploys a service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repository = 'YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine';
const branch = 'refs/heads/codex/rhine-030-browser-preflight';
const runtimeVersion = 'v24.21.0';
const sixFiles = ['test/ui/six-player-balance.e2e.test.js'];
const files = sixFiles;
const vanillaPattern = '^vanilla: six real humans receive/use R14 beacons, retain reduced BAN and fight a doubled boss pool$';
const supportFiles = ['test/e2e/mechanismGraphics.mjs', 'test/e2e/client.mjs',
  'test/e2e/sixWarmupObserver.mjs', 'public/js/battle/runner.js', 'public/js/battle/workerWarmup.js'];
const quiet = { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
const request = JSON.parse(fs.readFileSync(path.join(source, '.github/rhine-release-request.json'), 'utf8'));
const root = path.join(process.env.RUNNER_TEMP || path.dirname(source), 'rhine-native-browser-preflight-resources');
const archiveHelper = path.join(source, '.github/scripts/rhine-release-archive.py');
const progress = message => console.log(`${new Date().toISOString()} ${message}`);

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { ...quiet, cwd: source, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${path.basename(executable)} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function sha(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

function validateInputs() {
  assert.equal(request.previousTag, 'v0.2.4-rhine.6');
  assert.equal(request.previousArchiveName, 'Stronghold-Protocol-Rhine-v0.2.4-rhine.6-Windows-x64.zip');
  assert.equal(request.previousArchiveSha256, '492682907b8fc1d1b5ef4476566cbf8c764fc181076322b1d94872dd52904926');
  assert.equal(request.runtimeVersion, runtimeVersion);
  assert.deepEqual(request.upstreamResources, {
    repository: 'sganggs/Stronghold-Protocol', tag: 'v0.3.0',
    archiveName: 'Stronghold-Protocol-v0.3.0.zip', commit: 'c24e17eec3af1e6dedfa9935a6d15245cf2f4586',
    sha256: '5bf3cf3797902e8441aca211706630254c7ebb9636fa0baf301e6c179efcd5b7',
  });
  for (const relative of [...files, ...supportFiles, '.github/scripts/rhine-release-archive.py']) {
    assert.ok(fs.statSync(path.join(source, relative)).isFile(), relative);
  }
  return { diagnosticOnly: true, repository, branch, runtimeVersion, files, supportFiles, concurrency: 1,
    groupTimeoutMs: 600000, originalCaseDeadlinesAndAssertions: 'unchanged', resourceMode: 'complete verified old-then-upstream overlay',
    scope: 'Only the remaining failed vanilla six-player leaf. The two plugin cases passed in run38894407571 and are not rerun here.',
    groups: [{ name: 'vanillaSix', files: sixFiles, expectedTests: 1, testNamePattern: vanillaPattern,
        SP_STUDIO: 'off', SP_E2E_SWIFTSHADER: '1' }],
    flags: { NO_COLOR: '1', SP_STUDIO: 'local', SP_ASSET_INDEX: '0', SP_E2E: '1',
      SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0' },
    noPublisherImport: true, noReleaseMutation: true, noDistributable: true, noDeployment: true };
}

function normalizeOwnedPriority() {
  const before = os.getPriority(process.pid), requested = os.constants.priority.PRIORITY_NORMAL;
  assert.equal(requested, 0, 'Windows NORMAL must map to Node priority 0.');
  os.setPriority(process.pid, requested);
  const after = os.getPriority(process.pid);
  assert.equal(after, 0, 'The diagnostic helper must actually run at Windows NORMAL priority.');
  const cpus = os.cpus();
  return { pid: process.pid, before, requested, after, scope: 'owned diagnostic helper; inherited runtime priority checked separately',
    system: { type: os.type(), release: os.release(), version: os.version(), cpuCount: cpus.length,
      availableParallelism: os.availableParallelism(), cpuModels: [...new Set(cpus.map(cpu => cpu.model))] } };
}

function systemSnapshot(phase) {
  const cpus = os.cpus();
  return { phase, at: new Date().toISOString(), scope: 'this VM at one instant; CPU times are cumulative, memory is not a peak',
    system: { type: os.type(), release: os.release(), version: os.version(), arch: os.arch(),
      cpuCount: cpus.length, availableParallelism: os.availableParallelism(),
      memoryBytes: { total: os.totalmem(), free: os.freemem() },
      cpus: cpus.map((cpu, index) => ({ index, model: cpu.model, speedMHz: cpu.speed, timesMs: cpu.times })) },
    helper: { pid: process.pid, version: process.version, versions: process.versions,
      priority: os.getPriority(process.pid), uptimeSeconds: process.uptime(),
      memoryBytes: process.memoryUsage(), cpuMicroseconds: process.cpuUsage() } };
}

function extract(archive, destination) {
  assert.equal(fs.existsSync(destination), false, destination);
  // The exact shared helper rejects traversal/case aliases/links and reads all members, checking their CRCs.
  command('python', [archiveHelper, 'extract', archive, destination]);
}

function dependencyLock(directory) {
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  delete lock.name; delete lock.version;
  delete lock.packages[''].name; delete lock.packages[''].version;
  return lock;
}

// Same strict previous-payload validation as publish-rhine-release.mjs; do not reuse its older dependencies.
async function verifyPrevious(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'bundle-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.fileCount, manifest.files.length);
  const seen = new Set();
  for (const entry of manifest.files) {
    assert.ok(!entry.path.includes('\\') && !entry.path.includes(':') && !path.posix.isAbsolute(entry.path));
    assert.ok(entry.path.split('/').every(part => part && part !== '.' && part !== '..'));
    assert.equal(seen.has(entry.path.toLowerCase()), false, entry.path); seen.add(entry.path.toLowerCase());
    const file = path.join(directory, entry.path), stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), entry.path);
    assert.equal(stat.size, entry.size, entry.path); assert.equal(await sha(file), entry.sha256, entry.path);
  }
  assert.equal(manifest.totalBytes, manifest.files.reduce((sum, entry) => sum + entry.size, 0));
  const actual = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
      else { assert.ok(entry.isFile()); actual.push(relative); }
    }
  };
  visit(directory);
  assert.deepEqual(actual.sort(), [...manifest.files.map(entry => entry.path), 'bundle-manifest.json'].sort());
  return manifest;
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
  assert.equal(manifest.format, 1); assert.equal(manifest.app, resources.tag.slice(1));
  const seen = new Set();
  for (const [relative, entry] of Object.entries(manifest.files)) {
    assert.ok(!relative.includes('\\') && !relative.includes(':') && !path.posix.isAbsolute(relative));
    assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
    assert.equal(seen.has(relative.toLowerCase()), false); seen.add(relative.toLowerCase());
    const file = path.join(directory, relative), stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, entry.size, relative); assert.equal(await sha(file), entry.sha256, relative);
  }
  const vanilla = JSON.parse(fs.readFileSync(path.join(source, 'data/vanilla/manifest.json'), 'utf8'));
  assert.equal(vanilla.source, resources.commit); assert.equal(vanilla.upstreamVersion, '0.3.0');
  assert.equal(vanilla.files.length, 22);
  for (const entry of vanilla.files) {
    assert.equal(await sha(path.join(directory, 'data', entry.path)), entry.sha256, entry.path);
    assert.equal(await sha(path.join(source, 'data/vanilla', entry.path)), entry.sha256, entry.path);
  }
  assert.deepEqual(dependencyLock(directory), dependencyLock(source));
  progress(`Verified upstream archive, ${seen.size} manifest files and all 22 fixed snapshots.`);
  return directory;
}

async function officialRuntime(downloads) {
  const name = `node-${runtimeVersion}-win-x64.zip`, base = `https://nodejs.org/dist/${runtimeVersion}/`;
  const sums = await fetch(base + 'SHASUMS256.txt'); assert.equal(sums.status, 200);
  const digest = (await sums.text()).split(/\r?\n/).find(line => line.endsWith('  ' + name))?.split(/\s+/)[0];
  assert.match(digest, /^[0-9a-f]{64}$/);
  const response = await fetch(base + name); assert.equal(response.status, 200);
  const archive = path.join(downloads, name); fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  assert.equal(await sha(archive), digest);
  extract(archive, path.join(root, 'official-runtime'));
  const runtime = path.join(root, 'official-runtime', `node-${runtimeVersion}-win-x64`);
  const node = path.join(runtime, 'node.exe');
  const identity = JSON.parse(command(node, ['-p',
    "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version,versions:process.versions,pid:process.pid,priority:require('node:os').getPriority(process.pid),memoryBytes:process.memoryUsage(),cpuMicroseconds:process.cpuUsage()})"]));
  assert.deepEqual({ platform: identity.platform, arch: identity.arch, version: identity.version },
    { platform: 'win32', arch: 'x64', version: runtimeVersion });
  assert.equal(identity.priority, 0, 'The actual official Windows runtime child must inherit NORMAL priority.');
  progress(`Verified exact official Windows runtime ${runtimeVersion}; archive SHA256 ${digest}.`);
  progress(`Actual official runtime identity and inherited priority: ${JSON.stringify(identity)}`);
  return { node, npm: path.join(runtime, 'node_modules/npm/bin/npm-cli.js'), identity };
}

async function prepareResources() {
  fs.mkdirSync(root);
  const downloads = path.join(root, 'downloads'); fs.mkdirSync(downloads);
  command('gh', ['release', 'download', request.previousTag, '--repo', repository,
    '--pattern', request.previousArchiveName, '--pattern', 'SHA256SUMS.txt', '--dir', downloads]);
  const archive = path.join(downloads, request.previousArchiveName);
  assert.equal(await sha(archive), request.previousArchiveSha256);
  assert.ok(fs.readFileSync(path.join(downloads, 'SHA256SUMS.txt'), 'utf8').split(/\r?\n/)
    .some(line => line.trim() === `${request.previousArchiveSha256}  ${request.previousArchiveName}`));
  extract(archive, path.join(root, 'previous'));
  const previous = path.join(root, 'previous/Stronghold-Protocol-Rhine');
  const old = await verifyPrevious(previous);
  assert.equal(old.runtime.version, runtimeVersion);
  progress(`Verified previous archive and all ${old.fileCount} payload files.`);
  const fresh = await upstreamResources(downloads);
  const runtime = await officialRuntime(downloads);
  // Match publisher order exactly: complete old resource directories, then complete official 0.3.0 overlay.
  for (const relative of ['public/assets', 'public/fonts', 'public/vendor']) {
    assert.equal(fs.existsSync(path.join(source, relative)), false, relative);
    fs.cpSync(path.join(previous, relative), path.join(source, relative), { recursive: true });
    fs.cpSync(path.join(fresh, relative), path.join(source, relative), { recursive: true });
  }
  for (const relative of ['data/local-assets.json', 'data/local-fx.json']) {
    const origin = fs.existsSync(path.join(fresh, relative)) ? fresh : previous;
    if (fs.existsSync(path.join(origin, relative))) fs.copyFileSync(path.join(origin, relative), path.join(source, relative));
  }
  assert.equal(fs.existsSync(path.join(source, 'node_modules')), false);
  command(runtime.node, [runtime.npm, 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  command(runtime.node, ['tools/vendor.mjs']);
  for (const relative of ['node_modules/ses/dist/ses.umd.js', 'node_modules/acorn/dist/acorn.mjs',
    'public/vendor/ses.umd.js', 'public/vendor/acorn.mjs']) assert.ok(fs.statSync(path.join(source, relative)).size > 0, relative);
  command(runtime.node, ['--input-type=module', '-e',
    "import fs from 'node:fs'; import {fetchExtensionVoices} from './tools/assets/extension-voices.mjs'; import {rhineArtInput} from './tools/assets/rhine-plan.mjs'; import {kazdelArtInput} from './tools/assets/kazdel-plan.mjs'; const expected=JSON.parse(fs.readFileSync('data/assets.json')); const actual=structuredClone(expected); await fetchExtensionVoices(process.cwd(),kazdelArtInput(rhineArtInput()),actual); const {default:assert}=await import('node:assert/strict'); assert.deepEqual(actual,expected,'Rebuilt extension voices must exactly match tagged metadata.');"]);
  const manifest = path.join(source, 'data/assets.json'), bytes = fs.readFileSync(manifest), before = await sha(manifest);
  command(runtime.node, ['tools/fetch-rem-assets.mjs', '--units']);
  command(runtime.node, ['tools/fetch-rem-assets.mjs']);
  const { hash: originalHash, ...originalContent } = JSON.parse(bytes);
  const { hash: downloadedHash, ...downloadedContent } = JSON.parse(fs.readFileSync(manifest));
  assert.match(originalHash, /^[0-9a-f]{12}$/); assert.match(downloadedHash, /^[0-9a-f]{12}$/);
  assert.deepEqual(downloadedContent, originalContent, 'Rem asset metadata must stay exactly identical.');
  fs.writeFileSync(manifest, bytes); assert.equal(await sha(manifest), before);
  const logo = path.join(source, 'public/assets/bond/rem.png');
  assert.equal(fs.statSync(logo).size, 21152);
  assert.equal(await sha(logo), '3089f0cb87a7c85b1d12eb1bf6aff6e1dd8ed1d2ae6caaf2cda359b2658c546e');
  for (const [relative, expected] of Object.entries(request.approvedArt || {})) assert.equal(await sha(path.join(source, relative)), expected, relative);
  progress('Complete old + upstream + extension resources ready; SES/Acorn rebuilt; tracked asset metadata preserved.');
  return runtime;
}

async function main() {
  const plan = validateInputs();
  if (process.argv.includes('--validate-only')) { console.log(JSON.stringify(plan, null, 2)); return; }
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, runtimeVersion);
  assert.equal(process.env.GITHUB_REPOSITORY, repository); assert.equal(process.env.GITHUB_REF, branch);
  const scheduling = normalizeOwnedPriority();
  const commit = command('git', ['rev-parse', 'HEAD']).trim();
  const tracked = command('git', ['status', '--porcelain', '--untracked-files=no']);
  assert.equal(tracked, '', 'Diagnostic checkout must start clean.');
  const systemSnapshots = [systemSnapshot('before-resource-setup')];
  console.log(JSON.stringify({ ...plan, commit, platform: process.platform, arch: process.arch, node: process.version, scheduling,
    systemSnapshot: systemSnapshots[0],
    archiveHelperSha256: await sha(archiveHelper),
    files: await Promise.all(files.map(async file => ({ path: file, sha256: await sha(path.join(source, file)) }))),
    supportFiles: await Promise.all(supportFiles.map(async file => ({ path: file, sha256: await sha(path.join(source, file)) }))) }));
  const runtime = await prepareResources();
  assert.equal(command('git', ['status', '--porcelain', '--untracked-files=no']), tracked, 'Resource setup changed tracked source.');
  const edge = [process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', process.env.ProgramFiles || 'C:/Program Files']
    .map(directory => path.join(directory, 'Microsoft/Edge/Application/msedge.exe')).find(file => fs.existsSync(file));
  assert.ok(edge, 'Microsoft Edge is required, using the same lookup as the publisher.');
  const outcomes = [], failures = [];
  for (const group of plan.groups) {
    assert.equal(os.getPriority(process.pid), 0, 'Each diagnostic group must start from the NORMAL-priority helper.');
    const before = systemSnapshot(`before-${group.name}`); systemSnapshots.push(before);
    progress(`System snapshot: ${JSON.stringify(before)}`);
    progress(`Running diagnostic group ${group.name}; original case deadlines/assertions remain unchanged.`);
    const args = group.testNamePattern ? [`--test-name-pattern=${group.testNamePattern}`] : [];
    const result = spawnSync(runtime.node, ['--test', '--test-reporter=spec', '--test-concurrency=1', ...args, ...group.files], {
      ...quiet, cwd: source, timeout: plan.groupTimeoutMs,
      env: { ...process.env, ...plan.flags, CHROME_PATH: edge,
        SP_STUDIO: group.SP_STUDIO ?? plan.flags.SP_STUDIO,
        ...(group.SP_E2E_SWIFTSHADER ? { SP_E2E_SWIFTSHADER: group.SP_E2E_SWIFTSHADER } : {}) },
    });
    const after = systemSnapshot(`after-${group.name}`); systemSnapshots.push(after);
    progress(`System snapshot: ${JSON.stringify(after)}`);
    const output = (result.stdout || '') + (result.stderr || '');
    fs.writeFileSync(path.join(root, `browser-${group.name}-preflight.log`), output); console.log(output);
    const outcome = { name: group.name, exitStatus: result.status, signal: result.signal, totals: {} };
    outcomes.push(outcome);
    try {
      if (result.error) throw result.error;
      for (const key of ['tests', 'pass', 'fail', 'skipped']) {
        const matches = [...output.matchAll(new RegExp(`^[ℹ#] ?${key} (\\d+)$`, 'gm'))];
        assert.ok(matches.length, `Missing test total: ${key}`); outcome.totals[key] = Number(matches.at(-1)[1]);
      }
      assert.equal(result.status, 0, `Diagnostic group ${group.name} failed.`);
      assert.equal(outcome.totals.tests, group.expectedTests); assert.equal(outcome.totals.pass, group.expectedTests);
      assert.equal(outcome.totals.fail, 0); assert.equal(outcome.totals.skipped, 0);
      outcome.status = 'passed';
    } catch (error) {
      outcome.status = 'failed'; outcome.error = String(error?.stack || error);
      failures.push({ name: group.name, error: outcome.error });
    }
  }
  const summary = { diagnosticOnly: true, commit, scheduling, systemSnapshots, runtimeIdentity: runtime.identity, outcomes, failures };
  fs.writeFileSync(path.join(root, 'native-browser-preflight-results.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  assert.equal(command('git', ['status', '--porcelain', '--untracked-files=no']), tracked, 'Diagnostic tests changed tracked source.');
  assert.equal(failures.length, 0, 'Diagnostic browser cases failed; no release operation was attempted.');
  assert.equal(outcomes.reduce((sum, group) => sum + group.totals.tests, 0), 1);
  assert.equal(outcomes.reduce((sum, group) => sum + group.totals.pass, 0), 1);
  progress('Diagnostic-only vanilla six-player acceptance passed: 1 test, 1 pass; no package, release or deployment was created.');
}

await main();
