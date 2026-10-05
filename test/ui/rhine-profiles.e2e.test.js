// Real Chrome pages exercise room settings, profile-specific loadouts, reconnect and normal client-side combat.
// Opt-in: SP_E2E=1 CHROME_PATH=... node --test test/ui/rhine-profiles.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';
import { getDataProfile } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { compactResult, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const PTILOPSIS = 'chess_char_4_21_a';
const SARIA = 'chess_char_5_11_a';
const DOROTHY = 'chess_rhine_dorothy_a';
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };
const profileId = enabled => enabled ? 'rhine' : 'vanilla';

function observeImageReplacement(client) {
  client.replacedImageRequests = new Set();
  client.page.on('requestfailed', request => {
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
  return client.page.evaluate(({ ptilopsis, saria, dorothy }) => {
    const { data } = globalThis.__SP__;
    const summary = id => {
      const c = data.lookup('chess', id);
      if (!c) return null;
      const g = data.lookup('chess', c.goldenId);
      return { tier: c.tier, garrisons: c.garrisonIds, skill: c.skill.skillId,
        modules: (g?.modules || []).map(m => m.uniEquipId), defaultModule: g?.defaultUniEquipId ?? null };
    };
    return { profile: data.profileId, ptilopsis: summary(ptilopsis), saria: summary(saria), dorothy: summary(dorothy) };
  }, { ptilopsis: PTILOPSIS, saria: SARIA, dorothy: DOROTHY });
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
  await client.page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 5000 });
}

async function createCoop(client, name) {
  await client.open();
  observeImageReplacement(client);
  await client.enter(name);
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
  await client.page.evaluate(() => {
    globalThis.__profileCombat = { starts: [], uploads: [], errors: [] };
    const net = globalThis.__SP__.net;
    net.on('*', msg => {
      if (msg.t === 'b.start') globalThis.__profileCombat.starts.push(JSON.parse(JSON.stringify(msg)));
      if (msg.t === 'error') globalThis.__profileCombat.errors.push({ code: msg.code, detail: msg.detail });
    });
    const send = net._sendRaw.bind(net);
    net._sendRaw = msg => {
      if (msg.t === 'b.result') globalThis.__profileCombat.uploads.push(JSON.parse(JSON.stringify(msg)));
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
      srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 16, startRound: 1, idleBots: true, autoPlace: true,
        chess: [PTILOPSIS, SARIA, 'chess_char_1_01_b', 'chess_char_1_19_b', DOROTHY] } });
    } finally {
      if (previousVerify === undefined) delete process.env.SP_VERIFY;
      else process.env.SP_VERIFY = previousVerify;
    }
    const puppeteer = (await import('puppeteer-core')).default;
    const vanillaHost = new Client(puppeteer, srv.base, 'vanilla-host', { prefix: 'rhine-profiles-vanilla-host' });
    const guest = new Client(puppeteer, srv.base, 'vanilla-guest', { prefix: 'rhine-profiles-vanilla-guest' });
    const rhineHost = new Client(puppeteer, srv.base, 'rhine-host', { prefix: 'rhine-profiles-rhine-host' });
    const clients = [vanillaHost, guest, rhineHost];
    try {
      const code = await createCoop(vanillaHost, '原版房主');
      await guest.open(`?room=${code}`);
      observeImageReplacement(guest);
      await guest.enter('原版队友');
      await guest.waitFor(s => s.room?.code === code, 'guest joins');
      await waitProfile(guest, true);
      const initial = await rosterSnapshot(vanillaHost);
      assert.equal(initial.ptilopsis.tier, 3);
      assert.equal(initial.saria.tier, 3);
      assert.equal(initial.dorothy.tier, 4);
      assert.equal(await guest.page.$$eval('[data-testid="rhine-toggle"] button', buttons => buttons.every(button => button.disabled)), true);
      await assertRejected(guest, 'room.setRhine', { enabled: false }, 'NOT_HOST');

      // A real Rhine-only loadout before the setting changes, then inspect the newly loaded vanilla overlay.
      await vanillaHost.click('[data-testid="loadout-open"]');
      await vanillaHost.page.waitForSelector('.lo .lo-card', { visible: true });
      await searchLoadout(vanillaHost, '多萝西');
      await vanillaHost.page.waitForSelector(`.lo-card[data-chess="${DOROTHY}"]`, { visible: true });
      await vanillaHost.click(`.lo-card[data-chess="${DOROTHY}"]`);
      await vanillaHost.click('.lo-detail .lo-skill[data-skill="0"]');
      await vanillaHost.page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''));
      await closeLoadout(vanillaHost);
      await guest.click('.room-bar__right button', '准备就绪');
      await guest.page.waitForFunction(() => {
        const s = globalThis.__SP__.store.get();
        return s.room.seats.find(seat => seat?.playerId === s.me.playerId)?.ready;
      });
      await vanillaHost.click('[data-testid="rhine-vanilla"]');
      await Promise.all([waitProfile(vanillaHost, false), waitProfile(guest, false)]);
      const vanillaRoom = await roomSnapshot(vanillaHost);
      assert.equal(vanillaRoom.seats.filter(seat => !seat.isBot).every(seat => !seat.ready), true, 'switching clears every human ready flag');
      assert.equal(await guest.page.$eval('[data-testid="rhine-vanilla"]', button => button.getAttribute('aria-pressed')), 'true');
      const vanilla = await rosterSnapshot(vanillaHost);
      assert.equal(vanilla.ptilopsis.tier, 4, 'vanilla whiteface retains its original tier');
      assert.equal(vanilla.saria.tier, 5, 'vanilla Saria retains her original tier');
      assert.equal(vanilla.dorothy, null);
      assert.notDeepEqual(vanilla.ptilopsis.garrisons, initial.ptilopsis.garrisons);
      assert.notDeepEqual(vanilla.saria.garrisons, initial.saria.garrisons);
      const expectedVanilla = getDataProfile(false, { log: QUIET });
      assert.deepEqual(vanilla.ptilopsis.modules, expectedVanilla.chess[expectedVanilla.chess[PTILOPSIS].goldenId].modules.map(m => m.uniEquipId));
      await vanillaHost.click('[data-testid="loadout-open"]');
      await vanillaHost.page.waitForSelector('.lo', { visible: true });
      await searchLoadout(vanillaHost, '多萝西');
      assert.equal(await vanillaHost.page.$$eval('.lo-card', cards => cards.length), 0, 'the actual vanilla overlay excludes Dorothy');
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
      await vanillaHost.shot('six-seat-room');
      await rhineHost.shot('six-seat-room');

      // Reload while waiting in the vanilla room: restore identity and fetch that profile before controls unlock.
      const guestId = (await guest.st()).me;
      await guest.page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      await guest.page.reload({ waitUntil: 'domcontentloaded' });
      await guest.page.waitForFunction(() => !!globalThis.__SP__, { timeout: 30000 });
      await guest.waitFor(s => s.room?.code === code, 'guest reconnects to vanilla');
      await waitProfile(guest, false);
      assert.equal((await guest.st()).me, guestId);
      assert.deepEqual(await rosterSnapshot(guest), vanilla);
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
      assert.equal(privateLoadout[DOROTHY], undefined, 'the new match has no stale Rhine-only loadout');
      for (const client of clients) await captureCombat(client);
      await Promise.all(clients.map(client => client.click('.brief__foot .btn--primary', '准备就绪')));
      await chooseDrafts(clients);
      await Promise.all(clients.map(client => client.click('.readybtn')));

      // Inspect the live, per-battle DataSource rather than only the current page's display cache.
      for (const [client, enabled] of [[vanillaHost, false], [guest, false], [rhineHost, true]]) {
        const live = await client.page.waitForFunction(({ ptilopsis, saria, dorothy }) => {
          const e = [...(globalThis.__SP_RUNNER__?._entries?.values() || [])].find(e => e.own && e.battle && e.spec.round === 1);
          if (!e) return false;
          const chess = id => e.battle.data.getChess(id)?.raw ?? null;
          return { enabled: e.spec.rhineEnabled, profile: e.spec.dataProfile, authoritative: e.authoritative,
            ptilopsisTier: chess(ptilopsis)?.tier, sariaTier: chess(saria)?.tier, dorothyTier: chess(dorothy)?.tier ?? null };
        }, { timeout: 60000, polling: 100 }, { ptilopsis: PTILOPSIS, saria: SARIA, dorothy: DOROTHY }).then(handle => handle.jsonValue());
        assert.deepEqual(live, { enabled, profile: profileId(enabled), authoritative: true,
          ptilopsisTier: enabled ? 3 : 4, sariaTier: enabled ? 3 : 5, dorothyTier: enabled ? 4 : null });
      }
      for (const client of clients) await client.page.waitForFunction(() => globalThis.__profileCombat.uploads.length > 0, { timeout: 90000 });
      for (const [client, enabled] of [[vanillaHost, false], [guest, false], [rhineHost, true]]) {
        const captured = await client.page.evaluate(() => globalThis.__profileCombat);
        assert.deepEqual(captured.errors, [], `${client.label}: no rejected combat report`);
        const start = captured.starts.find(msg => msg.authoritative && msg.spec.round === 1 && msg.kind === 'normal');
        assert.ok(start, `${client.label}: an authoritative normal field was received`);
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
      await vanillaHost.page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
      await vanillaHost.page.reload({ waitUntil: 'domcontentloaded' });
      await vanillaHost.page.waitForFunction(() => !!globalThis.__SP__ && !!globalThis.__SP_RUNNER__, { timeout: 30000 });
      await vanillaHost.waitFor(s => s.phase === 'PREP' && s.round === 2 && s.room?.code === code, 'vanilla mid-match reconnect');
      await waitProfile(vanillaHost, false);
      assert.equal((await roomSnapshot(vanillaHost)).pubProfile, 'vanilla');
      assert.deepEqual(await rosterSnapshot(vanillaHost), vanilla);
      await vanillaHost.page.waitForFunction(() => globalThis.__SP_VIEW__ && document.querySelector('.gm canvas')?.width > 0,
        { timeout: 30000 });
      await sleep(1800); // the reconnected prep camera and round banner complete their entrance
      await vanillaHost.shot('reconnected-prep');
      assert.deepEqual(pageProblems(clients), [], 'no console, page or resource errors in the real pages');
      assert.deepEqual(srv.logs.filter(line => /verify mismatch|meta handler error|\[sim\].*(?:error|failed)/i.test(line)), [], 'no server verification/content errors');
    } finally {
      if (pageProblems(clients).length) console.log(pageProblems(clients).slice(0, 20).join('\n'));
      await Promise.all(clients.map(client => client.close()));
      await srv.stop();
    }
  });
