// Mechanism fixtures keep the real renderer and isolated simulation Workers, using the public graphics controls.
// Dedicated renderer tests cover official effects at their original settings. Observations below never change a
// Worker call, its timeout, result or failure callback, or any server/gameplay deadline.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const WORKER_EVENT = '[mechanism-worker] ';

export async function configureMechanismGraphics(client) {
  await client.click('[data-testid="settings-btn"]');
  await client.page.waitForSelector('.modal .set-list');
  await client.page.$eval('.modal .set-list', list => {
    const low = [...list.querySelectorAll('button[role="radio"]')].find(button => button.textContent.trim() === '低');
    if (!low) throw new Error('the low-quality radio is missing from settings');
    low.scrollIntoView({ block: 'center' });
  });
  await client.click('.modal button[role="radio"]', '低');
  assert.equal(await client.page.$eval('.modal .set-list', list =>
    [...list.querySelectorAll('button[role="radio"]')].find(button => button.textContent.trim() === '低').getAttribute('aria-checked')), 'true');
  await client.page.waitForSelector('.modal [data-testid="official-fx"]');
  await client.page.$eval('.modal [data-testid="official-fx"]', group => {
    const off = [...group.querySelectorAll('button[role="radio"]')].find(button => button.textContent.trim() === '关');
    if (!off) throw new Error('the official-effects off radio is missing from settings');
    off.scrollIntoView({ block: 'center' });
  });
  await client.click('.modal [data-testid="official-fx"] button[role="radio"]', '关');
  assert.equal(await client.page.$eval('.modal [data-testid="official-fx"]', group =>
    [...group.querySelectorAll('button[role="radio"]')].find(button => button.textContent.trim() === '关').getAttribute('aria-checked')), 'true');
  await client.click('.modal__actions button', '完成');
  const settings = await client.page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sp.pref.settings'));
    return { quality: s.quality, officialFx: s.officialFx, width: innerWidth, height: innerHeight };
  });
  assert.equal(settings.quality, 'low');
  assert.equal(settings.officialFx, 'off');
  assert.equal(settings.width, client.w);
  assert.equal(settings.height, client.h);
  console.log('Mechanism graphics:', JSON.stringify({ client: client.label, ...settings }));
}

export async function observeMechanismBrowser(client) {
  const pending = new Map(), counts = {}, workerEvents = [];
  const category = url => {
    const pathname = new URL(url).pathname;
    return pathname.includes('/assets/local/fx/') ? 'officialFx'
      : /\/(?:sim|cs)\//.test(pathname) || pathname.endsWith('/js/battle/simWorker.js') ? 'simulation'
        : /\.(?:glb|gltf|skel)(?:$|\?)/i.test(pathname) ? 'models' : 'other';
  };
  client.mechanismResources = { counts, pending, workerEvents };
  client.page.on('request', request => {
    const kind = category(request.url());
    const count = counts[kind] ||= { requested: 0, finished: 0, failed: 0 };
    count.requested++;
    pending.set(request, { url: request.url(), kind, at: Date.now() });
  });
  const ended = (request, field) => {
    const entry = pending.get(request);
    if (entry) { counts[entry.kind][field]++; pending.delete(request); }
  };
  client.page.on('requestfinished', request => ended(request, 'finished'));
  client.page.on('requestfailed', request => ended(request, 'failed'));
  client.page.on('console', message => {
    if (!message.text().startsWith(WORKER_EVENT)) return;
    try {
      workerEvents.push(JSON.parse(message.text().slice(WORKER_EVENT.length)));
      if (workerEvents.length > 100) workerEvents.shift();
    } catch { /* Diagnostic transport must not change the page's behavior. */ }
  });
  await client.page.evaluate(async prefix => {
    if (globalThis.__SP_MECHANISM_WORKERS__) return;
    const trace = globalThis.__SP_MECHANISM_WORKERS__ = { rpc: [], failures: [] };
    const { WorkerSimHost } = await import('/js/battle/simHost.js');
    const hosts = new WeakMap(), rpc = WorkerSimHost.prototype.rpc;
    let sequence = 0;
    const failure = error => ({ code: error?.code ?? null, message: String(error?.message || error), stack: error?.stack ?? null });
    const report = event => { try { console.log(prefix + JSON.stringify(event)); } catch { /* Passive only. */ } };
    WorkerSimHost.prototype.rpc = function (...args) {
      if (!hosts.has(this)) {
        hosts.set(this, ++sequence);
        const onFailure = this.onFailure;
        this.onFailure = function (...failureArgs) {
          try {
            const event = { at: performance.now(), workerId: hosts.get(this), type: 'onFailure',
              battleId: this.spec?.battleId, cs: this.cs, ...failure(failureArgs[0]) };
            trace.failures.push(event); report(event);
          } catch { /* Always call the original failure callback. */ }
          return onFailure.apply(this, failureArgs);
        };
      }
      const [method, values = [], timeoutMs] = args;
      const event = { at: performance.now(), workerId: hosts.get(this), method, cs: this.cs,
        battleId: values[0]?.battleId ?? this.spec?.battleId, timeoutMs: timeoutMs ?? this.timeoutMs };
      const important = !['step', 'unitStats'].includes(method);
      if (important) { trace.rpc.push(event); report({ ...event, type: 'rpc-start' }); }
      const result = rpc.apply(this, args);
      const finish = error => {
        try {
          event.durationMs = performance.now() - event.at;
          event.status = error ? 'error' : 'done';
          if (error) Object.assign(event, failure(error));
          if (!important && error) trace.rpc.push(event);
          if (important || error) report({ ...event, type: 'rpc-end' });
          if (trace.rpc.length > 100) trace.rpc.splice(0, trace.rpc.length - 100);
        } catch { /* Return the untouched production promise even if diagnostics fail. */ }
      };
      result.then(() => finish(), error => finish(error));
      return result;
    };
  }, WORKER_EVENT);
}

export function mechanismResourceSnapshot(client) {
  const resources = client.mechanismResources;
  return resources && { counts: resources.counts, workerEvents: resources.workerEvents,
    pending: [...resources.pending.values()].map(({ at, ...entry }) => ({ ...entry, ageMs: Date.now() - at })) };
}

export function readMechanismBrowser(client) {
  return client.page.evaluate(async () => {
    const { errorLog, trafficSummary } = await import('/js/diag.js');
    const view = globalThis.__SP_VIEW__;
    let stats;
    try { stats = view?.raw?.stats?.(); } catch (error) { stats = { diagnosticError: error.message }; }
    return { workers: globalThis.__SP_MECHANISM_WORKERS__, errors: errorLog(), traffic: trafficSummary(),
      graphics: JSON.parse(localStorage.getItem('sp.pref.settings')), view: { kind: view?.kind, stats },
      contextLost: view?.raw?.debug?.app?.renderer?.gl?.isContextLost?.() };
  });
}

export function startMechanismServerDiagnostics() {
  const samples = [];
  let previousAt = performance.now(), previousCpu = process.cpuUsage(), maxLagMs = 0, maxLagSample = null;
  const timer = setInterval(() => {
    const now = performance.now(), cpu = process.cpuUsage(), elapsedMs = now - previousAt;
    const lagMs = Math.max(0, elapsedMs - 1000);
    const sample = { at: Date.now(), elapsedMs, lagMs,
      parentCpuUserMs: (cpu.user - previousCpu.user) / 1000, parentCpuSystemMs: (cpu.system - previousCpu.system) / 1000 };
    if (lagMs > maxLagMs) { maxLagMs = lagMs; maxLagSample = sample; }
    samples.push(sample);
    if (samples.length > 20) samples.shift();
    previousAt = now; previousCpu = cpu;
  }, 1000);
  timer.unref();
  return { stop() { clearInterval(timer); }, snapshot() { return { scope: 'test-and-http-parent-only', maxLagMs, maxLagSample, samples }; } };
}
