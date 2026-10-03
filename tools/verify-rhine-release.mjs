// Read-only HTTP/WebSocket smoke check. Run against a loopback preview or the deployed release.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TestClient } from '../test/helpers/wsClient.js';

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
  const artifacts = {};
  const fetched = {};
  for (const name of ['chess', 'items', 'assets', 'tokens']) {
    const bytes = await get(`/data/${name}.json`);
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(`data/${name}.json`, root))), `${name} served data mismatch`);
    artifacts[name] = hash(bytes);
    fetched[name] = JSON.parse(bytes);
  }
  assert.equal(fetched.chess.chess_rhine_mayer_b.skill.index, 0);
  assert.equal(fetched.chess.chess_rhine_mayer_b.module.id, 'uniequip_002_otter');
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
  const client = await TestClient.connect(base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws', { timeout: 20000, wsOptions: { headers } });
  try {
    assert.equal((await client.hello('科研装备验证')).t, 'welcome');
    assert.equal((await client.request({ t: 'ping', c: Date.now() }, 10000)).t, 'pong');
  } finally { await client.close(); }
  checks.push({ base, health, equipment, artifacts, http: 'passed', webSocket: 'welcome + pong' });
}
const report = { timestamp: new Date().toISOString(), checks };
fs.writeFileSync(new URL('rhine-equipment-verification.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
