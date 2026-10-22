// SIM_E2E=1 CHROME_PATH=<Chrome/Edge> node --test test/sim/rem-unite-coverage.browser.test.js
// Production Battle/spec/Rem modules in Node and Chromium, without rendering or game art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Battle } from '../../server/sim/Battle.js';
import { DataSource } from '../../server/sim/simdata.js';
import * as specApi from '../../server/sim/spec.js';
import * as rem from '../../server/sim/content/rem.js';
import { chessRec, enemyRec, flatStage } from '../helpers/battleHarness.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SIM_E2E === '1' && existsSync(chrome);

function records() {
  const cross = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]];
  return {
    chess: {
      unite_rem: chessRec({ id: 'unite_rem', bonds: ['remShip'], skill: null, rangeGrid: cross,
        stats: { atk: 0, blockCnt: 0, maxHp: 1e8 } }),
      unite_other: chessRec({ id: 'unite_other', skill: null,
        stats: { atk: 0, blockCnt: 0, maxHp: 1e8 } }),
    },
    enemies: { unite_dummy: enemyRec({ key: 'unite_dummy', hp: 1e7, atk: 0, def: 0, speed: 0 }) },
    stages: { unite_coverage_acceptance: flatStage({ id: 'unite_coverage_acceptance' }) },
  };
}

// Serialized verbatim by Puppeteer: every runtime helper belongs inside this function.
export function exerciseUniteCoverage(api, raw) {
  let checks = 0;
  const check = (condition, label) => { checks++; if (!condition) throw new Error(label); };
  const near = (a, b) => Math.abs(a - b) < 1e-8;
  const present = u => u.alive && u.deployed && !u.removed;
  class CoverageBattle extends api.Battle {
    constructor(options) { super({ ...options, content: 'generic', extraContent: [api.rem], autoFinish: false, devices: false }); }
  }
  const out = [];
  for (const offset of [0, 8]) for (const twoOwners of [false, true]) {
    const otherOffset = offset ? 0 : 8;
    const data = JSON.parse(JSON.stringify(raw));
    // Keep near-gate teammate coverage in world coordinates for both prep-half mappings.
    data.chess.unite_other.rangeGrid = [[0, 2 - (3 + otherOffset)], [0, 3 - (3 + otherOffset)], [1, 2 - (3 + otherOffset)]];
    const spec = api.buildBattleSpec({
      battleId: `unite.coverage.${offset}.${twoOwners}`, fieldId: 'unite:coverage', kind: 'unite', round: 2,
      stageId: 'unite_coverage_acceptance', seed: 73519, timeLimit: 120,
      flags: { startOpCooldown: 0, dpInit: 99, dpPerSec: 0 }, spawns: [], routes: [],
      players: [
        { playerId: 'owner', seat: 0, side: 'L', colOffset: offset, bonds: {},
          units: [{ uid: 1, chessId: 'unite_rem', row: 10, col: 7 }] },
        { playerId: 'teammate', seat: 1, side: 'L', colOffset: otherOffset, bonds: {},
          units: [{ uid: 2, chessId: twoOwners ? 'unite_rem' : 'unite_other', row: twoOwners ? 10 : 9, col: twoOwners ? 4 : 3 }] },
      ],
    });
    const b = api.createBattleFromSpec(spec, new api.DataSource(data), { BattleClass: CoverageBattle, quiet: true });
    b.start(); b.step();
    const own = b.getPlayer('owner').units.find(u => u.uid === 1);
    const teammate = b.getPlayer('teammate').units.find(u => u.uid === 2);
    check(present(own) && present(teammate), 'the mapped operator bodies deploy');
    check(own.tileR === 10 && own.tileC === 7 + offset, 'side L and colOffset map into the actual unite field');
    check(!b.getPlayer('owner').mirror, 'right unite helper is not Boss-side mirroring');
    const original = [own.x, own.y, teammate.x, teammate.y];
    const states = [b.remState.get('owner'), ...(twoOwners ? [b.remState.get('teammate')] : [])];
    for (const s of states) {
      check(s.gate[0] === 9 && s.gate[1] === 2, 'the shared left blue gate remains unchanged');
      s.queue.push({ type: 'chef', source: 'unite-browser-acceptance' });
    }
    b.step();
    const troops = states.map(s => s.units.at(-1));
    check(troops.every((u, i) => present(u) && u.ownerId === states[i].ps.playerId), 'actual owned reinforcements are spawned');
    const operators = [own, ...(twoOwners ? [teammate] : [])];
    const foes = operators.map(op => b.spawnEnemy('unite_dummy', { pos: twoOwners ? [11, op.tileC] : [10, op.tileC + 1] }));
    check(foes.every(Boolean), 'actual enemy bodies are spawned in the corresponding owner ranges');
    const hits = troops.map(() => 0), damage = troops.map(() => 0), crossedGap = troops.map(() => false), trace = [];
    b.on('damaged', e => {
      const index = troops.indexOf(e.source);
      if (index >= 0 && e.target === foes[index] && e.amount > 0) { hits[index]++; damage[index] += e.amount; }
    });
    const arrived = () => troops.every((u, i) => hits[i] > 0 && operators[i].rangeKeys.includes(u.tileR * 21 + u.tileC));
    for (let n = 0; n < 40 / b.dt && !arrived(); n++) {
      const before = troops.map(u => [u.x, u.y]); b.step();
      for (let i = 0; i < troops.length; i++) {
        const u = troops[i], dx = Math.abs(u.x - before[i][0]), dy = Math.abs(u.y - before[i][1]);
        check(dx + dy <= b.dt + 1e-8 && (near(dx, 0) || near(dy, 0)), 'movement stays cardinal at one tile per game second');
        check(b.grid.groundPassable(u.tileR, u.tileC) && !b.downOn(u.tileR, u.tileC), 'the actual transit tile is legal');
        check(!b._occ.includes(u), 'a mobile reinforcement never takes operator occupancy');
        if (u.x > 2.5 && !operators[i].rangeKeys.includes(u.tileR * 21 + u.tileC)) crossedGap[i] = true;
      }
      if (n % 15 === 0) trace.push({ tick: b.tickCount, positions: troops.map(u => [u.x, u.y]), hp: foes.map(e => e.hp) });
    }
    for (let i = 0; i < troops.length; i++) {
      check(crossedGap[i], 'the reinforcement crosses genuinely uncovered intermediate tiles');
      check(hits[i] > 0 && damage[i] > 0 && foes[i].hp < foes[i].s.maxHp, 'it actually damages the enemy near its own Rem operator');
      check(operators[i].rangeKeys.includes(troops[i].tileR * 21 + troops[i].tileC), 'its final attack position is in its own preferred coverage');
    }
    check(original.every((v, i) => near(v, [own.x, own.y, teammate.x, teammate.y][i])), 'ordinary operator bodies remain stationary');
    check(b.errors.length === 0, `simulation errors: ${JSON.stringify(b.errors)}`);
    const final = troops.map(u => ({ owner: u.ownerId, x: u.x, y: u.y }));
    b.forceEnd();
    const result = b.result(), digest = api.resultDigest(result).hash;
    check(digest === api.resultDigest(api.compactResult(result)).hash, 'wire compaction preserves the authoritative result');
    out.push({ offset, twoOwners, ticks: b.tickCount, final, hits, damage, crossedGap, trace, digest });
  }
  return { checks, cases: out };
}

test('unite Rem owner coverage and legal gap transit match real Node and Chromium simulations', {
  skip: enabled ? false : 'set SIM_E2E=1 and CHROME_PATH (pure simulation; no art or renderer)', timeout: 120000,
}, async () => {
  const node = exerciseUniteCoverage({ ...specApi, DataSource, Battle, rem }, records());
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--no-first-run'] });
    const page = await browser.newPage(), problems = [], forbidden = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('request', r => { if (/\/(assets|vendor|render)\//.test(new URL(r.url()).pathname)) forbidden.push(r.url()); });
    page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${srv.port}/healthz`, { waitUntil: 'domcontentloaded' });
    const api = await page.evaluateHandle(async () => ({
      ...await import('/sim/spec.js'),
      DataSource: (await import('/sim/simdata.js')).DataSource,
      Battle: (await import('/sim/Battle.js')).Battle,
      rem: await import('/sim/content/rem.js'),
    }));
    const web = await page.evaluate(exerciseUniteCoverage, api, records());
    await api.dispose();
    assert.deepEqual(web, JSON.parse(JSON.stringify(node)), 'all positions, damage, sampled traces and result digests match');
    assert.deepEqual(forbidden, [], 'no art, vendor or renderer resources are requested');
    assert.deepEqual(problems, []);
    console.log('Rem unite browser evidence:', JSON.stringify({ browser: await browser.version(), checks: node.checks,
      cases: node.cases.map(({ trace, ...summary }) => ({ ...summary, traceSamples: trace.length })), forbidden, problems }));
  } finally { await browser?.close(); await srv.close(); }
});
