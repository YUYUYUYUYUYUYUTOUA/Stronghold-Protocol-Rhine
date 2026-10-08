import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRhineDeviceRelease } from '../../tools/verify-rhine-release.mjs';

const packageRoot = new URL('../../', import.meta.url);
const data = () => Object.fromEntries(['tokens', 'bonds', 'assets'].map(name => [name,
  JSON.parse(fs.readFileSync(new URL(`data/${name}.json`, packageRoot), 'utf8'))]));
const get = async url => fs.readFileSync(new URL(url.startsWith('/shared/') ? url.slice(1)
  : url.startsWith('/sim/') ? `server${url}` : `public${url}`, packageRoot));

test('release smoke verifies the shipped laser gate, fixed stage and all five HTTP artifact mounts', async () => {
  const artifacts = {}, requested = [];
  assert.deepEqual(await verifyRhineDeviceRelease({ fetched: data(), artifacts, get: async url => {
    requested.push(url);
    return get(url);
  } }), { laser: true, minCount: 9, maxStage: 0, httpArtifacts: 5 });
  assert.deepEqual(requested, ['/art/rhine/laser.svg', '/js/render/rhineDevices.js', '/shared/rhineResearch.js',
    '/shared/rhineRange.js', '/sim/content/rhine.js']);
  assert.ok(Object.values(artifacts).every(value => /^[a-f0-9]{64}$/.test(value)));
});

test('release smoke rejects a server missing the new token or serving an obsolete device roster', async () => {
  const missing = data();
  delete missing.tokens.token_rhine_laser;
  await assert.rejects(verifyRhineDeviceRelease({ fetched: missing, get }), /served laser token missing/);
  const obsolete = data();
  obsolete.bonds.rhineShip.spec.researchDevices = ['token_rhine_medical', 'token_rhine_energy'];
  await assert.rejects(verifyRhineDeviceRelease({ fetched: obsolete, get }), /laser missing from Rhine device roster/);
});

test('release smoke rejects a stale laser asset mapping and the retired standalone ecology token', async () => {
  const wrongArt = data();
  wrongArt.assets.tokens.token_rhine_laser.avatar = '/art/rhine/ecology.svg';
  await assert.rejects(verifyRhineDeviceRelease({ fetched: wrongArt, get }), /Expected values to be strictly equal/);
  const retired = data();
  retired.tokens.token_rhine_ecology = {};
  await assert.rejects(verifyRhineDeviceRelease({ fetched: retired, get }), /standalone ecology token should be removed/);
});

test('release smoke catches missing or stale SVG, renderer, shared parameters, range and combat HTTP bytes', async () => {
  for (const stale of ['/art/rhine/laser.svg', '/js/render/rhineDevices.js', '/shared/rhineResearch.js',
    '/shared/rhineRange.js', '/sim/content/rhine.js']) {
    await assert.rejects(verifyRhineDeviceRelease({ fetched: data(), get: async url => url === stale
      ? Buffer.from('<!doctype html>old app fallback') : get(url) }), /served device artifact mismatch/);
  }
});

test('release smoke remains compatible with a package predating the laser device', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-old-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'data'));
  fs.writeFileSync(path.join(directory, 'data', 'tokens.json'), '{"token_rhine_medical":{}}');
  const olderRoot = pathToFileURL(`${directory}${path.sep}`);
  assert.deepEqual(await verifyRhineDeviceRelease({ packageRoot: olderRoot, fetched: {},
    get: async () => { throw new Error('old release should not request laser artifacts'); } }), { laser: false });
});
