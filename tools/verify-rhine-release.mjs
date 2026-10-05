// Read-only HTTP/WebSocket smoke check. Run against a loopback preview or the deployed release.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TestClient } from '../test/helpers/wsClient.js';
import { APP_VERSION } from '../shared/constants.js';

// Pass one or more base URLs as CLI arguments to also verify an external deployment.
// Example: node tools/verify-rhine-release.mjs http://127.0.0.1:3000 https://your-host.example
const bases = process.argv.slice(2);
if (!bases.length) bases.push('http://127.0.0.1:3000');
const root = new URL('../', import.meta.url);
const hash = data => createHash('sha256').update(data).digest('hex');
const checks = [];
for (const base of bases) {
  assert.match(base, /^https?:\/\//);
  const headers = { 'ngrok-skip-browser-warning': 'true' };
  const get = async path => {
    const response = await fetch(base.replace(/\/$/, '') + path, { headers, signal: AbortSignal.timeout(25000) });
    assert.equal(response.status, 200, `${base}${path}`);
    return Buffer.from(await response.arrayBuffer());
  };
  assert.match((await get('/')).toString('utf8'), /STRONGHOLD PROTOCOL/);
  const health = JSON.parse(await get('/healthz'));
  assert.equal(health.ok, true);
  assert.equal(health.app, APP_VERSION, 'served release version mismatch');
  const artifacts = {};
  const fetched = {};
  for (const name of ['chess', 'items', 'assets', 'tokens', 'bonds', 'garrisons', 'effects', 'config']) {
    const bytes = await get(`/data/${name}.json`);
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(`data/${name}.json`, root))), `${name} served data mismatch`);
    artifacts[name] = hash(bytes);
    fetched[name] = JSON.parse(bytes);
  }
  assert.equal(fetched.chess.chess_rhine_mayer_b.skill.index, 0);
  assert.equal(fetched.chess.chess_rhine_mayer_b.module.id, 'uniequip_002_otter');
  assert.deepEqual(fetched.bonds.rhineShip.thresholds, [3, 6, 9]);
  const operators = [];
  for (const [key, charId, tier, skillCount, defaultSkill, moduleId] of [
    ['astgenne', 'char_135_halo', 2, 2, 0, 'uniequip_002_halo'],
    ['dorothy', 'char_4048_doroth', 4, 3, 2, 'uniequip_002_doroth'],
  ]) {
    const normal = fetched.chess[`chess_rhine_${key}_a`], elite = fetched.chess[`chess_rhine_${key}_b`];
    assert.equal(normal.charId, charId);
    assert.equal(normal.tier, tier);
    assert.equal(normal.skills.length, skillCount);
    assert.equal(normal.skill.index, defaultSkill);
    assert.equal(elite.skill.index, defaultSkill);
    assert.equal(elite.module.id, moduleId);
    assert.ok(normal.bonds.includes('rhineShip'));
    if (key === 'astgenne') assert.ok(normal.bonds.includes('preciShip'));
    else assert.deepEqual(elite.modules.map(m => m.uniEquipId), [moduleId]);
    const avatar = fetched.assets.chars[charId].avatar;
    const bytes = await get(avatar);
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(`public${avatar}`, root))));
    operators.push({ name: normal.name, tier, skills: skillCount, defaultSkill: defaultSkill + 1, eliteModule: elite.module.type });
  }
  assert.deepEqual(fetched.config.bans.FUNNY, { core: 1, addon: 1 });
  for (const level of ['NORMAL', 'HARD', 'ABYSS']) assert.deepEqual(fetched.config.bans[level], { core: 4, addon: 4 });
  for (const [id, count] of [['chess_rhine_dorothy_a', 4], ['chess_rhine_dorothy_b', 5]]) {
    const variant = fetched.tokens.token_10025_doroth_recttp.variants[id];
    assert.equal(variant.count, count);
    assert.equal(variant.stats.deployLimit, count);
    assert.equal(fetched.chess[id].talents.find(t => t.tokenKey === 'token_10025_doroth_recttp').bb.cnt, count);
  }
  for (const [id, count] of [['chess_rhine_mayer_a', 1], ['chess_rhine_mayer_b', 2]]) {
    const variant = fetched.tokens.token_10004_otter_motter.variants[id];
    assert.equal(variant.count, count);
    assert.equal(variant.stats.deployLimit, count);
    assert.equal(fetched.chess[id].talents.find(t => t.tokenKey === 'token_10004_otter_motter').bb.cnt, count);
  }
  const equipment = ['terminal', 'mainframe'].map(key => {
    const normal = fetched.items[`chess_item_rhine_${key}_a`];
    const elite = fetched.items[`chess_item_rhine_${key}_b`];
    assert.ok(normal && elite, `Missing ${key}`);
    assert.equal(normal.upgradeChessId, elite.id);
    assert.equal(normal.upgradeNum, 2);
    assert.equal(normal.hideInShop, false);
    assert.equal(normal.shopExcluded, false);
    return { name: normal.name, tier: normal.tier, normal: normal.desc, elite: elite.desc };
  });
  assert.equal(fetched.items.chess_item_rhine_terminal_a.giveBondId, 'rhineShip');
  assert.equal(fetched.items.chess_item_rhine_mainframe_a.requiresBondId, 'rhineShip');
  for (const key of ['terminal', 'mainframe']) {
    const path = fetched.assets.items[`trap_rhine_${key}`];
    assert.equal(path, `/art/rhine/${key}.png`);
    const bytes = await get(path);
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(`public${path}`, root))));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    artifacts[key] = hash(bytes);
  }
  const range = await get('/shared/rhineRange.js');
  assert.equal(hash(range), hash(fs.readFileSync(new URL('shared/rhineRange.js', root))));
  artifacts.range = hash(range);
  for (const path of ['/shared/rhineResearch.js', '/js/render/units.js', '/js/render/fx.js', '/js/render/app.js', '/js/ui/facingWheel.js', '/js/ui/rhineDock.js']) {
    const bytes = await get(path);
    const local = path.startsWith('/shared/') ? path.slice(1) : `public${path}`;
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(local, root))), `${path} served code mismatch`);
    artifacts[path] = hash(bytes);
  }
  const client = await TestClient.connect(base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws', { timeout: 20000, wsOptions: { headers } });
  try {
    assert.equal((await client.hello('科研装备验证')).t, 'welcome');
    assert.equal((await client.request({ t: 'ping', c: Date.now() }, 10000)).t, 'pong');
  } finally { await client.close(); }
  checks.push({ base, health, operators, equipment, artifacts, http: 'passed', webSocket: 'welcome + pong' });
}
const report = { timestamp: new Date().toISOString(), checks };
fs.writeFileSync(new URL('rhine-equipment-verification.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
