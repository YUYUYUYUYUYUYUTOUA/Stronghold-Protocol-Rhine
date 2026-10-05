import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { VANILLA_UPSTREAM_COMMIT, writeVanillaData } from '../tools/vanilla-data.mjs';
import { applyRhineData } from '../tools/rhine-data.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VANILLA = path.join(ROOT, 'data', 'vanilla');
const PIN = '9d404199df76f862eff7385b82f952ab0498f4c5';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => {
  try { return execFileSync('git', ['-C', ROOT, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }); }
  catch (error) { throw new Error(`upstream snapshot verification failed: ${error.code || error.status}`); }
};
async function validateManifest(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.profile, 'vanilla');
  assert.equal(manifest.upstreamVersion, '0.1.2');
  const entries = manifest.files.map((entry) => entry.path);
  assert.equal(new Set(entries).size, entries.length);
  const disk = (await fs.readdir(directory)).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort();
  assert.deepEqual(entries.slice().sort(), disk, 'manifest covers every data JSON exactly once');
  for (const entry of manifest.files) {
    assert.match(entry.path, /^[a-z][a-z-]*\.json$/);
    const bytes = await fs.readFile(path.join(directory, entry.path));
    assert.equal(entry.size, bytes.length, `${entry.path} byte size`);
    assert.equal(entry.sha256, digest(bytes), `${entry.path} SHA256`);
    assert.doesNotThrow(() => JSON.parse(bytes.toString('utf8')), entry.path);
  }
  return manifest;
}

test('the entire shipped vanilla manifest covers valid files with exact byte sizes and SHA256 checksums', async () => {
  const manifest = await validateManifest(VANILLA);
  assert.equal(manifest.files.length, 17, 'the fixed upstream release has 17 data files');
  assert.equal(manifest.source, PIN);
});

test('every shipped vanilla snapshot is byte-identical to the fixed v0.1.2 commit', async (t) => {
  assert.equal(VANILLA_UPSTREAM_COMMIT, PIN);
  try { git('cat-file', '-t', PIN); } catch { t.skip('fixed upstream Git object unavailable in the portable package or shallow checkout'); return; }
  assert.equal(git('cat-file', '-t', PIN).toString('utf8').trim(), 'commit');
  const upstreamPackage = JSON.parse(git('show', `${PIN}:package.json`).toString('utf8'));
  assert.equal(upstreamPackage.version, '0.1.2');
  const paths = git('ls-tree', '--name-only', PIN, 'data/').toString('utf8').trim().split(/\r?\n/);
  const manifest = JSON.parse(await fs.readFile(path.join(VANILLA, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.map((entry) => 'data/' + entry.path).sort(), paths.slice().sort());
  for (const entry of manifest.files) {
    const upstream = git('show', `${PIN}:data/${entry.path}`);
    const local = await fs.readFile(path.join(VANILLA, entry.path));
    assert.ok(local.equals(upstream), `${entry.path} preserves the exact fixed-release bytes`);
    assert.equal(entry.sha256, digest(upstream));
  }
});

test('the generator writes the captured pre-overlay vanilla data after Rhine expands a separate working copy', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(VANILLA, 'manifest.json'), 'utf8'));
  const files = Object.fromEntries(await Promise.all(manifest.files.map(async (entry) => [entry.path.slice(0, -5), JSON.parse(await fs.readFile(path.join(VANILLA, entry.path), 'utf8'))])));
  const vanillaFiles = structuredClone(files);
  const original = JSON.stringify(vanillaFiles);
  assert.equal(vanillaFiles.chess.chess_rhine_dorothy_a, undefined);
  assert.equal(vanillaFiles.bonds.rhineShip, undefined);
  assert.equal(vanillaFiles.items.chess_item_rhine_terminal_a, undefined);
  await applyRhineData(files);
  assert.equal(files.chess.chess_rhine_dorothy_a.tier, 4);
  assert.ok(files.bonds.rhineShip);
  assert.ok(files.items.chess_item_rhine_terminal_a);
  assert.equal(JSON.stringify(vanillaFiles), original, 'Rhine overlay does not mutate the captured upstream snapshot');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'stronghold-vanilla-data-test-'));
  try {
    await writeVanillaData(vanillaFiles, temp);
    const built = await validateManifest(temp);
    assert.equal(built.source, 'build-data before the Rhine overlay');
    assert.deepEqual(built.files.map((entry) => entry.path), manifest.files.map((entry) => entry.path).sort());
    for (const entry of built.files) {
      const generated = JSON.parse(await fs.readFile(path.join(temp, entry.path), 'utf8'));
      assert.deepEqual(generated, vanillaFiles[entry.path.slice(0, -5)], `${entry.path} retains upstream values`);
    }
    const builder = await fs.readFile(path.join(ROOT, 'tools', 'build-data.mjs'), 'utf8');
    const capture = builder.indexOf('const vanillaFiles = structuredClone(files);');
    const overlay = builder.indexOf('await applyRhineData(files);', capture);
    const write = builder.indexOf('await writeVanillaData(vanillaFiles,', overlay);
    assert.ok(capture >= 0 && overlay > capture && write > overlay, 'actual build-data captures vanilla before the overlay and writes that captured copy');
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()), 'temporary deletion remains inside the created temp parent');
    assert.ok(path.basename(temp).startsWith('stronghold-vanilla-data-test-'));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
