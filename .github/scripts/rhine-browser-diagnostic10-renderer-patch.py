#!/usr/bin/env python3
"""Diagnostic-copy-only passive tracing for the immutable failed stable10 renderer.

Usage: python rhine-browser-diagnostic10-renderer-patch.py ABSOLUTE_SOURCE_ROOT
This is not release code. No browser, game, network request, retry, timeout or test is run.
"""
import hashlib
import json
import pathlib
import sys

SOURCE = 'c2bcb246d407e8f4c014d39c480c85358e79fdeb'
RELATIVE = 'public/js/render/app.js'
EXPECTED_SHA256 = 'b10ae2fdd2a48d8f1896157c1985a960875985aa62a27e97ff16744e0d6955aa'
MARKER = '__SP_RENDER_INIT_DIAGNOSTICS__'
LIMIT = 200

# Each insertion follows an exact, unique original substring. All original bytes remain intact.
ENTRY_INSERTION = ('factory-entry', '  const signal = opts.signal;\n', r'''  // DIAGNOSTIC COPY ONLY: bounded passive phase observations; never shipped in a release.
  const __rhineRenderContext = { want3d: null, quality: opts.settings?.quality ?? 'high' };
  let __rhineRenderAttempt = null;
  const __rhineRenderTrace = (stage, error) => {
    try {
      let events = globalThis.__SP_RENDER_INIT_DIAGNOSTICS__;
      if (!Array.isArray(events)) events = globalThis.__SP_RENDER_INIT_DIAGNOSTICS__ = [];
      if (__rhineRenderAttempt == null) {
        events.nextAttempt = Number.isSafeInteger(events.nextAttempt) ? events.nextAttempt + 1 : 1;
        __rhineRenderAttempt = events.nextAttempt;
      }
      const event = { stage, at: performance.now(), date: Date.now(), timeOrigin: performance.timeOrigin,
        attempt: __rhineRenderAttempt, aborted: signal?.aborted ?? false,
        want3d: __rhineRenderContext.want3d, quality: __rhineRenderContext.quality };
      if (error != null) { event.errorName = String(error.name ?? ''); event.errorMessage = String(error.message ?? error); }
      if (events.length >= 200) { events.splice(0, events.length - 199); events.dropped = (events.dropped || 0) + 1; }
      events.push(event);
      console.debug('[render-init-phase]', JSON.stringify(event));
    } catch { /* Observation must never change the factory result or exception. */ }
  };
  const __rhineRenderCancel = () => __rhineRenderTrace('cancel');
  if (signal?.aborted) __rhineRenderCancel();
  signal?.addEventListener('abort', __rhineRenderCancel, { once: true });
  __rhineRenderTrace('entry');
''')

PHASE_INSERTIONS = [
    ('ensure-pixi-before', '  const P = await withTimeout(ensurePixi(), null, signal);', "  __rhineRenderTrace('ensure-pixi-before');\n", 'before'),
    ('ensure-pixi-after', '  const P = await withTimeout(ensurePixi(), null, signal);\n', "  __rhineRenderTrace('ensure-pixi-after');\n", 'after'),
    ('computed-options', "  const want3d = boardPref !== '2d' && webgl2Available(boardPref === '3d');\n", '  __rhineRenderContext.want3d = want3d;\n  __rhineRenderContext.quality = settings.quality;\n', 'after'),
    ('assets-before', '  await withTimeout(Promise.all([assets.ready ? assets.ready() : null, assets.local ? assets.local() : null]\n', "  __rhineRenderTrace('assets-wait-before');\n", 'before'),
    ('assets-after', '    .map((p) => Promise.resolve(p).catch(() => {}))), 4000, signal);\n', "  __rhineRenderTrace('assets-wait-after');\n", 'after'),
    ('fonts-before', "  try { if (document.fonts?.load) await withTimeout(Promise.all([document.fonts.load('700 40px Bender'), document.fonts.load('700 40px Oxanium')]), 1500, signal); } catch { /* optional fonts */ }", "  __rhineRenderTrace('fonts-wait-before');\n", 'before'),
    ('fonts-after', "  try { if (document.fonts?.load) await withTimeout(Promise.all([document.fonts.load('700 40px Bender'), document.fonts.load('700 40px Oxanium')]), 1500, signal); } catch { /* optional fonts */ }\n", "  __rhineRenderTrace('fonts-wait-after');\n", 'after'),
    ('sync-setup-before', '  const size = () => ({ width: Math.max(1, host.clientWidth || 1), height: Math.max(1, host.clientHeight || 1) });', "  __rhineRenderTrace('sync-setup-before');\n", 'before'),
    ('application-before', '  const app = new P.Application({', "  __rhineRenderTrace('application-before');\n", 'before'),
    ('application-after', '  const canvas = app.view;', "  __rhineRenderTrace('application-after');\n", 'before'),
    ('backdrop-before', '  const bg = backdropTextures();', "  __rhineRenderTrace('backdrop-textures-before');\n", 'before'),
    ('backdrop-after', '  const bg = backdropTextures();\n', "  __rhineRenderTrace('backdrop-textures-after');\n", 'after'),
    ('tile-field-before', '  const tiles = new TileField({ ground: layers.ground, overlay: layers.overlay, props: layers.units, anim: layers.anim });', "  __rhineRenderTrace('tile-field-before');\n", 'before'),
    ('tile-field-after', '  const tiles = new TileField({ ground: layers.ground, overlay: layers.overlay, props: layers.units, anim: layers.anim });\n', "  __rhineRenderTrace('tile-field-after');\n", 'after'),
    ('fx-system-before', '  const fx = new FxSystem({', "  __rhineRenderTrace('fx-system-before');\n", 'before'),
    ('fx-system-after', '  setupCleanup.push(() => fx.destroy());', "  __rhineRenderTrace('fx-system-after');\n", 'before'),
    ('official-fx-before', '  const ofx = new OfficialFx({ P, renderer: app.renderer, assets, cam: () => cam, heightAt });', "  __rhineRenderTrace('official-fx-before');\n", 'before'),
    ('official-fx-after', '  const ofx = new OfficialFx({ P, renderer: app.renderer, assets, cam: () => cam, heightAt });\n', "  __rhineRenderTrace('official-fx-after');\n", 'after'),
    ('impostor-before', '  const impostors = new ImpostorAtlas(app.renderer);', "  __rhineRenderTrace('impostor-atlas-before');\n", 'before'),
    ('impostor-after', '  const impostors = new ImpostorAtlas(app.renderer);\n', "  __rhineRenderTrace('impostor-atlas-after');\n", 'after'),
    ('ticker-added', '  app.ticker.add(frame);\n', "  __rhineRenderTrace('ticker-added');\n", 'after'),
    ('sync-setup-after', "  signal?.addEventListener('abort', onAbort, { once: true });\n", "  __rhineRenderTrace('sync-setup-after');\n", 'after'),
    ('art-before', '  await withTimeout(artPromise, 2500, signal);', "  __rhineRenderTrace('art-wait-before');\n", 'before'),
    ('art-after', '  await withTimeout(artPromise, 2500, signal);\n', "  __rhineRenderTrace('art-wait-after');\n", 'after'),
    ('conditional-3d-before', '  if (want3d) await withTimeout(boardReady, 6000, signal);', "  __rhineRenderTrace('conditional-3d-wait-before');\n", 'before'),
    ('conditional-3d-after', '  if (want3d) await withTimeout(boardReady, 6000, signal);\n', "  __rhineRenderTrace('conditional-3d-wait-after');\n", 'after'),
    ('return', '  return view;\n  } catch (err) {', "  __rhineRenderTrace('return');\n", 'before'),
    ('catch', '  } catch (err) {\n    if (view) view.destroy();', "    __rhineRenderTrace('catch', err);\n", 'catch-body'),
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def patch_bytes(original):
    if sha(original) != EXPECTED_SHA256:
        raise ValueError(f'Refusing non-pristine source, including repeated application: expected {EXPECTED_SHA256}, actual {sha(original)}')
    text = original.decode('utf8')
    if MARKER in text:
        raise ValueError('Diagnostic marker already exists')
    operations = [(*ENTRY_INSERTION, 'after')] + PHASE_INSERTIONS
    checks = []
    for name, anchor, addition, direction in operations:
        count = text.count(anchor)
        if count != 1:
            raise ValueError(f'{name}: expected exactly one original anchor, found {count}')
        checks.append({'name': name, 'originalMatches': count, 'direction': direction, 'insertedBytes': len(addition.encode())})
    patched = text
    reversals = []
    for name, anchor, addition, direction in operations:
        if direction == 'after': replacement = anchor + addition
        elif direction == 'before': replacement = addition + anchor
        else:
            head, tail = anchor.split('\n', 1)
            replacement = head + '\n' + addition + tail
        if patched.count(anchor) != 1:
            raise ValueError(f'{name}: an earlier diagnostic insertion invalidated this exact anchor')
        patched = patched.replace(anchor, replacement, 1)
        reversals.append((replacement, anchor))
    reversed_text = patched
    for replacement, anchor in reversed(reversals):
        if reversed_text.count(replacement) != 1:
            raise ValueError('Diagnostic inverse is ambiguous')
        reversed_text = reversed_text.replace(replacement, anchor, 1)
    if reversed_text.encode() != original:
        raise ValueError('Diagnostic inverse did not restore every original byte')
    return patched.encode(), checks

def main():
    if len(sys.argv) != 2:
        raise ValueError('Usage: patch.py ABSOLUTE_DIAGNOSTIC_SOURCE_ROOT')
    root = pathlib.Path(sys.argv[1])
    if not root.is_absolute():
        raise ValueError('Source root must be absolute')
    root = root.resolve(strict=True)
    if root == pathlib.Path('/workspace/Stronghold-Protocol-Rhine'):
        raise ValueError('Refusing the shared main repository; use an isolated diagnostic copy')
    target = root / RELATIVE
    if target.is_symlink() or root not in target.resolve(strict=True).parents:
        raise ValueError('The diagnostic target must remain inside the source copy')
    original = target.read_bytes()
    patched, checks = patch_bytes(original)
    # Every source/hash/anchor/inverse check completes before the only mutation.
    target.write_bytes(patched)
    print(json.dumps({'schema':'rhine-diagnostic10-renderer-phase-patch/v1', 'diagnosticOnly':True,
        'releaseSource':False, 'sourceCommit':SOURCE, 'path':RELATIVE,
        'before':{'bytes':len(original),'sha256':sha(original)},
        'after':{'bytes':len(patched),'sha256':sha(patched)},
        'anchorCount':len(checks),'anchors':checks,'exactReverseRestoresOriginal':True,
        'trace':{'global':MARKER,'arrayLimit':LIMIT,'consolePrefix':'[render-init-phase]',
            'conditional3dBoundary':'The original conditional remains intact; before/after records include want3d=false when the wait is skipped.'},
        'unchanged':['all original source bytes and statements','await expressions','timeouts','retry behavior','return values','original exception identity','GPU and DOM queries'],
        'scope':'Passive diagnostic-copy tracing only. Console output and timestamp sampling have observation overhead.'},ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Renderer diagnostic patch refused: {error}', file=sys.stderr)
        sys.exit(1)
