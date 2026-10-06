import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planUpdate, applyUpdate, rollbackUpdate } from '../scripts/rhine-bundle-update.mjs';

const MANIFEST = 'bundle-manifest.json';
const UPDATE_TOOL = fileURLToPath(new URL('../scripts/rhine-bundle-update.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function put(root, relative, contents) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
  return destination;
}
function manifest(root, files, revision = 'a') {
  const entries = Object.keys(files).sort().map(relative => {
    const bytes = Buffer.from(files[relative]);
    put(root, relative, bytes);
    return { path: relative, size: bytes.length, sha256: hash(bytes) };
  });
  const metadata = {
    schemaVersion: 1,
    bundle: 'Stronghold-Protocol-Rhine',
    sourceCommit: revision.repeat(40),
    sourceDirty: false,
    files: entries,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
  };
  put(root, MANIFEST, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}
function fixture(t, oldFiles = { 'server/index.js': 'old server', 'package.json': '{"version":"old"}' }, newFiles) {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rhine-update-test-')));
  // The only recursively removed directory is this fixture's newly created absolute temporary root.
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, '玩家目录');
  const source = path.join(temporary, '新版目录');
  fs.mkdirSync(target);
  fs.mkdirSync(source);
  const oldManifest = manifest(target, oldFiles, 'a');
  const newManifest = manifest(source, newFiles ?? { ...oldFiles, 'server/index.js': 'new server' }, 'b');
  return { temporary, target, source, oldManifest, newManifest };
}
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');
function snapshot(root) {
  const found = {};
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === '.rhine-updates') continue;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
      else found[relative] = fs.readFileSync(path.join(directory, entry.name)).toString('base64');
    }
  }
  visit(root);
  return found;
}
function editManifest(root, callback) {
  const metadata = JSON.parse(read(root, MANIFEST));
  callback(metadata);
  put(root, MANIFEST, `${JSON.stringify(metadata)}\n`);
}

test('plan is read-only and identifies changed, added and obsolete managed files', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'obsolete.txt': 'remove', 'unchanged.txt': 'same' },
    { 'server/index.js': 'new', 'added.txt': 'add', 'unchanged.txt': 'same' });
  put(f.target, '.env', 'HOST=192.168.1.10\n');
  put(f.target, 'player-notes.txt', 'keep');
  const before = snapshot(f.target);
  const planned = await planUpdate(f);
  assert.deepEqual(snapshot(f.target), before);
  assert.deepEqual(planned.conflicts, []);
  assert.deepEqual(planned.changes.map(change => change.path).sort(), ['added.txt', 'obsolete.txt', 'server/index.js']);
  const added = planned.changes.find(change => change.path === 'added.txt');
  const removed = planned.changes.find(change => change.path === 'obsolete.txt');
  assert.equal(added.before, null);
  assert.equal(added.after.sha256, hash(Buffer.from('add')));
  assert.equal(removed.after, null);
  assert.equal(removed.before.sha256, hash(Buffer.from('remove')));
  assert.ok(planned.preservedFiles.includes('.env'));
  assert.ok(planned.preservedFiles.includes('player-notes.txt'));
});

test('apply updates only managed files, preserves private settings and unknown files, and is idempotent', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'obsolete.txt': 'remove' },
    { 'server/index.js': 'new', 'added.txt': 'add' });
  const privateFiles = {
    '.env': 'PORT=3009\n', '.env.production': 'local-only',
    'scripts/service.env.cmd': 'set PORT=3009', 'logs/session.txt': 'player log',
    '.cache/session.json': '{"local":true}', 'my-local-settings.json': '{"sound":false}',
  };
  for (const [relative, contents] of Object.entries(privateFiles)) put(f.target, relative, contents);
  let stopChecks = 0;
  const result = await applyUpdate({ ...f, assertStopped: async () => { stopChecks++; } });
  assert.equal(result.status, 'updated');
  assert.equal(result.changedFiles, 3);
  assert.ok(stopChecks > 0);
  assert.ok(path.isAbsolute(result.backup));
  assert.ok(fs.existsSync(result.backup));
  assert.equal(read(f.target, 'server/index.js'), 'new');
  assert.equal(read(f.target, 'added.txt'), 'add');
  assert.equal(fs.existsSync(path.join(f.target, 'obsolete.txt')), false);
  assert.deepEqual(JSON.parse(read(f.target, MANIFEST)), f.newManifest);
  for (const [relative, contents] of Object.entries(privateFiles)) assert.equal(read(f.target, relative), contents, relative);
  const already = await applyUpdate({ ...f, assertStopped: async () => {} });
  assert.equal(already.status, 'already-current');
  assert.equal(already.changedFiles, 0);
});

test('modified managed file is retained when the new release leaves its official content unchanged', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'data/tuning.json': 'official' },
    { 'server/index.js': 'new', 'data/tuning.json': 'official' });
  put(f.target, 'data/tuning.json', 'player customization');
  const planned = await planUpdate(f);
  assert.deepEqual(planned.conflicts, []);
  assert.ok(planned.retainedOverrides.includes('data/tuning.json'));
  await applyUpdate({ ...f, assertStopped: async () => {} });
  assert.equal(read(f.target, 'data/tuning.json'), 'player customization');
  const second = await planUpdate(f);
  assert.deepEqual(second.conflicts, []);
  assert.ok(second.retainedOverrides.includes('data/tuning.json'));
});

test('modified managed files conflict with upstream changes or removals without partial writes', async t => {
  for (const removed of [false, true]) {
    const f = fixture(t, { 'server/index.js': 'old', 'data/tuning.json': 'official' },
      removed ? { 'server/index.js': 'new' } : { 'server/index.js': 'new', 'data/tuning.json': 'new official' });
    put(f.target, 'data/tuning.json', 'player customization');
    const before = snapshot(f.target);
    const planned = await planUpdate(f);
    assert.ok(planned.conflicts.some(conflict => conflict.path === 'data/tuning.json' && conflict.reason));
    await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {} }));
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('managed resource indexes update normally, retain untouched-version customization and conflict on new upstream edits', async t => {
  const oldFiles = { 'server/index.js': 'old', 'data/local-assets.json': 'old index', 'public/assets/local/operator.png': 'old asset' };
  const f = fixture(t, oldFiles, { ...oldFiles, 'server/index.js': 'new', 'data/local-assets.json': 'new index', 'public/assets/local/operator.png': 'new asset' });
  await applyUpdate({ ...f, assertStopped: async () => {} });
  assert.equal(read(f.target, 'data/local-assets.json'), 'new index');
  assert.equal(read(f.target, 'public/assets/local/operator.png'), 'new asset');
  const custom = fixture(t, oldFiles, { ...oldFiles, 'server/index.js': 'new' });
  put(custom.target, 'data/local-assets.json', 'custom index');
  assert.ok((await planUpdate(custom)).retainedOverrides.includes('data/local-assets.json'));
  const conflicting = fixture(t, oldFiles, { ...oldFiles, 'data/local-assets.json': 'new index' });
  put(conflicting.target, 'data/local-assets.json', 'custom index');
  assert.ok((await planUpdate(conflicting)).conflicts.some(conflict => conflict.path === 'data/local-assets.json'));
});

test('new managed path cannot overwrite an unknown local file or a local directory', async t => {
  for (const directory of [false, true]) {
    const f = fixture(t, { 'server/index.js': 'old' }, { 'server/index.js': 'new', 'new-setting.txt': 'upstream' });
    if (directory) put(f.target, 'new-setting.txt/local.txt', 'mine');
    else put(f.target, 'new-setting.txt', 'mine');
    const before = snapshot(f.target);
    const planned = await planUpdate(f);
    assert.ok(planned.conflicts.some(conflict => conflict.path === 'new-setting.txt'));
    await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {} }));
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('stop guard failure prevents any update', async t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  await assert.rejects(applyUpdate({ ...f, assertStopped: async () => { throw new Error('server still running'); } }), /server still running/);
  assert.deepEqual(snapshot(f.target), before);
});

test('managed file changes during the stop check are rejected without overwriting the user edit', async t => {
  const f = fixture(t);
  const manifestBefore = read(f.target, MANIFEST);
  await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {
    put(f.target, 'server/index.js', 'changed while confirming stop');
  } }));
  assert.equal(read(f.target, 'server/index.js'), 'changed while confirming stop');
  assert.equal(read(f.target, MANIFEST), manifestBefore);
});

test('source or target manifest replacements during the stop check are refused', async t => {
  for (const which of ['source', 'target']) {
    const f = fixture(t);
    let replacement;
    await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {
      editManifest(f[which], metadata => { metadata.sourceCommit = 'c'.repeat(40); });
      replacement = read(f[which], MANIFEST);
    } }));
    assert.equal(read(f.target, 'server/index.js'), 'old server');
    assert.equal(read(f.source, 'server/index.js'), 'new server');
    assert.equal(read(f[which], MANIFEST), replacement, 'a changed manifest is not overwritten or implicitly accepted');
    if (which === 'source') assert.deepEqual(JSON.parse(read(f.target, MANIFEST)), f.oldManifest);
  }
});

test('missing managed file is restored from the new package even when its official content is unchanged', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'public/required.js': 'required' },
    { 'server/index.js': 'new', 'public/required.js': 'required' });
  fs.unlinkSync(path.join(f.target, 'public/required.js'));
  const planned = await planUpdate(f);
  assert.deepEqual(planned.conflicts, []);
  assert.equal(planned.retainedOverrides.includes('public/required.js'), false);
  assert.ok(planned.changes.some(change => change.path === 'public/required.js' && change.before === null));
  await applyUpdate({ ...f, assertStopped: async () => {} });
  assert.equal(read(f.target, 'public/required.js'), 'required');
});

test('a failed write automatically restores changed, deleted, added files and the old manifest', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'a-obsolete.txt': 'remove', 'z-last.txt': 'old last' },
    { 'server/index.js': 'new', 'b-added.txt': 'add', 'z-last.txt': 'new last' });
  put(f.target, '.env', 'private settings');
  const before = snapshot(f.target);
  let writes = 0;
  await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {}, afterWrite: async () => {
    writes++;
    if (writes === 2) throw new Error('injected disk failure');
  } }), /injected disk failure/);
  assert.equal(writes, 2, 'failure occurs after the update has started to modify files');
  assert.deepEqual(snapshot(f.target), before);
});

test('a late user edit to a pending file is preserved while earlier update writes roll back', async t => {
  const f = fixture(t, { 'a-first.txt': 'old first', 'z-last.txt': 'old last' },
    { 'a-first.txt': 'new first', 'z-last.txt': 'new last' });
  const oldManifestText = read(f.target, MANIFEST);
  await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {}, afterWrite: async relative => {
    if (relative === 'a-first.txt') put(f.target, 'z-last.txt', 'late player edit');
  } }));
  assert.equal(read(f.target, 'a-first.txt'), 'old first');
  assert.equal(read(f.target, 'z-last.txt'), 'late player edit');
  assert.equal(read(f.target, MANIFEST), oldManifestText);
});

test('new manifest is written after managed payload, and explicit rollback restores the full delta', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'obsolete.txt': 'remove' },
    { 'server/index.js': 'new', 'added.txt': 'add' });
  put(f.target, 'my-local-settings.json', 'preserve');
  const before = snapshot(f.target);
  const oldManifestText = read(f.target, MANIFEST);
  const result = await applyUpdate({ ...f, assertStopped: async () => {}, afterWrite: async relative => {
    if (relative !== MANIFEST) assert.equal(read(f.target, MANIFEST), oldManifestText);
  } });
  let checked = false;
  const rolledBack = await rollbackUpdate({ target: f.target, backup: result.backup, assertStopped: async () => { checked = true; } });
  assert.equal(rolledBack.status, 'rolled-back');
  assert.equal(checked, true);
  assert.deepEqual(snapshot(f.target), before);
});

test('rollback refuses to overwrite files the player changed after updating', async t => {
  const f = fixture(t);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  put(f.target, 'server/index.js', 'changed after the update');
  const before = snapshot(f.target);
  await assert.rejects(rollbackUpdate({ target: f.target, backup: applied.backup, assertStopped: async () => {} }));
  assert.deepEqual(snapshot(f.target), before);
});

test('rollback refuses corrupted backup payload without altering the updated installation', async t => {
  const f = fixture(t);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  put(applied.backup, 'files/server/index.js', 'corrupt backup');
  const before = snapshot(f.target);
  await assert.rejects(rollbackUpdate({ target: f.target, backup: applied.backup, assertStopped: async () => {} }));
  assert.deepEqual(snapshot(f.target), before);
});

test('rollback rechecks after the final stop guard and preserves a user edit made during it', async t => {
  const f = fixture(t);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  const newManifestText = read(f.target, MANIFEST);
  let guards = 0;
  await assert.rejects(rollbackUpdate({ target: f.target, backup: applied.backup, assertStopped: async () => {
    guards++;
    if (guards === 2) put(f.target, 'server/index.js', 'edit during rollback confirmation');
  } }));
  assert.ok(guards >= 2);
  assert.equal(read(f.target, 'server/index.js'), 'edit during rollback confirmation');
  assert.equal(read(f.target, MANIFEST), newManifestText);
});

test('an interrupted prepared update with mixed old/new payload can recover the old version', async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'obsolete.txt': 'remove' },
    { 'server/index.js': 'new', 'added.txt': 'add' });
  put(f.target, '.env', 'player configuration');
  const before = snapshot(f.target);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  const state = JSON.parse(read(applied.backup, 'state.json'));
  state.status = 'prepared';
  put(applied.backup, 'state.json', `${JSON.stringify(state)}\n`);
  fs.copyFileSync(path.join(applied.backup, 'files/server/index.js'), path.join(f.target, 'server/index.js'));
  const rolledBack = await rollbackUpdate({ target: f.target, backup: applied.backup, assertStopped: async () => {} });
  assert.equal(rolledBack.status, 'rolled-back');
  assert.deepEqual(snapshot(f.target), before);
});

test('CLI --rollback passes its backup argument and restores a mixed interrupted fixture', { skip: process.platform !== 'win32' || process.env.SP_UPDATE_E2E !== '1' }, async t => {
  const f = fixture(t, { 'server/index.js': 'old', 'obsolete.txt': 'remove' },
    { 'server/index.js': 'new', 'added.txt': 'add' });
  put(f.target, '.env', 'keep private configuration');
  const before = snapshot(f.target);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  const state = JSON.parse(read(applied.backup, 'state.json'));
  state.status = 'prepared';
  put(applied.backup, 'state.json', `${JSON.stringify(state)}\n`);
  fs.copyFileSync(path.join(applied.backup, 'files/server/index.js'), path.join(f.target, 'server/index.js'));
  const execution = spawnSync(process.execPath, [UPDATE_TOOL, '--target', f.target, '--rollback', applied.backup], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
  assert.equal(execution.error, undefined);
  assert.equal(execution.status, 0, `${execution.stderr}\n${execution.stdout}`);
  assert.equal(JSON.parse(execution.stdout).status, 'rolled-back');
  assert.deepEqual(snapshot(f.target), before);
});

test('interrupted update recovery still rejects a payload with an unknown user hash', async t => {
  const f = fixture(t);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  const state = JSON.parse(read(applied.backup, 'state.json'));
  state.status = 'prepared';
  put(applied.backup, 'state.json', `${JSON.stringify(state)}\n`);
  put(f.target, 'server/index.js', 'neither old nor new');
  const before = snapshot(f.target);
  await assert.rejects(rollbackUpdate({ target: f.target, backup: applied.backup, assertStopped: async () => {} }));
  assert.deepEqual(snapshot(f.target), before);
});

test('source and target must have their own valid manifest', async t => {
  for (const which of ['source', 'target']) {
    const f = fixture(t);
    fs.unlinkSync(path.join(f[which], MANIFEST));
    await assert.rejects(planUpdate(f));
  }
});

test('source corruption and missing declared payload are refused before changes', async t => {
  for (const corruption of ['changed', 'missing']) {
    const f = fixture(t);
    if (corruption === 'changed') put(f.source, 'server/index.js', 'damaged');
    if (corruption === 'missing') fs.unlinkSync(path.join(f.source, 'server/index.js'));
    const before = snapshot(f.target);
    await assert.rejects(planUpdate(f));
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('undeclared files in the source are not imported into the installation', async t => {
  const f = fixture(t);
  put(f.source, '.env', 'must not import credentials');
  put(f.source, 'source-only.txt', 'not in the payload');
  put(f.target, '.env', 'player credentials');
  await applyUpdate({ ...f, assertStopped: async () => {} });
  assert.equal(read(f.target, '.env'), 'player credentials');
  assert.equal(fs.existsSync(path.join(f.target, 'source-only.txt')), false);
});

test('new managed file already present with matching content is accepted without replacing it', async t => {
  const f = fixture(t, { 'server/index.js': 'old' }, { 'server/index.js': 'new', 'new-setting.txt': 'upstream' });
  put(f.target, 'new-setting.txt', 'upstream');
  const before = snapshot(f.target);
  const planned = await planUpdate(f);
  assert.deepEqual(planned.conflicts, []);
  assert.equal(planned.changes.some(change => change.path === 'new-setting.txt'), false);
  const applied = await applyUpdate({ ...f, assertStopped: async () => {} });
  await rollbackUpdate({ target: f.target, backup: applied.backup, assertStopped: async () => {} });
  assert.deepEqual(snapshot(f.target), before);
});

test('manifest paths cannot escape, use Windows alternate streams, or name the manifest itself', async t => {
  const dangerous = ['../outside.txt', '/absolute.txt', 'C:/outside.txt', 'server\\..\\outside.txt', 'file.txt:token', MANIFEST];
  for (const relative of dangerous) {
    const f = fixture(t);
    editManifest(f.source, metadata => { metadata.files[0].path = relative; });
    await assert.rejects(planUpdate(f), undefined, relative);
    assert.equal(read(f.target, 'server/index.js'), 'old server');
  }
});

test('manifest duplicate entries, size/hash errors, counts and totals are refused', async t => {
  const malformed = [
    metadata => { metadata.files.push({ ...metadata.files[0] }); metadata.fileCount++; metadata.totalBytes += metadata.files[0].size; },
    metadata => { metadata.files.push({ ...metadata.files[0], path: metadata.files[0].path.toUpperCase() }); metadata.fileCount++; metadata.totalBytes += metadata.files[0].size; },
    metadata => { metadata.files[0].size++; metadata.totalBytes++; },
    metadata => { metadata.files[0].sha256 = 'not-a-sha256'; },
    metadata => { metadata.fileCount++; },
    metadata => { metadata.totalBytes++; },
  ];
  for (const mutate of malformed) {
    const f = fixture(t);
    editManifest(f.source, mutate);
    await assert.rejects(planUpdate(f));
  }
});

test('even a hash-valid manifest cannot designate private settings or logs as managed payload', async t => {
  for (const relative of ['.env', '.env.production', 'scripts/service.env.cmd', '.cache/session.json', 'logs/session.txt']) {
    const f = fixture(t);
    manifest(f.source, { 'server/index.js': 'new', [relative]: 'upstream must not manage this' }, 'b');
    put(f.target, relative, 'player setting');
    const before = snapshot(f.target);
    await assert.rejects(planUpdate(f));
    assert.deepEqual(snapshot(f.target), before);
  }
});

test('source and target cannot be identical or nested in either direction', async t => {
  const f = fixture(t);
  await assert.rejects(planUpdate({ source: f.target, target: f.target }));
  const nested = path.join(f.target, 'new-package');
  fs.mkdirSync(nested);
  manifest(nested, { 'server/index.js': 'new' }, 'b');
  await assert.rejects(planUpdate({ source: nested, target: f.target }));
  await assert.rejects(planUpdate({ source: f.target, target: nested }));
});

test('linked payload directories and linked target paths never write outside the installation', async t => {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const which of ['source', 'target']) {
    const f = fixture(t, { 'server/index.js': 'old' }, { 'server/index.js': 'new' });
    const outside = path.join(f.temporary, 'outside');
    put(outside, 'index.js', which === 'source' ? 'new' : 'old');
    fs.unlinkSync(path.join(f[which], 'server/index.js'));
    fs.rmdirSync(path.join(f[which], 'server'));
    fs.symlinkSync(outside, path.join(f[which], 'server'), linkType);
    if (which === 'source') await assert.rejects(planUpdate(f));
    else {
      assert.ok((await planUpdate(f)).conflicts.some(conflict => conflict.path === 'server/index.js'));
      await assert.rejects(applyUpdate({ ...f, assertStopped: async () => {} }));
    }
    assert.equal(read(outside, 'index.js'), which === 'source' ? 'new' : 'old');
  }
});
