// SIM_E2E=1 CHROME_PATH=/usr/bin/chromium node --test test/sim/rem.browser.test.js
// Real generated operator records and native sim, one identical JSON spec in Chromium and Node; no art required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';

const chrome = process.env.CHROME_PATH || '/usr/bin/chromium';
const enabled = process.env.SIM_E2E === '1' && existsSync(chrome);
function exercise(b) {
  const spawned = [], frames = [];
  b.on('remSpawned', ({ unit:u, type, ownerId, source }) => spawned.push([b.time,u.id,type,ownerId,source,u.s.atk,u.s.def]));
  b.start();
  for (const s of b.remState.values()) {
    const e = b.spawnEnemy('enemy_1000_gopro', { pos: [s.rally[0],s.rally[1]+1] });
    e.base.maxHp = 1e8; e.hp = 1e8; e.base.atk = 0; e.base.moveSpeed = 0; e.markDirty();
  }
  for (let n = 0; n < 45 * 30; n++) {
    b.step();
    if (n % 30 === 0) frames.push({
      reinforcements:b.allyUnits.filter(u=>u.remType).map(u=>[u.id,u.ownerId,u.remType,u.remSource,u.tileR,u.tileC,u.x,u.y,u.hp,u.s.atk,u.s.def,u.s.res,u.s.aspd,u.blocking.map(e=>e.id)]),
      operators:b.allyUnits.filter(u=>u.kind==='op').map(u=>[u.id,u.ownerId,u.hp,u.s.maxHp,u.s.atk,u.findBuff('rem:appearance')?.mods.atkPct??0]),
    });
  }
  const states = [...b.remState.values()].map(s=>({ owner:s.ps.playerId, stage:s.stage, gate:s.gate, rally:s.rally, queue:s.queue, appeared:s.appeared, layers:s.ps.bonds.remShip.layers }));
  const beforeEnd = b.allyUnits.filter(u=>u.remType&&u.alive&&u.deployed).length;
  b.forceEnd();
  return { spawned, frames, states, beforeEnd, afterEnd:b.allyUnits.filter(u=>u.remType&&u.alive&&u.deployed&&!u.removed).length, errors:b.errors, result:b.result() };
}

test('stage-nine Rem pools, owner traits, marching and cleanup match Node/Chromium in normal, unite and boss fields', {
  skip:enabled ? false:'set SIM_E2E=1 and CHROME_PATH (no art required)', timeout:90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port:0, host:'127.0.0.1', quiet:true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath:chrome, headless:true, args:['--no-sandbox','--no-first-run'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
    const ds = new DataSource(getData({ log:{ warn(){}, error(){}, info(){} } }));
    for (const kind of ['normal','unite','boss','hidden']) {
      const spec = buildBattleSpec({ fieldId:`rem:${kind}`, kind, seed:913, stageId:'act2autochess_m01',
        rect:{ r0:0,r1:18,c0:0,c1:20 }, timeLimit:60, flags:{ autoFinish:false },
        players:['p1','p2'].map((playerId,seat)=>({ playerId, seat, side:seat?'R':'L', colOffset:seat?10:0,
          bonds:{ remShip:{active:true,count:9,layers:100+100*seat} }, remRally:{row:10,col:5},
          units:[{uid:1+10*seat,chessId:'chess_rem_warmy_b',row:10,col:7,moduleId:'none'},
            {uid:2+10*seat,chessId:'chess_rem_thumpy_a',row:11,col:7,moduleId:'none'},
            {uid:3+10*seat,chessId:'chess_rem_glider_b',row:12,col:7,moduleId:'none'}] })), spawns:[] });
      const node = exercise(createBattleFromSpec(spec,ds));
      const battle = await page.evaluateHandle(async spec=>{
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec:S, ds } = await loadBrowserSim();
        return S.createBattleFromSpec(spec,ds);
      }, spec);
      const web = await page.evaluate(exercise, battle);
      await battle.dispose();
      assert.deepEqual(web,JSON.parse(JSON.stringify(node)),`${kind} full deterministic trace`);
      assert.deepEqual(node.errors,[],kind);
      assert.ok(node.spawned.some(x=>x[3]==='p1'),`${kind}: first owner summons`);
      assert.ok(node.spawned.some(x=>x[3]==='p2'),`${kind}: second owner summons`);
      if (kind === 'normal') assert.ok(node.states.every((s,i)=>s.layers > 100+100*i),`${kind}: Warmy native trait credits only its owner`);
      assert.equal(node.afterEnd,0,`${kind}: reinforcement cleanup`);
    }
    assert.deepEqual(errors,[]);
  } finally { await browser?.close(); await srv.close(); }
});
