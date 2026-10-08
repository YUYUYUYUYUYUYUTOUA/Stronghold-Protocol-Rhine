import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRhineDeviceRelease, verifyKazdelRelease, verifyOpeningBanRelease } from '../../tools/verify-rhine-release.mjs';

const packageRoot = new URL('../../', import.meta.url);
const data = () => Object.fromEntries(['tokens', 'bonds', 'assets', 'chess', 'garrisons', 'config'].map(name => [name,
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

test('release smoke verifies all ten Kazdel members, native loadouts, Tinman S2 and served artwork/code', async () => {
  const artifacts = {}, requested = [];
  const result = await verifyKazdelRelease({ fetched: data(), artifacts, get: async url => {
    requested.push(url);
    return get(url);
  } });
  assert.equal(result.enabled, true);
  assert.equal(result.tinmanSoulHealing, true);
  assert.equal(result.characters.length, 10);
  assert.deepEqual(result.characters.map(c => c.tier), [1, 2, 2, 2, 3, 4, 4, 4, 5, 6]);
  assert.equal(result.httpArtifacts, requested.length);
  assert.equal(new Set(requested).size, requested.length, 'shared native skill/module icons should be fetched once');
  assert.equal(Object.keys(artifacts).length, requested.length);
  assert.ok(Object.values(artifacts).every(value => /^[a-f0-9]{64}$/.test(value)));
  for (const url of ['/shared/kazdel.js', '/sim/content/kazdel/souls.js', '/sim/content/kazdel/cannon.js',
    '/sim/kazdelOrigin.js', '/js/ui/kazdelHud.js', '/js/render/fx/kazdel.js', '/art/kazdel/bond.svg',
    '/assets/spine/op/char_4131_odda/front/char_4131_odda.skel', '/assets/spine/op/char_4131_odda/back/char_4131_odda.atlas']) {
    assert.ok(requested.includes(url), `${url} must be verified through the actual HTTP mount`);
  }
});

test('release smoke rejects an obsolete Kazdel roster, wrong tier or supplemental covenant', async () => {
  const cases = [
    [f => { delete f.bonds.kazdelShip; }, /served Kazdel covenant missing/],
    [f => { f.bonds.kazdelShip.name = '萨卡兹'; }, /main covenant name mismatch/],
    [f => { f.bonds.kazdelShip.thresholds = [3, 6]; }, /threshold mismatch/],
    [f => { f.bonds.kazdelShip.visibleMembers.pop(); }, /visible roster mismatch/],
    [f => { delete f.chess.chess_kazdel_logos_b; }, /character forms missing/],
    [f => { f.chess.chess_kazdel_hoederer_a.tier = 5; }, /tier mismatch/],
    [f => { f.chess.chess_kazdel_odd_b.bonds = ['kazdelShip', 'unyieldShip']; }, /covenant mismatch/],
    [f => { f.chess.chess_char_4_15_a.bonds.push('kazdelShip'); }, /character pool mismatch/],
  ];
  for (const [change, error] of cases) {
    const fetched = data(); change(fetched);
    await assert.rejects(verifyKazdelRelease({ fetched, get }), error);
  }
});

test('release smoke rejects missing native skills, modules and their art instead of accepting a data-only card', async () => {
  const cases = [
    [f => { f.chess.chess_kazdel_odd_a.skills.pop(); }, /native skill roster mismatch/],
    [f => { f.chess.chess_kazdel_logos_b.modules.pop(); }, /ordinary module roster mismatch/],
    [f => { f.chess.chess_kazdel_wisdel_b.module.id = 'none'; }, /default module missing/],
    [f => { delete f.assets.skills.skchr_odda_2; }, /native skill icon missing/],
    [f => { delete f.assets.modules['ham-x']; }, /native module icon missing/],
    [f => { delete f.assets.chars.char_4131_odda.spine.back; }, /back Spine model missing/],
    [f => { delete f.garrisons.garrison_kazdel_odda_a; }, /garrison missing/],
  ];
  for (const [change, error] of cases) {
    const fetched = data(); change(fetched);
    await assert.rejects(verifyKazdelRelease({ fetched, get }), error);
  }
});

test('release smoke catches stale Kazdel combat, cannon provenance, interface and icon HTTP bytes', async () => {
  for (const stale of ['/sim/content/kazdel.js', '/sim/content/kazdel/souls.js', '/sim/content/kazdel/cannon.js',
    '/sim/kazdelOrigin.js', '/sim/content/kits/ops/chess_char_1_16-tinman.js', '/shared/kazdel.js',
    '/js/ui/kazdelHud.js', '/js/render/fx/kazdel.js', '/css/screens/kazdel.css', '/art/kazdel/bond.svg',
    '/assets/skill/skchr_odda_2.png', '/assets/module/ham-x.png',
    '/assets/spine/op/char_4131_odda/front/char_4131_odda.skel']) {
    await assert.rejects(verifyKazdelRelease({ fetched: data(), get: async url => url === stale
      ? Buffer.from('obsolete package') : get(url) }), /served Kazdel artifact mismatch/);
  }
});

test('release smoke keeps old packages at 1/4 core BAN and Kazdel packages at 2/5', t => {
  const current = data();
  assert.deepEqual(verifyOpeningBanRelease({ fetched: current }), { kazdel: true, funnyCore: 2, normalCore: 5 });
  current.config.bans.NORMAL.core = 4;
  assert.throws(() => verifyOpeningBanRelease({ fetched: current }), /NORMAL rotation BAN mismatch/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pre-kazdel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'data'));
  fs.writeFileSync(path.join(directory, 'data', 'bonds.json'), '{"rhineShip":{}}');
  const olderRoot = pathToFileURL(`${directory}${path.sep}`);
  const older = data(); delete older.bonds.kazdelShip;
  older.config.bans.FUNNY.core = 1;
  for (const level of ['NORMAL', 'HARD', 'ABYSS']) older.config.bans[level].core = 4;
  assert.deepEqual(verifyOpeningBanRelease({ fetched: older, packageRoot: olderRoot }),
    { kazdel: false, funnyCore: 1, normalCore: 4 });
  older.config.bans.FUNNY.core = 2;
  assert.throws(() => verifyOpeningBanRelease({ fetched: older, packageRoot: olderRoot }), /FUNNY rotation BAN mismatch/);
});

test('release smoke skips Kazdel artifacts in older bundles without importing absent modules', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-old-kazdel-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'data'));
  fs.writeFileSync(path.join(directory, 'data', 'bonds.json'), '{"rhineShip":{}}');
  assert.deepEqual(await verifyKazdelRelease({ packageRoot: pathToFileURL(`${directory}${path.sep}`), fetched: {},
    get: async () => { throw new Error('old release should not request Kazdel artifacts'); } }),
  { enabled: false, characters: [] });
});
