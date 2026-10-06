import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectRelease, prepareOnlineUpdate, runOnlineUpdate, extractArchive as extractWindowsArchive } from '../scripts/rhine-online-update.mjs';

const REPOSITORY = 'YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine';
const API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MANIFEST = 'bundle-manifest.json';
const CURRENT = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const TAG = 'v0.1.3-rhine.5';
const ZIP_NAME = `Stronghold-Protocol-Rhine-${TAG}-Windows-x64.zip`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const downloadUrl = (name, tag = TAG) => `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

function put(root, relative, contents) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}
function writeManifest(root, files, sourceCommit) {
  const entries = Object.entries(files).map(([relative, contents]) => {
    const bytes = Buffer.from(contents);
    put(root, relative, bytes);
    return { path: relative, size: bytes.length, sha256: hash(bytes) };
  });
  const value = { schemaVersion: 1, bundle: 'Stronghold-Protocol-Rhine', sourceCommit, sourceDirty: false,
    files: entries, fileCount: entries.length, totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
  put(root, MANIFEST, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
function editManifest(root, mutate) {
  const value = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  mutate(value);
  put(root, MANIFEST, `${JSON.stringify(value)}\n`);
}
function snapshot(root) {
  const found = {};
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
      else found[relative] = fs.readFileSync(path.join(directory, entry.name)).toString('base64');
    }
  }
  visit(root);
  return found;
}
function fixture(t, options = {}) {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rhine-online-test-')));
  // This fixture owns the freshly created absolute temporary directory; no installed bundle is removed.
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, '玩家旧目录');
  const sourceFixture = path.join(temporary, '新版夹具');
  const cacheRoot = path.join(temporary, '下载缓存');
  fs.mkdirSync(target);
  fs.mkdirSync(sourceFixture);
  const oldFiles = { 'server/index.js': 'old server', 'package.json': '{"version":"0.1.0"}', 'data/tuning.json': 'unchanged tuning' };
  const nextFiles = { ...oldFiles, 'server/index.js': 'new server', 'package.json': '{"version":"0.1.3"}', 'public/new.js': 'new asset' };
  const oldManifest = writeManifest(target, oldFiles, options.currentCommit ?? CURRENT);
  const newManifest = writeManifest(sourceFixture, nextFiles, options.sourceCommit ?? NEXT);
  put(target, '.env', 'PORT=3019\nPRIVATE_SETTING=keep\n');
  put(target, 'scripts/service.env.cmd', 'set PORT=3019\n');
  put(target, 'logs/private.log', 'private log');
  put(target, '.cache/player.json', '{"keep":true}');
  put(target, 'my-own-file.json', '{"sound":false}');
  const archiveBytes = options.archiveBytes ?? Buffer.from('small authenticated archive fixture');
  const checksumBytes = Buffer.from(`${hash(archiveBytes)}  ${ZIP_NAME}\n`);
  const metadata = {
    id: 99, tag_name: TAG, target_commitish: NEXT, draft: false, prerelease: false,
    html_url: `https://github.com/${REPOSITORY}/releases/tag/${TAG}`,
    assets: [
      { id: 100, name: ZIP_NAME, state: 'uploaded', size: archiveBytes.length, digest: `sha256:${hash(archiveBytes)}`, browser_download_url: downloadUrl(ZIP_NAME) },
      { id: 101, name: 'SHA256SUMS.txt', state: 'uploaded', size: checksumBytes.length, digest: `sha256:${hash(checksumBytes)}`, browser_download_url: downloadUrl('SHA256SUMS.txt') },
    ],
  };
  const calls = [];
  let extractionCount = 0;
  let stopCount = 0;
  const response = (contents, status = 200) => new Response(contents, { status });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (options.fetchOverride) {
      const overridden = await options.fetchOverride(String(url), init);
      if (overridden !== undefined) return overridden;
    }
    if (String(url) === API) return response(JSON.stringify(metadata));
    if (String(url) === downloadUrl('SHA256SUMS.txt')) return response(checksumBytes);
    if (String(url) === downloadUrl(ZIP_NAME)) return response(archiveBytes);
    throw new Error(`Unexpected network access: ${url}`);
  };
  const extractArchive = async ({ archive, destination }) => {
    extractionCount++;
    assert.ok(fs.existsSync(archive));
    const output = path.join(destination, 'Stronghold-Protocol-Rhine');
    fs.cpSync(sourceFixture, output, { recursive: true });
    if (options.afterExtract) await options.afterExtract(output, destination);
  };
  const assertStopped = async checked => {
    stopCount++;
    assert.equal(fs.realpathSync.native(checked), fs.realpathSync.native(target));
    if (options.stopError) throw new Error(options.stopError);
  };
  return { temporary, target, sourceFixture, cacheRoot, oldManifest, newManifest, archiveBytes, checksumBytes, metadata, calls,
    extractArchive, fetchImpl, assertStopped, response,
    get extractionCount() { return extractionCount; }, get stopCount() { return stopCount; },
    options: { target, cacheRoot, fetchImpl, extractArchive, assertStopped } };
}
const countRequests = (f, url) => f.calls.filter(call => call.url === url).length;

test('selects only the exact Windows package and checksum from the fixed public repository', t => {
  const f = fixture(t);
  f.metadata.assets.push({ name: 'Stronghold-Protocol-Rhine-Update-Tools.zip', browser_download_url: downloadUrl('Stronghold-Protocol-Rhine-Update-Tools.zip'), size: 123 });
  const release = selectRelease(f.metadata);
  assert.equal(release.tag, TAG);
  assert.equal(release.commit, NEXT);
  assert.equal(release.zip.name, ZIP_NAME);
  assert.equal(release.zip.url, downloadUrl(ZIP_NAME));
  assert.equal(release.zip.size, f.archiveBytes.length);
  assert.equal(release.checksum.name, 'SHA256SUMS.txt');
});

test('draft, prerelease, invalid commit, missing or duplicate exact assets are rejected', t => {
  const f = fixture(t);
  const mutations = [
    value => { value.draft = true; }, value => { value.prerelease = true; },
    value => { value.target_commitish = 'main'; }, value => { value.tag_name = '../outside'; },
    value => { value.assets = value.assets.filter(asset => asset.name !== ZIP_NAME); },
    value => { value.assets.push({ ...value.assets[0] }); },
    value => { value.assets[0].size = 0; }, value => { value.assets[0].size = 1.5; },
  ];
  for (const mutate of mutations) {
    const metadata = structuredClone(f.metadata);
    mutate(metadata);
    assert.throws(() => selectRelease(metadata));
  }
});

test('only stable Rhine release tags qualify even if a lab tag is mislabeled as a formal release', t => {
  const f = fixture(t);
  for (const tag of ['v0.1.3-lab.2', 'v0.1.3-rhine.5-beta', 'v0.1.3', 'v1', 'v0.1.3-rhine']) {
    const metadata = structuredClone(f.metadata);
    metadata.tag_name = tag;
    const zipName = `Stronghold-Protocol-Rhine-${tag}-Windows-x64.zip`;
    metadata.assets[0].name = zipName;
    metadata.assets[0].browser_download_url = downloadUrl(zipName, tag);
    metadata.assets[1].browser_download_url = downloadUrl('SHA256SUMS.txt', tag);
    assert.equal(metadata.prerelease, false, 'fixture deliberately mislabels nonstable tags');
    assert.throws(() => selectRelease(metadata), undefined, tag);
  }
});

test('metadata cannot redirect the download to another repository, host, protocol or file', t => {
  const f = fixture(t);
  for (const url of ['http://github.com/example.zip', 'https://evil.example/app.zip',
    'https://github.com/sganggs/Stronghold-Protocol/releases/download/v1/app.zip', `${downloadUrl(ZIP_NAME)}?token=secret`,
    downloadUrl('different.zip')]) {
    const metadata = structuredClone(f.metadata);
    metadata.assets[0].browser_download_url = url;
    assert.throws(() => selectRelease(metadata), undefined, url);
  }
});

test('each downloadable asset must have its own valid GitHub SHA256 digest', t => {
  const f = fixture(t);
  for (const index of [0, 1]) {
    for (const digest of [undefined, null, 'sha256:not-a-hash', `sha512:${'a'.repeat(64)}`]) {
      const metadata = structuredClone(f.metadata);
      metadata.assets[index].digest = digest;
      assert.throws(() => selectRelease(metadata));
    }
  }
});

test('preparation checks the public latest endpoint and leaves installation untouched', async t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  const result = await prepareOnlineUpdate(f.options);
  assert.equal(result.status, 'prepared');
  assert.equal(result.tag, TAG);
  assert.equal(result.commit, NEXT);
  assert.equal(result.sha256, hash(f.archiveBytes));
  assert.equal(countRequests(f, API), 1);
  assert.equal(countRequests(f, downloadUrl(ZIP_NAME)), 1);
  assert.equal(f.extractionCount, 1);
  assert.ok(f.stopCount >= 1);
  assert.deepEqual(snapshot(f.target), before);
  assert.equal(f.calls[0].init.redirect, 'manual', 'GitHub metadata redirects must not change the repository');
  assert.equal(new Headers(f.calls[0].init.headers).has('authorization'), false, 'public updater requires no private token');
});

test('already current commit never downloads assets or extracts an archive', async t => {
  const f = fixture(t, { currentCommit: NEXT });
  const before = snapshot(f.target);
  const result = await runOnlineUpdate(f.options);
  assert.equal(result.status, 'already-current');
  assert.equal(countRequests(f, API), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.extractionCount, 0);
  assert.deepEqual(snapshot(f.target), before);
});

test('service stop guard refusal prevents network and installation changes', async t => {
  const f = fixture(t, { stopError: 'fixture service still running' });
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options), /fixture service still running/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(snapshot(f.target), before);
});

test('a target without the old manifest is rejected before fetching or changing files', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.target, MANIFEST));
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(snapshot(f.target), before);
});

test('offline metadata request and HTTP failures cannot alter the target', async t => {
  for (const failure of ['offline', 403, 404, 429, 500, 302]) {
    const f = fixture(t, { fetchOverride: async url => {
      if (url !== API) return undefined;
      if (failure === 'offline') throw new Error('fixture offline');
      return new Response('failure', { status: failure });
    } });
    const before = snapshot(f.target);
    await assert.rejects(runOnlineUpdate(f.options));
    assert.equal(f.extractionCount, 0);
    assert.deepEqual(snapshot(f.target), before, String(failure));
  }
});

test('invalid metadata JSON is rejected without downloading or writing the target', async t => {
  const f = fixture(t, { fetchOverride: async url => url === API ? new Response('{bad') : undefined });
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(snapshot(f.target), before);
});

test('checksum or ZIP HTTP failures never reach extraction or installation', async t => {
  for (const failedUrl of [downloadUrl('SHA256SUMS.txt'), downloadUrl(ZIP_NAME)]) {
    const f = fixture(t, { fetchOverride: async url => url === failedUrl ? new Response('unavailable', { status: 503 }) : undefined });
    const before = snapshot(f.target);
    await assert.rejects(runOnlineUpdate(f.options));
    assert.equal(f.extractionCount, 0);
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('checksum with no exact package or conflicting duplicate entries is refused', async t => {
  const malformed = [
    `${hash(Buffer.from('other'))}  other.zip\n`,
    `${'c'.repeat(64)}  ${ZIP_NAME}\n${'d'.repeat(64)}  ${ZIP_NAME}\n`,
    `not-a-hash  ${ZIP_NAME}\n`,
  ];
  for (const text of malformed) {
    const f = fixture(t, { fetchOverride: async url => url === downloadUrl('SHA256SUMS.txt') ? new Response(text) : undefined });
    // Keep the checksum asset valid for these checksum syntax checks.
    f.metadata.assets[1].size = Buffer.byteLength(text);
    f.metadata.assets[1].digest = `sha256:${hash(Buffer.from(text))}`;
    const before = snapshot(f.target);
    await assert.rejects(runOnlineUpdate(f.options));
    assert.equal(f.extractionCount, 0);
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('GitHub ZIP digest and independently downloaded checksum must agree before extraction', async t => {
  const text = `${'c'.repeat(64)}  ${ZIP_NAME}\n`;
  const f = fixture(t, { fetchOverride: async url => url === downloadUrl('SHA256SUMS.txt') ? new Response(text) : undefined });
  f.metadata.assets[1].size = Buffer.byteLength(text);
  f.metadata.assets[1].digest = `sha256:${hash(Buffer.from(text))}`;
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.equal(f.extractionCount, 0);
  assert.deepEqual(snapshot(f.target), before);
});

test('a checksum download cannot be replaced even if it names the correct ZIP digest', async t => {
  const f = fixture(t);
  f.metadata.assets[1].digest = `sha256:${'c'.repeat(64)}`;
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.equal(f.extractionCount, 0);
  assert.deepEqual(snapshot(f.target), before);
});

test('a damaged or truncated ZIP is rejected before extraction and never reaches target files', async t => {
  const validBytes = Buffer.from('small authenticated archive fixture');
  for (const bytes of [Buffer.alloc(validBytes.length, 88), Buffer.from('short')]) {
    const f = fixture(t, { fetchOverride: async url => url === downloadUrl(ZIP_NAME) ? new Response(bytes) : undefined });
    const before = snapshot(f.target);
    await assert.rejects(runOnlineUpdate(f.options));
    assert.equal(f.extractionCount, 0);
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('an interrupted response body does not apply a partial download', async t => {
  const f = fixture(t, { fetchOverride: async url => {
    if (url !== downloadUrl(ZIP_NAME)) return undefined;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('partial')); controller.error(new Error('fixture interrupted body')); } }));
  } });
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.equal(f.extractionCount, 0);
  assert.deepEqual(snapshot(f.target), before);
});

test('validated archive cache avoids a second ZIP download while preparation remains read-only', async t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  const first = await prepareOnlineUpdate(f.options);
  const second = await prepareOnlineUpdate(f.options);
  assert.equal(first.archive, second.archive);
  assert.equal(countRequests(f, downloadUrl(ZIP_NAME)), 1);
  assert.equal(f.extractionCount, 2, 'each use receives a fresh verified extraction');
  assert.deepEqual(snapshot(f.target), before);
});

test('corrupted cached archive is never reused and must be downloaded and verified again', async t => {
  const f = fixture(t);
  const first = await prepareOnlineUpdate(f.options);
  fs.writeFileSync(first.archive, 'cache corruption');
  const second = await prepareOnlineUpdate(f.options);
  assert.equal(countRequests(f, downloadUrl(ZIP_NAME)), 2);
  assert.equal(hash(fs.readFileSync(second.archive)), hash(f.archiveBytes));
  assert.equal(fs.readFileSync(path.join(f.target, 'server/index.js'), 'utf8'), 'old server');
});

test('extracted source commit must match the release immutable commit', async t => {
  const f = fixture(t, { sourceCommit: 'c'.repeat(40) });
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.equal(f.extractionCount, 1);
  assert.deepEqual(snapshot(f.target), before);
});

test('dirty source, corrupted payload and malicious manifest paths are rejected before installation', async t => {
  const mutations = [
    output => editManifest(output, metadata => { metadata.sourceDirty = true; }),
    output => put(output, 'server/index.js', 'corrupt payload'),
    output => editManifest(output, metadata => { metadata.files[0].path = '../outside.txt'; }),
    output => editManifest(output, metadata => { metadata.files[0].path = 'file.txt:secret'; }),
  ];
  for (const afterExtract of mutations) {
    const f = fixture(t, { afterExtract });
    const before = snapshot(f.target);
    await assert.rejects(runOnlineUpdate(f.options));
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('check-only fetches metadata without downloading, extracting or writing to any fixture directory', async t => {
  const f = fixture(t);
  const before = snapshot(f.temporary);
  const result = await runOnlineUpdate({ ...f.options, checkOnly: true });
  assert.equal(result.status, 'checked');
  assert.equal(result.updateAvailable, true);
  assert.equal(result.currentCommit, CURRENT);
  assert.equal(result.commit, NEXT);
  assert.equal(result.tag, TAG);
  assert.equal(result.plan, undefined);
  assert.deepEqual(f.calls.map(call => call.url), [API]);
  assert.equal(f.extractionCount, 0);
  assert.equal(fs.existsSync(f.cacheRoot), false);
  assert.deepEqual(snapshot(f.temporary), before);
});

test('download-only modes never install or overwrite private files', async t => {
  for (const options of [{ downloadOnly: true }, { apply: false }]) {
    const f = fixture(t);
    const before = snapshot(f.target);
    const result = await runOnlineUpdate({ ...f.options, ...options });
    assert.equal(result.status, 'downloaded');
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('online update skips intermediate versions through the manifest updater and preserves local settings', async t => {
  const f = fixture(t);
  put(f.target, 'data/tuning.json', 'local custom tuning');
  const preserved = ['.env', 'scripts/service.env.cmd', 'logs/private.log', '.cache/player.json', 'my-own-file.json', 'data/tuning.json'];
  const before = Object.fromEntries(preserved.map(relative => [relative, fs.readFileSync(path.join(f.target, relative), 'utf8')]));
  const result = await runOnlineUpdate(f.options);
  assert.equal(result.status, 'updated');
  assert.equal(fs.readFileSync(path.join(f.target, 'server/index.js'), 'utf8'), 'new server');
  assert.equal(fs.readFileSync(path.join(f.target, 'package.json'), 'utf8'), '{"version":"0.1.3"}');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, MANIFEST), 'utf8')).sourceCommit, NEXT);
  for (const relative of preserved) assert.equal(fs.readFileSync(path.join(f.target, relative), 'utf8'), before[relative], relative);
  assert.ok(fs.existsSync(path.join(f.target, '.rhine-updates')), 'manifest updater retains its recovery backup');
  assert.ok(f.stopCount >= 2);
  const noFurtherDownload = countRequests(f, downloadUrl(ZIP_NAME));
  const second = await runOnlineUpdate(f.options);
  assert.equal(second.status, 'already-current');
  assert.equal(countRequests(f, downloadUrl(ZIP_NAME)), noFurtherDownload);
});

test('a locally modified file that also changes in the release stops the online update without partial writes', async t => {
  const f = fixture(t);
  put(f.target, 'server/index.js', 'player server customization');
  const before = snapshot(f.target);
  await assert.rejects(runOnlineUpdate(f.options));
  assert.deepEqual(snapshot(f.target), before);
});

// Minimal stored ZIP fixtures exercise .NET ZipArchive validation without depending on a ZIP package.
function storedZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [filename, contents] of entries) {
    const name = Buffer.from(filename);
    const bytes = Buffer.from(contents);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, bytes);
    central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const end = Buffer.alloc(22);
  const directory = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

test('real Windows ZIP extraction rejects escaping, ambiguous and duplicate paths before any extraction', { skip: process.platform !== 'win32' }, async t => {
  const cases = ['../outside.txt', 'Stronghold-Protocol-Rhine/../outside.txt', 'C:/outside.txt',
    'Stronghold-Protocol-Rhine/server\\..\\outside.txt', 'Stronghold-Protocol-Rhine/file.txt:stream',
    'Stronghold-Protocol-Rhine/CON.txt'];
  for (const dangerous of cases) {
    const f = fixture(t);
    const archive = put(f.temporary, 'unsafe.zip', storedZip([
      ['Stronghold-Protocol-Rhine/safe.txt', 'must not be extracted before validation finishes'], [dangerous, 'unsafe'],
    ]));
    const destination = path.join(f.temporary, 'extract-here');
    fs.mkdirSync(destination);
    const outside = path.join(f.temporary, 'outside.txt');
    await assert.rejects(extractWindowsArchive({ archive, destination }));
    assert.equal(fs.existsSync(outside), false, dangerous);
    assert.equal(fs.existsSync(path.join(destination, 'Stronghold-Protocol-Rhine/safe.txt')), false, dangerous);
  }
  const f = fixture(t);
  const archive = put(f.temporary, 'duplicate.zip', storedZip([
    ['Stronghold-Protocol-Rhine/same.txt', 'first'], ['Stronghold-Protocol-Rhine/SAME.txt', 'second'],
  ]));
  const destination = path.join(f.temporary, 'extract-duplicate');
  fs.mkdirSync(destination);
  await assert.rejects(extractWindowsArchive({ archive, destination }));
  assert.equal(fs.existsSync(path.join(destination, 'Stronghold-Protocol-Rhine/same.txt')), false);
});

test('real Windows ZIP extraction accepts safe nested package files', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  const archive = put(f.temporary, 'safe.zip', storedZip([
    ['Stronghold-Protocol-Rhine/server/index.js', 'fixture source'], ['Stronghold-Protocol-Rhine/开始游戏.txt', 'fixture instructions'],
  ]));
  const destination = path.join(f.temporary, 'extract-safe');
  fs.mkdirSync(destination);
  await extractWindowsArchive({ archive, destination });
  assert.equal(fs.readFileSync(path.join(destination, 'Stronghold-Protocol-Rhine/server/index.js'), 'utf8'), 'fixture source');
  assert.equal(fs.readFileSync(path.join(destination, 'Stronghold-Protocol-Rhine/开始游戏.txt'), 'utf8'), 'fixture instructions');
});

test('actual root updater batch entries preserve PowerShell exit codes in Chinese, space and metacharacter paths', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const launcherRoot = path.join(f.temporary, '中文 更新入口 & !');
  fs.mkdirSync(launcherRoot);
  put(launcherRoot, 'scripts/rhine-online-update.ps1', 'param([int]$FixtureExit)\r\nexit $FixtureExit\r\n');
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
  const cmd = path.join(windowsRoot, 'System32', 'cmd.exe');
  for (const name of ['联网更新.bat', '更新旧版.bat']) {
    const launcher = path.join(launcherRoot, name);
    fs.copyFileSync(path.join(repositoryRoot, name), launcher);
    for (const code of [0, 1, 7]) {
      const execution = spawnSync(cmd, ['/d', '/s', '/c', `""${launcher}" ${code}"`], {
        windowsHide: true, windowsVerbatimArguments: true, timeout: 15000, encoding: 'utf8',
        cwd: path.join(windowsRoot, 'System32'),
      });
      assert.equal(execution.error, undefined, `${name}, fixture exit ${code}: ${execution.error?.message}`);
      assert.equal(execution.status, code, `${name}, fixture exit ${code}: ${execution.stdout}\n${execution.stderr}`);
    }
  }
});
