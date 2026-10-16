import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseChannel, verifyPublishedChannel } from './rhine-release-channel.mjs';

const SOURCE = 'a'.repeat(40);
const stable = () => ({ id: 100, tag_name: 'v0.3.0-rhine.6', target_commitish: 'b'.repeat(40), draft: false, prerelease: false });
const fixture = (flags = {}) => {
  const request = { tag: 'v0.3.0-rhine.8-test.1', sourceCommit: SOURCE, ...flags };
  const published = { id: 200, tag_name: request.tag, target_commitish: SOURCE, draft: false, prerelease: flags.prerelease ?? false };
  return { request, published, beforeLatest: stable(), afterLatest: flags.prerelease || flags.makeLatest === false ? stable() : { ...published } };
};

test('legacy requests continue publishing stable releases as latest', () => {
  assert.deepEqual(releaseChannel({}), { prerelease: false, make_latest: 'true' });
  const input = fixture();
  const evidence = verifyPublishedChannel(input);
  assert.equal(evidence.published.sourceCommit, SOURCE);
  assert.equal(evidence.afterLatest.id, input.published.id);
  assert.deepEqual(JSON.parse(JSON.stringify(evidence)), evidence, 'publication evidence can be archived as JSON');
});

test('a prerelease defaults to preserving stable latest and verification does not mutate API responses', () => {
  const input = fixture({ prerelease: true });
  const snapshot = structuredClone(input);
  const evidence = verifyPublishedChannel(input);
  assert.deepEqual(evidence.policy, { prerelease: true, make_latest: 'false' });
  assert.equal(evidence.beforeLatest.id, 100);
  assert.equal(evidence.afterLatest.tag, 'v0.3.0-rhine.6');
  assert.equal(evidence.published.prerelease, true);
  assert.deepEqual(input, snapshot);
});

test('explicit channel flags support stable releases that do not replace latest', () => {
  const input = fixture({ prerelease: false, makeLatest: false });
  assert.deepEqual(verifyPublishedChannel(input).policy, { prerelease: false, make_latest: 'false' });
  assert.deepEqual(releaseChannel({ prerelease: true, makeLatest: false }), { prerelease: true, make_latest: 'false' });
  assert.deepEqual(releaseChannel({ prerelease: false, makeLatest: true }), { prerelease: false, make_latest: 'true' });
});

test('a prerelease cannot request stable promotion', () => {
  assert.throws(() => releaseChannel({ prerelease: true, makeLatest: true }), /prerelease.*latest stable/);
});

test('explicit non-boolean flags are rejected rather than coerced or treated as omitted', () => {
  for (const flag of ['prerelease', 'makeLatest']) {
    for (const value of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
      assert.throws(() => releaseChannel({ [flag]: value }), new RegExp(`${flag} must be a boolean`));
    }
  }
  for (const request of [null, false, 'stable', []]) assert.throws(() => releaseChannel(request), /request must be an object/);
});

test('prerelease publication fails verification if GitHub promotes its id and tag', () => {
  const input = fixture({ prerelease: true });
  input.afterLatest = { ...input.published, prerelease: false };
  assert.throws(() => verifyPublishedChannel(input), /latest stable release id changed/);
});

test('preserving stable latest checks both id and tag independently', () => {
  for (const [field, value, message] of [['id', 101, /id changed/], ['tag_name', 'v0.3.0-other', /tag changed/]]) {
    const input = fixture({ prerelease: true });
    input.afterLatest[field] = value;
    assert.throws(() => verifyPublishedChannel(input), message);
  }
});

test('preserved latest must be stable, published, and different from the requested tag', () => {
  for (const field of ['draft', 'prerelease']) {
    const input = fixture({ prerelease: true });
    input.afterLatest[field] = true;
    assert.throws(() => verifyPublishedChannel(input), /latest stable release must not/);
  }
  const input = fixture({ prerelease: true });
  input.beforeLatest.tag_name = input.afterLatest.tag_name = input.request.tag;
  assert.throws(() => verifyPublishedChannel(input), /requested tag must not become latest/);
});

test('preserving latest requires a baseline; publishing the first stable release does not', () => {
  const pre = fixture({ prerelease: true });
  pre.beforeLatest = null;
  assert.throws(() => verifyPublishedChannel(pre), /beforeLatest is required/);
  const first = fixture();
  first.beforeLatest = null;
  assert.equal(verifyPublishedChannel(first).beforeLatest, null);
});

test('publication must report the requested draft state, channel, tag, and source commit', () => {
  for (const [field, value, message] of [
    ['draft', true, /no longer be a draft/],
    ['prerelease', false, /prerelease flag/],
    ['tag_name', 'v0.3.0-wrong', /published tag/],
    ['target_commitish', 'c'.repeat(40), /published source/],
  ]) {
    const input = fixture({ prerelease: true });
    input.published[field] = value;
    assert.throws(() => verifyPublishedChannel(input), message);
  }
});

test('legacy stable publication must actually become latest with the same id and tag', () => {
  const oldLatest = fixture();
  oldLatest.afterLatest = stable();
  assert.throws(() => verifyPublishedChannel(oldLatest), /latest release id must match/);
  const wrongTag = fixture();
  wrongTag.afterLatest.tag_name = 'v0.3.0-wrong';
  assert.throws(() => verifyPublishedChannel(wrongTag), /latest release tag must match/);
  const wrongChannel = fixture();
  wrongChannel.afterLatest.prerelease = true;
  assert.throws(() => verifyPublishedChannel(wrongChannel), /must not be a prerelease/);
});

test('missing identities cannot accidentally verify through undefined equality', () => {
  for (const record of ['published', 'afterLatest', 'beforeLatest']) {
    const input = fixture({ prerelease: true });
    delete input[record].id;
    assert.throws(() => verifyPublishedChannel(input), new RegExp(`${record}.id`));
  }
  for (const field of ['tag', 'sourceCommit']) {
    const input = fixture({ prerelease: true });
    delete input.request[field];
    assert.throws(() => verifyPublishedChannel(input), new RegExp(`request.${field}`));
  }
});

test('formal Rhine nine becomes latest without mutating the prior stable or prerelease records', () => {
  const input = fixture({ prerelease: false, makeLatest: true });
  input.request.tag = input.published.tag_name = input.afterLatest.tag_name = 'v0.3.0-rhine.9';
  input.beforeLatest.tag_name = 'v0.2.4-rhine.6';
  const previousPrerelease = { ...input.published, id: 201, tag_name: 'v0.3.0-rhine.8', prerelease: true };
  const snapshot = structuredClone({ input, previousPrerelease });
  const evidence = verifyPublishedChannel(input);
  assert.deepEqual(evidence.policy, { prerelease: false, make_latest: 'true' });
  assert.equal(evidence.afterLatest.tag, 'v0.3.0-rhine.9');
  assert.deepEqual({ input, previousPrerelease }, snapshot);
});

test('formal latest with a different source cannot pass on matching id and tag alone', () => {
  const input = fixture({ prerelease: false, makeLatest: true });
  input.afterLatest.target_commitish = 'c'.repeat(40);
  assert.throws(() => verifyPublishedChannel(input), /latest stable source/);
});
