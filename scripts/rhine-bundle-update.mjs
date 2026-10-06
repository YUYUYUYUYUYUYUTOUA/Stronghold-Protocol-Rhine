#!/usr/bin/env node
// Manifest-based portable updates. No process is stopped, no user file is purged.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MANIFEST = 'bundle-manifest.json';
const BACKUPS = '.rhine-updates';
function inside(root, file) {
  const rel = path.relative(root, file);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}
function portable(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || /[<>:"|?*\x00-\x1f]/.test(relative)
    || relative.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error(`Unsafe manifest path: ${relative}`);
  return relative;
}
function protectedPath(relative) {
  const parts = relative.toLowerCase().split('/');
  const name = parts.at(-1);
  return parts.some(p => ['.git', '.cache', BACKUPS, 'logs', '.npm', '.yarn', '.idea', '.vscode', '.claude', '__pycache__'].includes(p))
    || name === '.env' || name.startsWith('.env.') || ['.npmrc', '.netrc', '.pypirc'].includes(name)
    || /\.log$/i.test(name) || relative.toLowerCase() === 'scripts/service.env.cmd';
}
function linked(file, stat) {
  if (stat.isSymbolicLink()) return true;
  // Some Windows Node builds report junctions as directories in lstat.
  const real = fs.realpathSync.native(file), absolute = path.resolve(file);
  return process.platform === 'win32' ? real.toLowerCase() !== absolute.toLowerCase() : real !== absolute;
}
function checkedPath(root, relative) {
  let current = root;
  for (const part of portable(relative).split('/')) {
    current = path.join(current, part);
    let st;
    try { st = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (st) {
      if (linked(current, st)) throw new Error(`Symlink/junction is not allowed for managed files: ${relative}`);
      if (current !== path.join(root, ...relative.split('/')) && !st.isDirectory()) throw new Error(`Parent is not a directory: ${relative}`);
    }
  }
  if (!inside(root, current)) throw new Error(`Path escapes the bundle: ${relative}`);
  return current;
}
function directory(input) {
  if (!input) throw new Error('Both source and target directories are required');
  const absolute = path.resolve(input);
  if (process.platform === 'win32' && absolute.startsWith('\\\\')) throw new Error('Use local Windows directories, not a remote UNC share');
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (linked(current, fs.lstatSync(current))) throw new Error('Bundle directories and ancestors must not be symlinks/junctions; use full directory paths');
  }
  if (!fs.statSync(absolute).isDirectory()) throw new Error('Bundle path must be a directory');
  return fs.realpathSync.native(absolute);
}
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function snapshot(root, relative) {
  const file = checkedPath(root, relative);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`Managed path is not a regular file: ${relative}`);
  return { size: stat.size, sha256: await hash(file) };
}
const same = (a, b) => a === null ? b === null : b !== null && a.size === b.size && a.sha256 === b.sha256;
function manifest(root, { source = false } = {}) {
  const file = checkedPath(root, MANIFEST);
  if (!fs.existsSync(file)) throw new Error('Missing bundle-manifest.json; this tool supports manifest-based Rhine portable packages only');
  const bytes = fs.readFileSync(file);
  const raw = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const value = JSON.parse(raw);
  if (value.schemaVersion !== 1 || value.bundle !== 'Stronghold-Protocol-Rhine' || !Array.isArray(value.files)
    || value.files.length === 0 || value.files.length > 100000 || value.fileCount !== value.files.length
    || !/^[a-f0-9]{40}$/i.test(value.sourceCommit) || (source && value.sourceDirty !== false)) throw new Error('Invalid or unpublished bundle manifest');
  const seen = new Set();
  for (const entry of value.files) {
    const key = portable(entry.path).toLowerCase();
    if (key === MANIFEST || protectedPath(key) || seen.has(key) || !Number.isSafeInteger(entry.size) || entry.size < 0
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid, protected or duplicate manifest entry: ${entry.path}`);
    seen.add(key);
  }
  for (const key of seen) {
    let parent = path.posix.dirname(key);
    while (parent !== '.') {
      if (seen.has(parent)) throw new Error(`File/directory collision in manifest: ${key}`);
      parent = path.posix.dirname(parent);
    }
  }
  if (value.totalBytes !== value.files.reduce((sum, entry) => sum + entry.size, 0)) throw new Error('Manifest size total mismatch');
  return { value, fingerprint: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}
function unlistedFiles(root, managed, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (rel === BACKUPS || rel === MANIFEST) continue;
    if (entry.isDirectory() && protectedPath(rel)) files.push(`${rel}/`);
    else if (entry.isDirectory() && !entry.isSymbolicLink()) files.push(...unlistedFiles(root, managed, rel));
    else if (!managed.has(rel.toLowerCase())) files.push(rel);
  }
  return files;
}

export async function planUpdate({ source, target }) {
  source = directory(source); target = directory(target);
  if (inside(source, target) || inside(target, source)) throw new Error('Source and target must not overlap');
  const old = manifest(target), next = manifest(source, { source: true });
  const oldManifest = old.value, newManifest = next.value;
  const oldFiles = new Map(oldManifest.files.map(f => [f.path.toLowerCase(), f]));
  const newFiles = new Map(newManifest.files.map(f => [f.path.toLowerCase(), f]));
  for (const entry of newManifest.files) {
    if (!same(await snapshot(source, entry.path), entry)) throw new Error(`Source payload hash/size mismatch: ${entry.path}`);
  }
  await verifySnapshot(source, MANIFEST, next.fingerprint);
  await verifySnapshot(target, MANIFEST, old.fingerprint);
  const changes = [], conflicts = [], retainedOverrides = [];
  for (const key of new Set([...oldFiles.keys(), ...newFiles.keys()])) {
    const old = oldFiles.get(key) || null, next = newFiles.get(key) || null;
    const relative = next?.path || old.path;
    let actual;
    try { actual = await snapshot(target, relative); }
    catch (error) { conflicts.push({ path: relative, reason: error.message }); continue; }
    if (same(actual, next)) continue;
    if (actual === null && next) { changes.push({ path: relative, before: null, after: next }); continue; }
    if (old && !same(actual, old)) {
      if (same(old, next)) retainedOverrides.push(relative);
      else conflicts.push({ path: relative, reason: 'Locally modified/missing file also changed in the new release' });
      continue;
    }
    if (!old && actual) {
      conflicts.push({ path: relative, reason: 'New release file would overwrite an unlisted local file' });
      continue;
    }
    changes.push({ path: relative, before: actual, after: next });
  }
  return { source, target, oldManifest, newManifest, oldManifestFile: old.fingerprint, newManifestFile: next.fingerprint, changes, conflicts, retainedOverrides,
    preservedFiles: unlistedFiles(target, new Set([...oldFiles.keys(), ...newFiles.keys()])) };
}

export async function assertBundleStopped(target) {
  if (process.platform !== 'win32') throw new Error('The CLI process check supports Windows only');
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $OutputEncoding=[Console]::OutputEncoding; @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(node|cmd|powershell|pwsh)(\\.exe)?$' } | Select-Object Name,CommandLine,ExecutablePath,ProcessId) | ConvertTo-Json -Compress";
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let processes;
  try {
    const raw = execFileSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }).trim();
    processes = raw ? JSON.parse(raw.replace(/^\uFEFF/, '')) : [];
  } catch { throw new Error('Cannot inspect running processes. Close the old service and retry from the same Windows account.'); }
  const entries = ['server/index.js', 'scripts/launch.mjs', 'scripts/rhine-bundle-launch.ps1', 'scripts/run-server.cmd'].map(rel => path.join(target, rel).replaceAll('/', '\\').toLowerCase());
  const targetNode = path.join(target, 'runtime/node/node.exe');
  const canonical = file => { try { return fs.realpathSync.native(file).toLowerCase(); } catch { return null; } };
  for (const item of Array.isArray(processes) ? processes : [processes]) {
    const line = (item.CommandLine || '').replaceAll('/', '\\').toLowerCase();
    const scriptPaths = [...line.matchAll(/(?:"([a-z]:\\[^"\r\n]+\.(?:js|mjs|ps1|cmd))"|(?:^|\s)([a-z]:\\[^\s"]+\.(?:js|mjs|ps1|cmd)))(?=\s|$)/g)].map(match => match[1] || match[2]);
    const managedScript = scriptPaths.some(file => { const real = canonical(file); return real !== null && entries.includes(real.replaceAll('/', '\\')); });
    const ownNode = item.ExecutablePath && canonical(targetNode) && canonical(item.ExecutablePath) === canonical(targetNode);
    if (ownNode || managedScript || entries.some(entry => line.includes(entry)) || (/^node(?:\.exe)?$/i.test(item.Name) && /(?:^|\s)"?(?:\.\\)?(?:server\\)?index\.js"?(?:\s|$)/i.test(line))) {
      throw new Error('The target service (or an unidentified relative-path game service) is still running. Finish matches and stop it manually first.');
    }
    if (!item.CommandLine && /^node(?:\.exe)?$/i.test(item.Name)) {
      // A process may exit between CIM enumeration and property collection.
      // Signal 0 only probes existence; it never stops or signals a live process.
      let gone = false;
      if (Number.isSafeInteger(item.ProcessId) && item.ProcessId > 0) {
        try { process.kill(item.ProcessId, 0); } catch (error) { gone = error.code === 'ESRCH'; }
      }
      if (!gone) throw new Error('A Node process cannot be inspected; update refused while service identity is unknown');
    }
  }
}
function store(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function atomicCopy(source, targetRoot, relative) {
  const target = checkedPath(targetRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporaryRelative = `${relative}.rhine-${randomUUID()}.tmp`;
  const temporary = checkedPath(targetRoot, temporaryRelative);
  try { fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
async function verifySnapshot(root, relative, expected) {
  if (!same(await snapshot(root, relative), expected)) throw new Error(`File changed during update or rollback: ${relative}`);
}
function validateBackup(target, backup) {
  const root = directory(backup);
  const backupRoot = checkedPath(target, BACKUPS);
  if (!inside(backupRoot, root) || path.dirname(root).toLowerCase() !== backupRoot.toLowerCase()) throw new Error('Backup must be a direct child of the target .rhine-updates directory');
  const state = JSON.parse(fs.readFileSync(checkedPath(root, 'state.json'), 'utf8'));
  if (state.schemaVersion !== 1 || path.resolve(state.target).toLowerCase() !== target.toLowerCase()
    || !Array.isArray(state.changes) || !['prepared', 'applied', 'restoring', 'rolled-back', 'rollback-failed'].includes(state.status)) throw new Error('Invalid update backup state');
  const seen = new Set();
  for (const change of state.changes) {
    const key = portable(change.path).toLowerCase();
    if (protectedPath(key) || seen.has(key)) throw new Error('Invalid backup entry');
    seen.add(key);
    for (const value of [change.before, change.after]) {
      if (value !== null && (!value || !Number.isSafeInteger(value.size) || value.size < 0 || !/^[a-f0-9]{64}$/.test(value.sha256))) throw new Error('Invalid backup hash/size');
    }
  }
  if (!seen.has(MANIFEST)) throw new Error('Backup must include the old manifest');
  return { root, state };
}
async function restore(target, backup, changes, expectedCurrent) {
  for (const change of changes) {
    if (change.before) await verifySnapshot(backup, `files/${change.path}`, change.before);
  }
  // Restore the manifest last, just as it is installed last.
  for (const change of [...changes.filter(c => c.path !== MANIFEST), ...changes.filter(c => c.path === MANIFEST)]) {
    await verifySnapshot(target, change.path, expectedCurrent.get(change.path));
    if (change.before) atomicCopy(checkedPath(backup, `files/${change.path}`), target, change.path);
    else { const file = checkedPath(target, change.path); if (fs.existsSync(file)) fs.unlinkSync(file); }
    await verifySnapshot(target, change.path, change.before);
  }
}

export async function applyUpdate({ source, target, assertStopped = assertBundleStopped, afterWrite = async () => {} }) {
  const plan = await planUpdate({ source, target });
  if (plan.conflicts.length) throw new Error(`Update conflicts; nothing overwritten:\n${plan.conflicts.map(c => `${c.path}: ${c.reason}`).join('\n')}`);
  await assertStopped(plan.target);
  const beforeManifest = plan.oldManifestFile;
  const afterManifest = plan.newManifestFile;
  await verifySnapshot(plan.target, MANIFEST, beforeManifest);
  await verifySnapshot(plan.source, MANIFEST, afterManifest);
  if (!plan.changes.length && same(beforeManifest, afterManifest)) return { status: 'already-current', changedFiles: 0, retainedOverrides: plan.retainedOverrides, preservedFiles: plan.preservedFiles };
  const changes = [...plan.changes, { path: MANIFEST, before: beforeManifest, after: afterManifest }];
  const backupBase = checkedPath(plan.target, BACKUPS);
  fs.mkdirSync(backupBase, { recursive: true });
  const backup = path.join(backupBase, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(backup);
  const state = { schemaVersion: 1, target: plan.target, status: 'prepared', fromCommit: plan.oldManifest.sourceCommit, toCommit: plan.newManifest.sourceCommit, changes,
    retainedOverrides: plan.retainedOverrides, preservedFiles: plan.preservedFiles, createdAt: new Date().toISOString() };
  // No target payload is touched until every delta backup is complete and verified.
  for (const change of changes) {
    await verifySnapshot(plan.target, change.path, change.before);
    if (change.before) {
      const file = checkedPath(backup, `files/${change.path}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(checkedPath(plan.target, change.path), file, fs.constants.COPYFILE_EXCL);
      await verifySnapshot(backup, `files/${change.path}`, change.before);
    }
    if (change.after) await verifySnapshot(plan.source, change.path, change.after);
  }
  store(path.join(backup, 'state.json'), state);
  await assertStopped(plan.target);
  for (const change of changes) await verifySnapshot(plan.target, change.path, change.before);
  const touched = [];
  let lastProcessCheck = Date.now();
  try {
    for (const change of changes) {
      if (Date.now() - lastProcessCheck >= 2000) { await assertStopped(plan.target); lastProcessCheck = Date.now(); }
      await verifySnapshot(plan.target, change.path, change.before);
      if (change.after) {
        await verifySnapshot(plan.source, change.path, change.after);
        atomicCopy(checkedPath(plan.source, change.path), plan.target, change.path);
      } else fs.unlinkSync(checkedPath(plan.target, change.path));
      touched.push(change);
      await verifySnapshot(plan.target, change.path, change.after);
      await afterWrite(change.path);
    }
    await assertStopped(plan.target);
    for (const change of changes) await verifySnapshot(plan.target, change.path, change.after);
    state.status = 'applied'; state.completedAt = new Date().toISOString();
    store(path.join(backup, 'state.json'), state);
  } catch (error) {
    try {
      await assertStopped(plan.target);
      for (const change of touched) await verifySnapshot(plan.target, change.path, change.after);
      await restore(plan.target, backup, touched, new Map(touched.map(c => [c.path, c.after])));
      state.status = 'rolled-back'; state.error = error.message;
      store(path.join(backup, 'state.json'), state);
    } catch (rollbackError) {
      state.status = 'rollback-failed'; state.error = error.message; state.rollbackError = rollbackError.message;
      store(path.join(backup, 'state.json'), state);
      throw new Error(`Update failed and rollback needs attention. Backup: ${backup}. ${error.message}; ${rollbackError.message}`);
    }
    throw new Error(`Update failed; changed files restored. Backup: ${backup}. ${error.message}`);
  }
  return { status: 'updated', backup, changedFiles: plan.changes.length, retainedOverrides: plan.retainedOverrides, preservedFiles: plan.preservedFiles };
}

export async function rollbackUpdate({ target, backup, assertStopped = assertBundleStopped }) {
  target = directory(target);
  const { root, state } = validateBackup(target, backup);
  await assertStopped(target);
  if (state.status === 'rolled-back') {
    for (const change of state.changes) await verifySnapshot(target, change.path, change.before);
    return { status: 'rolled-back', alreadyRestored: true, backup: root };
  }
  const current = new Map();
  for (const change of state.changes) {
    const actual = await snapshot(target, change.path);
    if (!same(actual, change.after) && !(state.status !== 'applied' && same(actual, change.before))) {
      throw new Error(`File changed during update or rollback: ${change.path}`);
    }
    current.set(change.path, actual);
    if (change.before) await verifySnapshot(root, `files/${change.path}`, change.before);
  }
  await assertStopped(target);
  for (const change of state.changes) await verifySnapshot(target, change.path, current.get(change.path));
  state.status = 'restoring';
  store(path.join(root, 'state.json'), state);
  await restore(target, root, state.changes, current);
  state.status = 'rolled-back'; state.rolledBackAt = new Date().toISOString();
  store(path.join(root, 'state.json'), state);
  return { status: 'rolled-back', backup: root, changedFiles: state.changes.length - 1 };
}

export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check' || arg === '--apply' || arg === '--help') options[arg.slice(2)] = true;
    else if (['--source', '--target', '--rollback'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = args[++i];
    else throw new Error(`Unknown/missing argument: ${arg}`);
  }
  if (options.help) { console.log('node rhine-bundle-update.mjs --source <new bundle> --target <old bundle> [--check | --apply]\nnode rhine-bundle-update.mjs --target <old bundle> --rollback <backup folder>'); return; }
  if ((options.check && options.apply) || (options.rollback && (options.apply || options.check || options.source))) throw new Error('Choose one update action');
  if (options.rollback) console.log(JSON.stringify(await rollbackUpdate({ target: options.target, backup: options.rollback }), null, 2));
  else if (options.apply) console.log(JSON.stringify(await applyUpdate(options), null, 2));
  else {
    const plan = await planUpdate(options);
    console.log(JSON.stringify({ status: plan.conflicts.length ? 'conflicts' : 'ready', sourceCommit: plan.newManifest.sourceCommit, currentCommit: plan.oldManifest.sourceCommit,
      changedFiles: plan.changes.length, conflicts: plan.conflicts, retainedOverrides: plan.retainedOverrides, preservedFileCount: plan.preservedFiles.length }, null, 2));
    if (plan.conflicts.length) process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
