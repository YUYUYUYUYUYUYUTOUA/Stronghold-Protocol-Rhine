// Real-server browser E2E — a room's content set (DESIGN §32.6 P1c; opt-in, ~1 min):
//   SP_E2E=1 node --test test/ui/plugins-content.e2e.test.js   (SP_E2E_VERBOSE=1: the server's log too)
//
// A server with a data plugin of its own (bond-def: a bond value patched — no file of the game) and two browsers: the
// host switches it on in the room's 插件 panel → both pages download the room's content set, check every file's bytes and
// the manifest against the room's cs (the seats read 插件内容就绪; the tag 非官方) and show its data (the patched bond in
// data.get('bonds')); the guest readies, the host starts → the match runs in the set's match host worker (the briefing's
// and the HUD's unofficial marks) — the host's page is the authority of its own battle: it simulates on the set's data and
// its b.result (naming the room's cs) is accepted by the server (the worker's field: resultSource 'client'). The guest's
// page was made to claim another content (__SP_CONTENT__.forgeHeldCs, a tampered cs): it is no authority — it sends no
// b.result — and the server takes its field over at the deadline (resultSource 'server'). No console / page errors, no
// failed request but the game's own art when this checkout has none.
//
// Screenshots: test/e2e/out/plugins-content-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, problemsOf } from '../e2e/client.mjs';
import { writePlugin } from '../helpers/pluginFixtures.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const bondPatch = (value) => ({ patch: 1, ops: [['bb', 'base_def'], ['buffs', 0, 'bb', 'base_def']].map((p) => ({ op: 'set', file: 'bonds', id: 'deputShip', path: p, value })) });

describe('a room\'s content set in the browser (P1c)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('host switches a data plugin on → the guest loads and checks it → a battle on it, the result accepted; a tampered cs is no authority', { timeout: 5 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugins-content-e2e-'));
    writePlugin(path.join(tmp, 'bond-def'), { manifest: 2, name: { zh: '盟约数值', en: 'Bond numbers' }, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'],
      authors: ['e2e'], permissions: ['data.patch'], data: ['p.json'] }, { 'p.json': bondPatch(0.3) });
    const { startServer } = await import('../../server/index.js');
    const serverLog = [];
    const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => {
      serverLog.push({ at: Date.now(), level, text: args.map(x => x instanceof Error ? x.stack : String(x)).join(' ') });
      if (serverLog.length > 400) serverLog.shift();
      if (process.env.SP_E2E_VERBOSE === '1') console[level](...args);
    }]));
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: process.env.SP_E2E_VERBOSE !== '1', pluginsDir: tmp,
      // Test the production battle clock; this is content authority coverage, not an artificial 16x throughput test.
      log, matchHost: { matchOptions: { timerScale: 0.1, combatSpeed: 2, botRehearsal: 0 } } });
    for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
      const h = await fetch(`${srv.url}/healthz?traffic=1`).then((r) => r.json(), () => null);
      if (!h?.assetHashes || h.assetHashes.ready) break;
      await sleep(150);
    }
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.url, 'host', { prefix: 'plugins-content', w: 1600, h: 900 });
    const guest = new Client(P, srv.url, 'guest', { prefix: 'plugins-content', w: 1600, h: 900 });
    let observing = true, observation = null;
    const readClient = async promise => {
      let timer;
      try {
        return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve({ diagnosticTimeoutMs: 5000 }), 5000); })]);
      } catch (error) { return { diagnosticError: error.message }; }
      finally { clearTimeout(timer); }
    };
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.click('.mode-card', '同盟模拟');
      await host.click('.diff-card', '标准模拟');
      await host.click('.create-box button', '创建同盟');
      const code = (await host.waitFor((s) => !!s.room?.code, 'room created')).room.code;
      await guest.open();
      await guest.enter('阿米娅');
      await guest.click('.join-row input');
      await guest.page.keyboard.type(code);
      await guest.click('.join-row button', '加入同盟');
      await guest.page.waitForSelector('.room-screen', { timeout: 15000 });
      const vanillaBond = await guest.page.evaluate(async () => (await globalThis.__SP__.data.load('bonds'))?.deputShip?.bb?.base_def);

      // the host switches the data plugin on in the 插件 panel
      await host.click('[data-testid="plugin-tag"]');
      await host.page.waitForSelector('[data-testid="plugin-panel"] [data-plugin="bond-def"]', { timeout: 10000 });
      assert.match(await host.page.$eval('[data-plugin="bond-def"]', (e) => e.textContent), /改变玩法/);
      await host.click('[data-plugin="bond-def"] button[role="switch"]');
      await host.page.waitForFunction(() => document.querySelector('[data-plugin="bond-def"] button[role="switch"]')?.getAttribute('aria-checked') === 'true', { timeout: 10000 });
      await host.page.waitForFunction(() => /通过校验/.test(document.querySelector('[data-testid="content-state"]')?.textContent || ''), { timeout: 30000 });
      await host.shot('panel');
      await host.click('.modal__actions button', '完成');

      // both pages: the set downloaded and checked, its data shown, every seat 插件内容就绪, the tag 非官方
      const room = await guest.page.evaluate(() => globalThis.__SP__.store.get().room);
      assert.equal(room.content.vanilla, false);
      const cs = room.content.cs;
      for (const c of [host, guest]) {
        await c.page.waitForFunction((want) => { const s = globalThis.__SP_CONTENT__?.state(); return s && s.status === 'ready' && s.held === want; }, { timeout: 30000 }, cs);
        await c.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="seat-content"]')].length === 2
          && [...document.querySelectorAll('[data-testid="seat-content"]')].every((e) => /插件内容就绪/.test(e.textContent)), { timeout: 15000 });
        assert.equal(await c.page.evaluate(() => globalThis.__SP__.data.get('bonds')?.deputShip?.bb?.base_def), 0.3, `${c.label}: the room's data`);
        assert.match(await c.page.$eval('[data-testid="plugin-tag"]', (e) => e.textContent), /非官方/);
      }
      assert.notEqual(vanillaBond, 0.3);
      await guest.shot('room-guest');

      // the guest's page claims another content than the one it checked: its runner must refuse the authority
      await guest.page.evaluate(() => globalThis.__SP_CONTENT__.forgeHeldCs('0'.repeat(64)));
      for (const c of [host, guest]) await c.page.evaluate(() => {
        const trace = globalThis.__SP_CONTENT_E2E__ = { starts: [], ends: [] };
        globalThis.__SP__.net.on('b.start', m => trace.starts.push({ at: performance.now(), battleId: m.battleId,
          authoritative: m.authoritative, elapsed: m.elapsed, speed: m.speed, cs: m.spec?.cs, timeLimit: m.spec?.timeLimit }));
        globalThis.__SP__.net.on('b.end', m => trace.ends.push({ at: performance.now(), ...m }));
      });
      await guest.click('.room-bar__right button', '准备就绪');
      await host.page.waitForFunction(() => !document.querySelector('.room-bar__right button[disabled]'), { timeout: 15000 });
      await host.click('.room-bar__right button', '开始模拟');
      await host.page.waitForSelector('.brief [data-testid="unofficial-mark"]', { timeout: 30000 });
      await host.shot('briefing');
      const match = srv.lobby.getRoom(code).match;
      assert.equal(match.hosted, true, 'the match runs in the content set\'s match host');

      // round 1: the host's battle — authority on the set's data, b.result with the room's cs, accepted
      const hostId = await host.page.evaluate(() => globalThis.__SP__.store.get().me.playerId);
      const guestId = await guest.page.evaluate(() => globalThis.__SP__.store.get().me.playerId);
      await host.waitFor((s) => s.phase === 'COMBAT', 'the first battle', 120000);
      // Keep handles to the real entries before settlement clears runner._entries. Their delivery fields continue
      // to change on the actual b.result response; copying their initial values or reading the next round is wrong.
      const hostBattle = await host.page.waitForFunction(() => {
        const pid = globalThis.__SP__.store.get().me.playerId;
        return [...globalThis.__SP_RUNNER__._entries.values()].find(e => e.kind === 'normal' && e.members.includes(pid));
      }, { timeout: 30000 });
      const hostBattleId = await hostBattle.evaluate(e => e.battleId);
      const firstFields = await match.diag();
      assert.ok(firstFields.fields.some(f => f.battleId === hostBattleId && f.players.includes(hostId)));
      const guestBattleId = firstFields.fields.find(f => f.kind === 'normal' && f.players.includes(guestId))?.battleId;
      assert.ok(guestBattleId, `the guest's field: ${JSON.stringify(firstFields)}`);
      // The last completed field survives only the 150ms COMBAT_END window. Observe immediately, including any
      // already-finished firstFields, while independent DOM/CDP waits and the HUD screenshot are still in progress.
      const finished = new Map();
      let last = firstFields, observationError = null;
      const remember = d => { for (const f of d?.fields || []) if (f.done && !finished.has(f.battleId)) finished.set(f.battleId, f); };
      remember(firstFields);
      observation = (async () => {
        for (const t0 = Date.now(); observing && Date.now() - t0 < 90000 && !(finished.has(hostBattleId) && finished.has(guestBattleId)); await sleep(50)) {
          last = await match.diag();
          remember(last);
        }
      })().catch(error => { observationError = error; });
      // A forged held cs may correctly prevent construction entirely. Keep an existing replica's real reference,
      // but never wait for one to be created: "no entry" is also the intended refusal path.
      const guestBattle = await guest.page.evaluateHandle(battleId => globalThis.__SP_RUNNER__._entries.get(battleId) || null, guestBattleId);
      assert.equal(await hostBattle.evaluate(e => e.authoritative), true);
      assert.equal(await guestBattle.evaluate(e => !e || e.authoritative === false), true, 'the forged content was refused before takeover');
      // P3b: this exact battle uses a real Worker; the page holds only cached wire state.
      assert.equal(await hostBattle.evaluate(e => e.host?.remote && e.host.worker instanceof Worker
        && !e.battle.step && !e.battle.data), true);
      await host.page.waitForSelector('.gtop [data-testid="unofficial-mark"]', { timeout: 15000 });
      await host.shot('hud');
      await observation;
      assert.ifError(observationError);
      const mine = finished.get(hostBattleId);
      const theirs = finished.get(guestBattleId);
      const d = last; // the same first-battle settlement, before later rounds can clear or dispose the match
      console.log('Content server settlement:', JSON.stringify({ firstFields, finished: [...finished.values()], settlement: d, serverLog }));
      const reportClients = async () => {
        const [hostState, guestState] = await Promise.all([
          readClient(hostBattle.evaluate(e => ({ trace: globalThis.__SP_CONTENT_E2E__, entry: {
            authoritative: e.authoritative, delivery: e.delivery, cs: e.spec.cs, simCs: e.sim?.cs,
            time: e.battle?.time, ticks: e.battle?.tickCount, done: e.done, failed: e.failed,
            resultSent: e.resultSent, remote: e.host?.remote, stopped: e.host?.stopped, progress: e.host?.progress?.(),
          } }))),
          readClient(guestBattle.evaluate((e, battleId) => {
            e ||= globalThis.__SP_RUNNER__._entries.get(battleId);
            return { trace: globalThis.__SP_CONTENT_E2E__, entry: e ? { authoritative: e.authoritative, delivery: e.delivery } : null };
          }, guestBattleId)),
        ]);
        console.log('Content optional client diagnostics:', JSON.stringify({ host: hostState, guest: guestState }));
      };
      if (!mine || !theirs || mine.resultSource !== 'client' || theirs.resultSource !== 'server') await reportClients();
      assert.ok(mine && theirs, `both battles settled: ${JSON.stringify([...finished.values()])} (the match's diag: ${JSON.stringify(last)?.slice(0, 600)})`);
      assert.ok(mine.players.includes(hostId));
      assert.ok(theirs.players.includes(guestId));
      assert.equal(mine.resultSource, 'client', 'the host\'s result was accepted');
      assert.equal(theirs.resultSource, 'server', 'the guest\'s field was taken over by the server');
      assert.equal(d.verifyStats.rejected, 0, 'no result refused: the host named the room\'s content');
      assert.ok(d.verifyStats.takeovers >= 1 || theirs.mode === 'server', `the takeover: ${JSON.stringify(d.verifyStats)}`);
      // Required truth reads keep the original protocol/case budgets. The optional 5s diagnostic bound above must
      // never supply, replace or time-limit the authority/delivery/content assertions.
      const [hostEntry, guestEntry] = await Promise.all([
        hostBattle.evaluate(e => ({ authoritative: e.authoritative, delivery: e.delivery, cs: e.spec.cs })),
        guestBattle.evaluate((e, battleId) => {
          e ||= globalThis.__SP_RUNNER__._entries.get(battleId);
          return e ? { authoritative: e.authoritative, delivery: e.delivery } : null;
        }, guestBattleId),
      ]);
      console.log('Content delivered entries:', JSON.stringify({ hostEntry, guestEntry }));
      if (hostEntry.authoritative !== true || hostEntry.delivery !== 'delivered' || hostEntry.cs !== cs
        || (guestEntry !== null && (guestEntry.authoritative !== false || guestEntry.delivery !== null))) await reportClients();
      assert.deepEqual(hostEntry, { authoritative: true, delivery: 'delivered', cs });
      assert.ok(guestEntry === null || (guestEntry.authoritative === false && guestEntry.delivery === null), 'the forged-content guest sent no result');

      // no errors; a failed request only for the game's own art when this checkout has none
      const art = fs.existsSync(path.join(ROOT, 'public/assets'));
      const problems = problemsOf([host, guest]).filter((p) => art || !/\/assets\//.test(p));
      assert.deepEqual(problems, []);
    } finally {
      observing = false;
      // Closing the contexts releases the retained handles, including if a page can no longer answer CDP reads.
      await host.close();
      await guest.close();
      await srv.close();
      await observation;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
