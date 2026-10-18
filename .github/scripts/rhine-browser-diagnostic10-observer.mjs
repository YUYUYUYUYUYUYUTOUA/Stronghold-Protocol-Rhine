// Diagnostic preload only. Calls the original launch/newPage/open exactly once and returns their original outcome.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const source = process.env.RHINE_DIAGNOSTIC_SOURCE;
const output = process.env.RHINE_DIAGNOSTIC_OUTPUT;
if (!source || !output) throw new Error('Diagnostic source/output are required.');
fs.mkdirSync(output, { recursive: true });
const eventsFile = path.join(output, `browser-events-${process.pid}.jsonl`);
const printedLimit = 1000;
let printed = 0, droppedFromStdout = 0;
const critical = new Set(['renderer-phase', 'Network.loadingFailed', 'requestfailed', 'Client.open-failure',
  'Client.open-failure-document-snapshot', 'Client.open-failure-snapshot-error', 'Client.close-document-snapshot',
  'Client.close-diagnostic-error', 'pageerror', 'page-crash', 'cdp-observer-error']);
const emit = (event, data = {}) => {
  try {
    const record = { at: new Date().toISOString(), nodePid: process.pid, event, ...data };
    fs.appendFileSync(eventsFile, JSON.stringify(record) + '\n');
    if (critical.has(event)) {
      if (printed < printedLimit) { printed++; console.log('[rhine-diagnostic-event]', JSON.stringify(record)); }
      else {
        droppedFromStdout++;
        if (droppedFromStdout === 1) console.log('[rhine-diagnostic-event-limit]', JSON.stringify({
          nodePid: process.pid, printedLimit, note: 'Further critical records remain complete in browser-events JSONL artifact.' }));
      }
    }
  }
  catch (error) { console.error('[diagnostic-observer-write-failed]', error.message); }
};
const errorOf = error => ({ name: error?.name, message: String(error?.message || error), code: error?.code, stack: error?.stack });
const observed = new WeakSet();
const sessions = new WeakMap();
async function readDocument(page) {
  const cdp = page && sessions.get(page);
  if (!cdp || page.isClosed()) return { diagnostic: 'no open observed page' };
  const result = await cdp.send('Runtime.evaluate', { returnByValue: true,
    expression: `(() => { const trace=globalThis.__SP_RENDER_INIT_DIAGNOSTICS__; return {
      href:location.href, readyState:document.readyState, appReady:!!globalThis.__SP__,
      rendererTrace:trace ? {events:[...trace],dropped:trace.dropped,nextAttempt:trace.nextAttempt} : null}; })()` },
  { timeout: 1000 });
  return { snapshot: result.result?.value, exceptionDetails: result.exceptionDetails };
}
async function observePage(page, browser) {
  if (observed.has(page)) return;
  observed.add(page);
  const owner = { browserPid: browser.process()?.pid, targetId: page.target()._targetId };
  emit('page-created', owner);
  page.on('console', message => {
    if (message.text().startsWith('[render-init-phase]')) emit('renderer-phase', { ...owner, text: message.text() });
  });
  page.on('requestfailed', request => emit('requestfailed', { ...owner, url: request.url(),
    resourceType: request.resourceType(), failure: request.failure() }));
  page.on('pageerror', error => emit('pageerror', { ...owner, error: errorOf(error) }));
  page.on('error', error => emit('page-crash', { ...owner, error: errorOf(error) }));
  try {
    const cdp = await page.createCDPSession();
    sessions.set(page, cdp);
    const requests = new Map();
    cdp.on('Network.requestWillBeSent', event => {
      requests.set(event.requestId, { url: event.request.url, type: event.type, timestamp: event.timestamp });
    });
    cdp.on('Network.loadingFinished', event => requests.delete(event.requestId));
    cdp.on('Network.loadingFailed', event => {
      emit('Network.loadingFailed', { ...owner, request: requests.get(event.requestId), ...event });
      requests.delete(event.requestId);
    });
    await cdp.send('Network.enable');
    page.once('close', () => { requests.clear(); cdp.detach().catch(() => {}); emit('page-closed', owner); });
  } catch (error) { emit('cdp-observer-error', { ...owner, error: errorOf(error) }); }
}
const require = createRequire(path.join(source, 'package.json'));
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
const launch = puppeteer.launch;
puppeteer.launch = async function (...args) {
  const browser = await launch.apply(this, args);
  emit('browser-launched', { pid: browser.process()?.pid, args: browser.process()?.spawnargs });
  const wrapContext = context => {
    const newPage = context.newPage;
    context.newPage = async function (...pageArgs) {
      const page = await newPage.apply(this, pageArgs);
      await observePage(page, browser);
      return page;
    };
    return context;
  };
  const createContext = browser.createBrowserContext;
  browser.createBrowserContext = async function (...contextArgs) { return wrapContext(await createContext.apply(this, contextArgs)); };
  const newPage = browser.newPage;
  browser.newPage = async function (...pageArgs) {
    const page = await newPage.apply(this, pageArgs);
    await observePage(page, browser);
    return page;
  };
  for (const page of await browser.pages()) await observePage(page, browser);
  browser.once('disconnected', () => emit('browser-disconnected', { pid: browser.process()?.pid }));
  return browser;
};
const { Client } = await import(pathToFileURL(path.join(source, 'test/e2e/client.mjs')).href);
const open = Client.prototype.open;
Client.prototype.open = async function (...args) {
  emit('Client.open-start', { client: this.label, base: this.base, args });
  try {
    const result = await open.apply(this, args);
    emit('Client.open-success', { client: this.label, url: this.page?.url(), problems: this.problems });
    return result;
  } catch (error) {
    const browserPid = this.browser?.process()?.pid;
    emit('Client.open-failure', { client: this.label, browserPid, url: this.page?.url(), problems: this.problems, error: errorOf(error) });
    // Parent samples the VM when it receives this event. No recovery, changed error or retry.
    console.error('[rhine-diagnostic-failure]', JSON.stringify({ at: new Date().toISOString(),
      client: this.label, browserPid, error: errorOf(error), problems: this.problems }));
    try { emit('Client.open-failure-document-snapshot', { client: this.label, browserPid, ...await readDocument(this.page) }); }
    catch (diagnosticError) { emit('Client.open-failure-snapshot-error', { client: this.label, browserPid,
      error: errorOf(diagnosticError) }); }
    throw error;
  }
};
emit('observer-installed', { source, preload: import.meta.url });
const close = Client.prototype.close;
Client.prototype.close = async function (...args) {
  const cdp = this.page && sessions.get(this.page);
  if (cdp && !this.page.isClosed()) {
    try {
      // Read only at fixture cleanup. This collector's 1 s CDP limit never changes a game/test deadline.
      emit('Client.close-document-snapshot', { client: this.label, ...await readDocument(this.page) });
    } catch (error) { emit('Client.close-diagnostic-error', { client: this.label, error: errorOf(error) }); }
  }
  return close.apply(this, args);
};
process.once('beforeExit', () => {
  const summary = { nodePid: process.pid, printedLimit, printed, droppedFromStdout,
    artifactBoundary: 'Full event records were written to browser-events JSONL; stdout critical-event output is bounded.' };
  fs.appendFileSync(eventsFile, JSON.stringify({ event: 'stdout-event-summary', ...summary }) + '\n');
  console.log('[rhine-diagnostic-event-summary]', JSON.stringify(summary));
});
