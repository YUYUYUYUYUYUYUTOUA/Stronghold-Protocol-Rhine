import assert from 'node:assert/strict';

export const BASE_BROWSER_GROUPS = Object.freeze(['remSimulation', 'remRenderer', 'remRally', 'kazdelSimulation',
  'renderer', 'rhineOperators', 'upstreamRenderer', 'upstreamUi', 'sixSeatUi', 'statsLandscape', 'upstreamPlugins']);
const ALLOWED_GROUPS = new Set([...BASE_BROWSER_GROUPS, 'newSync']);
const RECOVERY_SUITE = 'renderer recovery after transient resource failures';
export const LEGACY_3D_TESTS = Object.freeze(['atlas', 'three'].map(resource => Object.freeze({
  group: 'upstreamRenderer', file: 'test/render/recovery.browser.test.js',
  name: `${resource} download can recover the 3D board on visibility`,
  fullName: `${RECOVERY_SUITE} ${resource} download can recover the 3D board on visibility`,
})));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only the two explicitly reviewed legacy 3D leaves can be excluded. */
export function browserAcceptancePolicy(request = {}) {
  assert.ok(request && typeof request === 'object' && !Array.isArray(request), 'Release request must be an object');
  const input = Object.hasOwn(request, 'browserAcceptance') ? request.browserAcceptance : {};
  assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'browserAcceptance must be an object');
  assert.ok(Object.keys(input).every(key => ['excludedTests', 'expectedExecutedCases', 'expectedGroups'].includes(key)),
    'Unknown browser acceptance policy field');
  const excluded = Object.hasOwn(input, 'excludedTests') ? input.excludedTests : [];
  assert.ok(Array.isArray(excluded), 'excludedTests must be an array');
  const seen = new Set();
  const excludedTests = excluded.map(item => {
    assert.ok(item && typeof item === 'object' && !Array.isArray(item));
    assert.ok(Object.keys(item).every(key => ['file', 'name', 'reason'].includes(key)), 'Unknown exclusion field');
    const allowed = LEGACY_3D_TESTS.find(test => test.file === item.file && test.name === item.name);
    assert.ok(allowed, 'Only reviewed legacy 3D resource-recovery tests may be excluded');
    assert.ok(typeof item.reason === 'string' && item.reason.trim(), 'Every exclusion needs its explicit reason');
    assert.equal(seen.has(allowed.fullName), false, 'Duplicate excluded test'); seen.add(allowed.fullName);
    return { ...allowed, reason: item.reason };
  });
  const expectedGroups = Object.hasOwn(input, 'expectedGroups') ? input.expectedGroups : BASE_BROWSER_GROUPS;
  assert.ok(Array.isArray(expectedGroups) && expectedGroups.length > 0);
  assert.equal(new Set(expectedGroups).size, expectedGroups.length, 'Duplicate browser group');
  assert.ok(expectedGroups.every(group => ALLOWED_GROUPS.has(group)), 'Unknown browser group');
  assert.ok(BASE_BROWSER_GROUPS.every(group => expectedGroups.includes(group)), 'Required browser group omitted');
  const expectedExecutedCases = Object.hasOwn(input, 'expectedExecutedCases') ? input.expectedExecutedCases : 48 - excludedTests.length;
  assert.ok(Number.isSafeInteger(expectedExecutedCases) && expectedExecutedCases > 0, 'Expected case count must be a positive integer');
  return { schemaVersion: 1, expectedGroups: [...expectedGroups], expectedExecutedCases,
    expectedSkippedCases: 0, excludedCaseCount: excludedTests.length, excludedTests };
}

export function browserTestArguments(policy, group) {
  const excluded = policy.excludedTests.filter(test => test.group === group);
  if (!excluded.length) return [];
  return [`--test-skip-pattern=^(?:${excluded.map(test => escapeRegex(test.fullName)).join('|')})$`];
}

/** Counts are the publisher's real total/pass/fail/skipped schema; never invent cancelled=0. */
export function verifyBrowserAcceptance(policy, groups) {
  assert.ok(groups && typeof groups === 'object' && !Array.isArray(groups), 'Browser results are required');
  assert.deepEqual(Object.keys(groups).sort(), [...policy.expectedGroups].sort(), 'Browser group set differs from the reviewed plan');
  const totals = { total: 0, pass: 0, fail: 0, skipped: 0 };
  for (const [name, result] of Object.entries(groups)) {
    assert.deepEqual(Object.keys(result).sort(), Object.keys(totals).sort(), `${name}: unexpected total schema`);
    for (const key of Object.keys(totals)) {
      assert.ok(Number.isSafeInteger(result[key]) && result[key] >= 0, `${name}: invalid ${key}`);
      totals[key] += result[key];
    }
    assert.ok(result.pass > 0, `${name}: no executed passing cases`);
    assert.equal(result.fail, 0, `${name}: a browser case failed`);
    assert.equal(result.skipped, 0, `${name}: an executed group reported an unexpected skipped case`);
    assert.equal(result.total, result.pass + result.skipped, `${name}: incomplete case accounting`);
  }
  assert.equal(totals.pass, policy.expectedExecutedCases, 'Executed browser count differs from the reviewed plan');
  assert.equal(totals.skipped, policy.expectedSkippedCases, 'Skipped browser count differs from the reviewed plan');
  return { ...policy, observedGroups: Object.keys(groups).length, totals,
    exclusionBoundary: 'Exact --test-skip-pattern exclusions do not execute their bodies and are outside Node 24 runner totals; they are listed separately, never counted as passing or invented skipped tests.',
    cancellationBoundary: 'The serialized runner schema has no cancelled field; explicit cancellation totals remain in the complete sealed Windows log.' };
}
