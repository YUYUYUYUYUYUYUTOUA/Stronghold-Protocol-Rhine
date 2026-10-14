import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRemArtPlan, REM_LOGO_URL, REM_ENEMY_ART, remArtInput } from '../../tools/assets/rem-plan.mjs';
import { collectLeaves } from '../../tools/assets/manifest.mjs';

test('Rem icon plan preserves the selected original source and existing bond art', () => {
  const template = { bonds: { other: '/art/other.svg' } };
  assert.equal(addRemArtPlan(template), template);
  assert.equal(template.bonds.other, '/art/other.svg');
  const [entry] = collectLeaves(template);
  assert.equal(entry.path, 'bonds.remShip');
  assert.equal(entry.leaf.alts[0].kind, 'png');
  assert.equal(entry.leaf.alts[0].rel, 'bond/rem.png');
  assert.deepEqual(entry.leaf.alts[0].urls, [REM_LOGO_URL]);
  assert.match(REM_LOGO_URL, /^https:\/\/media\.prts\.wiki\/e\/ee\/Logo_/);
});

test('Rem art input plans all seven new native kits without dropping existing operators', () => {
  const input = remArtInput({assets07:{operators:{existing:{name:'existing'}}},ops03:{chess:[]}});
  assert.equal(Object.keys(input.assets07.operators).length,8);
  assert.equal(input.assets07.operators.existing.name,'existing');
  assert.equal(input.ops03.chess.length,7);
  assert.equal(Object.keys(REM_ENEMY_ART).length,8);
  for (const row of input.ops03.chess) {
    const op=input.assets07.operators[row.charId];
    assert.ok(op.battleSpine.front.skel.url.includes(row.charId));
    assert.ok(op.battleSpine.back.skel.url.includes(row.charId));
    assert.ok(op.skills.length>=2);
  }
});
