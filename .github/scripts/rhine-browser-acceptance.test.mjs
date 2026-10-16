import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BASE_BROWSER_GROUPS, LEGACY_3D_TESTS, browserAcceptancePolicy, browserTestArguments,
  verifyBrowserAcceptance } from './rhine-browser-acceptance.mjs';

const excludedTests = LEGACY_3D_TESTS.map(({ file, name }) => ({ file, name, reason: 'User excluded legacy 3D initialization checks.' }));
const planned = () => browserAcceptancePolicy({ browserAcceptance: { excludedTests, expectedExecutedCases: 46 } });
const results = () => Object.fromEntries(BASE_BROWSER_GROUPS.map((group, index) => {
  const count = [2, 2, 1, 5, 13, 2, 7, 8, 3, 1, 4][index];
  const executed = group === 'upstreamRenderer' ? count - 2 : count;
  return [group, { total: executed, pass: executed, fail: 0, skipped: 0 }];
}));

test('legacy requests retain every browser case and group', () => {
  const p = browserAcceptancePolicy();
  assert.equal(p.expectedExecutedCases, 48); assert.equal(p.expectedSkippedCases, 0);
  assert.deepEqual(p.expectedGroups, BASE_BROWSER_GROUPS);
  assert.deepEqual(browserTestArguments(p, 'upstreamRenderer'), []);
});

test('only the two reviewed 3D leaves receive exact full-name skip arguments', () => {
  const p = planned(), args = browserTestArguments(p, 'upstreamRenderer');
  assert.equal(args.length, 1);
  const regex = new RegExp(args[0].slice('--test-skip-pattern='.length));
  for (const leaf of LEGACY_3D_TESTS) assert.ok(regex.test(leaf.fullName));
  assert.equal(regex.test('renderer recovery after transient resource failures field hook retries a failed Pixi download; forced fallback=true'), false);
  assert.equal(regex.test(LEGACY_3D_TESTS[0].fullName + ' extra'), false);
  assert.deepEqual(browserTestArguments(p, 'upstreamUi'), []);
});

test('Node excludes two bodies from totals and reports five real passes without invented skips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhine-browser-policy-'));
  try {
    const file = path.join(dir, 'fixture.test.mjs');
    fs.writeFileSync(file, `import { test, describe } from 'node:test';
test('held Spine pose mechanism', () => {});
describe('renderer recovery after transient resource failures', () => {
  for (const mode of ['local', 'server']) test('a live ' + mode + ' battle survives renderer replacement with current enemy metadata', () => {});
  for (const forced of [false, true]) test('field hook retries a failed Pixi download; forced fallback=' + forced, () => {});
  for (const resource of ['atlas', 'three']) test(resource + ' download can recover the 3D board on visibility', () => { throw new Error('EXCLUDED BODY EXECUTED'); });
});`);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...browserTestArguments(planned(), 'upstreamRenderer'), file], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^[ℹ#] ?tests 5$/m); assert.match(result.stdout, /^[ℹ#] ?pass 5$/m);
    assert.match(result.stdout, /^[ℹ#] ?skipped 0$/m); assert.doesNotMatch(result.stdout, /EXCLUDED BODY EXECUTED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('non-reviewed skips, duplicate skips and exclusions without reasons are rejected', () => {
  for (const excluded of [[{ file: 'test/ui/rhine-profiles.e2e.test.js', name: 'profile', reason: 'skip' }],
    [excludedTests[0], excludedTests[0]], [{ file: excludedTests[0].file, name: excludedTests[0].name }]]) {
    assert.throws(() => browserAcceptancePolicy({ browserAcceptance: { excludedTests: excluded } }));
  }
});

test('invalid plans cannot omit groups or coerce counts', () => {
  for (const input of [{ expectedGroups: BASE_BROWSER_GROUPS.slice(1) }, { expectedGroups: [...BASE_BROWSER_GROUPS, 'unknown'] },
    { expectedExecutedCases: true }, { expectedExecutedCases: 0 }, { expectedExecutedCases: null },
    { expectedGroups: null }, { excludedTests: null }, { anything: 1 }]) {
    assert.throws(() => browserAcceptancePolicy({ browserAcceptance: input }));
  }
});

test('actual totals preserve 46 real passes with two separately documented exclusions', () => {
  const checked = verifyBrowserAcceptance(planned(), results());
  assert.deepEqual(checked.totals, { total: 46, pass: 46, fail: 0, skipped: 0 });
  assert.equal(checked.excludedCaseCount, 2);
  assert.equal(checked.observedGroups, 11);
  assert.equal(Object.hasOwn(checked.totals, 'cancelled'), false);
});

test('missing groups, failures, hidden skips and count drift all block acceptance', () => {
  for (const mutate of [g => delete g.remRally, g => { g.remRally.fail = 1; },
    g => { g.remRally.skipped = 1; }, g => { g.upstreamRenderer.skipped = 2; },
    g => { g.remRally.total++; }, g => { g.remRally.pass++; g.remRally.total++; },
    g => { g.remRally.pass = true; }, g => { g.remRally.cancelled = 0; }]) {
    const g = results(); mutate(g); assert.throws(() => verifyBrowserAcceptance(planned(), g));
  }
});

test('a reviewed new synchronization group requires its own executed case count', () => {
  const p = browserAcceptancePolicy({ browserAcceptance: { excludedTests, expectedExecutedCases: 47,
    expectedGroups: [...BASE_BROWSER_GROUPS, 'newSync'] } });
  const g = { ...results(), newSync: { total: 1, pass: 1, fail: 0, skipped: 0 } };
  assert.equal(verifyBrowserAcceptance(p, g).totals.pass, 47);
});
