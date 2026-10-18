// Field-host ownership under cancellation and timeout. Browser tests cover the actual renderer; this fixture runs
// the production orchestration with controlled imports and timers, without a DOM or GPU dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
import vm from 'node:vm';

const sourcePath = new URL('../../public/js/ui/fieldHost.js', import.meta.url);
const source = readFileSync(sourcePath, 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '')
  .replace("import('../assets.js')", 'importAssets()')
  .replace("import('../render/app.js')", 'importApp()');
const METHODS = ['setStage', 'setCamera', 'setPrep', 'enterBattle', 'pushSnapshot', 'pushEvents', 'highlightTiles', 'on', 'resize'];
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture() {
  const timers = new Map(), requests = [], fallbacks = [], warnings = [], errors = [];
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const subscriptions = new Set(), effects = [];
  let timerId = 0;
  const unrelated = { name: 'unrelated' };
  const host = {
    children: [unrelated],
    get firstChild() { return this.children[0] || null; },
    appendChild(node) { this.children.push(node); },
    removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); },
  };
  function view(name, valid = true) {
    const node = { name };
    host.appendChild(node);
    return {
      ...(valid ? Object.fromEntries(METHODS.map((k) => [k, () => {}])) : {}),
      node, destroyCalls: 0,
      destroy() { this.destroyCalls++; host.removeChild(node); },
    };
  }
  const context = vm.createContext({
    AbortController, DOMException, URLSearchParams, Promise,
    console: { warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) },
    window, document, navigator: { onLine: true },
    useState(initial) { return [initial, () => {}]; },
    useRef(current) { return { current }; },
    useEffect(effect) { effects.push(effect); },
    audio: {}, data: { get() { return null; } }, settingsStore: {
      get() { return {}; },
      subscribe(fn) { subscriptions.add(fn); return () => subscriptions.delete(fn); },
    },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    importAssets: async () => null,
    importApp: async () => ({
      createFieldView(_host, opts) {
        // Deliberately ignore cancellation: the host must still dispose a factory's late return value.
        return new Promise((resolve, reject) => requests.push({ resolve, reject, signal: opts.signal }));
      },
    }),
    createFallbackView() {
      const fallback = view('fallback');
      fallbacks.push({ view: fallback, rendererAborted: requests.at(-1)?.signal?.aborted });
      return fallback;
    },
  });
  vm.runInContext(source + '\nglobalThis.mount = mountFieldView; globalThis.useView = useFieldView;', context, { filename: sourcePath.pathname });
  return {
    host, unrelated, timers, requests, fallbacks, warnings, errors, view, context, window, document, subscriptions,
    mount: (signal) => context.mount(host, { signal }),
    // Run the production hook's effect. State updates do not rerender this controlled ownership fixture.
    useView() { context.useView({ current: host }); return effects.shift()(); },
    timeout() { const fn = [...timers.values()].at(-1); assert.ok(fn, 'initialization has a deadline'); fn(); },
  };
}

function settled(promise) {
  const result = { state: 'pending', value: null };
  promise.then((value) => { result.state = 'fulfilled'; result.value = value; }, (error) => { result.state = 'rejected'; result.value = error; });
  return result;
}

test('successful initialization releases deadlines and cancellation listeners', async () => {
  const f = fixture(), controller = new AbortController();
  const pending = f.mount(controller.signal);
  await flush();
  const raw = f.view('engine');
  f.requests[0].resolve(raw);
  const mounted = await pending;
  assert.equal(mounted.kind, 'engine');
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(getEventListeners(f.requests[0].signal, 'abort').length, 0);
  mounted.destroy();
  assert.equal(raw.destroyCalls, 1);
});

test('cancelling a pending mount rejects without fallback and disposes a late result', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.warnings.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('cancellation between factory resolution and mount continuation disposes the resolved view', async () => {
  const f = fixture(), controller = new AbortController();
  const result = settled(f.mount(controller.signal));
  await flush();
  const raw = f.view('settling');
  f.requests[0].resolve(raw);
  await Promise.resolve();
  controller.abort();
  await flush();
  assert.equal(result.state, 'rejected');
  assert.equal(result.value.name, 'AbortError');
  assert.equal(raw.destroyCalls, 1);
  assert.equal(f.fallbacks.length, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated]);
});

test('an invalid renderer API is disposed and aborted before fallback mounts', async () => {
  const f = fixture();
  const pending = f.mount();
  await flush();
  const invalid = f.view('invalid', false);
  f.requests[0].resolve(invalid);
  const fallback = await pending;
  assert.equal(fallback.kind, 'fallback');
  assert.equal(invalid.destroyCalls, 1);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, f.fallbacks[0].view.node]);
  fallback.destroy();
});

test('a timed-out factory returning late cannot remove a replacement view or unrelated children', async () => {
  const f = fixture();
  const first = f.mount();
  await flush();
  f.timeout();
  const fallback = await first;
  assert.equal(fallback.kind, 'fallback');
  fallback.destroy();
  const replacementPending = f.mount();
  await flush();
  const replacement = f.view('replacement');
  f.requests[1].resolve(replacement);
  const mounted = await replacementPending;
  const late = f.view('late');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.equal(replacement.destroyCalls, 0);
  assert.equal(f.fallbacks[0].rendererAborted, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.host.children, [f.unrelated, replacement.node]);
  mounted.destroy();
});

test('pagehide disposes a mounted owner once and releases its hook resources', async () => {
  const f = fixture(), unmount = f.useView();
  await flush();
  const raw = f.view('mounted');
  f.requests[0].resolve(raw);
  await flush();
  assert.equal(f.context.__SP_VIEW__.raw, raw);
  assert.equal(f.subscriptions.size, 1);
  assert.equal(getEventListeners(f.window, 'pagehide').length, 1);
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(raw.destroyCalls, 1, 'the renderer owner releases its view immediately');
  assert.equal(f.context.__SP_VIEW__, null);
  assert.equal(f.subscriptions.size, 0);
  for (const name of ['pagehide', 'resize', 'online']) assert.equal(getEventListeners(f.window, name).length, 0, name);
  assert.equal(getEventListeners(f.document, 'visibilitychange').length, 0);
  f.window.dispatchEvent(new Event('pagehide'));
  unmount();
  assert.equal(raw.destroyCalls, 1, 'pagehide followed by effect cleanup is idempotent');
  assert.deepEqual(f.host.children, [f.unrelated]);
  assert.deepEqual(f.errors, []);
});

test('pagehide aborts an in-progress mount and disposes an uncancellable late factory result', async () => {
  const f = fixture(), unmount = f.useView();
  await flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].signal.aborted, false);
  f.window.dispatchEvent(new Event('pagehide'));
  await flush();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.timers.size, 0, 'the original initialization deadline is released');
  assert.equal(f.subscriptions.size, 0);
  assert.equal(f.fallbacks.length, 0, 'departing the page must not mount a replacement fallback');
  const late = f.view('late-after-pagehide');
  f.requests[0].resolve(late);
  await flush();
  assert.equal(late.destroyCalls, 1);
  assert.equal(f.context.__SP_VIEW__ ?? null, null, 'a late continuation cannot publish a destroyed owner');
  assert.deepEqual(f.host.children, [f.unrelated]);
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.errors, []);
  unmount();
  assert.equal(late.destroyCalls, 1);
});

test('an unmounted owner removes pagehide and stale cleanup cannot destroy a replacement owner', async () => {
  const f = fixture(), firstUnmount = f.useView();
  await flush();
  const first = f.view('first');
  f.requests[0].resolve(first);
  await flush();
  const [stalePagehide] = getEventListeners(f.window, 'pagehide');
  assert.equal(typeof stalePagehide, 'function');
  firstUnmount();
  assert.equal(first.destroyCalls, 1);
  assert.equal(getEventListeners(f.window, 'pagehide').length, 0);
  const secondUnmount = f.useView();
  await flush();
  const second = f.view('replacement');
  f.requests[1].resolve(second);
  await flush();
  const replacement = f.context.__SP_VIEW__;
  stalePagehide(); // A previously queued old-owner callback must also be harmless.
  firstUnmount();
  assert.equal(f.context.__SP_VIEW__, replacement);
  assert.equal(second.destroyCalls, 0);
  assert.equal(f.subscriptions.size, 1);
  assert.deepEqual(f.host.children, [f.unrelated, second.node]);
  f.window.dispatchEvent(new Event('pagehide'));
  assert.equal(second.destroyCalls, 1, 'only the still-mounted owner responds to the new pagehide');
  assert.equal(f.context.__SP_VIEW__, null);
  secondUnmount();
  assert.equal(second.destroyCalls, 1);
  assert.equal(f.subscriptions.size, 0);
});

test('disposing one owner preserves a global hook published by a different active owner', async () => {
  const f = fixture(), firstUnmount = f.useView();
  await flush();
  const first = f.view('first');
  f.requests[0].resolve(first);
  await flush();
  const secondUnmount = f.useView();
  await flush();
  const second = f.view('second');
  f.requests[1].resolve(second);
  await flush();
  const replacement = f.context.__SP_VIEW__;
  firstUnmount();
  assert.equal(f.context.__SP_VIEW__, replacement);
  assert.equal(first.destroyCalls, 1);
  assert.equal(second.destroyCalls, 0);
  assert.equal(f.subscriptions.size, 1);
  secondUnmount();
  assert.equal(f.context.__SP_VIEW__, null);
  assert.equal(second.destroyCalls, 1);
});
