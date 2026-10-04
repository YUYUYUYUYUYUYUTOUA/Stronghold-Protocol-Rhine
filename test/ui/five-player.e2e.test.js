// Five independent browser clients use the actual room, draft and client-side combat UI.
// Opt-in, like the other real-browser suites: SP_E2E=1 CHROME_PATH=... node --test this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

async function createFive(clients) {
  const host = clients[0];
  await host.open();
  await host.enter('Five1');
  await host.click('.mode-card', '同盟模拟');
  await host.click('.diff-card', '标准模拟');
  await host.click('.create-box button', '创建同盟');
  const { room } = await host.waitFor(s => !!s.room?.code, 'room created');
  for (let i = 1; i < clients.length; i++) {
    const c = clients[i];
    await c.open(`?room=${room.code}`);
    await c.enter(`Five${i + 1}`);
    await c.waitFor(s => s.room?.code === room.code, 'joined room');
  }
  for (const c of clients) {
    await c.page.waitForFunction(() => document.querySelectorAll('.seat:not(.seat--empty)').length === 5);
    assert.equal(await c.page.$$eval('.seat', rows => rows.length), 5, 'five seat cards');
  }
  // The fifth card has a staggered entrance animation; inspect its final visible layout.
  await sleep(900);
  for (const c of clients) {
    const visible = await c.page.$$eval('.seat', rows => rows.every(el => {
      const r = el.getBoundingClientRect();
      return Number(getComputedStyle(el).opacity) > 0.99 && r.left >= 0 && r.right <= innerWidth;
    }));
    assert.equal(visible, true, 'all five cards visible within desktop width');
  }
  await host.shot('room');
  await clients[4].shot('room-720');
  const fifth = clients[4];
  const fifthId = (await fifth.st()).me;
  await fifth.page.reload({ waitUntil: 'domcontentloaded' });
  await fifth.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'));
  await fifth.waitFor(s => s.room?.code === room.code, 'fifth player resumes room');
  assert.equal((await fifth.st()).me, fifthId, 'reload keeps the fifth identity');
  for (const c of clients.slice(1)) await c.click('.room-bar__right button', '准备就绪');
  await host.click('.room-bar__right button', '开始模拟');
  for (const c of clients) await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
  for (const c of clients) await c.click('.brief__foot .btn--primary', '准备就绪');
  const picked = new Set();
  const deadline = Date.now() + 120000;
  while (picked.size < 5 && Date.now() < deadline) {
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
  assert.equal(picked.size, 5, 'every player chooses a strategy');
  for (const c of clients) {
    await c.waitFor(s => s.phase === 'PREP', 'prep');
    await c.page.waitForFunction(() => document.querySelectorAll('.team__row').length === 5);
    assert.equal(await c.page.$$eval('.team__row', rows => rows.length), 5, 'all five team rows visible');
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
  await fifth.shot('prep-720');
  return fifthId;
}

for (const scene of ['normal', 'boss']) {
  test(`five real browser players: ${scene} combat, fifth-seat resume and UI`,
    { skip: !ENABLED, timeout: 300000 }, async () => {
      const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 16,
        startRound: scene === 'boss' ? 'boss' : 1, kit: 4, autoPlace: true } });
      const puppeteer = (await import('puppeteer-core')).default;
      const clients = Array.from({ length: 5 }, (_, i) => new Client(puppeteer, srv.base, `p${i + 1}`,
        { w: i === 4 ? 1280 : 1920, h: i === 4 ? 720 : 1080, prefix: `five-${scene}-p${i + 1}` }));
      try {
        const fifthId = await createFive(clients);
        // Five humans ready via the real controls; each browser receives its own battle.
        for (const c of clients) await c.click('.readybtn');
        for (const c of clients) {
          await c.page.waitForFunction(() => globalThis.__fiveEvents.some(e => e.t === 'b.start'), { timeout: 30000 });
          const events = await c.page.evaluate(() => globalThis.__fiveEvents);
          assert.ok(events.some(e => e.t === 'b.start' && e.kind === (scene === 'boss' ? 'boss' : 'normal')));
        }
        const phase = scene === 'boss' ? 'FINAL_ASSAULT' : 'COMBAT';
        await clients[0].page.waitForFunction(phase => globalThis.__fiveEvents.some(e => e.phase === phase && e.fields?.length), {}, phase);
        const fields = await clients[0].page.evaluate(phase => globalThis.__fiveEvents.find(e => e.phase === phase && e.fields?.length).fields, phase);
        assert.equal(fields.length, scene === 'boss' ? 3 : 5);
        if (scene === 'boss') {
          assert.deepEqual(fields.map(f => f.players.length).sort(), [1, 2, 2], '2+2+1 boss fields');
          assert.ok(fields.some(f => f.players.length === 1 && f.players[0] === fifthId), 'fifth fights in lone field');
        }
        if (scene === 'normal') {
          for (const c of clients) await c.waitFor(s => s.phase === 'PREP' && s.round === 2, 'round one settles', 90000);
        } else {
          for (const c of clients) await c.waitFor(s => s.phase === 'RESULT', 'boss result', 120000);
          for (const c of clients) {
            const n = await c.page.evaluate(() => globalThis.__SP__.store.get().match.result?.players?.length);
            assert.equal(n, 5, 'result retains all five players');
          }
          await clients[4].shot('result-720');
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
