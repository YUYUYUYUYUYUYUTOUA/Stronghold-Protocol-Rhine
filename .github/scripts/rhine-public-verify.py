#!/usr/bin/env python3
"""Independently verify all public Rhine release attachments without credentials."""
import hashlib
import json
import os
import pathlib
import re
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

TAG = 'v0.3.0-rhine.11'
SOURCE = '8f6b98c2979b66ee636dbbfcf04ae6dad5b65904'
REPO = 'YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine'
ARCHIVE = f'Stronghold-Protocol-Rhine-{TAG}-Windows-x64.zip'
TOOL = 'Rhine-Update-Tool-Windows.zip'
NAMES = ['RELEASE-VALIDATION.json', 'SHA256SUMS.txt', 'UPDATE-TOOL-SHA256.txt', TOOL, ARCHIVE]
PRIVATE_CONFIGS = {'.env', 'scripts/service.env.cmd', 'plugins/config.json', 'plugins/.studio-key',
                   'plugins/release-validation-private/plugin.json', 'plugins/release-validation-private/.studio.json'}
REPOSITORY = os.environ.get('RHINE_VERIFY_REPOSITORY', '/workspace/Stronghold-Protocol-Rhine')
STABLE_TAG = 'v0.2.4-rhine.6'
API_MAX_BYTES = 2 * 1024 * 1024
BROWSER_GROUPS = frozenset(['remSimulation', 'remRenderer', 'remRally', 'kazdelSimulation', 'renderer',
                            'rhineOperators', 'upstreamRenderer', 'upstreamUi', 'sixSeatUi',
                            'statsLandscape', 'upstreamPlugins', 'newSync'])
SOURCE_READY = True  # Windows 39103531386 and public stable11/latest verified; anonymous downloads pending.
EXPECTED_BROWSER_CASES = 54
OLD_STABLE_ID = 412688222
OLD_STABLE_SOURCE = 'f146f38f38937ff8cba6e036aed30621c0f85a50'
OLD_STABLE_ARCHIVE = f'Stronghold-Protocol-Rhine-{STABLE_TAG}-Windows-x64.zip'
OLD_STABLE_ARCHIVE_SHA256 = '492682907b8fc1d1b5ef4476566cbf8c764fc181076322b1d94872dd52904926'
OLD_STABLE_ASSETS = [{'id': 640363258, 'name': 'RELEASE-VALIDATION.json', 'url': 'https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/releases/download/v0.2.4-rhine.6/RELEASE-VALIDATION.json', 'bytes': 4679, 'sha256': 'bf06daa3eda1330c33bd532361f1099f8d701d1f7287a33e04807027b7e130f6', 'state': 'uploaded'}, {'id': 640363260, 'name': 'Rhine-Update-Tool-Windows.zip', 'url': 'https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/releases/download/v0.2.4-rhine.6/Rhine-Update-Tool-Windows.zip', 'bytes': 41760, 'sha256': 'c587fc1fe6634d01f1b61c4c25ad40cfa59212584653cd47d68905d00c187fc6', 'state': 'uploaded'}, {'id': 640363267, 'name': 'SHA256SUMS.txt', 'url': 'https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/releases/download/v0.2.4-rhine.6/SHA256SUMS.txt', 'bytes': 123, 'sha256': '8b6c0bda55c8c9d5fffb33878f4ef574fc422452959390940b6239d170191607', 'state': 'uploaded'}, {'id': 640363262, 'name': 'Stronghold-Protocol-Rhine-v0.2.4-rhine.6-Windows-x64.zip', 'url': 'https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/releases/download/v0.2.4-rhine.6/Stronghold-Protocol-Rhine-v0.2.4-rhine.6-Windows-x64.zip', 'bytes': 620019699, 'sha256': '492682907b8fc1d1b5ef4476566cbf8c764fc181076322b1d94872dd52904926', 'state': 'uploaded'}, {'id': 640363259, 'name': 'UPDATE-TOOL-SHA256.txt', 'url': 'https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/releases/download/v0.2.4-rhine.6/UPDATE-TOOL-SHA256.txt', 'bytes': 96, 'sha256': 'c3596dd61aa383f19c163015badfa8a37342ebffc8b29024b4f4a3b5f27ea9bf', 'state': 'uploaded'}]
OLD_STABLE_NAMES = [asset['name'] for asset in OLD_STABLE_ASSETS]
EXPECTED_BROWSER_GROUP_ORDER = ['remSimulation', 'remRenderer', 'remRally', 'kazdelSimulation', 'renderer',
                                'rhineOperators', 'upstreamRenderer', 'upstreamUi', 'sixSeatUi',
                                'statsLandscape', 'upstreamPlugins', 'newSync']
EXCLUSION_REASON = '用户明确不再要求旧3D初始化专项；保留其余2D恢复、模拟、同步、重连、动画及行为门槛。'
LEGACY_3D_EXCLUSIONS = [{'group': 'upstreamRenderer', 'file': 'test/render/recovery.browser.test.js',
                         'name': f'{resource} download can recover the 3D board on visibility',
                         'fullName': f'renderer recovery after transient resource failures {resource} download can recover the 3D board on visibility',
                         'reason': EXCLUSION_REASON} for resource in ['atlas', 'three']]
EXCLUSION_BOUNDARY = 'Exact --test-skip-pattern exclusions do not execute their bodies and are outside Node 24 runner totals; they are listed separately, never counted as passing or invented skipped tests.'
CANCELLATION_BOUNDARY = 'The serialized runner schema has no cancelled field; explicit cancellation totals remain in the complete sealed Windows log.'


def announce(message):
    print(message, flush=True)

def require(condition, detail):
    if not condition:
        raise AssertionError(detail)

def asset_url(name):
    return f'https://github.com/{REPO}/releases/download/{TAG}/{urllib.parse.quote(name)}'

def anonymous_api_json(url):
    """Read a bounded public API response without a credential or cookie handler."""
    require(url in [f'https://api.github.com/repos/{REPO}/releases/tags/{TAG}',
                    f'https://api.github.com/repos/{REPO}/releases/latest',
                    f'https://api.github.com/repos/{REPO}/releases/tags/{STABLE_TAG}'], 'Unexpected metadata endpoint')
    request = urllib.request.Request(url, method='GET', headers={
        'User-Agent': 'Rhine-public-release-verification', 'Accept': 'application/vnd.github+json'})
    # A fresh default opener has no cookie jar or authorization handler and does not consult gh credentials.
    opener = urllib.request.build_opener()
    started = time.monotonic()
    with opener.open(request, timeout=60) as response:
        require(response.status == 200, ('Public API HTTP status', url, response.status))
        length = response.headers.get('Content-Length')
        if length is not None:
            require(length.isdecimal() and int(length) <= API_MAX_BYTES, ('Oversized public API response', url, length))
        raw = response.read(API_MAX_BYTES + 1)
        require(len(raw) <= API_MAX_BYTES, ('Oversized public API body', url))
        if length is not None:
            require(len(raw) == int(length), ('Public API Content-Length mismatch', url))
        final_url = response.geturl()
        require(final_url == url, ('Unexpected public API redirect', final_url))
    value = json.loads(raw.decode('utf8'))
    require(type(value) is dict, ('Public API response must be an object', url))
    return value, {'url': url, 'anonymousHttpStatus': 200, 'bytes': len(raw),
                   'sha256': hashlib.sha256(raw).hexdigest(), 'seconds': round(time.monotonic() - started, 3)}

def verify_release_pin():
    """Fail closed before the first network operation until the parent freezes the actual source."""
    require(TAG == 'v0.3.0-rhine.11', 'Unexpected release tag; this checker is pinned to stable11')
    require(SOURCE_READY is True, 'Final source is not frozen: parent must explicitly enable this checker after publication')
    require(type(SOURCE) is str and re.fullmatch(r'[0-9a-f]{40}', SOURCE) is not None,
            'Final source must be an immutable lowercase 40-hex commit')
    require(type(EXPECTED_BROWSER_CASES) is int and EXPECTED_BROWSER_CASES == 54,
            'Reviewed stable11 browser count must remain exactly 54')
    return {'tag': TAG, 'sourceCommit': SOURCE, 'sourceReady': True}

def tag_asset_url(tag, name):
    return f'https://github.com/{REPO}/releases/download/{tag}/{urllib.parse.quote(name)}'

def normalize_release_metadata(value, label, expected_tag, expected_source, expected_names, expected_id=None):
    """Normalize immutable public identity/assets while ignoring mutable counters and timestamps."""
    require(type(value) is dict, (label, 'Release metadata must be an object'))
    require(type(value.get('id')) is int and value['id'] > 0, (label, 'Release id must be a positive integer'))
    if expected_id is not None:
        require(value['id'] == expected_id, (label, 'Preserved release id changed'))
    require(value.get('draft') is False and value.get('prerelease') is False,
            (label, 'Release must be public, non-draft and stable'))
    require(value.get('tag_name') == expected_tag, (label, 'Release tag mismatch'))
    require(value.get('target_commitish') == expected_source, (label, 'Release source mismatch'))
    require(value.get('html_url') == f'https://github.com/{REPO}/releases/tag/{expected_tag}',
            (label, 'Release HTML URL mismatch'))
    assets = value.get('assets')
    require(type(assets) is list and len(assets) == len(expected_names) == 5,
            (label, 'Release must contain exactly five assets'))
    require(all(type(asset) is dict and type(asset.get('name')) is str for asset in assets),
            (label, 'Invalid public asset metadata'))
    require(len({asset['name'] for asset in assets}) == 5 and
            {asset['name'] for asset in assets} == set(expected_names),
            (label, 'Missing, duplicate or unexpected public asset names'))
    normalized, seen_ids = [], set()
    for asset in assets:
        name = asset['name']
        require(type(asset.get('id')) is int and asset['id'] > 0 and asset['id'] not in seen_ids,
                (label, name, 'Invalid or duplicate public asset id'))
        seen_ids.add(asset['id'])
        require(asset.get('browser_download_url') == tag_asset_url(expected_tag, name),
                (label, name, 'Public asset URL mismatch'))
        require(type(asset.get('size')) is int and asset['size'] > 0,
                (label, name, 'Invalid public asset size'))
        require(type(asset.get('digest')) is str and re.fullmatch(r'sha256:[0-9a-f]{64}', asset['digest']) is not None,
                (label, name, 'Public asset must have an exact SHA256 digest'))
        require(asset.get('state') == 'uploaded', (label, name, 'Public asset is not fully uploaded'))
        normalized.append({'id': asset['id'], 'name': name, 'url': asset['browser_download_url'],
                           'bytes': asset['size'], 'sha256': asset['digest'][7:], 'state': 'uploaded'})
    return {'id': value['id'], 'tag': expected_tag, 'sourceCommit': expected_source,
            'draft': False, 'prerelease': False, 'htmlUrl': value['html_url'],
            'assets': sorted(normalized, key=lambda asset: asset['name'])}

def verify_public_release_metadata(published, latest, old_stable):
    """Validate public stable11/latest11 and separately preserve the exact historical stable6."""
    current = normalize_release_metadata(published, 'published', TAG, SOURCE, NAMES)
    selection = normalize_release_metadata(latest, 'latest', TAG, SOURCE, NAMES)
    require(current == selection, 'Stable latest must select the same release id, tag, source and all five exact assets')
    preserved = normalize_release_metadata(old_stable, 'oldStable', STABLE_TAG, OLD_STABLE_SOURCE,
                                          OLD_STABLE_NAMES, OLD_STABLE_ID)
    require(preserved['assets'] == OLD_STABLE_ASSETS, 'Historical stable6 asset identity, URL, size or SHA256 changed')
    old_archive = next(asset for asset in preserved['assets'] if asset['name'] == OLD_STABLE_ARCHIVE)
    require(old_archive['sha256'] == OLD_STABLE_ARCHIVE_SHA256, 'Historical stable6 archive SHA256 changed')
    identity = {key: value for key, value in current.items() if key != 'assets'}
    return {'published': identity, 'latestStable': dict(identity), 'assets': current['assets'],
            'preservedStable': preserved,
            'makeLatestBoundary': 'GitHub does not expose make_latest as a persisted release field; before/after public latest selects this exact stable11 id, tag, source and five assets. Historical stable6 is checked independently by tag.'}

def verify_release_body_reads(published, latest):
    """Read-only body evidence; the parent separately compares the new draft body with the final request notes."""
    require(type(published) is dict and type(latest) is dict, 'Release body reads must be objects')
    body = published.get('body')
    require(type(body) is str and bool(body.strip()), 'Public release notes must be a nonempty string')
    require(type(latest.get('body')) is str and latest['body'] == body,
            'Published and latest release notes differ')
    raw = body.encode('utf8')
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
            'scope': 'Fresh anonymous public tag/latest body reads only; no release write or template-based finalization. The parent checks final request notes with the actual publisher anchor replacement.'}

def verify_metadata_unchanged(before, after):
    require(before == after, 'Public release identity/assets, latest11 selection or preserved stable6 changed during verification')
    return 'passed'

def verify_public_asset_downloads(publication, downloads):
    """Pure comparison of exact public metadata with completed anonymous file streams."""
    require(type(publication) is dict and type(publication.get('assets')) is list, 'Missing validated public asset metadata')
    assets = publication['assets']
    require(len(assets) == len(NAMES) and {a['name'] for a in assets} == set(NAMES), 'Invalid validated asset set')
    require(type(downloads) is list and len(downloads) == len(NAMES), 'Exactly five completed downloads are required')
    require(all(type(d) is dict and type(d.get('name')) is str for d in downloads), 'Invalid downloaded asset record')
    require(len({d['name'] for d in downloads}) == len(NAMES) and {d['name'] for d in downloads} == set(NAMES),
            'Missing, duplicate or unexpected downloaded assets')
    by_name = {d['name']: d for d in downloads}
    for a in assets:
        d = by_name[a['name']]
        require(d.get('url') == a['url'] == asset_url(a['name']), (a['name'], 'Anonymous asset URL mismatch'))
        require(type(d.get('bytes')) is int and d['bytes'] == a['bytes'], (a['name'], 'Anonymous size differs from public API'))
        require(type(d.get('sha256')) is str and d['sha256'] == a['sha256'], (a['name'], 'Anonymous SHA differs from public API'))
        require(type(d.get('anonymousHttpStatus')) is int and d['anonymousHttpStatus'] == 200,
                (a['name'], 'Anonymous download did not return HTTP 200'))
    return {'assets': len(assets), 'exactPublicURLsAndNames': 'passed', 'publicApiSizeAndSHA256': 'passed'}

def verify_report_channel(report):
    """Check the actual publication policy recorded before the stable assets were uploaded."""
    require(type(report) is dict and type(report.get('releaseChannel')) is dict, 'Missing report release channel')
    channel = report['releaseChannel']
    require(set(channel) == {'prerelease', 'makeLatest'} and
            channel['prerelease'] is False and channel['makeLatest'] is True,
            'Report must explicitly record prerelease false and makeLatest true')
    return dict(channel)

def verify_browser_acceptance(report):
    """Check the actual four-field native summaries and the separate exact reviewed exclusion policy."""
    require(type(report) is dict and type(report.get('packagedWindows')) is dict, 'Missing packaged Windows report')
    native = report['packagedWindows']
    require(type(native.get('browserTests')) is dict, 'Missing native browser groups')
    groups = native['browserTests']
    require(set(groups) == BROWSER_GROUPS, 'The exact twelve required browser groups must be present')
    aggregate = {key: 0 for key in ['total', 'pass', 'fail', 'skipped']}
    for name, totals in groups.items():
        require(type(totals) is dict and set(totals) == set(aggregate), (name, 'Unexpected browser total schema'))
        require(all(type(totals[key]) is int and totals[key] >= 0 for key in aggregate),
                (name, 'Browser totals must be nonnegative integers'))
        require(totals['total'] == totals['pass'] and totals['pass'] > 0 and totals['fail'] == totals['skipped'] == 0,
                (name, 'Every browser case must pass with no failures or skips'))
        for key in aggregate:
            aggregate[key] += totals[key]
    require(aggregate == {'total': EXPECTED_BROWSER_CASES, 'pass': EXPECTED_BROWSER_CASES, 'fail': 0, 'skipped': 0},
            'The complete browser batch must execute and pass exactly 54 cases')
    policy = report.get('browserAcceptance')
    fields = {'schemaVersion', 'expectedGroups', 'expectedExecutedCases', 'expectedSkippedCases',
              'excludedCaseCount', 'excludedTests', 'observedGroups', 'totals',
              'exclusionBoundary', 'cancellationBoundary'}
    require(type(policy) is dict and set(policy) == fields, 'Missing or unexpected browser acceptance schema')
    for key, expected in [('schemaVersion', 1), ('expectedExecutedCases', EXPECTED_BROWSER_CASES),
                          ('expectedSkippedCases', 0), ('excludedCaseCount', 2), ('observedGroups', 12)]:
        require(type(policy[key]) is int and policy[key] == expected, (key, 'Browser acceptance metadata mismatch'))
    require(type(policy['expectedGroups']) is list and len(policy['expectedGroups']) == 12 and
            all(type(group) is str for group in policy['expectedGroups']) and
            set(policy['expectedGroups']) == BROWSER_GROUPS, 'Expected browser group set differs from reviewed policy')
    require(type(policy['totals']) is dict and set(policy['totals']) == set(aggregate) and
            all(type(policy['totals'][key]) is int for key in aggregate) and policy['totals'] == aggregate,
            'Browser policy totals differ from actual native summaries')
    excluded = policy['excludedTests']
    require(type(excluded) is list and len(excluded) == 2 and all(type(item) is dict for item in excluded),
            'Exactly two reviewed legacy 3D exclusions must be recorded')
    require(all(set(item) == set(LEGACY_3D_EXCLUSIONS[0]) and
                all(type(item[key]) is str for key in item) for item in excluded),
            'Unexpected excluded-test metadata schema')
    require(sorted(excluded, key=lambda item: item['name']) == LEGACY_3D_EXCLUSIONS,
            'Only the two exact reviewed legacy 3D leaves and reasons may be excluded')
    require(policy['exclusionBoundary'] == EXCLUSION_BOUNDARY, 'Missing exact separate not-run accounting boundary')
    require(policy['cancellationBoundary'] == CANCELLATION_BOUNDARY,
            'Missing actual cancellation evidence boundary; no cancelled value may be invented')
    return dict(policy)

def verify_runner_scheduling(native):
    require(type(native) is dict, 'Packaged Windows report must be an object')
    require('runnerScheduling' in native, 'Missing native Windows runner scheduling evidence')
    scheduling = native['runnerScheduling']
    require(type(scheduling) is dict, 'Native Windows runner scheduling evidence must be an object')
    for key in ['beforePriority', 'targetPriority', 'actualPriority', 'availableParallelism', 'bundledNodePriority']:
        require(key in scheduling and type(scheduling[key]) is int,
                ('Missing or non-integer native Windows scheduling evidence', key))
    require(-20 <= scheduling['beforePriority'] <= 19, 'Initial runner priority is outside Node\'s valid range')
    for key in ['targetPriority', 'actualPriority', 'bundledNodePriority']:
        require(scheduling[key] == 0, ('Native Windows process did not use NORMAL priority', key))
    require(scheduling['availableParallelism'] > 0, 'Native Windows parallelism must be a positive integer')
    return dict(scheduling)

def verify_native_windows_acceptance(report):
    """Check the planned source11 native counts and actual HTTP/WS report fields."""
    require(type(report) is dict and type(report.get('packagedWindows')) is dict,
            'Missing packaged Windows acceptance')
    native = report['packagedWindows']
    require(native.get('platform') == 'win32' and native.get('arch') == 'x64' and
            native.get('node') == 'v24.21.0', 'Native Windows identity mismatch')
    expected = {'tests': {'total': 1020, 'pass': 1018, 'fail': 0, 'skipped': 2},
                'sourceAuthorTests': {'total': 27, 'pass': 27, 'fail': 0, 'skipped': 0},
                'hostTests': {'total': 9, 'pass': 9, 'fail': 0, 'skipped': 0}}
    for name, totals in expected.items():
        actual = native.get(name)
        require(type(actual) is dict and set(actual) == set(totals),
                (name, 'Unexpected native acceptance schema'))
        require(all(type(actual[key]) is int and actual[key] == value for key, value in totals.items()),
                (name, 'Native acceptance counts differ from the planned source11 gates; verify actual counts before activation'))
    require(native.get('http') == 'passed', 'Native HTTP acceptance did not pass')
    require(native.get('webSocket') == 'welcome + pong', 'Native WebSocket acceptance did not pass')
    require(type(native.get('httpArtifactsVerified')) is int and native['httpArtifactsVerified'] == 214,
            'Native HTTP acceptance must verify all 214 artifacts')
    return {'platform': native['platform'], 'arch': native['arch'], 'node': native['node'],
            **{name: dict(native[name]) for name in expected}, 'http': native['http'],
            'webSocket': native['webSocket'], 'httpArtifactsVerified': native['httpArtifactsVerified'],
            'cancellationBoundary': CANCELLATION_BOUNDARY}

def sha_file(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def git_bytes(*args, input=None):
    return subprocess.run(['git', '-c', 'core.attributesFile=/dev/null', *args], cwd=REPOSITORY,
                          input=input, check=True, capture_output=True).stdout

def git_blob_sha1(data):
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()

def source_eol_rules(tree):
    attribute_paths = sorted(name for name in tree if pathlib.PurePosixPath(name).name == '.gitattributes')
    require(attribute_paths == ['.gitattributes'], 'Unexpected nested source attributes; review checkout transformation rules')
    raw = git_bytes('show', f'{SOURCE}:.gitattributes')
    require(git_blob_sha1(raw) == tree['.gitattributes'], 'Source attributes differ from exact tagged blob')
    source_rules = [line.split() for line in raw.decode('utf8').splitlines()
                    if line.strip() and not line.lstrip().startswith('#')]
    expected = [['*.bat', 'text', 'eol=crlf'], ['*.cmd', 'text', 'eol=crlf'], ['*.ps1', 'text', 'eol=crlf']]
    require([rule for rule in source_rules if 'eol=crlf' in rule] == expected,
            'Exact tag no longer has the reviewed Windows checkout rules')
    requested = b''.join(name.encode('utf8') + b'\0' for name in sorted(tree))
    actual = git_bytes('check-attr', f'--source={SOURCE}', '-z', '--stdin', 'text', 'eol', input=requested).split(b'\0')
    require(actual[-1] == b'' and (len(actual) - 1) % 3 == 0, 'Unexpected Git attributes output')
    attributes = {}
    for pos in range(0, len(actual) - 1, 3):
        name, attribute, value = (part.decode('utf8') for part in actual[pos:pos + 3])
        attributes.setdefault(name, {})[attribute] = value
    scripts = set()
    for name, values in attributes.items():
        eligible = name.endswith(('.bat', '.cmd', '.ps1'))
        require((values.get('text') == 'set' and values.get('eol') == 'crlf') == eligible,
                (name, 'Git attributes differ from the exact reviewed script rules'))
        if eligible:
            source = git_bytes('show', f'{SOURCE}:{name}')
            require(b'\r' not in source and git_blob_sha1(source) == tree[name],
                    (name, 'Expected canonical LF Windows-script source blob'))
            scripts.add(name)
    return scripts, {'sourceCommit': SOURCE, 'path': '.gitattributes', 'gitBlob': tree['.gitattributes'],
                     'sha256': hashlib.sha256(raw).hexdigest(), 'rules': [' '.join(rule) for rule in expected],
                     'eligibleSourceScripts': len(scripts),
                     'policy': 'Exact-tag explicit text/eol=crlf scripts are validated here; other tracked paths use raw Git blobs unless windowsCheckoutModel explicitly lists their exact-tag Git auto-text Windows conversion, compared byte-for-byte.'}

def verify_source_member(data, source_path, tree, crlf_scripts):
    transformed = source_path in crlf_scripts
    if transformed:
        # Require the actual checkout representation before normalizing. A raw LF blob must not bypass this check.
        pairs = data.count(b'\r\n')
        require(pairs == data.count(b'\r') == data.count(b'\n'), (source_path, 'Windows script is not strictly CRLF'))
        canonical = data.replace(b'\r\n', b'\n')
    else:
        canonical = data
    require(source_path in tree and git_blob_sha1(canonical) == tree[source_path],
            (source_path, 'Payload differs from exact tagged Git blob after permitted checkout transformation'))
    return transformed and canonical != data

def source_mismatch_diagnostic(source_path, data, expected_blob):
    return {'path': source_path, 'actualBytes': len(data), 'actualSha256': hashlib.sha256(data).hexdigest(),
            'actualGitBlob': git_blob_sha1(data), 'expectedSourceGitBlob': expected_blob,
            'strictCrLf': data.count(b'\r\n') == data.count(b'\r') == data.count(b'\n'),
            'crLfToLfCandidateGitBlob': git_blob_sha1(data.replace(b'\r\n', b'\n')),
            'candidateBoundary': 'Diagnostic only; this candidate never authorizes a checkout transformation.'}

def auto_text_checkout_model(source_path, raw, filtered, attributes, expected_blob):
    """Accept only Git's exact-tag auto-text LF -> CRLF conversion, never arbitrary normalization."""
    require(attributes == {'text': 'auto', 'eol': 'unspecified', 'filter': 'unspecified',
                           'working-tree-encoding': 'unspecified', 'ident': 'unspecified'},
            (source_path, 'Unsupported attributes for Windows auto-text checkout'))
    require(git_blob_sha1(raw) == expected_blob, (source_path, 'Model source differs from exact Git blob'))
    if filtered == raw:
        return None  # Git's text detector left these bytes unchanged, including binary files.
    require(b'\x00' not in raw and b'\r' not in raw and b'\n' in raw and filtered == raw.replace(b'\n', b'\r\n'),
            (source_path, 'Git filter produced an unsupported transformation'))
    return {'sourcePath': source_path, 'sourceGitBlob': expected_blob, 'sourceBytes': len(raw),
            'sourceSha256': hashlib.sha256(raw).hexdigest(), 'expectedBytes': filtered,
            'expectedPayloadBytes': len(filtered), 'expectedPayloadSha256': hashlib.sha256(filtered).hexdigest(),
            'attributes': dict(attributes), 'model': 'exact-tag Git auto text; core.autocrlf=false/core.eol=crlf',
            'sourceCommit': SOURCE}

def windows_auto_checkout_models(tree):
    """Use a clean bare Git model: no working tree, index, info/global/system attributes or filters."""
    object_path = pathlib.Path(os.fsdecode(git_bytes('rev-parse', '--git-path', 'objects')).strip())
    if not object_path.is_absolute():
        object_path = pathlib.Path(REPOSITORY) / object_path
    object_path = object_path.resolve()
    require(object_path.is_dir() and '\n' not in str(object_path), 'Invalid source object directory')
    env = {k: value for k, value in os.environ.items() if not k.startswith('GIT_')}
    env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_ATTR_NOSYSTEM': '1'})
    models = {}
    with tempfile.TemporaryDirectory(prefix='rhine-windows-checkout-model-') as temporary:
        subprocess.run(['git', 'init', '--bare', '--quiet', '--template=', temporary], env=env,
                       check=True, capture_output=True)
        objects = pathlib.Path(temporary) / 'objects' / 'info'
        objects.mkdir(exist_ok=True)
        (objects / 'alternates').write_text(str(object_path) + '\n')
        command = ['git', f'--git-dir={temporary}', f'--attr-source={SOURCE}', '-c', f'core.attributesFile={os.devnull}',
                   '-c', 'core.autocrlf=false', '-c', 'core.eol=crlf']
        def model_git(*args, input=None):
            return subprocess.run(command + list(args), env=env, input=input,
                                  check=True, capture_output=True).stdout
        root_attrs = model_git('show', f'{SOURCE}:.gitattributes')
        require(git_blob_sha1(root_attrs) == tree['.gitattributes'], 'Model attributes differ from exact tag')
        requested = b''.join(name.encode('utf8') + b'\0' for name in sorted(tree))
        values = model_git('check-attr', '-z', '--stdin', 'text', 'eol', 'filter', 'working-tree-encoding', 'ident',
                           input=requested).split(b'\0')
        require(values[-1] == b'' and (len(values)-1) % 3 == 0, 'Invalid model attributes output')
        attributes = {}
        for i in range(0, len(values)-1, 3):
            name, key, value = (x.decode('utf8') for x in values[i:i+3])
            attributes.setdefault(name, {})[key] = value
        for name, attrs in attributes.items():
            if attrs.get('text') != 'auto' or attrs.get('eol') != 'unspecified':
                continue
            raw = model_git('show', f'{SOURCE}:{name}')
            filtered = model_git('cat-file', '--filters', f'{SOURCE}:{name}')
            model = auto_text_checkout_model(name, raw, filtered, attrs, tree[name])
            if model is not None:
                models[name] = model
    evidence = {'sourceCommit': SOURCE, 'attributesGitBlob': tree['.gitattributes'],
                'attributesSha256': hashlib.sha256(root_attrs).hexdigest(), 'autoTextConversionPaths': sorted(models),
                'autoTextConversionCount': len(models), 'gitVersion': git_bytes('--version').decode().strip(),
                'isolation': 'Fresh bare repo with empty template and read-only source-object alternate; exact-tag --attr-source, no working tree/index/info attributes; GIT_ATTR_NOSYSTEM/GIT_CONFIG_NOSYSTEM and null global/core.attributesFile.',
                'model': {'core.autocrlf': False, 'core.eol': 'crlf', 'scope': 'Windows native checkout'},
                'policy': 'Only paths where exact-tag Git filters actually produce canonical LF-to-CRLF bytes get a model; every actual payload must match those exact bytes. Other files retain raw Git-blob checks.'}
    return models, evidence

def verify_auto_checkout_member(data, source_path, tree, models):
    require(source_path in models and models[source_path]['sourceGitBlob'] == tree[source_path],
            (source_path, 'Missing exact source checkout model'))
    model = models[source_path]
    require(data == model['expectedBytes'], {'error': 'Payload differs from exact Git Windows checkout model',
            **source_mismatch_diagnostic(source_path, data, tree[source_path]),
            'expectedPayloadBytes': model['expectedPayloadBytes'], 'expectedPayloadSha256': model['expectedPayloadSha256'],
            'model': model['model'], 'attributes': model['attributes']})
    require(git_blob_sha1(data.replace(b'\r\n', b'\n')) == tree[source_path],
            (source_path, 'Checkout model does not recover exact source Git blob'))
    return {key: value for key, value in model.items() if key != 'expectedBytes'} | {
        'payloadPath': source_path, 'actualPayloadBytes': len(data), 'actualPayloadSha256': hashlib.sha256(data).hexdigest()}

def download(directory, name):
    url = asset_url(name)
    target = directory / name
    # No Authorization, cookies, gh configuration, or connector credentials are used.
    request = urllib.request.Request(url, headers={'User-Agent': 'Rhine-public-release-verification'})
    started = time.monotonic()
    last = started
    size = 0
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=60) as response, target.open('xb') as output:
        require(response.status == 200, (name, response.status))
        length = response.headers.get('Content-Length')
        host = urllib.parse.urlparse(response.geturl()).hostname
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            output.write(chunk)
            digest.update(chunk)
            size += len(chunk)
            if time.monotonic() - last >= 10:
                announce(f'Downloading {name}: {size:,} bytes')
                last = time.monotonic()
    if length is not None:
        require(size == int(length), (name, 'Content-Length mismatch', size, length))
    info = {'name': name, 'path': str(target), 'url': url, 'bytes': size,
            'sha256': digest.hexdigest(), 'anonymousHttpStatus': 200,
            'finalHost': host, 'seconds': round(time.monotonic() - started, 3)}
    announce(f'Downloaded {name}: {size:,} bytes SHA256={info["sha256"]}')
    return info

def verify_archive(file, prefix, manifest_name, expected_source, tree, crlf_scripts, node=False, checkout_models=None):
    started = time.monotonic()
    with zipfile.ZipFile(file) as archive:
        members = archive.infolist()
        files = [entry.filename for entry in members if not entry.is_dir()]
        require(len(files) == len(set(files)), 'Duplicate ZIP members')
        require(len(files) == len({name.casefold() for name in files}), 'Case-colliding ZIP members')
        require(all(name.startswith(prefix) and '..' not in pathlib.PurePosixPath(name).parts for name in files),
                'Unexpected ZIP root or traversal')
        manifest = json.loads(archive.read(prefix + manifest_name))
        require(manifest.get('schemaVersion') == 1, 'Unknown manifest schema; source-byte comparison requires schema 1')
        require(manifest['sourceCommit'] == expected_source, 'Manifest source commit mismatch')
        if node:
            require(not ({prefix + name for name in PRIVATE_CONFIGS} & set(files)), 'Payload contains private configuration')
            require(prefix + 'release-validation-private.txt' not in files, 'Payload contains the synthetic user private file')
            require(manifest.get('bundle') == 'Stronghold-Protocol-Rhine', 'Unexpected bundle manifest family')
            require(all(entry.get('source') in ['tracked', 'local-resource', 'runtime'] for entry in manifest['files']),
                    'Unknown source category in schema-1 payload')
            require(manifest['sourceDirty'] is False, 'Dirty payload source')
            require(manifest['runtime']['platform'] == 'win32' and manifest['runtime']['arch'] == 'x64', 'Runtime platform mismatch')
            require(manifest['runtime']['version'] == 'v24.21.0', 'Runtime version mismatch')
        else:
            require(manifest.get('tool') == 'Rhine-Update-Tool-Windows', 'Unexpected toolkit manifest family')
        expected = {entry['path']: entry for entry in manifest['files']}
        require(len(expected) == len(manifest['files']), 'Duplicate manifest entries')
        require(set(files) == {prefix + manifest_name} | {prefix + rel for rel in expected}, 'ZIP membership differs from manifest')
        total = 0
        source_matched = 0
        eol_transformed = []
        auto_transformed = []
        transformation_records = []
        for number, (relative, entry) in enumerate(expected.items(), 1):
            member = prefix + relative
            meta = archive.getinfo(member)
            require(meta.file_size == entry['size'], (relative, 'ZIP size mismatch'))
            digest = hashlib.sha256()
            source_path = relative if node else ('docs/RHINE-UPDATE.md' if relative == 'README.md' else relative)
            compare_source = entry.get('source') == 'tracked' if node else True
            transform_eol = compare_source and source_path in crlf_scripts
            transform_auto = compare_source and source_path in (checkout_models or {})
            require(not (transform_eol and transform_auto), (source_path, 'Ambiguous source checkout model'))
            script_bytes = bytearray() if transform_eol or transform_auto else None
            source_digest = hashlib.sha1(f'blob {entry["size"]}\0'.encode()) if compare_source and not (transform_eol or transform_auto) else None
            size = 0
            # zipfile verifies each member's CRC when its complete stream is read.
            with archive.open(member) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
                    if source_digest is not None:
                        source_digest.update(chunk)
                    if script_bytes is not None:
                        script_bytes.extend(chunk)
                    size += len(chunk)
            require(size == entry['size'] and digest.hexdigest() == entry['sha256'], (relative, 'Payload SHA/size mismatch'))
            if source_digest is not None:
                if source_path not in tree or source_digest.hexdigest() != tree[source_path]:
                    require(False, {'error': 'Payload differs from exact tagged Git blob',
                                    **source_mismatch_diagnostic(source_path, archive.read(member), tree.get(source_path))})
                source_matched += 1
            elif transform_eol:
                if verify_source_member(bytes(script_bytes), source_path, tree, crlf_scripts):
                    eol_transformed.append(relative)
                    canonical = bytes(script_bytes).replace(b'\r\n', b'\n')
                    transformation_records.append({'payloadPath': relative, 'sourcePath': source_path,
                        'sourceGitBlob': tree[source_path], 'sourceBytes': len(canonical), 'sourceSha256': hashlib.sha256(canonical).hexdigest(),
                        'actualPayloadBytes': len(script_bytes), 'actualPayloadSha256': hashlib.sha256(script_bytes).hexdigest(),
                        'model': 'exact-tag explicit text/eol=crlf; original strict-CRLF script validator'})
                source_matched += 1
            elif transform_auto:
                record = verify_auto_checkout_member(bytes(script_bytes), source_path, tree, checkout_models)
                record['payloadPath'] = relative
                transformation_records.append(record)
                eol_transformed.append(relative)
                auto_transformed.append(relative)
                source_matched += 1
            total += size
            if number % 10000 == 0:
                announce(f'Verified {file.name}: {number:,}/{len(expected):,} payload members')
        # This additionally reads the manifest and directory entries and independently checks every member CRC.
        require(archive.testzip() is None, 'ZIP CRC failure')
        result = {'sourceCommit': manifest['sourceCommit'], 'zipFiles': len(files), 'payloadFiles': len(expected),
                  'payloadBytes': total, 'allPayloadSha256': 'passed', 'allMemberCRC': 'passed',
                  'exactManifestMembership': 'passed', 'taggedSourceFilesMatched': source_matched,
                  'taggedSourceRawBlobMatches': source_matched - len(eol_transformed),
                  'gitCheckoutEolTransformations': len(eol_transformed), 'eolTransformedPaths': eol_transformed,
                  'gitCheckoutExplicitCrLfTransformations': len(eol_transformed) - len(auto_transformed),
                  'gitCheckoutAutoTextTransformations': len(auto_transformed), 'sourceComparisonTransformations': transformation_records,
                  'seconds': round(time.monotonic() - started, 3)}
        if node:
            require(manifest['fileCount'] == len(expected) and manifest['totalBytes'] == total, 'Manifest totals differ')
            binary = archive.read(prefix + 'runtime/node/node.exe')
            require(binary[:2] == b'MZ', 'node.exe lacks DOS MZ signature')
            pe = struct.unpack_from('<I', binary, 0x3c)[0]
            require(binary[pe:pe + 4] == b'PE\0\0', 'node.exe lacks PE signature')
            machine = struct.unpack_from('<H', binary, pe + 4)[0]
            optional_magic = struct.unpack_from('<H', binary, pe + 24)[0]
            require(machine == 0x8664 and optional_magic == 0x20b, 'node.exe is not PE32+ AMD64')
            result.update({'sourceDirty': manifest['sourceDirty'], 'runtime': manifest['runtime'],
                           'nodeExecutable': {'bytes': len(binary), 'sha256': hashlib.sha256(binary).hexdigest(),
                                              'machine': '0x8664 (AMD64)', 'optionalHeader': '0x020b (PE32+)'}})
        return result

def main():
    verify_release_pin()  # Must remain before any network call.
    published, published_read = anonymous_api_json(f'https://api.github.com/repos/{REPO}/releases/tags/{TAG}')
    latest, latest_read = anonymous_api_json(f'https://api.github.com/repos/{REPO}/releases/latest')
    old_stable, old_stable_read = anonymous_api_json(f'https://api.github.com/repos/{REPO}/releases/tags/{STABLE_TAG}')
    publication = verify_public_release_metadata(published, latest, old_stable)
    body_before = verify_release_body_reads(published, latest)
    raw_tree = git_bytes('ls-tree', '-r', '-z', '--full-tree', SOURCE)
    tree = {}
    for record in raw_tree.split(b'\0'):
        if not record:
            continue
        metadata, name = record.split(b'\t', 1)
        mode, kind, oid = metadata.split()
        if kind == b'blob':
            tree[name.decode('utf8')] = oid.decode('ascii')
    crlf_scripts, attributes_evidence = source_eol_rules(tree)
    require(len(crlf_scripts) == 15, 'Reviewed source must retain exactly fifteen explicit CRLF Windows scripts')
    checkout_models, checkout_model_evidence = windows_auto_checkout_models(tree)
    directory = pathlib.Path(tempfile.mkdtemp(prefix='rhine-r11-anonymous-', dir='/tmp'))
    announce(f'Verification directory: {directory}')
    (directory / 'PUBLIC-METADATA-BEFORE.json').write_text(json.dumps({
        'publication': published, 'latest': latest, 'oldStable': old_stable,
        'reads': [published_read, latest_read, old_stable_read]}, ensure_ascii=False, indent=2) + '\n')
    files = [download(directory, name) for name in NAMES]
    public_asset_check = verify_public_asset_downloads(publication, files)
    by_name = {entry['name']: entry for entry in files}
    report = json.loads((directory / 'RELEASE-VALIDATION.json').read_text())
    require(report['sourceCommit'] == SOURCE, 'Report source commit mismatch')
    report_channel = verify_report_channel(report)
    require(report['updateToolkit']['sourceCommit'] == SOURCE, 'Toolkit report source commit mismatch')
    for name, section in [(ARCHIVE, 'archive'), (TOOL, 'updateToolkit')]:
        require(report[section]['name'] == name, 'Report asset name mismatch')
        require(report[section]['bytes'] == by_name[name]['bytes'], 'Report asset byte count mismatch')
        require(report[section]['sha256'] == by_name[name]['sha256'], 'Report asset SHA mismatch')
    for name, checksum_name in [(ARCHIVE, 'SHA256SUMS.txt'), (TOOL, 'UPDATE-TOOL-SHA256.txt')]:
        lines = (directory / checksum_name).read_text().strip().splitlines()
        require(lines == [f'{by_name[name]["sha256"]}  {name}'], 'Checksum file content mismatch')
    payload = verify_archive(directory / ARCHIVE, 'Stronghold-Protocol-Rhine/', 'bundle-manifest.json', SOURCE, tree, crlf_scripts, node=True, checkout_models=checkout_models)
    tool = verify_archive(directory / TOOL, 'Rhine-Update-Tool-Windows/', 'TOOL-MANIFEST.json', SOURCE, tree, crlf_scripts, checkout_models=checkout_models)
    require(payload['gitCheckoutExplicitCrLfTransformations'] == 15, 'Payload must retain fifteen strictly validated explicit CRLF scripts')
    require(payload['payloadFiles'] == report['archive']['payloadFilesVerified'], 'Report payload count mismatch')
    require(payload['zipFiles'] == report['archive']['zipFilesVerified'], 'Report ZIP count mismatch')
    require(tool['zipFiles'] == report['updateToolkit']['verifiedFiles'], 'Report toolkit count mismatch')
    checks = report['updateChecks']
    require(checks['from'] == 'v0.2.4-rhine.6' and checks['to'] == TAG, 'Upgrade version mismatch')
    require(checks['conflicts'] == 0, 'Upgrade conflicts')
    for key in ['apply', 'privateFilesPreserved', 'rollback']:
        require(checks[key] == 'passed', ('Upgrade check failed', key))
    require(checks['repeat'] == 'already-current', 'Repeat upgrade mismatch')
    require(checks['platform'] == 'win32' and checks['realWindowsProcessGuard'] is True, 'Upgrade was not checked with the native Windows process guard')
    require(set(checks['privateConfigurationsPreserved']) == PRIVATE_CONFIGS, 'Private configuration coverage mismatch')
    native = report['packagedWindows']
    require(native['platform'] == 'win32' and native['arch'] == 'x64' and native['node'] == 'v24.21.0', 'Native identity mismatch')
    runner_scheduling = verify_runner_scheduling(native)
    native_acceptance = verify_native_windows_acceptance(report)
    browser_acceptance = verify_browser_acceptance(report)
    gates = {key: native[key] for key in ['tests', 'sourceAuthorTests', 'hostTests']}
    gates.update({'browser:' + key: value for key, value in native['browserTests'].items()})
    for key, value in gates.items():
        require(value['fail'] == 0 and value['pass'] > 0, (key, 'Acceptance gate did not pass'))
    published_after, published_after_read = anonymous_api_json(f'https://api.github.com/repos/{REPO}/releases/tags/{TAG}')
    latest_after, latest_after_read = anonymous_api_json(f'https://api.github.com/repos/{REPO}/releases/latest')
    old_stable_after, old_stable_after_read = anonymous_api_json(f'https://api.github.com/repos/{REPO}/releases/tags/{STABLE_TAG}')
    publication_after = verify_public_release_metadata(published_after, latest_after, old_stable_after)
    body_after = verify_release_body_reads(published_after, latest_after)
    require(body_before == body_after, 'Public release notes changed during anonymous verification')
    verify_metadata_unchanged(publication, publication_after)
    verify_public_asset_downloads(publication_after, files)
    (directory / 'PUBLIC-METADATA-AFTER.json').write_text(json.dumps({
        'publication': published_after, 'latest': latest_after, 'oldStable': old_stable_after,
        'reads': [published_after_read, latest_after_read, old_stable_after_read]}, ensure_ascii=False, indent=2) + '\n')
    result = {'tag': TAG, 'sourceCommit': SOURCE, 'directory': str(directory), 'anonymous': True,
              'attachments': files, 'payload': payload, 'toolkit': tool, 'packagedWindowsGates': gates,
              'packagedWindowsRunnerScheduling': runner_scheduling,
              'packagedWindowsAcceptance': native_acceptance,
              'publicRelease': publication, 'publicReleaseAfter': publication_after,
              'publicReleaseBodyBefore': body_before, 'publicReleaseBodyAfter': body_after,
              'publicApiReads': [published_read, latest_read, old_stable_read, published_after_read, latest_after_read, old_stable_after_read],
              'publicAssetChecks': public_asset_check, 'reportReleaseChannel': report_channel,
              'browserAcceptance': browser_acceptance,
              'sourceAttributes': attributes_evidence,
              'windowsCheckoutModel': checkout_model_evidence,
              'updateChecks': checks, 'automation': report['automation'], 'status': 'passed'}
    target = directory / 'ANONYMOUS-VERIFICATION.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    announce(f'All anonymous download, SHA256, exact membership, payload SHA256, CRC and PE AMD64 checks passed: {target}')
    announce(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
