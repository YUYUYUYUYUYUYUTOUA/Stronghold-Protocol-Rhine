// Actual room controls and six-member prep layout, with one human and five AI teammates.
// Opt-in: SP_E2E=1 CHROME_PATH=... node --test this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

test('six actual room cards fit narrow screens and six prep teammates stay above the shop',
  { skip: !ENABLED, timeout: 120000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 1, kit: 4, autoPlace: true } });
    const puppeteer = (await import('puppeteer-core')).default;
    const host = new Client(puppeteer, srv.base, 'layout-host', { prefix: 'six-layout' });
    try {
      await host.open();
      await host.enter('六人布局长名字博士');
      await host.click('.mode-card', '同盟模拟');
      await host.click('.diff-card', '标准模拟');
      await host.click('.create-box button', '创建同盟');
      await host.waitFor(s => !!s.room?.code, 'room created');
      for (let n = 1; n <= 5; n++) {
        await host.click('.seat--empty button', '添加 AI 队友');
        await host.page.waitForFunction(n => document.querySelectorAll('.seat.is-bot').length === n, {}, n);
      }
      for (const { width, height } of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 640, height: 360 }]) {
        await host.page.setViewport({ width, height });
        await sleep(650);
        const roomLayout = await host.page.evaluate(() => {
          const rect = el => el.getBoundingClientRect();
          const cards = [...document.querySelectorAll('.seat')];
          const visible = cards.every(el => {
            const r = rect(el);
            return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
          });
          const contentFits = cards.every(el => [...el.querySelectorAll('.seat__head, .seat__who, .seat__foot')].every(child => {
            const r = rect(child); const card = rect(el);
            return r.left >= card.left - 1 && r.right <= card.right + 1 && child.scrollWidth <= child.clientWidth + 1;
          }));
          const croppedAvatars = [...document.querySelectorAll('.seat__art .avatar')].flatMap(el => {
            const r = rect(el); const art = rect(el.parentElement);
            return r.left >= art.left - 1 && r.right <= art.right + 1 && r.top >= art.top - 1 && r.bottom <= art.bottom + 1
              ? [] : [{ avatar: { top: r.top, bottom: r.bottom, height: r.height }, art: { top: art.top, bottom: art.bottom, height: art.height } }];
          });
          const aiButtons = [...document.querySelectorAll('.seat.is-bot button')];
          const reachable = aiButtons.every(el => {
            const r = rect(el); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
            const top = document.elementFromPoint(x, y);
            return !el.disabled && x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight && top && (el.contains(top) || top.contains(el));
          });
          return { cards: cards.length, aiButtons: aiButtons.length, visible, contentFits, croppedAvatars, reachable,
            banNote: document.querySelector('.room-bar__bans')?.textContent, columns: getComputedStyle(document.querySelector('.seats')).gridTemplateColumns.split(' ').length };
        });
        await host.shot(`room-${width}`);
        assert.equal(roomLayout.cards, 6);
        assert.equal(roomLayout.aiButtons, 5);
        assert.equal(roomLayout.visible, true, `${width}: all six room cards are visible`);
        assert.equal(roomLayout.contentFits, true, `${width}: room card text and controls fit their cards`);
        assert.deepEqual(roomLayout.croppedAvatars, [], `${width}: avatars fit without cropping`);
        assert.equal(roomLayout.reachable, true, `${width}: every AI removal button can be clicked`);
        assert.match(roomLayout.banNote, /核心 0 \/ 附加 1.*6 人（含 AI）/);
        assert.equal(roomLayout.columns, width < 768 ? 3 : 6);
      }
      // Exercise the sixth seat's actual removal / replacement controls on the narrow layout.
      await host.click('.seat.is-bot button', null, { nth: 4 });
      await host.page.waitForFunction(() => document.querySelectorAll('.seat.is-bot').length === 4);
      await host.click('.seat--empty button', '添加 AI 队友');
      await host.page.waitForFunction(() => document.querySelectorAll('.seat.is-bot').length === 5);
      await host.page.setViewport({ width: 1920, height: 1080 });
      await host.click('.room-bar__right button', '开始模拟');
      await host.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
      await host.click('.brief__foot .btn--primary', '准备就绪');
      await host.waitFor(s => s.phase === 'BAND_DRAFT' && s.draft?.turn === s.me, 'host draft turn');
      const freeBand = await host.page.evaluate(() => {
        const free = document.querySelector('.dband:not(.is-taken)');
        free?.scrollIntoView({ block: 'nearest' });
        return free?.querySelector('.dband__name')?.textContent.trim();
      });
      assert.ok(freeBand);
      await host.click('.dband:not(.is-taken)', freeBand);
      await host.click('.draft-detail__btns .btn--primary', '确认选择');
      await host.waitFor(s => s.phase === 'PREP', 'six-member prep');
      await host.page.waitForFunction(() => document.querySelectorAll('.team__row').length === 6);
      for (const { width, height } of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
        await host.page.setViewport({ width, height });
        await sleep(650);
        const prepLayout = await host.page.evaluate(() => {
          const rows = [...document.querySelectorAll('.team__row')];
          const last = rows.at(-1).getBoundingClientRect();
          const shop = document.querySelector('.shopbar').getBoundingClientRect();
          const button = rows.at(-1).querySelector('.team__btn');
          const r = button.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { rows: rows.length, lastBottom: last.bottom, shopTop: shop.top,
            sixthReachable: !!top && (button.contains(top) || top.contains(button)) };
        });
        assert.equal(prepLayout.rows, 6);
        assert.ok(prepLayout.lastBottom <= prepLayout.shopTop, `${width}: sixth row ${prepLayout.lastBottom} stays above shop ${prepLayout.shopTop}`);
        assert.equal(prepLayout.sixthReachable, true);
        await host.shot(`prep-${width}`);
      }
      assert.deepEqual(problemsOf([host]), [], 'no console, page or resource errors');
    } finally {
      await host.close();
      await srv.stop();
    }
  });
