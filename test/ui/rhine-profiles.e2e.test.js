// Real Chrome pages exercise room settings, profile-specific loadouts, reconnect and normal client-side combat.
// Opt-in: SP_E2E=1 CHROME_PATH=... node --test test/ui/rhine-profiles.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { constants as osConstants, getPriority, setPriority } from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, startRealServer, problemsOf, waitForFunctionLong } from '../e2e/client.mjs';
import { createMechanismBrowserPool, observeMechanismVisibility, assertMechanismVisibility,
  readMechanismVisibility } from '../e2e/mechanismGraphics.mjs';
import { getDataProfile } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { compactResult, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const PTILOPSIS = 'chess_char_4_21_a';
const SARIA = 'chess_char_5_11_a';
const MAGALLAN = 'chess_rhine_magallan_a';
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
const profileId = enabled => enabled ? 'rhine' : 'vanilla';
const SOFTWARE_GPU = process.env.SP_E2E_SWIFTSHADER === '1';
const BROWSER_ARGS = SOFTWARE_GPU ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] : [];
// A desktop mechanism viewport, also used by the six-player fixture. Dedicated renderer suites retain their sizes.
// This reduces pixel work without changing any UI/simulation condition, deadline or the real reload Canvas gate.
const VIEWPORT = { width: 1280, height: 720 };
const ISOLATION_KEY = '__sp_e2e_rhine_profile_context';
const scheduledBrowsers = new WeakMap();

function installProfileResourceTiming() {
  performance.setResourceTimingBufferSize(5000);
  globalThis.__SP_PROFILE_RESOURCE_TIMING__ = () => {
    const resources = performance.getEntriesByType('resource');
    return { requestedBufferSize: 5000, documentId: String(performance.timeOrigin), totalCount: resources.length,
      entries: resources.filter(entry => /\/js\/render\/|pixi|three|manifest|font|board|\/data\/(?:local-)?assets|\/cs\/[^/]+\/index\.json/i.test(entry.name))
        .slice(-120).map(entry => {
          const url = new URL(entry.name, location.href);
          return { path: `${url.origin === location.origin ? '' : url.origin}${url.pathname}${url.search}`,
            initiatorType: entry.initiatorType, startTime: entry.startTime, duration: entry.duration,
            fetchStart: entry.fetchStart, domainLookupStart: entry.domainLookupStart, domainLookupEnd: entry.domainLookupEnd,
            connectStart: entry.connectStart, connectEnd: entry.connectEnd, secureConnectionStart: entry.secureConnectionStart,
            requestStart: entry.requestStart, responseStart: entry.responseStart, responseEnd: entry.responseEnd,
            transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize };
        }) };
  };
}

async function openClient(client, query) {
  await client.open(query);
  // Passive capture only. The early-document hook covers reloads, including their cold render-module requests.
  await client.page.evaluateOnNewDocument(installProfileResourceTiming);
  await client.page.evaluate(installProfileResourceTiming);
  assert.deepEqual(client.page.viewport(), VIEWPORT, `${client.label}: the configured viewport is desktop 1280x720`);
  const actualViewport = await client.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.deepEqual(actualViewport, VIEWPORT, `${client.label}: the real document has the configured desktop dimensions`);
  console.log('Profile actual viewport:', JSON.stringify({ client: client.label, ...actualViewport }));
  assert.ok(client.browserContext?.id, `${client.label}: this player owns a browser context`);
  assert.equal(client.page.browserContext(), client.browserContext);
  await observeMechanismVisibility(client);
  const untouched = await client.page.evaluate(key => ({ local: localStorage.getItem(key), session: sessionStorage.getItem(key),
    cookie: document.cookie.split('; ').find(cookie => cookie.startsWith(`${key}=`)) ?? null }), ISOLATION_KEY);
  assert.deepEqual(untouched, { local: null, session: null, cookie: null }, `${client.label}: another context's markers are absent`);
  // These namespaced markers never touch the game's identity, settings, profile or simulation state.
  await client.page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
    document.cookie = `${key}=${value}; Path=/; SameSite=Lax`;
  }, { key: ISOLATION_KEY, value: client.label });
  if (!SOFTWARE_GPU) return;
  const cdp = await client.browser.target().createCDPSession();
  try {
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    const renderer = gpu.auxAttributes.glRenderer;
    assert.match(renderer, /SwiftShader/i, 'the requested software backend is actually active');
    assert.equal(gpu.featureStatus.gpu_compositing, 'disabled_software', 'software WebGL keeps GPU compositing disabled');
    if (!['win32', 'linux'].includes(process.platform)) return;
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const owned = processInfo.filter(p => /^gpu$/i.test(p.type));
    assert.equal(owned.length, 1, 'one owned browser GPU process');
    const nodePriority = getPriority(process.pid), priority = osConstants.priority.PRIORITY_NORMAL;
    // One shared software GPU serves these independent contexts. Windows aligns only its CDP-owned GPU to NORMAL;
    // Linux only reads the default GPU priority and never writes process/thread priorities. This controlled scheduling
    // hypothesis changes no Worker load, RPC, renderer lifecycle or deadline.
    const browserPid = client.browser.process()?.pid;
    const allOwned = processInfo.filter(p => /^(?:browser|renderer|gpu)$/i.test(p.type));
    const priorities = () => allOwned.map(p => {
      try { return { pid: p.id, type: p.type, priority: getPriority(p.id) }; }
      catch (error) {
        if (error.info?.code !== 'ESRCH') throw error;
        return { pid: p.id, type: p.type, exitedDuringObservation: true };
      }
    });
    const scheduled = scheduledBrowsers.get(client.browser);
    if (scheduled) {
      assert.equal(browserPid, scheduled.browserPid, 'later contexts use the same owned browser');
      assert.equal(owned[0].id, scheduled.gpuPid, 'later contexts use the same owned GPU');
      assert.equal(getPriority(owned[0].id), priority, 'the shared GPU retains its rendering priority');
      assert.equal(nodePriority, scheduled.nodePriority, 'the test and simulation priority stays unchanged');
      console.log('Profile shared owned priorities read-only:', JSON.stringify({ client: client.label, browserPid,
        node: { pid: process.pid, priority: nodePriority }, owned: priorities(), renderer }));
      return;
    }
    let before;
    if (process.platform === 'win32') {
      assert.ok(Number.isInteger(browserPid), 'the fixture owns its launched browser process');
      assert.ok(allOwned.some(p => /^browser$/i.test(p.type) && p.id === browserPid), 'CDP confirms this browser ownership');
      assert.notEqual(owned[0].id, process.pid);
      assert.notEqual(owned[0].id, browserPid);
      assert.equal(nodePriority, osConstants.priority.PRIORITY_NORMAL, 'the Windows test Node remains NORMAL');
      assert.equal(priority, 0, 'Windows NORMAL is the owned GPU target');
      before = priorities();
      console.log('Profile Windows owned priorities before:', JSON.stringify({ client: client.label,
        node: { pid: process.pid, priority: nodePriority }, browserPid, owned: before }));
    }
    for (const gpuProcess of owned) {
      if (process.platform === 'win32' && getPriority(gpuProcess.id) !== priority) setPriority(gpuProcess.id, priority);
      assert.equal(getPriority(gpuProcess.id), priority, 'owned software GPU has the requested rendering priority');
      assert.equal(getPriority(process.pid), nodePriority, 'the test and simulation priority stays unchanged');
      console.log(JSON.stringify({ client: client.label, gpuPid: gpuProcess.id, renderer,
        gpuPriority: getPriority(gpuProcess.id), nodePriority,
        priorityPolicy: process.platform === 'linux' ? 'default-read-only' : 'owned-GPU-NORMAL' }));
    }
    if (process.platform === 'win32') {
      const after = priorities();
      console.log('Profile Windows owned priorities after:', JSON.stringify({ client: client.label,
        node: { pid: process.pid, priority: getPriority(process.pid) }, browserPid, owned: after }));
      assert.equal(getPriority(process.pid), osConstants.priority.PRIORITY_NORMAL);
      for (const [index, p] of after.entries()) {
        if (/^gpu$/i.test(p.type)) assert.equal(p.priority, priority, 'only the owned GPU has the rendering target');
        else if (!p.exitedDuringObservation && !before[index].exitedDuringObservation) {
          assert.equal(p.priority, before[index].priority, `owned ${p.type} priority is unchanged`);
        }
      }
    } else {
      console.log('Profile default owned priorities read-only:', JSON.stringify({ client: client.label,
        node: { pid: process.pid, priority: getPriority(process.pid) }, browserPid, owned: priorities() }));
    }
    scheduledBrowsers.set(client.browser, { browserPid, gpuPid: owned[0].id, nodePriority });
  } finally { await cdp.detach(); }
}

async function contextSnapshot(clients) {
  const contextIds = clients.map(client => client.browserContext?.id);
  assert.ok(contextIds.every(Boolean), 'each player owns a browser context');
  assert.equal(new Set(contextIds).size, clients.length, 'the three browser contexts are distinct');
  const observations = await Promise.all(clients.map(async client => {
    assert.equal(client.page.browserContext(), client.browserContext);
    const observed = await client.page.evaluate(key => ({ documentId: String(performance.timeOrigin),
      playerId: globalThis.__SP__.store.get().me.playerId, profile: globalThis.__SP__.data.profileId,
      viewport: { width: innerWidth, height: innerHeight },
      local: localStorage.getItem(key), session: sessionStorage.getItem(key),
      cookie: document.cookie.split('; ').find(cookie => cookie.startsWith(`${key}=`))?.slice(key.length + 1) ?? null }), ISOLATION_KEY);
    assert.deepEqual({ local: observed.local, session: observed.session, cookie: observed.cookie },
      { local: client.label, session: client.label, cookie: client.label }, `${client.label}: storage belongs only to this context`);
    assert.deepEqual(observed.viewport, VIEWPORT, `${client.label}: desktop dimensions remain unchanged across reloads`);
    return { client: client.label, contextId: client.browserContext.id, ...observed };
  }));
  assert.ok(observations.every(observed => observed.playerId), 'every context has a real player identity');
  assert.equal(new Set(observations.map(observed => observed.playerId)).size, clients.length, 'the three player identities are distinct');
  console.log('Profile context isolation:', JSON.stringify(observations));
  return observations;
}

function assertReloadIsolation(before, after, reloaded) {
  for (const [index, old] of before.entries()) {
    const current = after[index];
    const { documentId: oldDocument, ...oldStable } = old, { documentId: currentDocument, ...currentStable } = current;
    assert.deepEqual(currentStable, oldStable, `${old.client}: reload preserves context, storage, identity and profile`);
    if (old.client === reloaded.label) assert.notEqual(currentDocument, oldDocument, 'reload creates a new document realm');
    else assert.equal(currentDocument, oldDocument, `${old.client}: another context's reload does not replace this document`);
  }
}

function observeImageReplacement(client) {
  client.replacedImageRequests = new Set();
  client.pendingRequests = new Map();
  client.fieldWarnings = [];
  client.page.on('request', request => client.pendingRequests.set(request,
    { url: request.url(), type: request.resourceType(), at: Date.now() }));
  client.page.on('requestfinished', request => client.pendingRequests.delete(request));
  client.page.on('console', message => {
    if (message.type() === 'warn' && message.text().startsWith('[field]')) client.fieldWarnings.push(message.text());
  });
  client.page.on('requestfailed', request => {
    client.pendingRequests.delete(request);
    const error = request.failure()?.errorText;
    // Search replaces portrait/skill DOM nodes. Chrome intentionally cancels those image requests; other resource
    // failures, and image failures outside the explicit replacement, still fail this test.
    if (client.replacingImages && request.resourceType() === 'image' && error === 'net::ERR_ABORTED'
      && request.url().startsWith(`${client.base}/assets/`)) {
      client.replacedImageRequests.add(`${client.label}: requestfailed: ${request.url()} ${error}`);
    }
  });
}
const pageProblems = clients => problemsOf(clients).filter(problem => !clients.some(client => client.replacedImageRequests?.has(problem)));

async function observeRoomProfile(client) {
  await client.page.evaluate(() => {
    const trace = globalThis.__profileRoom = { inputs: [], requests: [], replies: [], states: [] };
    const net = globalThis.__SP__.net, send = net._sendRaw.bind(net);
    net._sendRaw = msg => {
      const sent = send(msg);
      if (msg.t === 'room.setRhine') trace.requests.push({ at: performance.now(), rid: msg.rid, enabled: msg.enabled, sent });
      return sent;
    };
    net.on('*', msg => {
      if (trace.requests.some(request => request.rid === msg.rid)) {
        trace.replies.push({ at: performance.now(), t: msg.t, rid: msg.rid, code: msg.code, detail: msg.detail });
      }
      if (msg.t === 'room.state') trace.states.push({ at: performance.now(), code: msg.code,
        enabled: msg.rhineEnabled, inMatch: msg.inMatch, phase: msg.phase,
        seats: msg.seats?.filter(Boolean).map(seat => ({ playerId: seat.playerId, ready: seat.ready })) });
    });
    // Observe real input before the room handler. A click in a hidden button's old rect must not look like success.
    const observeInput = event => {
      const buttons = [...document.querySelectorAll('[data-testid="rhine-toggle"] button')];
      const button = buttons.find(button => {
        const r = button.getBoundingClientRect();
        return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      });
      if (!button) return;
      const ancestors = [];
      for (let node = button; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        ancestors.push({ tag: node.tagName, class: node.className, visibility: style.visibility,
          display: style.display, opacity: style.opacity, pointerEvents: style.pointerEvents,
          hidden: node.hidden, inert: node.inert });
      }
      trace.inputs.push({ at: performance.now(), type: event.type, trusted: event.isTrusted,
        target: event.target?.tagName, targetTestId: event.target?.getAttribute?.('data-testid'),
        button: button.dataset.testid, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled,
        visibility: getComputedStyle(button).visibility, loadoutHidden: document.documentElement.classList.contains('sp-loadout-open'),
        statsHidden: document.documentElement.classList.contains('sp-stats-open'), ancestors });
    };
    document.addEventListener('pointerdown', observeInput, true);
    document.addEventListener('click', observeInput, true);
  });
}

async function lowQuality(client) {
  // Use the real graphics control so three software-rendered boards leave time for their real simulation Workers.
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
  // Official effects have a separate setting. Keep their background preload queue out of this profile/Worker fixture;
  // dedicated renderer suites exercise full effects. Configure it before the first match view or battle exists.
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
  assert.equal(await client.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).quality), 'low');
  assert.equal(await client.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).officialFx), 'off');
}

async function waitProfile(client, enabled) {
  await client.page.waitForFunction(enabled => {
    const { store, data } = globalThis.__SP__;
    const s = store.get();
    const id = enabled ? 'rhine' : 'vanilla';
    return s.room?.rhineEnabled === enabled && data.profileId === id && s.ui.dataReady
      && s.ui.dataProfile === id && s.ui.dataGeneration === data.generation && data.isReady('chess', 'bonds', 'config');
  }, { timeout: 30000 }, enabled);
}

async function roomSnapshot(client) {
  return client.page.evaluate(() => {
    const { store, data } = globalThis.__SP__;
    const s = store.get(), pub = s.match.public;
    return { code: s.room?.code, me: s.me.playerId, roomEnabled: s.room?.rhineEnabled, profile: data.profileId,
      generation: data.generation, seats: s.room?.seats?.filter(Boolean), pubEnabled: pub?.rhineEnabled,
      pubProfile: pub?.dataProfile, count: pub?.startingPlayerCount, bans: pub?.openingBans };
  });
}

async function rosterSnapshot(client) {
  return client.page.evaluate(({ ptilopsis, saria, magallan }) => {
    const { data } = globalThis.__SP__;
    const summary = id => {
      const c = data.lookup('chess', id);
      if (!c) return null;
      const g = data.lookup('chess', c.goldenId);
      return { tier: c.tier, garrisons: c.garrisonIds, skill: c.skill.skillId,
        modules: (g?.modules || []).map(m => m.uniEquipId), defaultModule: g?.defaultUniEquipId ?? null };
    };
    return { profile: data.profileId, ptilopsis: summary(ptilopsis), saria: summary(saria), magallan: summary(magallan) };
  }, { ptilopsis: PTILOPSIS, saria: SARIA, magallan: MAGALLAN });
}

async function searchLoadout(client, query) {
  client.replacingImages = true;
  try {
    await client.click('.lo-search input');
    await client.page.keyboard.down('Control');
    await client.page.keyboard.press('KeyA');
    await client.page.keyboard.up('Control');
    await client.page.keyboard.press('Backspace');
    if (query) await client.page.keyboard.type(query);
    await sleep(250);
  } finally { client.replacingImages = false; }
}

async function closeLoadout(client) {
  await client.page.keyboard.press('Escape');
  // Overlay/class removal alone did not prove the room was interactive on Windows: a real click still hit its
  // ancestor DIV while the button's computed visibility was hidden. Keep the original close budget and check hit.
  await client.page.waitForFunction(profileControlPoint, { timeout: 5000 }, '[data-testid="rhine-vanilla"]');
}

function profileControlPoint(selector) {
  if (document.querySelector('.lo') || document.documentElement.classList.contains('sp-loadout-open')) return null;
  const button = document.querySelector(selector);
  if (!button?.isConnected || button.tagName !== 'BUTTON' || button.matches(':disabled')
    || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) return null;
  for (let node = button; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.inert || node.hasAttribute('inert') || style.display === 'none'
      || style.visibility !== 'visible' || Number(style.opacity) <= 0 || style.pointerEvents === 'none'
      || style.contentVisibility === 'hidden') return null;
  }
  const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  if (rect.width < 2 || rect.height < 2 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const hit = document.elementFromPoint(x, y);
  // A containing DIV is the native failure's exact false positive. Only the button or a descendant receives its click.
  return hit && button.contains(hit) ? { x, y, button: button.dataset.testid,
    target: hit.tagName, targetTestId: hit.getAttribute('data-testid') } : null;
}

async function clickProfileControl(client, selector) {
  const handle = await client.page.waitForFunction(profileControlPoint, { timeout: 15000 }, selector);
  try {
    const point = await handle.jsonValue();
    console.log(JSON.stringify({ client: client.label, profileClickPoint: point }));
    // Exactly one trusted mouse click; no scripted DOM click, network shortcut or retry after missing acknowledgement.
    await client.page.mouse.click(point.x, point.y);
  } finally { await handle.dispose(); }
}

async function createCoop(client, name) {
  await openClient(client);
  observeImageReplacement(client);
  await observeRoomProfile(client);
  await client.enter(name);
  await lowQuality(client);
  await client.click('.mode-card', '同盟模拟');
  await client.click('.diff-card', '标准模拟');
  await client.click('.create-box button', '创建同盟');
  await client.waitFor(s => !!s.room?.code, 'room created');
  await waitProfile(client, true);
  return (await roomSnapshot(client)).code;
}

async function fillBots(client, count) {
  for (let n = 1; n <= count; n++) {
    await client.click('.seat--empty button', '添加 AI 队友');
    await client.page.waitForFunction(n => document.querySelectorAll('.seat.is-bot').length === n, {}, n);
  }
}

async function assertRejected(client, type, fields, code) {
  const result = await client.page.evaluate(async (type, fields) => {
    try { await globalThis.__SP__.net.request(type, fields); return { accepted: true }; }
    catch (error) { return { accepted: false, code: error.code }; }
  }, type, fields);
  assert.deepEqual(result, { accepted: false, code });
}

async function captureCombat(client) {
  await client.page.evaluate(async () => {
    globalThis.__profileCombat = { starts: [], uploads: [], errors: [], timeline: [], workerRpc: [], progress: {} };
    const timeline = (type, fields) => globalThis.__profileCombat.timeline.push({ at: performance.now(), type, ...fields });
    const { WorkerSimHost } = await import('/js/battle/simHost.js');
    const rpc = WorkerSimHost.prototype.rpc, workers = new WeakMap();
    let workerSeq = 0;
    WorkerSimHost.prototype.rpc = function (...rpcArgs) {
      const [method, args = [], timeoutMs] = rpcArgs;
      if (!workers.has(this)) workers.set(this, ++workerSeq);
      const event = { at: performance.now(), workerId: workers.get(this), method, cs: this.cs,
        battleId: args[0]?.battleId ?? this.spec?.battleId, timeoutMs: timeoutMs ?? this.timeoutMs };
      const important = method !== 'step' && method !== 'unitStats';
      if (important) globalThis.__profileCombat.workerRpc.push(event);
      // Observe the exact production promise; its payload, timeout and return value remain unchanged.
      const result = rpc.apply(this, rpcArgs);
      const finish = error => {
        event.durationMs = performance.now() - event.at;
        event.status = error ? 'error' : 'done';
        if (error) { event.code = error.code; event.message = String(error.message || error); }
        if (!important && (error || event.durationMs > 500)) globalThis.__profileCombat.workerRpc.push(event);
      };
      result.then(() => finish(), error => finish(error));
      return result;
    };
    const net = globalThis.__SP__.net;
    net.on('*', msg => {
      if (msg.t === 'b.start') {
        globalThis.__profileCombat.starts.push(JSON.parse(JSON.stringify(msg)));
        timeline(msg.t, { battleId: msg.battleId, round: msg.spec?.round, kind: msg.kind, authoritative: msg.authoritative });
      }
      if (msg.t === 'b.end') timeline(msg.t, { battleId: msg.battleId, reason: msg.reason });
      if (msg.t === 'error') globalThis.__profileCombat.errors.push({ code: msg.code, detail: msg.detail });
    });
    globalThis.__SP_RUNNER__.on('takeover', event => timeline('runner-takeover', event));
    const send = net._sendRaw.bind(net);
    net._sendRaw = msg => {
      if (msg.t === 'b.progress') globalThis.__profileCombat.progress[msg.battleId] = { at: performance.now(), gt: msg.gt, done: msg.done };
      if (msg.t === 'b.result') {
        globalThis.__profileCombat.uploads.push(JSON.parse(JSON.stringify(msg)));
        timeline(msg.t, { battleId: msg.battleId, reason: msg.result?.reason, errors: msg.result?.errors });
      }
      return send(msg);
    };
  });
}

async function chooseDrafts(clients) {
  const done = new Set(), deadline = Date.now() + 90000;
  while (done.size < clients.length && Date.now() < deadline) {
    for (const client of clients) {
      if (done.has(client)) continue;
      const state = await client.st();
      if (state.phase !== 'BAND_DRAFT' || state.draft?.turn !== state.me) continue;
      const name = await client.page.evaluate(() => {
        const card = [...document.querySelectorAll('.dband:not(.is-taken)')].find(el => !el.textContent.includes('老鲤'));
        card?.scrollIntoView({ block: 'nearest' });
        return card?.querySelector('.dband__name')?.textContent.trim();
      });
      assert.ok(name, `${client.label}: a free strategy exists`);
      await sleep(150);
      await client.click('.dband:not(.is-taken)', name);
      await client.click('.draft-detail__btns .btn--primary', '确认选择');
      done.add(client);
    }
    await sleep(100);
  }
  assert.equal(done.size, clients.length, 'all real players choose through the draft controls');
  for (const client of clients) await client.waitFor(s => s.phase === 'PREP' && s.round === 1, 'first prep');
}

test('Rhine and vanilla six-seat rooms: host controls, ready/loadout refresh, fixed match profile, real simulation and vanilla reload',
  { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run real Chrome', timeout: 300000 }, async () => {
    // fastServer preserves the real match, socket and simulation. Its hooks only supply known operators and speed.
    const previousVerify = process.env.SP_VERIFY;
    let srv;
    try {
      process.env.SP_VERIFY = 'all';
      // Keep the production 2x speed: cold isolated Workers need the normal field budget to start and report.
      srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, idleBots: true, autoPlace: true,
        chess: [PTILOPSIS, SARIA, 'chess_char_1_01_b', 'chess_char_1_19_b', MAGALLAN] } });
    } finally {
      if (previousVerify === undefined) delete process.env.SP_VERIFY;
      else process.env.SP_VERIFY = previousVerify;
    }
    const clients = [];
    let browserPool;
    try {
      const puppeteer = (await import('puppeteer-core')).default;
      // Share only the browser/GPU, as the six-player and plugin mechanism fixtures do. Each Client creates its own
      // BrowserContext, page, storage and simulation Workers; this is not coverage of independent browser processes.
      browserPool = await createMechanismBrowserPool(puppeteer, { browserArgs: BROWSER_ARGS });
      const vanillaHost = new Client(puppeteer, srv.base, 'vanilla-host',
        { w: VIEWPORT.width, h: VIEWPORT.height, prefix: 'rhine-profiles-vanilla-host', sharedBrowser: browserPool.browser });
      const guest = new Client(puppeteer, srv.base, 'vanilla-guest',
        { w: VIEWPORT.width, h: VIEWPORT.height, prefix: 'rhine-profiles-vanilla-guest', sharedBrowser: browserPool.browser });
      const rhineHost = new Client(puppeteer, srv.base, 'rhine-host',
        { w: VIEWPORT.width, h: VIEWPORT.height, prefix: 'rhine-profiles-rhine-host', sharedBrowser: browserPool.browser });
      clients.push(vanillaHost, guest, rhineHost);
      const code = await createCoop(vanillaHost, '原版房主');
      await openClient(guest, `?room=${code}`);
      observeImageReplacement(guest);
      await observeRoomProfile(guest);
      await guest.enter('原版队友');
      await guest.waitFor(s => s.room?.code === code, 'guest joins');
      await waitProfile(guest, true);
      await lowQuality(guest);
      const initial = await rosterSnapshot(vanillaHost);
      assert.equal(initial.ptilopsis.tier, 3);
      assert.equal(initial.saria.tier, 3);
      assert.equal(initial.magallan.tier, 4);
      assert.equal(await guest.page.$$eval('[data-testid="rhine-toggle"] button', buttons => buttons.every(button => button.disabled)), true);
      await assertRejected(guest, 'room.setRhine', { enabled: false }, 'NOT_HOST');

      // A real Rhine-only loadout before the setting changes, then inspect the newly loaded vanilla overlay.
      await vanillaHost.click('[data-testid="loadout-open"]');
      await vanillaHost.page.waitForSelector('.lo .lo-card', { visible: true });
      await searchLoadout(vanillaHost, '麦哲伦');
      await vanillaHost.page.waitForSelector(`.lo-card[data-chess="${MAGALLAN}"]`, { visible: true });
      await vanillaHost.click(`.lo-card[data-chess="${MAGALLAN}"]`);
      await vanillaHost.click('.lo-detail .lo-skill[data-skill="0"]');
      await vanillaHost.page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''));
      await closeLoadout(vanillaHost);
      await guest.click('.room-bar__right button', '准备就绪');
      await guest.page.waitForFunction(() => {
        const s = globalThis.__SP__.store.get();
        return s.room.seats.find(seat => seat?.playerId === s.me.playerId)?.ready;
      });
      await clickProfileControl(vanillaHost, '[data-testid="rhine-vanilla"]');
      const profileReply = vanillaHost.page.waitForFunction(() => {
        const trace = globalThis.__profileRoom;
        const request = trace.requests.find(request => request.enabled === false);
        const reply = request && trace.replies.find(reply => reply.rid === request.rid);
        return reply && { enabled: request.enabled, sent: request.sent, reply: reply.t, code: reply.code ?? null };
      }, { timeout: 30000 }).then(handle => handle.jsonValue());
      const [, , reply] = await Promise.all([waitProfile(vanillaHost, false), waitProfile(guest, false), profileReply]);
      assert.deepEqual(reply, { enabled: false, sent: true, reply: 'ok', code: null }, 'the actual room control sends a request accepted by the server');
      assert.equal(await vanillaHost.page.evaluate(() => globalThis.__profileRoom.inputs.some(input => input.type === 'click'
        && input.trusted && input.button === 'rhine-vanilla' && input.targetTestId === 'rhine-vanilla'
        && input.visibility === 'visible' && !input.disabled && !input.loadoutHidden)), true, 'the visible vanilla control receives the real mouse click');
      const vanillaRoom = await roomSnapshot(vanillaHost);
      assert.equal(vanillaRoom.seats.filter(seat => !seat.isBot).every(seat => !seat.ready), true, 'switching clears every human ready flag');
      assert.equal(await guest.page.$eval('[data-testid="rhine-vanilla"]', button => button.getAttribute('aria-pressed')), 'true');
      const vanilla = await rosterSnapshot(vanillaHost);
      assert.equal(vanilla.ptilopsis.tier, 4, 'vanilla whiteface retains its original tier');
      assert.equal(vanilla.saria.tier, 5, 'vanilla Saria retains her original tier');
      assert.equal(vanilla.magallan, null);
      assert.notDeepEqual(vanilla.ptilopsis.garrisons, initial.ptilopsis.garrisons);
      assert.notDeepEqual(vanilla.saria.garrisons, initial.saria.garrisons);
      const expectedVanilla = getDataProfile(false, { log: QUIET });
      assert.deepEqual(vanilla.ptilopsis.modules, expectedVanilla.chess[expectedVanilla.chess[PTILOPSIS].goldenId].modules.map(m => m.uniEquipId));
      await vanillaHost.click('[data-testid="loadout-open"]');
      await vanillaHost.page.waitForSelector('.lo', { visible: true });
      await searchLoadout(vanillaHost, '麦哲伦');
      assert.equal(await vanillaHost.page.$$eval(`.lo-card[data-chess="${MAGALLAN}"]`, cards => cards.length), 0, 'the actual vanilla overlay excludes the Rhine-only Magallan record');
      await searchLoadout(vanillaHost, '塞雷娅');
      await vanillaHost.page.waitForSelector(`.lo-card[data-chess="${SARIA}"]`, { visible: true });
      assert.equal(await vanillaHost.page.$eval(`.lo-card[data-chess="${SARIA}"]`, card => card.classList.contains('lo-card--t5')), true);
      await vanillaHost.shot('vanilla-loadout');
      await closeLoadout(vanillaHost);

      await createCoop(rhineHost, '莱茵房主');
      await fillBots(vanillaHost, 4);
      await fillBots(rhineHost, 5);
      for (const [client, enabled] of [[vanillaHost, false], [guest, false], [rhineHost, true]]) {
        await waitProfile(client, enabled);
        const state = await roomSnapshot(client);
        assert.equal(state.seats.length, 6);
        assert.equal(state.profile, profileId(enabled));
        assert.equal(await client.page.$$eval('.seat', cards => cards.length), 6);
        await client.page.waitForFunction(() => [...document.querySelectorAll('.seat')]
          .every(card => Number(getComputedStyle(card).opacity) > 0.99), { timeout: 5000 });
        await client.page.evaluate(async () => {
          const animations = document.querySelector('.room-screen').getAnimations({ subtree: true });
          await Promise.all(animations.filter(animation => Number.isFinite(animation.effect.getTiming().iterations))
            .map(animation => animation.finished.catch(() => {})));
        });
      }
      assert.deepEqual(await rosterSnapshot(rhineHost), initial, 'the parallel Rhine room still uses its own roster');
      const poolState = await browserPool.diagnostics();
      assert.equal(poolState.gpuCount, 1, 'the mechanism fixture uses one real owned GPU');
      assert.deepEqual(new Set(poolState.contextIds), new Set(clients.map(client => client.browserContext.id)));
      console.log('Profile browser pool:', JSON.stringify(poolState));
      await vanillaHost.shot('six-seat-room');
      await rhineHost.shot('six-seat-room');

      // Reload while waiting in the vanilla room: restore identity and fetch that profile before controls unlock.
      const guestId = (await guest.st()).me;
      const beforeGuestReload = await contextSnapshot(clients);
      await guest.page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      await guest.page.reload({ waitUntil: 'domcontentloaded' });
      await guest.page.waitForFunction(() => !!globalThis.__SP__, { timeout: 30000 });
      await guest.waitFor(s => s.room?.code === code, 'guest reconnects to vanilla');
      await waitProfile(guest, false);
      assert.equal((await guest.st()).me, guestId);
      assert.deepEqual(await rosterSnapshot(guest), vanilla);
      assertReloadIsolation(beforeGuestReload, await contextSnapshot(clients), guest);
      await guest.click('.room-bar__right button', '准备就绪');
      await Promise.all([vanillaHost.click('.room-bar__right button', '开始模拟'), rhineHost.click('.room-bar__right button', '开始模拟')]);
      for (const [client, enabled] of [[vanillaHost, false], [guest, false], [rhineHost, true]]) {
        await client.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
        const state = await roomSnapshot(client);
        assert.equal(state.pubEnabled, enabled);
        assert.equal(state.pubProfile, profileId(enabled));
        assert.equal(state.count, 6);
        assert.deepEqual(state.bans, { core: 0, addon: 1 }, 'the six-seat opening reduction works for both profiles');
      }
      await assertRejected(vanillaHost, 'room.setRhine', { enabled: true }, 'ROOM_STARTED');
      await assertRejected(rhineHost, 'room.setRhine', { enabled: false }, 'ROOM_STARTED');
      assert.equal((await roomSnapshot(vanillaHost)).pubEnabled, false);
      assert.equal((await roomSnapshot(rhineHost)).pubEnabled, true);
      const privateLoadout = await vanillaHost.page.evaluate(() => globalThis.__SP__.store.get().match.private.loadout);
      assert.equal(privateLoadout[MAGALLAN], undefined, 'the new match has no stale Rhine-only loadout');
      for (const client of clients) await captureCombat(client);
      await Promise.all(clients.map(client => client.click('.brief__foot .btn--primary', '准备就绪')));
      await chooseDrafts(clients);

      // Inspect the live simulation's installed data, including the original profile's isolated Worker.
      // Arm every observation before ready clicks while the other pages render their art.
      const liveChecks = [[vanillaHost, false], [guest, false], [rhineHost, true]].map(async ([client, enabled]) => {
        const live = await client.page.waitForFunction(({ ptilopsis, saria, magallan }) => {
          const me = globalThis.__SP__.store.get().me.playerId, captured = globalThis.__profileCombat;
          const start = captured.starts.find(msg => msg.authoritative && msg.kind === 'normal' && msg.spec.round === 1
            && msg.spec.players.some(player => player.playerId === me));
          const e = start && globalThis.__SP_RUNNER__?._entries?.get(start.battleId);
          if (!e?.own || !e.battle || e.kind !== 'normal' || e.spec.round !== 1) return false;
          captured.live = { at: performance.now(), battleId: e.battleId, kind: e.kind,
            wireAuthority: start.authoritative, observedAuthority: e.authoritative };
          const chess = id => e.battle.data?.getChess(id)?.raw ?? null;
          return { enabled: e.spec.rhineEnabled, profile: e.spec.dataProfile, authoritative: e.authoritative,
            remote: e.host.remote,
            ptilopsisTier: chess(ptilopsis)?.tier, sariaTier: chess(saria)?.tier, magallanTier: chess(magallan)?.tier ?? null };
        }, { timeout: 60000, polling: 100 }, { ptilopsis: PTILOPSIS, saria: SARIA, magallan: MAGALLAN }).then(handle => handle.jsonValue());
        if (live.remote) {
          const workers = client.page.workers().filter(worker => worker.url().includes('/js/battle/simWorker.js'));
          assert.ok(workers.length > 0, `${client.label}: an actual simulation Worker holds the original profile`);
          const installed = await Promise.all(workers.map(worker => worker.evaluate(async ({ ptilopsis, saria, magallan }) => {
            const { getSimData } = await import('/sim/simdata.js');
            const raw = getSimData();
            return { ptilopsisTier: raw?.chess?.[ptilopsis]?.tier, sariaTier: raw?.chess?.[saria]?.tier,
              magallanTier: raw?.chess?.[magallan]?.tier ?? null };
          }, { ptilopsis: PTILOPSIS, saria: SARIA, magallan: MAGALLAN })));
          for (const roster of installed) assert.deepEqual(roster, { ptilopsisTier: 4, sariaTier: 5, magallanTier: null });
          Object.assign(live, installed[0]);
        }
        assert.deepEqual(live, { enabled, profile: profileId(enabled), authoritative: true,
          remote: !enabled,
          ptilopsisTier: enabled ? 3 : 4, sariaTier: enabled ? 3 : 5, magallanTier: enabled ? 4 : null });
      });
      await Promise.all([...liveChecks, ...clients.map(client => client.click('.readybtn'))]);
      for (const client of clients) await waitForFunctionLong(client.page, () => globalThis.__profileCombat.uploads.length > 0, { timeout: 90000 });
      for (const [client, enabled] of [[vanillaHost, false], [guest, false], [rhineHost, true]]) {
        const captured = await client.page.evaluate(() => globalThis.__profileCombat);
        assert.deepEqual(captured.errors, [], `${client.label}: no rejected combat report`);
        const start = captured.starts.find(msg => msg.authoritative && msg.spec.round === 1 && msg.kind === 'normal');
        assert.ok(start, `${client.label}: an authoritative normal field was received`);
        const me = (await client.st()).me;
        assert.ok(start.spec.players.find(player => player.playerId === me)?.units?.length > 0,
          `${client.label}: the real field contains the configured starter kit`);
        assert.equal(start.rhineEnabled, enabled);
        assert.equal(start.dataProfile, profileId(enabled));
        const upload = captured.uploads.find(msg => msg.battleId === start.battleId);
        assert.ok(upload, `${client.label}: its real browser uploaded the normal battle`);
        const ds = new DataSource(getDataProfile(enabled, { log: QUIET }), null);
        const replay = compactResult(createBattleFromSpec(start.spec, ds, { recordEvents: false, quiet: true }).runToEnd(4000));
        assert.equal(resultDigest(upload.result).hash, resultDigest(replay).hash,
          `${client.label}: real browser result matches the server simulation for ${profileId(enabled)}`);
        assert.equal(upload.result.errors, 0);
        await client.waitFor(s => s.phase === 'PREP' && s.round === 2, 'the first round settles normally', 90000);
        assert.equal((await roomSnapshot(client)).pubEnabled, enabled);
        assert.equal(await client.page.evaluate(() => globalThis.__SP_RUNNER__.stats().errors), 0);
      }
      const beforeHostReload = await contextSnapshot(clients);
      await vanillaHost.page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      await vanillaHost.page.reload({ waitUntil: 'domcontentloaded' });
      await vanillaHost.page.waitForFunction(() => !!globalThis.__SP__ && !!globalThis.__SP_RUNNER__, { timeout: 30000 });
      await vanillaHost.waitFor(s => s.phase === 'PREP' && s.round === 2 && s.room?.code === code, 'vanilla mid-match reconnect');
      await waitProfile(vanillaHost, false);
      assert.equal((await roomSnapshot(vanillaHost)).pubProfile, 'vanilla');
      assert.deepEqual(await rosterSnapshot(vanillaHost), vanilla);
      assertReloadIsolation(beforeHostReload, await contextSnapshot(clients), vanillaHost);
      await vanillaHost.page.waitForFunction(() => globalThis.__SP_VIEW__ && document.querySelector('.gm canvas')?.width > 0,
        { timeout: 30000 });
      await sleep(1800); // the reconnected prep camera and round banner complete their entrance
      await vanillaHost.shot('reconnected-prep');
      for (const client of clients) {
        await assertMechanismVisibility(client);
        const visibility = readMechanismVisibility(client);
        assert.ok(visibility.documents.every(document => document.frames > 0), `${client.label}: real animation frames ran in every observed document`);
        assert.equal(visibility.documents.length, client === rhineHost ? 1 : 2, `${client.label}: visibility includes both sides of each reload`);
        const actualView = await client.page.evaluate(() => {
          const view = globalThis.__SP_VIEW__, app = view?.raw?.debug?.app;
          return { kind: view?.kind, renderer: !!app?.renderer, contextLost: app?.renderer?.gl?.isContextLost?.(),
            canvases: [...document.querySelectorAll('.gm canvas')].map(canvas => ({ width: canvas.width, height: canvas.height,
              connected: canvas.isConnected, display: getComputedStyle(canvas).display,
              rect: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height } })) };
        });
        console.log('Profile final actual view:', JSON.stringify({ client: client.label, ...actualView, fieldWarnings: client.fieldWarnings }));
      }
      assert.deepEqual(pageProblems(clients), [], 'no console, page or resource errors in the real pages');
      assert.deepEqual(srv.logs.filter(line => /verify mismatch|meta handler error|\[sim\].*(?:error|failed)/i.test(line)), [], 'no server verification/content errors');
    } catch (error) {
      await Promise.all(clients.map(async client => {
        if (!client.page) return;
        const diagnostic = await Promise.race([
          client.page.evaluate(() => {
            const s = globalThis.__SP__?.store.get(), captured = globalThis.__profileCombat;
            const view = globalThis.__SP_VIEW__, app = view?.raw?.debug?.app;
            return { phase: s?.match.public?.phase, round: s?.match.public?.round,
              profile: globalThis.__SP__?.data.profileId,
              room: { code: s?.room?.code, enabled: s?.room?.rhineEnabled, hostId: s?.room?.hostId, inMatch: s?.room?.inMatch },
              roomProfile: globalThis.__profileRoom,
              loadout: { open: !!document.querySelector('.lo'), hidden: document.documentElement.classList.contains('sp-loadout-open') },
              profileButtons: [...document.querySelectorAll('[data-testid="rhine-toggle"] button')].map(button => {
                const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                const ancestors = [];
                for (let node = button; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  ancestors.push({ tag: node.tagName, class: node.className, visibility: style.visibility,
                    display: style.display, opacity: style.opacity, pointerEvents: style.pointerEvents,
                    hidden: node.hidden, inert: node.inert });
                }
                return { id: button.dataset.testid, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled,
                  visibility: getComputedStyle(button).visibility, ancestors,
                  hit: hit && { tag: hit.tagName, class: hit.className, testId: hit.getAttribute('data-testid'), receivesClick: button.contains(hit) } };
              }),
              ui: { route: s?.ui.route, dataReady: s?.ui.dataReady, dataError: s?.ui.dataError },
              resourceTiming: globalThis.__SP_PROFILE_RESOURCE_TIMING__?.(),
              visibility: globalThis.__SP_MECHANISM_VISIBILITY__?.snapshot(),
              view: { kind: view?.kind, app: !!app, renderer: !!app?.renderer,
                contextLost: app?.renderer?.gl?.isContextLost?.() },
              canvases: [...document.querySelectorAll('.gm canvas')].map(canvas => ({ width: canvas.width, height: canvas.height,
                connected: canvas.isConnected, display: getComputedStyle(canvas).display,
                rect: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height } })),
              fieldLoading: document.querySelector('.gm__loading')?.textContent,
              live: captured?.live, timeline: captured?.timeline, workerRpc: captured?.workerRpc, progress: captured?.progress,
              starts: captured?.starts.map(m => ({ battleId: m.battleId, round: m.spec?.round, kind: m.kind, authoritative: m.authoritative })),
              uploads: captured?.uploads.map(m => ({ battleId: m.battleId, errors: m.result?.errors })),
              entries: [...(globalThis.__SP_RUNNER__?._entries?.values() || [])].map(e => ({ battleId: e.battleId,
                round: e.spec?.round, own: e.own, battle: !!e.battle, remote: e.host?.remote, done: e.done, failed: e.failed })) };
          }).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) })),
          sleep(5000).then(() => ({ diagnosticTimedOut: true })),
        ]);
        console.log(JSON.stringify({ client: client.label, diagnostic, fieldWarnings: client.fieldWarnings,
          visibilityHistory: readMechanismVisibility(client),
          pendingRequests: [...(client.pendingRequests?.values() || [])].map(({ at, ...request }) => ({ ...request, ageMs: Date.now() - at })) }));
      }));
      console.log(JSON.stringify({ serverCombat: srv.logs.filter(line => /takeover|verify|rejected/i.test(line)).slice(-60) }));
      throw error;
    } finally {
      if (pageProblems(clients).length) console.log(pageProblems(clients).slice(0, 20).join('\n'));
      try { await Promise.all(clients.map(client => client.close())); }
      finally {
        try { await browserPool?.close(); }
        finally { await srv.stop(); }
      }
    }
  });
