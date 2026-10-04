// Five/six independent browser clients use the actual room, draft and client-side combat UI.
// Opt-in, like the other real-browser suites: SP_E2E=1 CHROME_PATH=... node --test this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MAX_SEATS } from '../../shared/constants.js';
import { Client, ROOT, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

async function createCoop(clients) {
  const count = clients.length;
  const host = clients[0];
  await host.open();
  await host.enter(`Team${count}P1`);
  await host.click('.mode-card', '同盟模拟');
  await host.click('.diff-card', '标准模拟');
  await host.click('.create-box button', '创建同盟');
  const { room } = await host.waitFor(s => !!s.room?.code, 'room created');
  for (let i = 1; i < clients.length; i++) {
    const c = clients[i];
    await c.open(`?room=${room.code}`);
    await c.enter(`Team${count}P${i + 1}`);
    await c.waitFor(s => s.room?.code === room.code, 'joined room');
  }
  for (const c of clients) {
    await c.page.waitForFunction(count => document.querySelectorAll('.seat:not(.seat--empty)').length === count, {}, count);
    assert.equal(await c.page.$$eval('.seat', rows => rows.length), MAX_SEATS, 'room renders its entire capacity');
  }
  // Seat cards have staggered entrance animations; inspect their final visible layout.
  await sleep(900);
  for (const c of clients) {
    const visible = await c.page.$$eval('.seat', rows => rows.every(el => {
      const r = el.getBoundingClientRect();
      return Number(getComputedStyle(el).opacity) > 0.99 && r.left >= 0 && r.right <= innerWidth;
    }));
    assert.equal(visible, true, 'all seat cards visible within desktop width');
  }
  await host.shot('room');
  const last = clients.at(-1);
  await last.shot('room-720');
  const lastId = (await last.st()).me;
  await last.page.reload({ waitUntil: 'domcontentloaded' });
  await last.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'));
  await last.waitFor(s => s.room?.code === room.code, 'last player resumes room');
  assert.equal((await last.st()).me, lastId, 'reload keeps the last seat identity');
  for (const c of clients.slice(1)) await c.click('.room-bar__right button', '准备就绪');
  await host.click('.room-bar__right button', '开始模拟');
  for (const c of clients) await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
  for (const c of clients) {
    const opening = await c.page.evaluate(() => {
      const pub = globalThis.__SP__.store.get().match.public;
      return { count: pub.startingPlayerCount, bans: pub.openingBans };
    });
    assert.equal(opening.count, count, 'BAN rule captures starting participant count');
    assert.deepEqual(opening.bans, { core: 0, addon: 1 }, '5–6 players ban one fewer core in standard mode');
  }
  for (const c of clients) await c.click('.brief__foot .btn--primary', '准备就绪');
  const picked = new Set();
  const deadline = Date.now() + 120000;
  while (picked.size < count && Date.now() < deadline) {
    for (const c of clients) {
      const s = await c.st();
      if (s.phase !== 'BAND_DRAFT' || picked.has(c.label) || s.draft?.turn !== s.me) continue;
      // Choose a currently free strategy by scrolling the real grid and clicking it.
      const name = await c.page.evaluate(() => {
        const free = [...document.querySelectorAll('.dband:not(.is-taken)')];
        const el = free.find(row => !row.textContent.includes('老鲤'));
        el?.scrollIntoView({ block: 'nearest' });
        return el?.querySelector('.dband__name')?.textContent.trim();
      });
      assert.ok(name, 'a free strategy exists');
      await sleep(150);
      await c.click('.dband:not(.is-taken)', name);
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      picked.add(c.label);
    }
    await sleep(150);
  }
  assert.equal(picked.size, count, 'every player chooses a strategy');
  for (const c of clients) {
    await c.waitFor(s => s.phase === 'PREP', 'prep');
    await c.page.waitForFunction(count => document.querySelectorAll('.team__row').length === count, {}, count);
    assert.equal(await c.page.$$eval('.team__row', rows => rows.length), count, 'all team rows visible');
    // Record real net events without replacing requests or the simulation.
    await c.page.evaluate(() => {
      globalThis.__fiveEvents = [];
      globalThis.__SP__.net.on('*', m => {
        if (['b.start', 'b.end', 'error', 'm.result', 'm.public'].includes(m.t)) {
          globalThis.__fiveEvents.push({ t: m.t, fieldId: m.fieldId, kind: m.spec?.kind,
            authoritative: m.authoritative, code: m.code, reason: m.reason,
            phase: m.phase, fields: m.fields });
        }
      });
    });
  }
  await host.shot('prep');
  await last.shot('prep-720');
  return lastId;
}

for (const count of [5, 6]) {
for (const scene of ['normal', 'boss']) {
  test(`${count} real browser players: ${scene} combat, last-seat resume, BAN and UI`,
    { skip: !ENABLED, timeout: 300000 }, async () => {
      const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 16,
        startRound: scene === 'boss' ? 'boss' : 1, kit: 4, autoPlace: true } });
      const puppeteer = (await import('puppeteer-core')).default;
      const clients = Array.from({ length: count }, (_, i) => new Client(puppeteer, srv.base, `p${i + 1}`,
        { w: i === count - 1 ? 1280 : 1920, h: i === count - 1 ? 720 : 1080, prefix: `team${count}-${scene}-p${i + 1}` }));
      try {
        const lastId = await createCoop(clients);
        // All humans ready via the real controls; each browser receives its own battle.
        for (const c of clients) await c.click('.readybtn');
        for (const c of clients) {
          await c.page.waitForFunction(() => globalThis.__fiveEvents.some(e => e.t === 'b.start'), { timeout: 30000 });
          const events = await c.page.evaluate(() => globalThis.__fiveEvents);
          assert.ok(events.some(e => e.t === 'b.start' && e.kind === (scene === 'boss' ? 'boss' : 'normal')));
        }
        const phase = scene === 'boss' ? 'FINAL_ASSAULT' : 'COMBAT';
        await clients[0].page.waitForFunction(phase => globalThis.__fiveEvents.some(e => e.phase === phase && e.fields?.length), {}, phase);
        const fields = await clients[0].page.evaluate(phase => globalThis.__fiveEvents.find(e => e.phase === phase && e.fields?.length).fields, phase);
        assert.equal(fields.length, scene === 'boss' ? 3 : count);
        if (scene === 'boss') {
          assert.deepEqual(fields.map(f => f.players.length).sort(), count === 5 ? [1, 2, 2] : [2, 2, 2], 'boss groups match actual players');
          assert.ok(fields.some(f => f.players.length === (count === 5 ? 1 : 2) && f.players.includes(lastId)), 'last player belongs to the third field');
        }
        if (scene === 'normal') {
          for (const c of clients) await c.waitFor(s => s.phase === 'PREP' && s.round === 2, 'round one settles', 90000);
        } else {
          for (const c of clients) await c.waitFor(s => s.phase === 'RESULT', 'boss result', 120000);
          for (const c of clients) {
            const n = await c.page.evaluate(() => globalThis.__SP__.store.get().match.result?.players?.length);
            assert.equal(n, count, 'result retains every player');
          }
          await clients.at(-1).shot('result-720');
        }
        for (const c of clients) {
          const errors = await c.page.evaluate(() => globalThis.__fiveEvents.filter(e => e.t === 'error'));
          assert.deepEqual(errors, [], `${c.label}: no rejected combat report`);
        }
        assert.deepEqual(problemsOf(clients), [], 'no console/page/resource errors');
      } finally {
        for (const c of clients) await c.close();
        await srv.stop();
      }
    });
}
}
