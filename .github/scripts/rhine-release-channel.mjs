// Publication channel checks are independent of the updater's release selection policy.
import assert from 'node:assert/strict';

function booleanFlag(request, name, fallback) {
  if (!Object.hasOwn(request, name)) return fallback;
  if (typeof request[name] !== 'boolean') throw new TypeError(`${name} must be a boolean when specified`);
  return request[name];
}

/** Resolve GitHub's publication flags without changing legacy stable requests. */
export function releaseChannel(request = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('release request must be an object');
  const prerelease = booleanFlag(request, 'prerelease', false);
  const makeLatest = booleanFlag(request, 'makeLatest', !prerelease);
  if (prerelease && makeLatest) throw new Error('a prerelease must not become the latest stable release');
  return { prerelease, make_latest: makeLatest ? 'true' : 'false' };
}

function releaseIdentity(release, name) {
  assert.ok(release && typeof release === 'object' && !Array.isArray(release), `${name} must be a release object`);
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0, `${name}.id must identify a release`);
  assert.ok(typeof release.tag_name === 'string' && release.tag_name.length > 0, `${name}.tag_name must identify a tag`);
  return { id: release.id, tag: release.tag_name, draft: release.draft, prerelease: release.prerelease };
}

/** Verify fresh API responses after publication and return a serializable evidence snapshot. */
export function verifyPublishedChannel({ published, beforeLatest, afterLatest, request }) {
  const policy = releaseChannel(request);
  assert.ok(typeof request?.tag === 'string' && request.tag.length > 0, 'request.tag must identify the requested release');
  assert.ok(typeof request.sourceCommit === 'string' && request.sourceCommit.length > 0, 'request.sourceCommit must identify the requested source');
  const publication = releaseIdentity(published, 'published');
  const before = beforeLatest == null ? null : releaseIdentity(beforeLatest, 'beforeLatest');
  const after = releaseIdentity(afterLatest, 'afterLatest');
  assert.equal(published.draft, false, 'published release must no longer be a draft');
  assert.equal(published.tag_name, request.tag, 'published tag must match request.tag');
  assert.equal(published.target_commitish, request.sourceCommit, 'published source must match request.sourceCommit');
  assert.equal(published.prerelease, policy.prerelease, 'published prerelease flag must match the requested channel');
  assert.equal(afterLatest.draft, false, 'latest stable release must not be a draft');
  assert.equal(afterLatest.prerelease, false, 'latest stable release must not be a prerelease');
  if (policy.make_latest === 'false') {
    assert.ok(before, 'beforeLatest is required to prove the stable latest release was preserved');
    assert.equal(afterLatest.id, beforeLatest.id, 'latest stable release id changed');
    assert.equal(afterLatest.tag_name, beforeLatest.tag_name, 'latest stable release tag changed');
    assert.notEqual(afterLatest.tag_name, request.tag, 'the requested tag must not become latest when makeLatest is false');
  } else {
    assert.equal(afterLatest.id, published.id, 'latest release id must match the published stable release');
    assert.equal(afterLatest.tag_name, published.tag_name, 'latest release tag must match the published stable release');
  }
  return { policy, published: { ...publication, sourceCommit: published.target_commitish }, beforeLatest: before, afterLatest: after };
}
