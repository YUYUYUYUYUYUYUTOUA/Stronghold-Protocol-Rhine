// Keep the two portable update formats separate at both production startup entry points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPendingUpdate, finishInstallUpdate } from '../server/update.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const put = (root, relative, body) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const digest = (body) => ({ size: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex') });
const quiet = { log: { log() {}, warn() {}, error() {} } };
const marker = (patch = {}) => JSON.stringify({ schemaVersion: 1, bundle: 'Stronghold-Protocol-Rhine',
  sourceCommit: 'a'.repeat(40), fileCount: 1, files: [{ path: 'server/index.js', ...digest('Rhine') }], ...patch });

function fixture(t, { matching = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-rhine-boot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, 'server/index.js', 'Rhine');
  put(root, 'server/old.js', 'old');
  put(root, 'MANIFEST.json', JSON.stringify({ format: 1, app: '0.2.1',
    files: { 'server/index.js': digest(matching ? 'Rhine' : 'Official') } }));
  put(root, 'UPDATE.json', JSON.stringify({ format: 1, app: '0.2.1', from: ['0.2.0'], count: 0, bytes: 0, files: {},
    removed: [{ path: 'server/old.js', sha256: [digest('old').sha256] }] }));
  return root;
}

test('Rhine startup skips foreign update metadata without deleting or renaming any player file', (t) => {
  for (const matching of [false, true]) {
    const root = fixture(t, { matching });
    put(root, 'bundle-manifest.json', marker());
    const before = ['UPDATE.json', 'MANIFEST.json', 'server/old.js'].map((p) => fs.readFileSync(path.join(root, p), 'utf8'));
    assert.deepEqual(finishInstallUpdate(root, quiet), { state: 'rhine' });
    assert.deepEqual(['UPDATE.json', 'MANIFEST.json', 'server/old.js'].map((p) => fs.readFileSync(path.join(root, p), 'utf8')), before);
    assert.equal(fs.existsSync(path.join(root, '.update-applied.json')), false);
    // The explicit upstream API retains its original behavior, even in a mixed install.
    assert.equal(applyPendingUpdate(root, quiet).state, matching ? 'applied' : 'failed');
  }
});

test('ordinary upstream installs still finish their update at startup', (t) => {
  const root = fixture(t, { matching: true });
  assert.equal(finishInstallUpdate(root, quiet).state, 'applied');
  assert.equal(fs.existsSync(path.join(root, 'server/old.js')), false);
  assert.equal(fs.existsSync(path.join(root, '.update-applied.json')), true);
});

test('invalid, unrelated, oversized and linked bundle identities never suppress upstream validation', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'bundle-manifest.json');
  for (const text of ['{', 'null', marker({ schemaVersion: 2 }), marker({ bundle: 'Other' }),
    marker({ sourceCommit: ['a'.repeat(40)] }), marker({ sourceCommit: 'no' }), marker({ files: [] }),
    marker({ fileCount: 2 })]) {
    put(root, 'bundle-manifest.json', text);
    assert.equal(finishInstallUpdate(root, quiet).state, 'failed', text);
  }
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, 32 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  assert.equal(finishInstallUpdate(root, quiet).state, 'failed');
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.equal(finishInstallUpdate(root, quiet).state, 'failed');
  fs.rmdirSync(file);
  put(root, 'elsewhere.json', marker());
  try { fs.symlinkSync(path.join(root, 'elsewhere.json'), file, 'file'); }
  catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    t.diagnostic('File symlink privilege unavailable; link case not exercised');
    return;
  }
  assert.equal(finishInstallUpdate(root, quiet).state, 'failed');
});

function installEntrypoints(root) {
  for (const relative of ['server/update.js', 'server/http/boot.js', 'scripts/launch.mjs']) {
    put(root, relative, fs.readFileSync(path.join(ROOT, relative)));
  }
  put(root, 'package.json', '{"type":"module"}');
  put(root, 'shared/constants.js', "export const APP_VERSION='0.2.1', DEV_BUILD=false;");
  put(root, 'server/http/config.js', "import {fileURLToPath} from 'node:url'; export const ROOT=fileURLToPath(new URL('../../',import.meta.url));");
  put(root, 'server/net.js', 'export const limitKeyOf=(address)=>address;');
  put(root, 'server/index.js', `import fs from 'node:fs';
import {runMain} from './http/boot.js';
await runMain(async()=>{ fs.writeFileSync(new URL('../started.txt',import.meta.url),'started');
return {url:'http://127.0.0.1:54321',host:'127.0.0.1',port:54321,close:async()=>{}}; });`);
  // Dependencies are controlled: exercise the real launcher/runMain without opening sockets or a browser.
  put(root, 'scripts/open-browser.mjs', 'export const openBrowser=()=>{throw new Error("browser must remain closed")};');
  put(root, 'tools/setup.mjs', 'export const c=new Proxy({}, {get:()=>x=>x}), mark={ok:"ok",err:"err"};');
  put(root, 'tools/doctor.mjs', 'export const probePort=async()=>({state:"free"}), classifyAddresses=()=>[], hostUrl=(host,port)=>`http://${host}:${port}`, KIND_LABEL={};');
}

for (const entry of ['server/index.js', 'scripts/launch.mjs']) {
  test(`actual ${entry} process uses the format guard before starting`, (t) => {
    const root = fixture(t);
    installEntrypoints(root);
    const args = [path.join(root, entry), '--no-open', '--no-setup', '--host', '127.0.0.1', '--port', '54321'];
    const run = () => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const refused = run();
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.equal(fs.existsSync(path.join(root, 'started.txt')), false);
    put(root, 'bundle-manifest.json', marker());
    const started = run();
    assert.equal(started.status, 0, started.stdout + started.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'started.txt'), 'utf8'), 'started');
    assert.equal(fs.existsSync(path.join(root, 'UPDATE.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'server/old.js')), true);
    assert.match(started.stdout + started.stderr, /Rhine bundle/);
  });
}
