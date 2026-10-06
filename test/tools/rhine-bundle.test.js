import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBundle, BUNDLE_NAME, MANIFEST_NAME } from '../../tools/build-rhine-bundle.mjs';

const BUILD_TOOL = fileURLToPath(new URL('../../tools/build-rhine-bundle.mjs', import.meta.url));
const RUNTIME_URL = 'https://nodejs.org/dist/v24.14.1/node-v24.14.1-win-x64.zip';
const RUNTIME_SHA = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541';
function put(root, relative, content = relative) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}
function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
function fixture(t) {
  const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rhine-bundle-test-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const runtimeDir = path.join(temp, 'official-node');
  fs.mkdirSync(source);
  const tracked = ['README.md', 'LICENSE', 'NOTICE.md', 'package.json', 'server/index.js', 'scripts/launch.mjs', 'public/art/rhine/device.png'];
  for (const relative of tracked) put(source, relative);
  put(source, '.gitignore', 'public/assets/\npublic/fonts/\npublic/vendor/\nnode_modules/\ndata/local-assets.json\n.cache/\n');
  // Deliberately track forbidden paths too: Git membership alone must not bypass bundle exclusions.
  const forbidden = ['.env', '.env.production', '.cache/private.txt', '.rhine-updates/last/files/server/index.js', 'logs/session.txt', 'server.log', 'rhine-public-verification.json',
    'tools/deploy-rhine-update.ps1', 'scripts/service.env.cmd', 'test/e2e/out/screenshot.png', '.npmrc'];
  for (const relative of forbidden) put(source, relative, 'do not publish');
  git(source, ['init', '-q']);
  git(source, ['add', '-f', '.']);
  git(source, ['-c', 'user.name=Bundle test', '-c', 'user.email=bundle-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  const resources = ['public/assets/portrait.png', 'public/fonts/font.woff2', 'public/vendor/preact.module.js', 'node_modules/ws/index.js',
    'node_modules/ws/LICENSE', 'node_modules/example/lib/cache/index.js', 'data/local-assets.json'];
  for (const relative of resources) put(source, relative);
  for (const relative of ['public/assets/.cache/download.bin', 'node_modules/.cache/build.bin', 'public/assets/secret.log', 'public/assets/.env',
    'node_modules/package/logs/run.txt', 'public/assets/rhine-test-verification.json']) put(source, relative, 'do not publish');
  put(source, 'untracked-draft.txt', 'do not publish');
  const runtimeFiles = ['node.exe', 'LICENSE', 'README.md', 'npm.cmd', 'node_modules/npm/package.json', 'node_modules/npm/LICENSE'];
  for (const relative of runtimeFiles) put(runtimeDir, relative);
  return {
    temp, source, runtimeDir, tracked, resources, runtimeFiles, forbidden,
    options: { source, out: path.join(temp, 'stage'), runtimeDir, runtimeVersion: 'v24.14.1', runtimeSourceUrl: RUNTIME_URL, runtimeSha256: RUNTIME_SHA },
  };
}
function filesUnder(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(path.join(directory, entry.name), relative) : [relative];
  });
}

test('bundle contains tracked game/art, explicit local resources and complete runtime licenses; no private files', async t => {
  const f = fixture(t);
  const { destination, manifest } = await buildBundle(f.options);
  assert.equal(destination, path.join(f.options.out, BUNDLE_NAME));
  const expected = [...f.tracked, '.gitignore', ...f.resources, ...f.runtimeFiles.map(file => `runtime/node/${file}`)].sort();
  assert.deepEqual(filesUnder(destination).filter(file => file !== MANIFEST_NAME).sort(), expected);
  assert.deepEqual(manifest.files.map(file => file.path).sort(), expected);
  assert.equal(manifest.sourceCommit, git(f.source, ['rev-parse', 'HEAD']).trim());
  assert.equal(manifest.sourceDirty, false);
  assert.equal(manifest.runtime.version, 'v24.14.1');
  assert.equal(manifest.runtime.sourceUrl, RUNTIME_URL);
  assert.equal(manifest.runtime.archiveSha256, RUNTIME_SHA);
  assert.equal(manifest.runtime.platform, 'win32');
  assert.equal(manifest.runtime.arch, 'x64');
  assert.equal(manifest.fileCount, expected.length);
  let total = 0;
  for (const entry of manifest.files) {
    const contents = fs.readFileSync(path.join(destination, entry.path));
    assert.equal(entry.size, contents.length, entry.path);
    assert.equal(entry.sha256, createHash('sha256').update(contents).digest('hex'), entry.path);
    assert.equal(path.isAbsolute(entry.path), false);
    total += contents.length;
  }
  assert.equal(manifest.totalBytes, total);
  const saved = fs.readFileSync(path.join(destination, MANIFEST_NAME), 'utf8');
  assert.equal(saved.includes(f.temp), false, 'manifest does not record workstation paths');
  assert.equal(saved.includes('do not publish'), false);
  assert.deepEqual(JSON.parse(saved), manifest);
});

test('current tracked edits are included and accurately marked as dirty', async t => {
  const f = fixture(t);
  put(f.source, 'server/index.js', 'current tracked source');
  const { destination, manifest } = await buildBundle(f.options);
  assert.equal(manifest.sourceDirty, true);
  assert.equal(fs.readFileSync(path.join(destination, 'server/index.js'), 'utf8'), 'current tracked source');
  assert.equal(fs.existsSync(path.join(destination, 'untracked-draft.txt')), false);
});

test('nonempty output is refused without overwriting or removing its contents', async t => {
  const f = fixture(t);
  put(f.options.out, 'keep.txt', 'existing output');
  await assert.rejects(buildBundle(f.options), /not empty/);
  assert.deepEqual(fs.readdirSync(f.options.out), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(f.options.out, 'keep.txt'), 'utf8'), 'existing output');
});

test('a runtime executable, its license and populated local resource directories are required before writing output', async t => {
  const f = fixture(t);
  for (const missing of ['node.exe', 'LICENSE']) {
    fs.renameSync(path.join(f.runtimeDir, missing), path.join(f.runtimeDir, `${missing}.saved`));
    await assert.rejects(buildBundle(f.options), /ENOENT/);
    assert.equal(fs.existsSync(f.options.out), false);
    fs.renameSync(path.join(f.runtimeDir, `${missing}.saved`), path.join(f.runtimeDir, missing));
  }
  fs.unlinkSync(path.join(f.source, 'public/fonts/font.woff2'));
  await assert.rejects(buildBundle(f.options), /directory is empty: public\/fonts/);
  assert.equal(fs.existsSync(f.options.out), false);
});

test('unsafe output overlaps and linked assets cannot cause copies outside the staging directory', async t => {
  const f = fixture(t);
  await assert.rejects(buildBundle({ ...f.options, out: path.join(f.runtimeDir, 'new-output') }), /overlap/);
  await assert.rejects(buildBundle({ ...f.options, out: path.join(f.source, 'public/assets/new-output') }), /overlap/);
  const privateDirectory = path.join(f.temp, 'outside');
  put(privateDirectory, 'private.txt', 'not a bundle asset');
  fs.symlinkSync(privateDirectory, path.join(f.source, 'public/assets/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildBundle(f.options), /Symlink\/junction/);
  assert.equal(fs.existsSync(f.options.out), false);
  assert.equal(fs.readFileSync(path.join(privateDirectory, 'private.txt'), 'utf8'), 'not a bundle asset');
});

test('output junctions are refused rather than populated', async t => {
  const f = fixture(t);
  const outside = path.join(f.temp, 'outside-empty');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, f.options.out, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(buildBundle(f.options), /output directory or its ancestors/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('CLI validates arguments and accepts an empty staging directory without starting the fake runtime', async t => {
  const f = fixture(t);
  const bad = spawnSync(process.execPath, [BUILD_TOOL, '--out'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Missing value/);
  await assert.rejects(buildBundle({ ...f.options, runtimeSha256: 'not-a-hash' }), /64 hexadecimal/);
  fs.mkdirSync(f.options.out);
  const run = spawnSync(process.execPath, [BUILD_TOOL, '--source', f.source, '--out', f.options.out, '--runtime-dir', f.runtimeDir,
    '--runtime-version=24.14.1', '--runtime-source-url', RUNTIME_URL, '--runtime-sha256', RUNTIME_SHA], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Staged \d+ files/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.out, BUNDLE_NAME, MANIFEST_NAME), 'utf8')).runtime.version, 'v24.14.1');
});
