import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyKazdelData, validateKazdelData, KAZDEL_ADDITIONS, KAZDEL_EXISTING, WISDEL_TOKEN, kazdelGarrison } from '../tools/kazdel-data.mjs';
import { applyRhineData } from '../tools/rhine-data.mjs';
import { composeStats, loadoutRecord, resolveRecordLoadout } from '../shared/loadoutRecord.js';
import { KAZDEL_BOND, KAZDEL_CHARACTERS, KAZDEL_BALANCE, KAZDEL_CANNON, kazdelStage } from '../shared/kazdel.js';
import { OPENING_BANS, openingBanCounts } from '../shared/openingBans.js';

const read = async name => JSON.parse(await readFile(new URL(`../${name}.json`, import.meta.url), 'utf8'));
const names = ['chess', 'bonds', 'garrisons', 'tokens', 'effects', 'config', 'backups', 'items'];
const files = Object.fromEntries(await Promise.all(names.map(async n => [n, await read(`data/${n}`)])));
const source = await read('tools/kazdel-data-source');
const vanilla = { chess: await read('data/vanilla/chess'), garrisons: await read('data/vanilla/garrisons'), config: await read('data/vanilla/config') };

test('Kazdel data: 10 distinct members, approved tiers and 3/6/9 main-faction thresholds', () => {
  const bond = files.bonds[KAZDEL_BOND];
  assert.deepEqual(validateKazdelData(files), []);
  assert.deepEqual(bond.thresholds, [3, 6, 9]);
  assert.equal(bond.isCore, true);
  assert.equal(bond.visibleMembers.length, 10);
  assert.deepEqual(new Set(bond.visibleMembers.map(id => files.chess[id].charId)), new Set(Object.values(KAZDEL_CHARACTERS)));
  for (const spec of KAZDEL_ADDITIONS) for (const suffix of ['a', 'b']) {
    const c = files.chess[`chess_kazdel_${spec.key}_${suffix}`];
    assert.equal(c.tier, spec.tier); assert.deepEqual(c.bonds, spec.bonds);
    assert.equal(c.skill.skillId, spec.skillId); assert.equal(c.visible, true);
  }
  for (const spec of KAZDEL_EXISTING) for (const suffix of ['a', 'b']) {
    const c = files.chess[`${spec.baseId}_${suffix}`];
    assert.equal(c.tier, spec.tier); assert.deepEqual(c.bonds, spec.bonds);
    assert.equal(c.visible, true); assert.equal(c.isHidden, false);
  }
  for (const [count, stage] of [[2, 0], [3, 1], [5, 1], [6, 2], [8, 2], [9, 3], [11, 3]]) assert.equal(kazdelStage({ active: count >= 3, count }), stage);
});

test('Kazdel data: soul and cannon formulas are shared with no hidden expiry or dummy population token', () => {
  assert.deepEqual(KAZDEL_BALANCE, { thresholds: [3, 6, 9], bodyHpPerLayer: 10, soulHpRatio: .6, soulHpPerLayer: 10,
    soulAttackRatio: .8, soulAttackPerLayer: 3, soulsPerPiecePerBattle: 1 });
  assert.deepEqual(KAZDEL_CANNON, { capacity: 15, chargePerSec: 1, chargePerLayer: .005, deathCharge: 3,
    minInterval: 3, warningDuration: 2, damageBase: 800, damagePerLayer: 15, radius: 1, friendlyFireStage: 2, enemiesOnlyStage: 3 });
  assert.match(files.bonds[KAZDEL_BOND].desc, /无时间限制/);
  assert.match(files.bonds[KAZDEL_BOND].desc, /预警计入间隔/);
  assert.match(files.bonds[KAZDEL_BOND].desc, /亡魂始终免疫/);
  assert.match(files.bonds[KAZDEL_BOND].desc, /不获得死亡产层与充能/);
  assert.equal(files.tokens.token_kazdel_cannon, undefined);
});

test('Kazdel data: nine ordinary/elite trait blackboards match the approved effects', () => {
  const expect = {
    vigna: [{ layer: 2 }, { layer: 4 }], odda: [{ layer: 1, max_layer: 6 }, { layer: 2, max_layer: 12 }],
    meteorite: [{ damage_bonus: .2 }, { damage_bonus: .4 }], tinman: [{ aspd: 15, radius: 1 }, { aspd: 30, radius: 1 }],
    paprika: [{ heal_bonus: .25 }, { heal_bonus: .5 }], hoederer: [{ layer: 2, max_layer: 24 }, { layer: 4, max_layer: 48 }],
    mudrock: [{ block_cnt: 3, hp_per_layer: 5 }, { block_cnt: 3, hp_per_layer: 10 }],
    logos: [{ atk_per_layer: 1, target_count: 2 }, { atk_per_layer: 2, target_count: 3 }],
    wisdel: [{ damage_bonus: .2, next_attack_bonus: .5 }, { damage_bonus: .4, next_attack_bonus: 1 }],
  };
  for (const [key, pair] of Object.entries(expect)) for (const grade of [0, 1]) {
    const g = files.garrisons[kazdelGarrison(key, Boolean(grade)).garrisonId];
    assert.deepEqual(g.bb, pair[grade]);
    assert.equal(g.owners.length, 1, g.garrisonId);
    assert.deepEqual(files.chess[g.owners[0]].garrisonIds, [g.garrisonId]);
  }
});

test('Kazdel data: existing identities, native loadouts and every Amiya record stay unchanged', () => {
  for (const spec of KAZDEL_EXISTING) for (const suffix of ['a', 'b']) {
    const id = `${spec.baseId}_${suffix}`, before = vanilla.chess[id], c = files.chess[id];
    const allowed = new Set(['bonds', ...(spec.preserveGarrison ? [] : ['garrisonIds']), ...(spec.key === 'vigna' ? ['visible', 'isHidden'] : [])]);
    for (const key of Object.keys(before).filter(k => !allowed.has(k))) assert.deepEqual(c[key], before[key], `${id}.${key}`);
  }
  for (const c of Object.values(files.chess).filter(c => c.name === '魔王')) assert.deepEqual(c, vanilla.chess[c.chessId], c.chessId);
  for (const suffix of ['a', 'b']) {
    assert.deepEqual(files.chess[`chess_char_1_16_${suffix}`], vanilla.chess[`chess_char_1_16_${suffix}`], 'unused hidden Tin stays untouched');
    assert.deepEqual(files.garrisons[`garrison_104_${suffix}`], vanilla.garrisons[`garrison_104_${suffix}`], 'Ines retains the original +5/+10 trait');
  }
});

test('Kazdel data: every selectable skill preserves pinned client values at skill levels 4 and 7', () => {
  for (const spec of KAZDEL_ADDITIONS) for (const suffix of ['a', 'b']) {
    const c = files.chess[`chess_kazdel_${spec.key}_${suffix}`], skillLevel = suffix === 'b' ? 7 : 4;
    assert.equal(c.skills.length, ['odd', 'meteorite', 'paprika'].includes(spec.key) ? 2 : 3);
    for (const skill of c.skills) {
      const raw = source.skillTable[skill.skillId].levels[skillLevel - 1];
      const numeric = Object.fromEntries(raw.blackboard.filter(b => !(b.valueStr && b.value === 0)).map(b => [b.key, b.value]));
      assert.deepEqual(skill.bb, numeric, `${c.chessId} ${skill.skillId}`);
      assert.deepEqual([skill.duration, skill.spCost, skill.initSp], [raw.duration, raw.spData.spCost, raw.spData.initSp]);
      const selected = loadoutRecord(c, resolveRecordLoadout(c, { skillIndex: skill.index }));
      assert.equal(selected.skill.skillId, skill.skillId);
      assert.equal(selected.assets.skillIcon, skill.iconId);
    }
  }
});

test('Kazdel data: all general modules, first-module defaults, no-module fallback and native high-star form parity', () => {
  for (const spec of KAZDEL_ADDITIONS) {
    const c = files.chess[`chess_kazdel_${spec.key}_b`];
    const allowed = source.uniequipTable.charEquip[spec.charId].filter(id => {
      const m = source.uniequipTable.equipDict[id]; return m.type !== 'INITIAL' && !m.isSpecialEquip;
    });
    assert.deepEqual(c.modules.map(m => m.uniEquipId), allowed);
    assert.equal(c.module.id, spec.defaultModuleId);
    const none = loadoutRecord(c, resolveRecordLoadout(c, { moduleId: 'none' }));
    assert.deepEqual(none.stats, c.statsBase); assert.deepEqual(none.trait, c.traitBase); assert.deepEqual(none.talents, c.talentsBase);
    for (const m of c.modules) {
      const selected = loadoutRecord(c, resolveRecordLoadout(c, { moduleId: m.uniEquipId }));
      assert.deepEqual(selected.stats, composeStats(c.statsBase, m.attr));
    }
    if (['hoederer', 'logos', 'wisdel'].includes(spec.key)) for (const suffix of ['a', 'b']) {
      const form = files.chess[`chess_kazdel_${spec.key}_${suffix}`];
      const native = files.backups.units[spec.charId].forms[Object.values(form.status).join('/')];
      assert.deepEqual(form.statsBase || form.stats, native.stats);
      for (const s of form.skills) assert.deepEqual(s.trigger, native.skills.find(n => n.skillId === s.skillId).trigger);
      if (suffix === 'b') for (const m of form.modules) {
        const { isDefault, ...body } = m;
        assert.deepEqual(body, native.modules.find(n => n.uniEquipId === m.uniEquipId));
      }
    }
  }
});

test('Kazdel data: Wisadel native shadows resolve all owner skills and module-free token stats', () => {
  const t = files.tokens[WISDEL_TOKEN], backup = files.backups.tokens[WISDEL_TOKEN];
  assert.equal(t.placeable, false); assert.equal(t.displayType, 'HIDDEN');
  assert.deepEqual(t.owners, ['chess_kazdel_wisdel_a', 'chess_kazdel_wisdel_b']);
  for (const id of t.owners) {
    const c = files.chess[id], v = t.variants[id], native = backup.variants[`${c.charId}@${Object.values(c.status).join('/')}`];
    assert.deepEqual(v.sources, ['talent', 'skill', 'display'], 'S3 owns native shadows through talent and its skill');
    assert.deepEqual(Object.keys(v.bySkill).sort(), ['0', '1']);
    for (const k of ['0', '1']) assert.deepEqual(v.bySkill[k].sources, ['talent', 'display']);
    if (c.isGolden) {
      assert.deepEqual(v.stats, native.byModule[c.module.id].stats);
      assert.deepEqual(v.byModule.none.stats, native.stats);
      assert.deepEqual(v.talents, native.byModule[c.module.id].talents);
    } else assert.deepEqual(v.stats, native.stats);
  }
});

test('Kazdel data: one additional core BAN preserves addon counts and 5/6-player reductions', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS', 'TRAINING']) {
    const base = OPENING_BANS[difficulty], configured = files.config.bans[difficulty];
    assert.equal(configured.core, base.core + (difficulty === 'TRAINING' ? 0 : 1));
    assert.equal(configured.addon, base.addon);
    for (const seats of [1, 4, 5, 6]) {
      const reduction = difficulty === 'TRAINING' ? 0 : seats === 6 ? 2 : seats === 5 ? 1 : 0;
      assert.deepEqual(openingBanCounts(difficulty, seats, files.config.bans), { core: Math.max(0, configured.core - reduction), addon: base.addon });
    }
  }
  for (const mode of Object.values(files.config.modes)) assert.ok(mode.activeBondIds.includes(KAZDEL_BOND));
  assert.equal(vanilla.config.bans.NORMAL.core, 3, 'upstream snapshot remains native');
});

test('Kazdel data: offline overlay and the full Rhine→Kazdel chain are byte-for-byte idempotent', async () => {
  const rebuilt = structuredClone(files), before = JSON.stringify(rebuilt);
  await applyKazdelData(rebuilt, source); assert.equal(JSON.stringify(rebuilt), before);
  await applyRhineData(rebuilt); await applyKazdelData(rebuilt, source);
  assert.equal(JSON.stringify(rebuilt), before);
  assert.deepEqual(validateKazdelData(rebuilt), []);
});

test('Kazdel data: the preserved official snapshot rebuilds the complete expansion tables offline', async () => {
  const rebuilt = Object.fromEntries(await Promise.all(names.map(async n => [n, await read(`data/vanilla/${n}`)])));
  await applyRhineData(rebuilt); await applyKazdelData(rebuilt, source);
  for (const n of names) assert.deepEqual(rebuilt[n], files[n], `${n} from the untouched official snapshot`);
});

test('Kazdel data: all native portraits, skill/module icons and faction art resolve to installed files', async () => {
  const assets = await read('data/assets'), paths = new Set([assets.bonds[KAZDEL_BOND]]);
  for (const id of Object.values(KAZDEL_CHARACTERS)) {
    const c = assets.chars[id]; assert.ok(c, id);
    for (const k of ['avatar', 'avatarE2', 'portrait', 'portraitE2']) paths.add(c[k]);
    for (const direction of ['front', 'back']) {
      const m = c.spine?.[direction]; assert.ok(m, `${id}.${direction}`);
      paths.add(m.skel); paths.add(m.atlas); for (const texture of m.textures) paths.add(texture);
    }
  }
  for (const spec of KAZDEL_ADDITIONS) {
    const c = files.chess[`chess_kazdel_${spec.key}_b`];
    for (const skill of c.skills) paths.add(assets.skills[assets.skillsById[skill.skillId]]);
    for (const module of c.modules) paths.add(assets.modules[module.typeIcon]);
  }
  for (const path of paths) {
    assert.equal(typeof path, 'string'); assert.ok(path.startsWith('/'), path);
    const bytes = await readFile(new URL(`../public${path}`, import.meta.url)); assert.ok(bytes.length > 0, path);
  }
});
