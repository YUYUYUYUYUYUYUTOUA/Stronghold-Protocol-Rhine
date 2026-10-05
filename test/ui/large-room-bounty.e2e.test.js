// Production six-human draft: real generateDraft/cardView -> m.public -> GameScreen normalizeSp -> ChoiceOverlay.
// The fast server only skips earlier rounds; no fake UI data, socket requests or draft contents are injected.
// SP_E2E=1 CHROME_PATH=... node --test test/ui/large-room-bounty.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, OUT, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

async function createSixHumanRoom(clients) {
  const host = clients[0];
  await host.open();
  await host.enter('悬赏九卡房主');
  await host.click('.mode-card', '同盟模拟');
  await host.click('.diff-card', '绝境模拟');
  await host.click('.create-box button', '创建同盟');
  const { room } = await host.waitFor(state => !!state.room?.code, 'room created');
  for (let i = 1; i < clients.length; i++) {
    await clients[i].open(`?room=${room.code}`);
    await clients[i].enter(`悬赏九卡队友${i + 1}`);
    await clients[i].waitFor(state => state.room?.code === room.code, 'joined six-human room');
  }
  for (const client of clients) {
    await client.page.waitForFunction(() => document.querySelectorAll('.seat:not(.seat--empty)').length === 6);
  }
  for (const client of clients.slice(1)) await client.click('.room-bar__right button', '准备就绪');
  await host.click('.room-bar__right button', '开始模拟');
  for (const client of clients) {
    await client.waitFor(state => state.phase === 'INFO_CHECK', 'briefing');
    await client.click('.brief__foot .btn--primary', '准备就绪');
  }
  const done = new Set(), deadline = Date.now() + 90000;
  while (done.size < clients.length && Date.now() < deadline) {
    for (const client of clients) {
      if (done.has(client)) continue;
      const state = await client.st();
      if (state.phase !== 'BAND_DRAFT' || state.draft?.turn !== state.me) continue;
      const name = await client.page.evaluate(() => {
        const card = [...document.querySelectorAll('.dband:not(.is-taken)')]
          .find(element => !element.textContent.includes('老鲤'));
        card?.scrollIntoView({ block: 'nearest' });
        return card?.querySelector('.dband__name')?.textContent.trim();
      });
      assert.ok(name, 'each player has a free strategy');
      await sleep(150);
      await client.click('.dband:not(.is-taken)', name);
      await client.click('.draft-detail__btns .btn--primary', '确认选择');
      done.add(client);
    }
    await sleep(100);
  }
  assert.equal(done.size, 6, 'six real players select strategies through the actual UI');
  for (const client of clients) {
    await client.waitFor(state => state.phase === 'SP_DRAFT' && state.round === 3, 'real R3 bounty draft');
    await client.page.waitForSelector('.spov .spcard', { visible: true });
  }
}

async function inspectAndScroll(client) {
  await client.page.waitForFunction(() => !document.querySelector('.pbanner--overlay'), { timeout: 5000 });
  await client.page.evaluate(() => document.fonts.ready);
  const snapshot = await client.page.evaluate(async () => {
    const state = globalThis.__SP__.store.get();
    const pub = state.match.public;
    const { normalizeSp } = await import('/js/ui/gameLogic.js');
    const normalized = normalizeSp(pub.sp, pub.players);
    const grid = document.querySelector('.spov__grid');
    const rectangle = grid.getBoundingClientRect();
    return { players: pub.players.length, startingPlayerCount: pub.startingPlayerCount,
      family: pub.sp.family, rawCards: pub.sp.cards.length, normalizedCards: normalized.cards.length,
      normalizedIndices: normalized.cards.map(card => card.idx),
      bonusCoins: pub.sp.cards.slice(6).map(card => card.coin),
      domCards: document.querySelectorAll('.spov .spcard').length,
      lastIndex: document.querySelector('.spov .spcard:last-child')?.getAttribute('data-idx'),
      grid: { overflow: getComputedStyle(grid).overflowY, height: grid.clientHeight, contentHeight: grid.scrollHeight,
        centerX: rectangle.left + rectangle.width / 2, centerY: rectangle.top + rectangle.height / 2 },
    };
  });
  assert.equal(snapshot.players, 6);
  assert.equal(snapshot.startingPlayerCount, 6);
  assert.equal(snapshot.family, 'bounty');
  assert.equal(snapshot.rawCards, 9, 'server sends nine actual bounty cards');
  assert.equal(snapshot.normalizedCards, 9, 'production normalization preserves all nine cards');
  assert.deepEqual(snapshot.normalizedIndices, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(snapshot.bonusCoins, [1, 2, 2]);
  assert.equal(snapshot.domCards, 9, 'actual GameScreen renders nine buttons');
  assert.equal(snapshot.lastIndex, '8');
  assert.equal(snapshot.grid.overflow, 'auto');
  assert.ok(snapshot.grid.contentHeight > snapshot.grid.height + 1, 'three rows exceed the visible grid and can scroll');
  await client.shot('nine-cards-top');
  await client.page.mouse.move(snapshot.grid.centerX, snapshot.grid.centerY);
  await client.page.mouse.wheel({ deltaY: 1000 });
  await client.page.waitForFunction(() => document.querySelector('.spov__grid').scrollTop > 0);
  const scrolled = await client.page.evaluate(() => {
    const grid = document.querySelector('.spov__grid');
    const card = grid.querySelector('.spcard[data-idx="8"]');
    const r = card.getBoundingClientRect(), g = grid.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { scrollTop: grid.scrollTop, visible: r.top >= g.top - 1 && r.bottom <= g.bottom + 1,
      uncovered: !!top && (card.contains(top) || top.contains(card)) };
  });
  assert.ok(scrolled.scrollTop > 0, 'real mouse wheel scrolls the card grid');
  assert.equal(scrolled.visible, true, 'third-row ninth card fits inside the scrolled grid');
  assert.equal(scrolled.uncovered, true, 'third-row ninth card is not covered');
  await client.shot('nine-cards-third-row');
  return { viewport: { width: client.w, height: client.h }, ...snapshot, scrolled };
}

test('six-human R3 bounty: nine actual cards at 1080p/720p, third-row scrolling and real index-eight confirmation',
  { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run real Chrome', timeout: 300000 }, async () => {
    const server = await startRealServer({ fast: { startRound: 3, timerScale: 1, combatSpeed: 16, kit: 0 } });
    const puppeteer = (await import('puppeteer-core')).default;
    const clients = Array.from({ length: 6 }, (_, index) => new Client(puppeteer, server.base, `bounty-p${index + 1}`,
      { w: index === 5 ? 1280 : 1920, h: index === 5 ? 720 : 1080, prefix: `bounty-nine-p${index + 1}` }));
    const report = { server: server.base, viewports: [] };
    try {
      await createSixHumanRoom(clients);
      report.viewports.push(await inspectAndScroll(clients[0]));
      report.viewports.push(await inspectAndScroll(clients[5]));
      const firstTurn = (await clients[0].st()).sp.turn;
      let picker;
      for (const client of clients) if ((await client.st()).me === firstTurn) picker = client;
      assert.ok(picker, 'current bounty turn belongs to a real browser player');
      const before = await picker.page.evaluate(() => {
        const state = globalThis.__SP__.store.get();
        return { me: state.me.playerId, picks: state.match.public.sp.picks, cardId: state.match.public.sp.cards[8].id };
      });
      assert.deepEqual(before.picks, {}, 'no timeout or bot took the ninth card');
      await picker.page.$eval('.spcard[data-idx="8"]', card => card.scrollIntoView({ block: 'nearest' }));
      await sleep(150);
      await picker.click('.spcard[data-idx="8"]');
      await picker.page.waitForSelector('.spcard[data-idx="8"].is-armed .spcard__confirm', { visible: true });
      assert.equal(await picker.page.evaluate(() => {
        const state = globalThis.__SP__.store.get();
        return state.match.public.sp.picks[state.me.playerId] ?? null;
      }), null, 'first tap only arms the ninth card');
      await picker.click('.spcard[data-idx="8"].is-armed');
      for (const client of clients) {
        await client.page.waitForFunction(playerId => globalThis.__SP__.store.get().match.public?.sp?.picks?.[playerId] === 8,
          { timeout: 10000 }, before.me);
      }
      const after = await picker.page.evaluate(async () => {
        const state = globalThis.__SP__.store.get();
        const sp = state.match.public.sp;
        const { normalizeSp } = await import('/js/ui/gameLogic.js');
        const normalized = normalizeSp(sp, state.match.public.players);
        return { pick: sp.picks[state.me.playerId], taken: sp.taken['8'], cardId: sp.cards[8].id,
          normalizedPick: normalized.pickOf.get(state.me.playerId), normalizedPickedCount: normalized.pickedCount,
          domTaken: document.querySelector('.spcard[data-idx="8"]')?.classList.contains('is-mine') };
      });
      assert.equal(after.pick, 8, 'server accepts actual ninth-card selection');
      assert.equal(after.taken, before.me, 'server marks index eight taken by its real player');
      assert.equal(after.cardId, before.cardId, 'the selected actual server card retains its identity');
      assert.equal(after.normalizedPick, 8, 'normalization preserves the server-confirmed ninth-card pick');
      assert.equal(after.normalizedPickedCount, 1, 'the next turn receives the correct picked count');
      assert.equal(after.domTaken, true, 'production overlay reflects the acknowledged choice');
      report.selection = { playerId: before.me, ...after };
      report.problems = problemsOf(clients);
      assert.deepEqual(report.problems, [], 'no browser console, resource or page errors');
    } finally {
      report.serverLogs = server.logs;
      writeFileSync(path.join(OUT, 'large-room-bounty-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
      for (const client of clients) await client.close();
      await server.stop();
    }
  });
