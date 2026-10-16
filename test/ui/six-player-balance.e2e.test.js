// Production UI/network regression for six-seat balance, with only the existing scenario fixtures
// (skip to R14, known starter operators, automatic placement, faster combat). No fabricated UI state
// or direct game requests: room controls, drafts, beacon use/reward and readiness use real input.
// SP_E2E=1 CHROME_PATH=... node --test test/ui/six-player-balance.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { getPriority, setPriority } from 'node:os';
import path from 'node:path';
import { Client, ROOT, cameraSettled, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';
import { getDataProfile } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';
import { DataSource } from '../../server/sim/simdata.js';
import { compactResult, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const CORE = 'chess_char_6_01_a'; // a six-tier operator present in both profiles
const BEACON = 'chess_item_5_04_e_a';
const KIT = [CORE, 'chess_char_1_01_a', 'chess_char_1_19_a', 'chess_char_2_01_a'];
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
// Opt into software WebGL (not software GPU compositing) only in this test harness.
// Combat speed, deadlines and gameplay assertions are unchanged. The six clients
// use actual low-quality controls with a 720p host and compact teammate windows;
// separate renderer/layout suites cover
// full-quality art and the desktop/phone viewport matrix.
const SOFTWARE_GPU = process.env.SP_E2E_SWIFTSHADER === '1';
const BROWSER_ARGS = SOFTWARE_GPU ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] : [];
const inventory = c => c.page.evaluate(() => {
  const p = globalThis.__SP__.store.get().match.private;
  return [...(p?.hand || []), ...(p?.temp || []), ...(p?.board || [])].filter(Boolean);
});

async function openClient(client, query) {
  await client.open(query);
  client.fieldWarnings = [];
  client.page.on('console', message => {
    if (message.type() === 'warn' && message.text().startsWith('[field]')) client.fieldWarnings.push(message.text());
  });
  if (!SOFTWARE_GPU || !['win32', 'linux'].includes(process.platform)) return;
  // Hosted Windows jobs inherit BelowNormal, but Chromium raises its GPU process
  // to AboveNormal: align this browser's owned GPU with the fixture there. On a
  // four-core Linux runner six SwiftShader GPUs also compete with the real IPC
  // and simulation Workers: give only their rendering tasks nice +15. Linux nice
  // is per-thread, so cover the owned GPU's existing threads too; new threads
  // inherit it. The Node/server/renderer/Worker priorities and rendering stay intact.
  const cdp = await client.browser.target().createCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const gpuProcesses = processInfo.filter(p => /gpu/i.test(p.type));
    assert.equal(gpuProcesses.length, 1, 'one owned browser GPU process');
    const priority = process.platform === 'linux' ? 15 : getPriority(process.pid);
    for (const gpu of gpuProcesses) {
      setPriority(gpu.id, priority);
      if (process.platform === 'linux') {
        for (let pass = 0; pass < 2; pass++) {
          for (const task of readdirSync(`/proc/${gpu.id}/task`)) {
            try {
              setPriority(Number(task), priority);
              assert.equal(getPriority(Number(task)), priority, 'owned software GPU thread has the requested rendering priority');
            } catch (error) {
              if (error.info?.code === 'ESRCH' && !existsSync(`/proc/${gpu.id}/task/${task}`)) continue; // a shader/compiler thread already exited
              throw error;
            }
          }
        }
      }
      assert.equal(getPriority(gpu.id), priority, 'owned software GPU has the requested rendering priority');
      console.log(`Six-client owned GPU priority: pid=${gpu.id}, priority=${getPriority(gpu.id)}`);
    }
  } finally { await cdp.detach(); }
}

async function lowQuality(client) {
  await client.click('[data-testid="settings-btn"]');
  await client.page.waitForSelector('.modal .set-list');
  // The added 0.3 settings put quality below the fold, even on the host's 720p
  // viewport. Reveal its actual radio before using the same real mouse input.
  await client.page.$eval('.modal .set-list', list => {
    const low = [...list.querySelectorAll('button[role="radio"]')].find(button => button.textContent.trim() === '低');
    if (!low) throw new Error('the low-quality radio is missing from settings');
    low.scrollIntoView({ block: 'center' });
  });
  await client.click('.modal button[role="radio"]', '低');
  assert.equal(await client.page.$eval('.modal .set-list', list =>
    [...list.querySelectorAll('button[role="radio"]')].find(button => button.textContent.trim() === '低').getAttribute('aria-checked')), 'true');
  await client.click('.modal__actions button', '完成');
  assert.equal(await client.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).quality), 'low');
}

async function warmClient(client, enabled) {
  // Finish each room's real module/content lookup before six boards render
  // simultaneously. A gameplay profile still creates its real isolated Worker at battle start.
  await client.page.waitForFunction(enabled => globalThis.__SP__.store.get().ui.dataReady
    && globalThis.__SP__.data.profileId === (enabled ? 'rhine' : 'vanilla'), { timeout: 30000 }, enabled);
  await client.page.evaluate(enabled => {
    const cs = globalThis.__SP__.store.get().room?.content?.cs ?? null;
    return globalThis.__SP_RUNNER__.ensureSim(cs, enabled).then(() => true);
  }, enabled);
}

async function createSixHumanRoom(clients, rhineEnabled) {
  const host = clients[0];
  await openClient(host);
  if (SOFTWARE_GPU) {
    const cdp = await host.browser.target().createCDPSession();
    try {
      const { gpu } = await cdp.send('SystemInfo.getInfo');
      assert.match(gpu.auxAttributes.glRenderer, /SwiftShader/i, 'the requested software backend is actually active');
      assert.equal(gpu.featureStatus.gpu_compositing, 'disabled_software', 'software WebGL does not turn on GPU compositing');
      console.log(`Six-client GPU: ${gpu.auxAttributes.glRenderer}`);
    } finally { await cdp.detach(); }
  }
  await host.enter('六人验收1');
  await lowQuality(host);
  await host.click('.mode-card', '同盟模拟');
  await host.click('.diff-card', '绝境模拟');
  await host.click('.create-box button', '创建同盟');
  const { room } = await host.waitFor(s => !!s.room?.code, 'room created');
  if (!rhineEnabled) {
    await host.click('[data-testid="rhine-vanilla"]');
    await host.page.waitForFunction(() => globalThis.__SP__.store.get().room?.rhineEnabled === false
      && globalThis.__SP__.data.profileId === 'vanilla' && globalThis.__SP__.store.get().ui.dataReady);
  }
  await warmClient(host, rhineEnabled);
  for (const [i, client] of clients.slice(1).entries()) {
    await openClient(client, `?room=${room.code}`);
    await client.enter(`六人验收${i + 2}`);
    await client.waitFor(s => s.room?.code === room.code, 'join six-human room');
    await warmClient(client, rhineEnabled);
    // Auto-join replaces the lobby screen; configure its settings only after that
    // transition, so it cannot unmount an open dialog between the two real clicks.
    await lowQuality(client);
  }
  for (const client of clients.slice(1)) await client.click('.room-bar__right button', '准备就绪');
  await host.click('.room-bar__right button', '开始模拟');
  for (const client of clients) {
    await client.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
    const pub = await client.page.evaluate(() => globalThis.__SP__.store.get().match.public);
    assert.equal(pub.startingPlayerCount, 6);
    assert.equal(pub.dataProfile, rhineEnabled ? 'rhine' : 'vanilla');
    assert.deepEqual(pub.openingBans, { core: rhineEnabled ? 3 : 1, addon: 4 });
    assert.equal(pub.players.filter(p => !p.isBot).length, 6);
    await client.click('.brief__foot .btn--primary', '准备就绪');
  }
  const picked = new Set(), deadline = Date.now() + 90000;
  while (picked.size < 6 && Date.now() < deadline) {
    for (const client of clients) {
      const state = await client.st();
      if (picked.has(client) || state.phase !== 'BAND_DRAFT' || state.draft?.turn !== state.me) continue;
      const name = await client.page.evaluate(() => {
        const card = [...document.querySelectorAll('.dband:not(.is-taken)')].find(el => !el.textContent.includes('老鲤'));
        card?.scrollIntoView({ block: 'nearest' });
        return card?.querySelector('.dband__name')?.textContent.trim();
      });
      assert.ok(name, 'an unclaimed strategy is visible');
      await sleep(150);
      await client.click('.dband:not(.is-taken)', name);
      await client.click('.draft-detail__btns .btn--primary', '确认选择');
      picked.add(client);
    }
    await sleep(100);
  }
  assert.equal(picked.size, 6, 'six humans selected through actual draft controls');
  await Promise.all(clients.map(client => client.waitFor(s => s.phase === 'PREP' && s.round === 14 && !s.ready, 'R14 prep')));
}

async function recordCombat(client) {
  await client.page.evaluate(async () => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const trace = globalThis.__sixBalance = { starts: [], ends: [], pools: [], uploads: [], errors: [], byBattle: {}, localPools: {}, phases: [], states: [] };
    const remoteHosts = new Map();
    // Capture the real local pool when its field is shown. At accelerated combat speed,
    // RESULT may clear runner entries before the six clients are inspected sequentially.
    const runner = globalThis.__SP_RUNNER__;
    runner.on('field', () => {
      for (const entry of runner._entries.values()) {
        if (!entry.own || !entry.battle?.sharedBoss) continue;
        // A Worker exposes its actual Battle snapshot, rather than the engine's
        // LocalBossPool object. Both paths read the pool the simulation built.
        trace.localPools[entry.battleId] = entry.host.remote
          ? entry.host.packet?.snap?.boss?.max : entry.battle.sharedBoss.maxHp;
      }
    });
    // Worker syncPool is an ordered RPC. Observe its completion after any pending
    // step, so replay applies each real pool update at the tick it reached there.
    const { WorkerSimHost } = await import('/js/battle/simHost.js');
    const start = WorkerSimHost.prototype.start;
    WorkerSimHost.prototype.start = async function (spec) {
      remoteHosts.set(spec.battleId, this);
      const value = await start.call(this, spec);
      trace.localPools[spec.battleId] = this.packet?.snap?.boss?.max;
      return value;
    };
    const syncPool = WorkerSimHost.prototype.syncPool;
    WorkerSimHost.prototype.syncPool = async function (hp, acked) {
      const value = await syncPool.call(this, hp, acked);
      if (!this.stopped && this.spec?.battleId && Number.isInteger(this.battle.tickCount)) {
        (trace.byBattle[this.spec.battleId] ||= []).push({ tick: this.battle.tickCount, hp, acked });
      }
      return value;
    };
    let stateKey = null;
    runner.on('state', state => {
      const key = JSON.stringify([state?.battleId, state?.loading, state?.authoritative, state?.done]);
      if (key === stateKey) return;
      stateKey = key;
      trace.states.push({ at: performance.now(), state: copy(state), entries: [...runner._entries.values()].map(entry => ({
        battleId: entry.battleId, own: entry.own, remote: entry.host?.remote, authoritative: entry.authoritative,
        ticks: entry.battle?.tickCount, time: entry.battle?.time, pending: entry.host?.pending?.size,
      })) });
    });
    const net = globalThis.__SP__.net;
    net.on('*', msg => {
      if (['m.public', 'b.start', 'b.end'].includes(msg.t)) trace.phases.push({ at: performance.now(), type: msg.t,
        phase: globalThis.__SP__.store.get().match.public?.phase, runner: runner.state() });
      if (msg.t === 'b.start') trace.starts.push(copy(msg));
      if (msg.t === 'b.end') trace.ends.push({ at: performance.now(), message: copy(msg) });
      if (msg.t === 'error') trace.errors.push({ at: performance.now(), phase: globalThis.__SP__.store.get().match.public?.phase, ...copy(msg) });
      if (msg.t === 'b.pool') {
        trace.pools.push(copy(msg));
        // The in-page host applied this synchronously; Worker application is
        // recorded by the real RPC completion observer above.
        for (const entry of globalThis.__SP_RUNNER__?._entries?.values() || []) {
          if (!entry.own || !entry.battle || entry.resultSent || entry.host.remote) continue;
          (trace.byBattle[entry.battleId] ||= []).push({ tick: entry.battle.tickCount,
            hp: msg.hp, acked: msg.acked?.[entry.fieldId] });
        }
      }
    });
    const send = net._sendRaw.bind(net);
    net._sendRaw = msg => {
      if (msg.t === 'b.result') {
        const entry = globalThis.__SP_RUNNER__?._entries?.get(msg.battleId);
        // A real Worker can finish and upload during prepare(), before the
        // runner registers its entry for display. Read that same actual host.
        const battle = entry?.battle || remoteHosts.get(msg.battleId)?.battle;
        trace.uploads.push({ message: copy(msg), tick: battle?.tickCount,
          pools: copy(trace.byBattle[msg.battleId] || []) });
      }
      return send(msg);
    };
  });
}

async function useAwardedBeacon(clients) {
  const host = clients[0], before = await Promise.all(clients.map(inventory));
  const beacon = before[0].find(p => p.kind === 'item' && p.id === BEACON && p.giftTiming === 'immediate');
  const core = before[0].find(p => p.kind === 'chess' && p.id === CORE);
  assert.ok(beacon && core, 'R14 reward beacon and the actual six-tier starter operator exist');
  await host.page.waitForFunction(uid => !!globalThis.__SP_VIEW__?.pieceScreenRect(uid), {}, beacon.uid);
  await sleep(1500); // real prep camera and entrance banner finish their flight
  await host.hookRequests();
  await host.page.evaluate(async () => {
    const { serverNow } = await import('/js/store.js');
    const trace = globalThis.__sixBeacon = { errors: [], replies: [], checkpoints: [] };
    trace.mark = stage => {
      const pub = globalThis.__SP__.store.get().match.public, now = serverNow();
      trace.checkpoints.push({ stage, at: Date.now(), phase: pub.phase, round: pub.round, serverNow: now,
        wireServerNow: pub.serverNow, deadline: pub.deadline, remainingSeconds: Math.max(0, (pub.deadline - now) / 1000) });
    };
    trace.mark('before-detail');
    globalThis.__SP__.net.on('*', msg => {
      if (msg.t === 'error') trace.errors.push({ at: performance.now(), ...msg });
      if (msg.t === 'ok') trace.replies.push({ at: performance.now(), ...msg });
    });
  });
  const detailPoint = await host.piecePoint(beacon.uid);
  assert.ok(detailPoint, 'beacon has real field coordinates');
  await host.page.mouse.click(detailPoint.x, detailPoint.y);
  await host.page.waitForFunction(() => document.querySelector('.dpanel')?.textContent.includes('信标'));
  assert.match(await host.page.$eval('.dpanel', panel => panel.textContent), /第14回合六人补给信标.*使用后立即转赠/,
    'the actual awarded item detail explains its special R14 delivery timing');
  await host.shot('beacon-detail');
  // Opening the detail and picking an item can reframe the board. Read its real
  // position now, then aim at the intended board tile again after the drag fold.
  const from = await host.piecePoint(beacon.uid), to = await host.tilePoint(core.row, core.col);
  assert.ok(from && to, 'beacon and core tile have real field coordinates after opening the detail');
  await host.drops();
  const geometry = await host.page.evaluate(coords => {
    // Both production views expose tileScreen; only the engine has debug.app.
    // Inspect the surface already mounted, without selecting a render backend.
    const view = globalThis.__SP_VIEW__;
    const selector = view.kind === 'engine' ? '.gm canvas' : view.kind === 'fallback' ? '.gm .ff-board' : null;
    const surface = selector && document.querySelector(selector);
    if (!surface) throw new Error(`the actual ${view.kind} field surface is missing`);
    const rect = surface.getBoundingClientRect();
    const inside = p => p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom;
    const hit = p => { const el = document.elementFromPoint(p.x, p.y); return el && { tag: el.tagName, class: el.className }; };
    globalThis.__sixBeacon.coords = { ...coords, kind: view.kind,
      surface: { selector, left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      selectedUid: document.querySelector('.uframe')?.getAttribute('data-uid'), sourceHit: hit(coords.from), targetHit: hit(coords.to) };
    globalThis.__sixBeacon.mark('after-detail-shot');
    return { sourceInside: inside(coords.from), targetInside: inside(coords.to), kind: view.kind,
      surface: globalThis.__sixBeacon.coords.surface };
  }, { detailPoint, from, to, core: { uid: core.uid, row: core.row, col: core.col } });
  console.log(`${host.label}: real beacon field geometry ${JSON.stringify(geometry)}; fieldWarnings=${JSON.stringify(host.fieldWarnings)}`);
  assert.ok(geometry.sourceInside && geometry.targetInside, 'the real item and intended board tile are inside the actual field surface');
  try {
    // Keep three actual pickup moves and one final move. Each CDP input waits for
    // the software-rendered page; extra interpolation must not consume the prep.
    const releasedAt = await host.drag(from, to, { steps: 4, retarget: async () => {
      // Preserve the real held-item screenshot before the final coordinate read:
      // a slow GPU readback must not leave a stale target while the camera folds.
      await host.shot('beacon-drag');
      await cameraSettled(host.page);
      const point = await host.page.evaluate(({ row, col }) => {
        const view = globalThis.__SP_VIEW__, p = view.raw.tileScreen(row, col);
        const selector = view.kind === 'engine' ? '.gm canvas' : view.kind === 'fallback' ? '.gm .ff-board' : null;
        const surface = selector && document.querySelector(selector);
        if (!surface) throw new Error(`the actual ${view.kind} field surface is missing after pickup`);
        const rect = surface.getBoundingClientRect();
        globalThis.__sixBeacon.mark('retarget-after-midshot');
        const target = p && { x: p.x, y: p.y, kind: view.kind,
          surface: { selector, left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          inside: p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom };
        globalThis.__sixBeacon.retarget = target;
        return target;
      }, { row: core.row, col: core.col });
      assert.ok(point?.inside && Number.isFinite(point.x) && Number.isFinite(point.y),
        'the intended core tile remains inside the actual field surface after the real drag fold');
      return { x: point.x, y: point.y };
    } });
    await host.page.evaluate(point => { globalThis.__sixBeacon.releasedAt = point; globalThis.__sixBeacon.mark('after-release'); }, releasedAt);
    await host.page.waitForFunction(() => !!globalThis.__SP__.store.get().match.private?.shop?.rewardOffer, { timeout: 10000 });
    const requests = await host.requests('g.equip');
    assert.equal(requests.length, 1, 'one equipment request originated from the real drag');
    assert.equal(requests[0][1].itemUid, beacon.uid, 'the real drag uses the awarded beacon');
    assert.equal(requests[0][1].targetUid, core.uid, 'the real drag targets the intended six-tier operator');
  } catch (error) {
    // A failed/closed renderer must not replace the actual input/assertion error
    // with another CDP failure, or spend the protocol timeout on diagnostics.
    let diagnostic, timer;
    try {
      diagnostic = await Promise.race([
        host.page.evaluate(() => {
          const state = globalThis.__SP__.store.get(), priv = state.match.private;
          const kind = globalThis.__SP_VIEW__?.kind;
          const selector = kind === 'engine' ? '.gm canvas' : kind === 'fallback' ? '.gm .ff-board' : null;
          const surface = selector && document.querySelector(selector), rect = surface?.getBoundingClientRect();
          globalThis.__sixBeacon.mark('failed');
          return { trace: globalThis.__sixBeacon, requests: globalThis.__e2eReq, drops: globalThis.__e2eDrops,
            phase: state.match.public?.phase, round: state.match.public?.round,
            selection: { uid: document.querySelector('.uframe')?.getAttribute('data-uid'), detail: document.querySelector('.dpanel')?.textContent },
            inventory: [...(priv?.hand || []), ...(priv?.temp || []), ...(priv?.board || [])].filter(Boolean),
            offer: priv?.shop?.rewardOffer, surface: rect && { selector, left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            view: kind, toasts: [...document.querySelectorAll('.toast')].map(el => el.textContent.trim()) };
        }),
        new Promise(resolve => { timer = setTimeout(() => resolve({ diagnostic: 'page did not answer within 5 s' }), 5000); timer.unref(); }),
      ]);
    } catch (diagnosticError) { diagnostic = { diagnostic: diagnosticError.message }; }
    finally { clearTimeout(timer); }
    console.log(`${host.label}: real beacon drag failed: ${error.message}; before=${JSON.stringify(before)}; after=${JSON.stringify(diagnostic)}`);
    throw error;
  }
  const offer = await host.page.evaluate(() => globalThis.__SP__.store.get().match.private.shop.rewardOffer);
  assert.equal(offer.slots.length, 2, 'ordinary beacon offers two operators');
  assert.ok(offer.slots.every(slot => slot.kind === 'chess' && slot.price === 0));
  await host.page.waitForFunction(() => document.querySelectorAll('.shopbar__reward .scard').length === 2);
  let after, gained;
  const giftDeadline = Date.now() + 10000;
  do {
    after = await Promise.all(clients.map(inventory));
    gained = after.slice(1).flatMap((pieces, n) => pieces.filter(p => p.kind === 'chess' && p.id === CORE
      && !before[n + 1].some(old => old.uid === p.uid)).map(p => ({ seat: n + 1, uid: p.uid })));
    if (gained.length) break;
    await sleep(100);
  } while (Date.now() < giftDeadline);
  assert.equal(after[0].some(p => p.uid === beacon.uid || p.uid === core.uid), false, 'beacon and original core are consumed');
  assert.equal(gained.length, 1, 'one teammate received the original core immediately in R14 prep');
  assert.equal((await clients[gained[0].seat].st()).phase, 'PREP');
  assert.equal((await clients[gained[0].seat].st()).round, 14);
  await host.shot('beacon-offer');
  await host.click('.shopbar__reward .scard');
  await sleep(250);
  await host.click('.shopbar__reward .scard.is-armed');
  await host.page.waitForFunction(() => !globalThis.__SP__.store.get().match.private?.shop?.rewardOffer, { timeout: 10000 });
  assert.equal((await host.requests('g.reward')).length, 1, 'one replacement selected through the reward controls');
}

function replayUpload(start, upload, data) {
  const battle = createBattleFromSpec(start.spec, new DataSource(data, null), { recordEvents: false, quiet: true });
  for (const pool of upload.pools) {
    while (!battle.finished && battle.tickCount < pool.tick) battle.step();
    battle.sharedBoss.sync(pool.hp, pool.acked);
  }
  while (!battle.finished && battle.tickCount < upload.tick) battle.step();
  if (!battle.finished) battle.forceEnd(upload.message.result.reason);
  return compactResult(battle.result());
}

async function failureSnapshot(client) {
  if (!client.page || client.page.isClosed()) return { label: client.label, closed: true };
  let timer;
  try {
    return await Promise.race([
      client.page.evaluate(() => {
        const s = globalThis.__SP__?.store.get(), runner = globalThis.__SP_RUNNER__, trace = globalThis.__sixBalance;
        return { me: s?.me.playerId, phase: s?.match.public?.phase, round: s?.match.public?.round, ready: s?.match.private?.ready,
          states: trace?.states, phases: trace?.phases, starts: trace?.starts.map(msg => ({ battleId: msg.battleId,
            authoritative: msg.authoritative, kind: msg.kind, startAt: msg.startAt, serverNow: msg.serverNow, speed: msg.speed,
            round: msg.spec?.round, boss: msg.spec?.boss, bossId: msg.spec?.bossId, spec: msg.spec })), ends: trace?.ends,
          localPools: trace?.localPools, byBattle: trace?.byBattle, uploads: trace?.uploads, errors: trace?.errors,
          view: globalThis.__SP_VIEW__?.kind, stats: runner?.stats(), state: runner?.state(), entries: [...(runner?._entries.values() || [])].map(entry => ({
            battleId: entry.battleId, own: entry.own, authoritative: entry.authoritative, remote: entry.host?.remote,
            resultSent: entry.resultSent, ticks: entry.battle?.tickCount, time: entry.battle?.time, pending: entry.host?.pending?.size,
          })), beacon: globalThis.__sixBeacon, requests: globalThis.__e2eReq };
      }).then(snapshot => ({ ...snapshot, fieldWarnings: client.fieldWarnings })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ label: client.label, diagnostic: 'page did not answer within 5 s' }), 5000); timer.unref(); }),
    ]);
  } catch (error) { return { label: client.label, diagnostic: error.message }; }
  finally { clearTimeout(timer); }
}

for (const rhineEnabled of [true, false]) {
  const profile = rhineEnabled ? 'rhine' : 'vanilla';
  test(`${profile}: six real humans receive/use R14 beacons, retain reduced BAN and fight a doubled boss pool`,
    { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run Chrome', timeout: 300000 }, async () => {
      const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 16, startRound: 14, chess: KIT, autoPlace: true } });
      const puppeteer = (await import('puppeteer-core')).default;
      const clients = Array.from({ length: 6 }, (_, i) => new Client(puppeteer, srv.base, `${profile}-${i + 1}`,
        { w: i === 0 ? 1280 : 640, h: i === 0 ? 720 : 360, prefix: `six-balance-${profile}-p${i + 1}`, browserArgs: BROWSER_ARGS }));
      try {
        await createSixHumanRoom(clients, rhineEnabled);
        const rewards = await Promise.all(clients.map(inventory));
        for (const [i, pieces] of rewards.entries()) {
          const awarded = pieces.filter(p => p.kind === 'item' && p.id === BEACON);
          assert.equal(awarded.length, 1, `seat ${i + 1}: one actual reward beacon`);
          assert.equal(awarded[0].giftTiming, 'immediate');
        }
        const last = clients.at(-1), lastId = (await last.st()).me, lastBeacon = rewards[5].find(p => p.id === BEACON).uid;
        // Finish the room's checked module/content boot before navigating away. Unrelated
        // asset/media traffic need not become globally idle for a valid refresh.
        await warmClient(last, rhineEnabled);
        await last.page.reload({ waitUntil: 'domcontentloaded' });
        await last.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.gm'));
        await last.waitFor(s => s.phase === 'PREP' && s.round === 14, 'resume R14 prep');
        assert.equal((await last.st()).me, lastId);
        assert.deepEqual((await inventory(last)).filter(p => p.id === BEACON).map(p => p.uid), [lastBeacon], 'refresh does not duplicate the award');
        // Restore the refreshed page's exact checked profile/content before 16x
        // combat. A Worker profile still boots its own engine at the real battle start.
        await warmClient(last, rhineEnabled);
        await last.shot('prep-compact');
        await useAwardedBeacon(clients);
        await Promise.all(clients.map(recordCombat));
        await Promise.all(clients.map(client => client.hookRequests()));
        // Six real humans confirm independently. Serial CDP waits must not spend
        // the last prep seconds before the fifth/sixth person's actual click.
        await Promise.all(clients.map(client => client.click('.readybtn')));
        const confirmations = await Promise.all(clients.map(client => client.requests('g.ready')));
        for (const [index, client] of clients.entries()) {
          const requests = confirmations[index];
          assert.equal(requests.length, 1, `${client.label}: one real readiness confirmation`);
          assert.equal(requests[0][1].ready, true);
        }
        for (const client of clients) await client.page.waitForFunction(() => globalThis.__sixBalance.starts.some(s => s.spec?.round === 14), { timeout: 45000 });
        const data = getDataProfile(rhineEnabled, { log: QUIET }), gd4 = new GameData(data, 'mode_multi_hard', 4);
        for (const client of clients) {
          const capture = await client.page.evaluate(() => globalThis.__sixBalance);
          const start = capture.starts.find(s => s.spec?.round === 14);
          assert.equal(start.spec.kind, 'boss');
          assert.equal(start.spec.dataProfile, profile);
          const expected = bossPoolHp(gd4, start.spec.bossId, 4) * 2;
          assert.equal(start.spec.boss.poolMax, expected, `${client.label}: doubled four-seat maximum in real battle spec`);
          assert.equal(start.spec.boss.poolHp, expected, `${client.label}: doubled four-seat initial current HP`);
          await client.page.waitForFunction(id => globalThis.__SP_RUNNER__?.stats().errors === 0
            && globalThis.__sixBalance.localPools[id] > 0, { timeout: 30000 }, start.battleId).catch(async error => {
            const diagnostic = await client.page.evaluate(() => ({ phase: globalThis.__SP__.store.get().match.public.phase,
              localPools: globalThis.__sixBalance.localPools, phases: globalThis.__sixBalance.phases,
              stats: globalThis.__SP_RUNNER__.stats(),
              entries: [...globalThis.__SP_RUNNER__._entries.values()].map(e => ({ battleId: e.battleId,
                own: e.own, maxHp: e.battle?.sharedBoss?.maxHp })) }));
            throw new Error(`${client.label}: ${error.message}; ${JSON.stringify(diagnostic)}`, { cause: error });
          });
          const max = await client.page.evaluate(id => globalThis.__sixBalance.localPools[id], start.battleId);
          assert.equal(max, expected, `${client.label}: actual local shared pool has the same maximum`);
        }
        for (const client of clients) await client.waitFor(s => s.phase === 'RESULT', 'complete boss settlement', 150000);
        let authoritativeUploads = 0;
        for (const client of clients) {
          const captured = await client.page.evaluate(() => globalThis.__sixBalance);
          assert.deepEqual(captured.errors, [], `${client.label}: no rejected game or combat request`);
          for (const start of captured.starts.filter(s => s.authoritative && s.spec?.round === 14)) {
            const upload = captured.uploads.find(u => u.message.battleId === start.battleId);
            assert.ok(upload, `${client.label}: real browser uploaded its authoritative pair field`);
            assert.equal(upload.message.result.errors, 0);
            assert.equal(resultDigest(replayUpload(start, upload, data)).hash, resultDigest(upload.message.result).hash,
              `${client.label}: exact shared-pool timeline replay agrees with actual browser result`);
            authoritativeUploads++;
          }
          assert.equal(await client.page.evaluate(() => globalThis.__SP__.store.get().match.result.players.length), 6);
          assert.equal(await client.page.evaluate(() => globalThis.__SP_RUNNER__.stats().errors), 0);
        }
        assert.equal(authoritativeUploads, 3, 'all three pair fields uploaded and replayed');
        await last.shot('result-compact');
        assert.deepEqual(problemsOf(clients), [], 'no page, console or resource errors');
        assert.deepEqual(srv.logs.filter(line => /verify mismatch|meta handler error|\[sim\].*(?:error|failed)/i.test(line)), []);
      } catch (error) {
        console.log(`Six-seat failure: ${String(error.stack || error)}`);
        console.log(`Six-seat failure diagnostics: ${JSON.stringify({ error: String(error.stack || error), profile, clients: await Promise.all(clients.map(failureSnapshot)),
          problems: problemsOf(clients), server: srv.logs })}`);
        throw error;
      } finally {
        if (problemsOf(clients).length) console.log(problemsOf(clients).slice(0, 20).join('\n'));
        await Promise.all(clients.map(client => client.close()));
        await srv.stop();
      }
    });
}
