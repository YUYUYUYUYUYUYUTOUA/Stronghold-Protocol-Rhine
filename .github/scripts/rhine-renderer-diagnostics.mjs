// Draft-only navigation evidence. Run with the payload's Node; write every artifact outside the payload.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--payload', '--output', '--browser'].includes(process.argv[i]) && process.argv[i + 1]);
  flags.set(process.argv[i], process.argv[i + 1]);
}
assert.ok(flags.has('--payload') && flags.has('--output') && flags.has('--browser'));
const payload = fs.realpathSync(flags.get('--payload'));
const output = path.resolve(flags.get('--output'));
const relative = path.relative(payload, output);
assert.ok(relative && (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)), 'Diagnostics must be outside the payload.');
fs.mkdirSync(output, { recursive: true });
const files = {
  report: path.join(output, 'renderer-diagnostics.json'),
  events: path.join(output, 'renderer-diagnostics.jsonl'),
  stderr: path.join(output, 'renderer-diagnostics-stderr.log'),
  netlog: path.join(output, 'renderer-diagnostics-netlog.json'),
};
for (const file of [files.events, files.stderr]) fs.writeFileSync(file, '');
const began = Date.now();
const report = { status: 'diagnostics-only', createdAt: new Date().toISOString(), payload, platform: process.platform,
  node: process.version, browserExecutable: flags.get('--browser'), visualAssertionsRun: false, complete: false,
  executionContext: 'Fresh payload immediately after build, before native regression, source-author, host and simulation acceptance.',
  limitation: 'Fresh navigation success cannot exclude ordering or resource effects after the normal acceptance pipeline.',
  limits: { totalMs: 240000, navigationMs: 30000, healthMs: 5000, cdpMs: 5000 }, navigations: [], health: [] };
function emit(event, details = {}) {
  const line = JSON.stringify({ ms: Date.now() - began, event, ...details });
  fs.appendFileSync(files.events, line + '\n');
  console.log(line);
}
const errorOf = error => ({ name: error?.name, message: String(error?.message || error), code: error?.code, stack: error?.stack });
function bounded(promise, ms, label) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: diagnostic limit ${ms}ms`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
let srv, browser, browserProcess;
async function health(label) {
  const at = Date.now(), sample = { label };
  try {
    const response = await fetch(`${srv.url}/healthz`, { signal: AbortSignal.timeout(5000) });
    Object.assign(sample, { status: response.status, body: await response.text(), elapsedMs: Date.now() - at });
  } catch (error) { Object.assign(sample, { error: errorOf(error), elapsedMs: Date.now() - at }); }
  report.health.push(sample); emit('node-health', sample);
}
async function run() {
  // Resolve both imports from the verified payload, never from this automation checkout's dependencies.
  const require = createRequire(pathToFileURL(path.join(payload, 'package.json')));
  const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
  const { startServer } = await import(pathToFileURL(path.join(payload, 'server/index.js')).href);
  srv = await bounded(startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, studio: false }), 30000, 'server startup');
  report.serverUrl = srv.url; emit('server-started', { url: srv.url });
  srv.server.on('connection', socket => emit('server-connection', { remoteAddress: socket.remoteAddress, remotePort: socket.remotePort }));
  srv.server.on('request', (request, response) => {
    const at = Date.now(); emit('server-request', { method: request.method, url: request.url });
    response.on('finish', () => emit('server-response-finished', { url: request.url, status: response.statusCode, elapsedMs: Date.now() - at }));
    response.on('close', () => { if (!response.writableFinished) emit('server-response-closed', { url: request.url, elapsedMs: Date.now() - at }); });
  });
  await health('before-browser');
  // Only net-log collection is added to the failing tests' launch arguments; no GPU/proxy flags change.
  browser = await puppeteer.launch({ executablePath: flags.get('--browser'), headless: true, dumpio: true,
    args: ['--no-sandbox', `--log-net-log=${files.netlog}`] });
  browserProcess = browser.process();
  browserProcess?.stderr?.on('data', chunk => fs.appendFileSync(files.stderr, chunk));
  browserProcess?.on('exit', (code, signal) => emit('browser-exit', { code, signal }));
  browser.on('disconnected', () => emit('browser-disconnected'));
  report.browserArgs = browserProcess?.spawnargs;
  try { report.browserVersion = await bounded(browser.version(), 5000, 'browser version'); }
  catch (error) { report.browserVersionError = errorOf(error); }
  emit('browser-launched', { version: report.browserVersion, args: report.browserArgs, pid: browserProcess?.pid });
  const page = await bounded(browser.newPage(), 10000, 'new page');
  page.on('error', error => emit('page-crashed', errorOf(error)));
  page.on('pageerror', error => emit('page-error', errorOf(error)));
  page.on('console', message => emit('page-console', { type: message.type(), text: message.text() }));
  page.on('request', request => { if (request.url().startsWith(srv.url)) emit('browser-request', { url: request.url(), resourceType: request.resourceType(), navigation: request.isNavigationRequest() }); });
  page.on('response', response => { if (response.url().startsWith(srv.url)) emit('browser-response', { url: response.url(), status: response.status(), fromCache: response.fromCache() }); });
  page.on('requestfinished', request => { if (request.url().startsWith(srv.url)) emit('browser-request-finished', { url: request.url() }); });
  page.on('requestfailed', request => emit('browser-request-failed', { url: request.url(), failure: request.failure() }));
  page.on('framenavigated', frame => emit('frame-navigated', { url: frame.url(), main: frame === page.mainFrame() }));
  page.on('domcontentloaded', () => emit('domcontentloaded', { url: page.url() }));
  page.on('load', () => emit('load', { url: page.url() }));
  const cdp = await bounded(page.createCDPSession(), 5000, 'CDP session');
  cdp.on('Page.lifecycleEvent', event => emit('cdp-lifecycle', event));
  await cdp.send('Page.enable', {}, { timeout: 5000 });
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }, { timeout: 5000 });
  const demo = '/dev/render-demo.html?scene=prep&paused=1&board=2d&quality=low&panel=0';
  const cases = [['/healthz', 'load', null], ['/healthz', 'domcontentloaded', null], ['/sim/spec.js', 'load', null],
    ['/healthz', 'load', { width: 1800, height: 1040 }], ['/healthz', 'domcontentloaded', { width: 1800, height: 1040 }],
    [demo, 'load', { width: 1200, height: 800 }], [demo, 'domcontentloaded', { width: 1200, height: 800 }]];
  report.plannedNavigations = cases.map(([url, waitUntil, viewport]) => ({ url: srv.url + url, waitUntil, viewport: viewport || 'Puppeteer default; no setViewport' }));
  for (const [relativeUrl, waitUntil, viewport] of cases) {
    const sample = { url: srv.url + relativeUrl, waitUntil, viewport: viewport || 'Puppeteer default; no setViewport' };
    report.navigations.push(sample);
    if (viewport) {
      emit('viewport-start', { viewport });
      try { await bounded(page.setViewport(viewport), 5000, 'setViewport'); emit('viewport-applied', { viewport: page.viewport() }); }
      catch (error) { sample.viewportError = errorOf(error); emit('viewport-error', sample.viewportError); }
    }
    try { sample.layoutMetrics = await cdp.send('Page.getLayoutMetrics', {}, { timeout: 5000 }); emit('layout-metrics', { viewport: sample.viewport, metrics: sample.layoutMetrics }); }
    catch (error) { sample.layoutMetricsError = errorOf(error); emit('layout-metrics-error', sample.layoutMetricsError); }
    await health(`before:${relativeUrl}:${waitUntil}`);
    const at = Date.now(); emit('navigation-start', sample);
    try {
      // The load variant deliberately retains page.goto's default wait condition and original 30-second limit.
      const response = await page.goto(sample.url, waitUntil === 'load' ? { timeout: 30000 } : { timeout: 30000, waitUntil });
      Object.assign(sample, { status: response?.status(), elapsedMs: Date.now() - at, outcome: 'navigation-completed' });
    } catch (error) { Object.assign(sample, { error: errorOf(error), elapsedMs: Date.now() - at, outcome: 'navigation-failed' }); }
    emit('navigation-result', sample);
    // A hung renderer must not prevent Node from proving whether its HTTP server is still responsive.
    await health(`after:${relativeUrl}:${waitUntil}`);
    try {
      const state = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `({readyState:document.readyState,href:location.href,title:document.title,canvases:document.querySelectorAll('canvas').length,pixiVersion:globalThis.PIXI?.VERSION,demoReady:!!globalThis.__demo?.ready,demoError:globalThis.__demo?.error,demoLog:globalThis.__demo?.log})` }, { timeout: 5000 });
      sample.document = state.result?.value; sample.exception = state.exceptionDetails;
      emit('document-state', { url: sample.url, waitUntil, ...sample.document, exception: sample.exception });
    } catch (error) { sample.documentError = errorOf(error); emit('document-state-error', sample.documentError); }
    if (sample.outcome === 'navigation-failed') {
      try { await cdp.send('Page.stopLoading', {}, { timeout: 5000 }); emit('navigation-stopped'); }
      catch (error) { emit('navigation-stop-error', errorOf(error)); }
    }
  }
  report.complete = true;
}
emit('diagnostics-started', { payload, output, limits: report.limits });
try {
  // Reserve ten seconds within the publisher's 240-second ceiling for cleanup and durable output.
  await bounded(run(), 230000, 'overall diagnostics');
} catch (error) { report.error = errorOf(error); emit('diagnostics-error', report.error); }
finally {
  const cleanup = await Promise.allSettled([
    bounded(browser?.close(), 5000, 'browser cleanup'),
    bounded(srv?.close(), 5000, 'server cleanup'),
  ]);
  report.cleanup = cleanup.map(result => result.status === 'fulfilled' ? { status: result.status } : { status: result.status, error: errorOf(result.reason) });
  if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
    if (process.platform === 'win32') {
      const killed = spawnSync('taskkill', ['/PID', String(browserProcess.pid), '/T', '/F'], { windowsHide: true, timeout: 2500 });
      emit('browser-tree-cleanup', { pid: browserProcess.pid, status: killed.status, error: killed.error && errorOf(killed.error) });
    } else { browserProcess.kill('SIGKILL'); emit('browser-force-cleanup', { pid: browserProcess.pid }); }
  }
  report.elapsedMs = Date.now() - began;
  fs.writeFileSync(files.report, JSON.stringify(report, null, 2) + '\n');
  emit('diagnostics-finished', { complete: report.complete, elapsedMs: report.elapsedMs, report: files.report, visualAssertionsRun: false });
}
// A timed-out CDP operation must not keep this standalone evidence collector alive after cleanup.
process.stdout.write('', () => process.exit(0));
