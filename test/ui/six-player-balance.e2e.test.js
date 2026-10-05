// Production UI/network regression for six-seat balance, with only the existing scenario fixtures
// (skip to R14, known starter operators, automatic placement, faster combat). No fabricated UI state
// or direct game requests: room controls, drafts, beacon use/reward and readiness use real input.
// SP_E2E=1 CHROME_PATH=... node --test test/ui/six-player-balance.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';
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
const inventory = c => c.page.evaluate(() => {
  const p = globalThis.__SP__.store.get().match.private;
  return [...(p?.hand || []), ...(p?.temp || []), ...(p?.board || [])].filter(Boolean);
});

async function createSixHumanRoom(clients, rhineEnabled) {
  const host = clients[0];
  await host.open();
  await host.enter('六人验收1');
  await host.click('.mode-card', '同盟模拟');
  await host.click('.diff-card', '绝境模拟');
  await host.click('.create-box button', '创建同盟');
  const { room } = await host.waitFor(s => !!s.room?.code, 'room created');
  if (!rhineEnabled) {
    await host.click('[data-testid="rhine-vanilla"]');
    await host.page.waitForFunction(() => globalThis.__SP__.store.get().room?.rhineEnabled === false
      && globalThis.__SP__.data.profileId === 'vanilla' && globalThis.__SP__.store.get().ui.dataReady);
  }
  for (const [i, client] of clients.slice(1).entries()) {
    await client.open(`?room=${room.code}`);
    await client.enter(`六人验收${i + 2}`);
    await client.waitFor(s => s.room?.code === room.code, 'join six-human room');
  }
  for (const client of clients.slice(1)) await client.click('.room-bar__right button', '准备就绪');
  await host.click('.room-bar__right button', '开始模拟');
  for (const client of clients) {
    await client.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
    const pub = await client.page.evaluate(() => globalThis.__SP__.store.get().match.public);
    assert.equal(pub.startingPlayerCount, 6);
    assert.equal(pub.dataProfile, rhineEnabled ? 'rhine' : 'vanilla');
    assert.deepEqual(pub.openingBans, { core: rhineEnabled ? 2 : 1, addon: 4 });
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
  for (const client of clients) await client.waitFor(s => s.phase === 'PREP' && s.round === 14 && !s.ready, 'R14 prep');
}

async function recordCombat(client) {
  await client.page.evaluate(() => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const trace = globalThis.__sixBalance = { starts: [], pools: [], uploads: [], errors: [], byBattle: {} };
    const net = globalThis.__SP__.net;
    net.on('*', msg => {
      if (msg.t === 'b.start') trace.starts.push(copy(msg));
      if (msg.t === 'error') trace.errors.push({ code: msg.code, detail: msg.detail });
      if (msg.t === 'b.pool') {
        trace.pools.push(copy(msg));
        // The real runner has already applied the pool message synchronously. Record its exact
        // simulation tick so server-side replay can apply the same external shared-pool updates.
        for (const entry of globalThis.__SP_RUNNER__?._entries?.values() || []) {
          if (!entry.own || !entry.battle || entry.resultSent) continue;
          (trace.byBattle[entry.battleId] ||= []).push({ tick: entry.battle.tickCount,
            hp: msg.hp, acked: msg.acked?.[entry.fieldId] });
        }
      }
    });
    const send = net._sendRaw.bind(net);
    net._sendRaw = msg => {
      if (msg.t === 'b.result') {
        const entry = globalThis.__SP_RUNNER__?._entries?.get(msg.battleId);
        trace.uploads.push({ message: copy(msg), tick: entry?.battle?.tickCount,
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
  const from = await host.piecePoint(beacon.uid), to = await host.tilePoint(core.row, core.col);
  assert.ok(from && to, 'beacon and core tile have real canvas coordinates');
  await host.page.mouse.click(from.x, from.y);
  await host.page.waitForFunction(() => document.querySelector('.dpanel')?.textContent.includes('信标'));
  assert.match(await host.page.$eval('.dpanel', panel => panel.textContent), /第14回合六人补给信标.*使用后立即转赠/,
    'the actual awarded item detail explains its special R14 delivery timing');
  await host.shot('beacon-detail');
  await host.drag(from, to, { midShot: 'beacon-drag' });
  await host.page.waitForFunction(() => !!globalThis.__SP__.store.get().match.private?.shop?.rewardOffer, { timeout: 10000 });
  assert.equal((await host.requests('g.equip')).length, 1, 'one equipment request originated from the real drag');
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

for (const rhineEnabled of [true, false]) {
  const profile = rhineEnabled ? 'rhine' : 'vanilla';
  test(`${profile}: six real humans receive/use R14 beacons, retain reduced BAN and fight a doubled boss pool`,
    { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run Chrome', timeout: 300000 }, async () => {
      const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 16, startRound: 14, chess: KIT, autoPlace: true } });
      const puppeteer = (await import('puppeteer-core')).default;
      const clients = Array.from({ length: 6 }, (_, i) => new Client(puppeteer, srv.base, `${profile}-${i + 1}`,
        { w: i === 5 ? 1280 : 1920, h: i === 5 ? 720 : 1080, prefix: `six-balance-${profile}-p${i + 1}` }));
      try {
        await createSixHumanRoom(clients, rhineEnabled);
        const rewards = await Promise.all(clients.map(inventory));
        for (const [i, pieces] of rewards.entries()) {
          const awarded = pieces.filter(p => p.kind === 'item' && p.id === BEACON);
          assert.equal(awarded.length, 1, `seat ${i + 1}: one actual reward beacon`);
          assert.equal(awarded[0].giftTiming, 'immediate');
        }
        const last = clients.at(-1), lastId = (await last.st()).me, lastBeacon = rewards[5].find(p => p.id === BEACON).uid;
        await last.page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 });
        await last.page.reload({ waitUntil: 'domcontentloaded' });
        await last.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.gm'));
        await last.waitFor(s => s.phase === 'PREP' && s.round === 14, 'resume R14 prep');
        assert.equal((await last.st()).me, lastId);
        assert.deepEqual((await inventory(last)).filter(p => p.id === BEACON).map(p => p.uid), [lastBeacon], 'refresh does not duplicate the award');
        await last.shot('prep-720');
        await useAwardedBeacon(clients);
        await Promise.all(clients.map(recordCombat));
        for (const client of clients) await client.click('.readybtn');
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
          await client.page.waitForFunction(() => globalThis.__SP_RUNNER__?.stats().errors === 0
            && [...globalThis.__SP_RUNNER__._entries.values()].some(e => e.battle?.sharedBoss?.maxHp > 0), { timeout: 30000 });
          const max = await client.page.evaluate(() => [...globalThis.__SP_RUNNER__._entries.values()].find(e => e.own)?.battle.sharedBoss.maxHp);
          assert.equal(max, expected, `${client.label}: actual local shared pool has the same maximum`);
        }
        for (const client of clients) await client.waitFor(s => s.phase === 'RESULT', 'complete boss settlement', 150000);
        let authoritativeUploads = 0;
        for (const client of clients) {
          const captured = await client.page.evaluate(() => globalThis.__sixBalance);
          assert.deepEqual(captured.errors, [], `${client.label}: no rejected result`);
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
        await last.shot('result-720');
        assert.deepEqual(problemsOf(clients), [], 'no page, console or resource errors');
        assert.deepEqual(srv.logs.filter(line => /verify mismatch|meta handler error|\[sim\].*(?:error|failed)/i.test(line)), []);
      } finally {
        if (problemsOf(clients).length) console.log(problemsOf(clients).slice(0, 20).join('\n'));
        await Promise.all(clients.map(client => client.close()));
        await srv.stop();
      }
    });
}
