import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { validateData, validateReferences } from '../../shared/plugins/validate.js';

const base = getData();
const sharedIds = Object.keys(base.backups.tokens).filter(id => base.tokens[id]);
const drone = 'token_10005_mgllan_drone1';
const overlapError = (data, id = drone) => validateReferences(data).some(message => message === `backups.json token ${id} is also a tokens.json record`);

test('the five built-in fixed-card summons coexist with their original DIY owner variants', () => {
  assert.deepEqual(sharedIds.sort(), [drone, 'token_10005_mgllan_drone2', 'token_10005_mgllan_drone3', 'token_10034_ray_sndbst', 'token_10035_wisdel_wward']);
  assert.deepEqual(validateReferences(base), []);
  assert.deepEqual(validateData(base), []);
  const source = new DataSource(base);
  for (const id of sharedIds) {
    const record = source.rawToken(id);
    const native = base.backups.tokens[id], fixed = base.tokens[id];
    assert.deepEqual(record.variants, { ...native.variants, ...fixed.variants });
    assert.equal(Object.keys(record.variants).length, Object.keys(native.variants).length + Object.keys(fixed.variants).length);
    for (const [owner, variant] of Object.entries(native.variants)) assert.strictEqual(record.variants[owner], variant);
    for (const [owner, variant] of Object.entries(fixed.variants)) assert.strictEqual(record.variants[owner], variant);
  }
});

test('the fixed upstream v0.3.0 data has no overlapping token records', () => {
  const vanilla = Object.fromEntries(Object.keys(base).filter(name => fs.existsSync(new URL(`../../data/vanilla/${name}.json`, import.meta.url)))
    .map(name => [name, JSON.parse(fs.readFileSync(new URL(`../../data/vanilla/${name}.json`, import.meta.url), 'utf8'))]));
  assert.deepEqual(Object.keys(vanilla.backups.tokens).filter(id => vanilla.tokens[id]), []);
  assert.deepEqual(validateReferences(vanilla), []);
});

test('the fixed-card exception refuses arbitrary plugin collisions and altered owner maps or identities', () => {
  const unknown = structuredClone(base), id = 'token_x_collision_drone';
  unknown.tokens[id] = { ...structuredClone(base.tokens[drone]), tokenId: id };
  unknown.backups.tokens[id] = { ...structuredClone(base.backups.tokens[drone]), tokenId: id };
  assert.ok(overlapError(unknown, id), 'an identical header never authorizes a third-party overlap');
  for (const change of [
    data => { data.tokens[drone].name += ' changed'; },
    data => { data.tokens[drone].pluginId = 'collision'; },
    data => { data.chess.chess_rhine_magallan_a.extension.id = 'collision'; },
    data => { data.chess.chess_rhine_magallan_a.charId = 'char_x_collision_fake'; },
    data => { data.tokens[drone].owners.push('chess_x_collision_fake_a'); },
    data => { data.tokens[drone].variants[Object.keys(data.backups.tokens[drone].variants)[0]] = structuredClone(data.tokens[drone].variants.chess_rhine_magallan_a); },
    data => { delete data.backups.tokens[drone].variants[Object.keys(data.backups.tokens[drone].variants)[0]]; },
  ]) {
    const data = structuredClone(base);
    change(data);
    assert.ok(overlapError(data), String(change));
    assert.ok(validateData(data).length > 0, 'the runtime rejects malformed identities even when an earlier shape check fires');
  }
});
