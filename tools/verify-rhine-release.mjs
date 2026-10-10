// Read-only HTTP/WebSocket smoke check. Run against a loopback preview or the deployed release.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestClient } from '../test/helpers/wsClient.js';
import { APP_VERSION } from '../shared/constants.js';

// Pass one or more base URLs as CLI arguments to also verify an external deployment.
// Example: node tools/verify-rhine-release.mjs http://127.0.0.1:3000 https://your-host.example
const root = new URL('../', import.meta.url);
const hash = data => createHash('sha256').update(data).digest('hex');
const localArtifact = url => url.startsWith('/shared/') ? url.slice(1)
  : url.startsWith('/sim/') ? `server${url}` : `public${url}`;

/** The extra core BAN slot belongs only to packages carrying the Kazdel covenant. */
export function verifyOpeningBanRelease({ fetched, packageRoot = root }) {
  const localBonds = JSON.parse(fs.readFileSync(new URL('data/bonds.json', packageRoot), 'utf8'));
  const kazdel = Boolean(localBonds.kazdelShip);
  assert.equal(Boolean(fetched.bonds.kazdelShip), kazdel, 'served Kazdel covenant presence mismatch');
  assert.deepEqual(fetched.config.bans.FUNNY, { core: kazdel ? 2 : 1, addon: 1 }, 'FUNNY rotation BAN mismatch');
  for (const level of ['NORMAL', 'HARD', 'ABYSS']) {
    assert.deepEqual(fetched.config.bans[level], { core: kazdel ? 5 : 4, addon: 4 }, `${level} rotation BAN mismatch`);
  }
  assert.deepEqual(fetched.config.bans.TRAINING, { core: 0, addon: 0 }, 'TRAINING rotation BAN mismatch');
  return { kazdel, funnyCore: kazdel ? 2 : 1, normalCore: kazdel ? 5 : 4 };
}

const KAZDEL_ROSTER = [
  ['chess_char_1_05', 'char_290_vigna', 1, ['skillfulShip'], ['skchr_vigna_1', 'skchr_vigna_2'], ['uniequip_002_vigna']],
  ['chess_kazdel_odd', 'char_4131_odda', 2, ['steadShip'], ['skchr_odda_1', 'skchr_odda_2'], ['uniequip_002_odda']],
  ['chess_kazdel_meteorite', 'char_219_meteo', 2, ['preciShip'], ['skchr_meteo_1', 'skchr_meteo_2'], ['uniequip_002_meteo']],
  ['chess_char_2_19', 'char_4151_tinman', 2, ['investShip', 'skillfulShip'], ['skchr_tinman_1', 'skchr_tinman_2'], ['uniequip_002_tinman']],
  ['chess_kazdel_paprika', 'char_4071_peper', 3, ['deputShip'], ['skcom_heal_rage[3]', 'skchr_peper_2'], ['uniequip_002_peper']],
  ['chess_kazdel_ascalon', 'char_4132_ascln', 3, [], ['skchr_ascln_1', 'skchr_ascln_2', 'skchr_ascln_3'], ['uniequip_002_ascln', 'uniequip_003_ascln']],
  ['chess_kazdel_hoederer', 'char_4088_hodrer', 4, ['steadShip'], ['skchr_hodrer_1', 'skchr_hodrer_2', 'skchr_hodrer_3'], ['uniequip_002_hodrer', 'uniequip_003_hodrer']],
  ['chess_char_4_04', 'char_4087_ines', 4, ['visiShip', 'raidShip'], ['skchr_ines_1', 'skchr_ines_2', 'skchr_ines_3'], ['uniequip_002_ines']],
  ['chess_char_4_18', 'char_311_mudrok', 4, ['soloShip'], ['skcom_def_up[3]', 'skchr_mudrok_2', 'skchr_mudrok_3'], ['uniequip_002_mudrok', 'uniequip_003_mudrok']],
  ['chess_kazdel_logos', 'char_4133_logos', 5, ['arcaneShip'], ['skchr_logos_1', 'skchr_logos_2', 'skchr_logos_3'], ['uniequip_002_logos', 'uniequip_003_logos']],
  ['chess_kazdel_wisdel', 'char_1035_wisdel', 6, ['preciShip'], ['skchr_wisdel_1', 'skchr_wisdel_2', 'skchr_wisdel_3'], ['uniequip_002_wisdel']],
];

/** Verify Kazdel only when present locally, while rejecting stale served data/code/assets in new packages. */
export async function verifyKazdelRelease({ fetched, get, artifacts = {}, packageRoot = root }) {
  const localBonds = JSON.parse(fs.readFileSync(new URL('data/bonds.json', packageRoot), 'utf8'));
  if (!localBonds.kazdelShip) return { enabled: false, characters: [] };
  const bond = fetched.bonds.kazdelShip;
  assert.ok(bond, 'served Kazdel covenant missing');
  assert.equal(bond.name, '卡兹戴尔', 'Kazdel main covenant name mismatch');
  assert.equal(bond.isCore, true, 'Kazdel must be a main covenant');
  assert.deepEqual(bond.thresholds, [3, 6, 9], 'Kazdel threshold mismatch');
  const expectedMembers = KAZDEL_ROSTER.map(([id]) => `${id}_a`).sort();
  assert.deepEqual([...bond.visibleMembers].sort(), expectedMembers, 'Kazdel visible roster mismatch');
  assert.deepEqual([...bond.members].sort(), expectedMembers, 'Kazdel covenant roster mismatch');
  const actualMembers = Object.values(fetched.chess).filter(c => !c.isGolden && c.bonds.includes('kazdelShip'));
  assert.deepEqual(actualMembers.map(c => c.chessId).sort(), expectedMembers, 'Kazdel character pool mismatch');
  assert.equal(fetched.assets.bonds.kazdelShip, '/art/kazdel/bond.svg', 'Kazdel covenant icon mismatch');

  const urls = new Set([
    '/art/kazdel/bond.svg', '/shared/kazdel.js', '/shared/openingBans.js',
    '/sim/content/kazdel/ascalon.js', '/sim/content/kits/ops/op-ascln.js', '/sim/content/kazdel.js', '/sim/content/kazdel/souls.js', '/sim/content/kazdel/cannon.js',
    '/sim/content/kits/kazdel.js', '/sim/content/index.js', '/sim/kazdelOrigin.js',
    '/sim/damage.js', '/sim/units.js', '/sim/buffs.js', '/sim/snapshot.js', '/sim/ai.js', '/sim/projectiles.js',
    '/sim/battle/combat.js', '/sim/battle/events.js', '/sim/battle/hooks.js',
    '/sim/battle/deploy.js', '/sim/battle/tiles.js', '/sim/battle/status.js',
    '/sim/content/kits/ops/chess_char_1_16-tinman.js', '/sim/content/kits/ops/chess_char_2_19-tinman.js',
    '/js/kazdelState.js', '/js/ui/kazdelHud.js', '/js/ui/combatHud.js', '/js/ui/detailPanel.js',
    '/js/ui/fallbackField.js', '/js/ui/gameLogic/format.js', '/js/render/fx/kazdel.js',
    '/js/render/fx/system.js', '/js/render/fx/kinds.js', '/js/render/fx/simfx.js',
    '/js/render/units.js', '/js/render/app.js', '/js/render/app/info.js', '/css/screens/kazdel.css',
  ]);
  const characters = [];
  for (const [id, charId, tier, addons, skillIds, moduleIds] of KAZDEL_ROSTER) {
    const normal = fetched.chess[`${id}_a`], elite = fetched.chess[`${id}_b`];
    assert.ok(normal && elite, `${id} Kazdel character forms missing`);
    for (const form of [normal, elite]) {
      assert.equal(form.charId, charId, `${id} character ID mismatch`);
      assert.equal(form.tier, tier, `${id} tier mismatch`);
      assert.deepEqual([...form.bonds].sort(), ['kazdelShip', ...addons].sort(), `${id} covenant mismatch`);
      assert.deepEqual(form.skills.map(s => s.skillId), skillIds, `${id} native skill roster mismatch`);
      assert.ok(skillIds.includes(form.skill.skillId), `${id} default skill missing from native skills`);
      assert.ok(form.garrisonIds.length, `${id} garrison missing`);
      for (const skill of form.skills) {
        assert.ok(skill.name && skill.desc && skill.bb, `${id} native skill data missing`);
        const url = fetched.assets.skills[skill.iconId];
        assert.ok(url, `${id} native skill icon missing`);
        urls.add(url);
      }
      for (const garrisonId of form.garrisonIds) assert.ok(fetched.garrisons[garrisonId], `${id} garrison missing`);
    }
    assert.deepEqual(elite.modules.map(m => m.uniEquipId), moduleIds, `${id} ordinary module roster mismatch`);
    assert.ok(moduleIds.includes(elite.module?.id), `${id} default module missing`);
    for (const module of elite.modules) {
      assert.ok(module.name && module.attr && module.level > 0, `${id} native module data missing`);
      const url = fetched.assets.modules[module.typeIcon];
      assert.ok(url, `${id} native module icon missing`);
      urls.add(url);
    }
    const art = fetched.assets.chars[charId];
    assert.ok(art?.avatar && art.avatarE2 && art.portrait && art.portraitE2, `${id} character art missing`);
    for (const key of ['avatar', 'avatarE2', 'portrait', 'portraitE2']) urls.add(art[key]);
    for (const facing of ['front', 'back']) {
      const model = art.spine?.[facing];
      assert.ok(model?.skel && model.atlas && model.textures?.length, `${id} ${facing} Spine model missing`);
      for (const url of [model.skel, model.atlas, ...model.textures]) urls.add(url);
    }
    characters.push({ id: normal.chessId, charId, name: normal.name, tier, bonds: normal.bonds,
      skills: skillIds.length, defaultSkill: normal.skill.index + 1, eliteModule: elite.module.type,
      modules: moduleIds.length });
  }
  let tinmanSoulHealing = false;
  for (const url of urls) {
    const bytes = await get(url);
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(localArtifact(url), packageRoot))), `${url} served Kazdel artifact mismatch`);
    artifacts[url] = hash(bytes);
    if (url === '/art/kazdel/bond.svg') assert.match(bytes.toString('utf8'), /<svg\b/, 'Kazdel icon must be an SVG');
    if (url === '/sim/content/kits/ops/chess_char_1_16-tinman.js') {
      assert.match(bytes.toString('utf8'), /if\s*\(a\.kazdelSoul\)\s*b\.heal\(unit,\s*a,[^;]+tags:\s*\['kazdelSoulHeal'\]/,
        'Tinman S2 soul healing exception missing');
      tinmanSoulHealing = true;
    }
  }
  return { enabled: true, characters, tinmanSoulHealing, httpArtifacts: urls.size };
}

/** Verify the new device only when the local release carries it; older bundles keep their existing smoke checks. */
export async function verifyRhineDeviceRelease({ fetched, get, artifacts = {}, packageRoot = root }) {
  const localTokens = JSON.parse(fs.readFileSync(new URL('data/tokens.json', packageRoot), 'utf8'));
  if (!localTokens.token_rhine_laser) return { laser: false };
  const { RHINE_DEVICES, rhineDeviceUnlocked, rhineDeviceStage } = await import(new URL('shared/rhineResearch.js', packageRoot));
  const definition = RHINE_DEVICES.find(d => d.tokenId === 'token_rhine_laser');
  assert.ok(definition, 'laser definition missing from shared research parameters');
  assert.equal(definition.minCount, 9, 'laser must unlock at nine Rhine members');
  assert.equal(definition.maxStage, 0, 'laser must have one level only');
  assert.deepEqual(definition.breakthroughs, [], 'laser must not have breakthroughs');
  assert.equal(rhineDeviceUnlocked(definition, { active: true, count: 8 }), false);
  assert.equal(rhineDeviceUnlocked(definition, { active: true, count: 9 }), true);
  assert.equal(rhineDeviceUnlocked(definition, { active: false, count: 9 }), false);
  assert.equal(rhineDeviceStage(definition, 2), 0, 'laser stage must remain zero');
  const laser = fetched.tokens.token_rhine_laser;
  assert.ok(laser, 'served laser token missing');
  assert.equal(laser.tokenId, definition.tokenId);
  assert.ok(fetched.bonds.rhineShip.spec.researchDevices.includes(definition.tokenId), 'laser missing from Rhine device roster');
  assert.equal(fetched.tokens.token_rhine_ecology, undefined, 'standalone ecology token should be removed');
  assert.equal(fetched.assets.tokens[definition.tokenId].avatar, '/art/rhine/laser.svg');
  assert.equal(laser.assets.icon, definition.icon);
  assert.equal(laser.assets.sprite, definition.sprite);
  for (const url of ['/art/rhine/laser.svg', '/js/render/rhineDevices.js', '/shared/rhineResearch.js', '/shared/rhineRange.js', '/sim/content/rhine.js']) {
    // These are the static mounts used by server/http/static.js: / → public, /shared → shared, /sim → server/sim.
    const local = url.startsWith('/shared/') ? url.slice(1) : url.startsWith('/sim/') ? `server${url}` : `public${url}`;
    const bytes = await get(url);
    assert.equal(hash(bytes), hash(fs.readFileSync(new URL(local, packageRoot))), `${url} served device artifact mismatch`);
    artifacts[url] = hash(bytes);
    if (url.endsWith('laser.svg')) assert.match(bytes.toString('utf8'), /<svg\b/, 'laser icon must be an SVG');
  }
  return { laser: true, minCount: definition.minCount, maxStage: definition.maxStage, httpArtifacts: 5 };
}

async function main() {
  const bases = process.argv.slice(2);
  if (!bases.length) bases.push('http://127.0.0.1:3000');
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
    const openingBans = verifyOpeningBanRelease({ fetched });
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
    const researchDevices = await verifyRhineDeviceRelease({ fetched, get, artifacts });
    const kazdel = await verifyKazdelRelease({ fetched, get, artifacts });
    const maincovenants = Object.values(fetched.bonds).filter(b => b.isCore).map(b => ({
      id: b.bondId, name: b.name, thresholds: b.thresholds, members: b.visibleMembers?.length ?? b.members.length,
    }));
    const client = await TestClient.connect(base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws', { timeout: 20000, wsOptions: { headers } });
    try {
      assert.equal((await client.hello('科研装备验证')).t, 'welcome');
      assert.equal((await client.request({ t: 'ping', c: Date.now() }, 10000)).t, 'pong');
    } finally { await client.close(); }
    checks.push({ base, health, operators, characters: [...operators, ...kazdel.characters], maincovenants,
      equipment, researchDevices, openingBans, kazdel, artifacts, http: 'passed', webSocket: 'welcome + pong' });
  }
  const report = { timestamp: new Date().toISOString(), checks };
  fs.writeFileSync(new URL('rhine-equipment-verification.json', root), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
