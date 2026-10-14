import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRemArtPlan, REM_LOGO_URL, REM_ENEMY_ART, remArtInput } from '../../tools/assets/rem-plan.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Downloader } from '../../tools/assets/downloader.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate } from '../../tools/assets/manifest.mjs';

test('Rem icon plan preserves the selected original source and existing bond art', () => {
  const template = { bonds: { other: '/art/other.svg' } };
  assert.equal(addRemArtPlan(template), template);
  assert.equal(template.bonds.other, '/art/other.svg');
  const [entry] = collectLeaves(template);
  assert.equal(entry.path, 'bonds.remShip');
  assert.equal(entry.leaf.alts[0].kind, 'png');
  assert.equal(entry.leaf.alts[0].rel, 'bond/rem.png');
  assert.deepEqual(entry.leaf.alts[0].urls, [REM_LOGO_URL]);
  assert.equal(REM_LOGO_URL, 'https://raw.githubusercontent.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/13df9cfd5f607a07ce4b1fa766439c3b012657cb/public/assets/bond/rem.png');
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

// Opt-in network acceptance; never reads the checkout's art or download ledger.
// NODE_USE_ENV_PROXY=1 SP_ASSET_E2E=1 node --test test/tools/rem-asset-plan.test.js
test('Rem original downloads into an empty asset root with exact accepted bytes', {
  skip: process.env.SP_ASSET_E2E === '1' ? false : 'set SP_ASSET_E2E=1 for live source acceptance',
  timeout: 60000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'rem-original-clean-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const responses = [];
  const dl = new Downloader({ root, ledgerPath: join(root, 'ledger.json'), retries: 1, timeoutMs: 15000,
    fetchImpl: async (...args) => {
      const response = await fetch(...args);
      responses.push({ url: String(args[0]), status: response.status });
      return response;
    },
  });
  await dl.loadLedger();
  const template = addRemArtPlan({});
  assert.deepEqual(await downloadLeaves(collectLeaves(template), dl, root), []);
  assert.deepEqual(responses, [{ url: REM_LOGO_URL, status: 200 }]);
  assert.equal(dl.totals.skip, 0, 'a cached file must not satisfy source acceptance');
  assert.equal(dl.totals.ok, 1);
  const bytes = await readFile(join(root, 'bond/rem.png'));
  assert.equal(bytes.length, 21152);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '3089f0cb87a7c85b1d12eb1bf6aff6e1dd8ed1d2ae6caaf2cda359b2658c546e');
  assert.equal(resolveTemplate(template, { root, spine: {} }).value.bonds.remShip, '/assets/bond/rem.png');
});
