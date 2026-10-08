// Local-only deterministic integration preview, using the same /sim Battle and field renderer as the game.
import { render } from '../vendor/preact.module.js';
import { html } from '../js/ui/components.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { createFieldView } from '../js/render/app.js';
import { KazdelCannonHud } from '../js/ui/kazdelHud.js';
import { DetailPanel, resolveDetail } from '../js/ui/detailPanel.js';
import { chessAvatarUrl } from '../js/ui/assetUrls.js';
import { unitStatsEntry } from '../../shared/protocol.js';
import { createKazdelFixture } from './kazdel-fixture.js';

const q = new URLSearchParams(location.search), $ = id => document.getElementById(id);
const demo = window.__kazdelDemo = { ready: false, errors: [], events: [] };
const problem = e => { demo.errors.push(String(e?.message || e)); $('errors').textContent = demo.errors.join('\n'); };
window.addEventListener('error', e => problem(e.error || e.message));
window.addEventListener('unhandledrejection', e => problem(e.reason));

async function main() {
  const files = ['chess','enemies','tokens','stages','waves','bonds','items','garrisons','bands','effects','backups','assets','config'];
  await data.loadAll(...files); await assets.ready();
  const raw = Object.fromEntries(files.map(n => [n,data.get(n)]));
  const [{ Battle }, { DataSource, setSimData }] = await Promise.all([import('/sim/Battle.js'),import('/sim/simdata.js')]);
  setSimData(raw);
  const view = await createFieldView($('field'), { data, assets, settings: { quality:q.get('quality') || 'high', damageNumbers:true } });
  await view.setBoardMode('2d'); view.setLocalFeed({ on:true,speed:1 }); demo.view = view;
  let b, body, roster, count = [3,6,9].includes(Number(q.get('count'))) ? Number(q.get('count')) : 6;
  let playing = q.get('paused') === '0', acc = 0;
  function card(target) {
    const detail = resolveDetail(target, new Map());
    render(detail ? html`<${DetailPanel} detail=${detail} editable=${false} voice=${false} onClose=${()=>card(null)}
      live=${()=>{const u=b.units.find(x=>x.id===detail.unitId);return u?{...unitStatsEntry(u,u.s),src:'battle'}:null;}} />` : null, $('details'));
  }
  function paintHud() {
    const snap = b.snapshot(), soul = b.allyUnits.find(u=>u.kazdelSoul&&u.alive);
    render(html`<${KazdelCannonHud} states=${snap.kazdel} gameTime=${b.time} players=${[{playerId:'p1',name:'本地验收'}]} />`, $('hud'));
    $('status').textContent = `${count} 人 · ${b.time.toFixed(1)} 秒\n层数 ${b.getPlayer('p1')?.bonds?.kazdelShip?.layers ?? '—'} · 亡魂 ${soul ? `${Math.round(soul.hp)} HP` : '无'}`;
  }
  function feed() {
    const ev = b.drainEvents(); demo.events.push(...ev);
    if (demo.events.length > 400) demo.events.splice(0,demo.events.length-400);
    view.pushEvents({ ev,gt:b.time }); view.pushSnapshot(b.snapshot()); paintHud();
  }
  function reset(nextCount = count, targetTime = 0) {
    count = nextCount; ({ b,body,roster } = createKazdelFixture(Battle,DataSource,raw,count));
    acc = 0; demo.events = []; b.drainEvents();
    while (b.time + 1/30 <= targetTime) { b.step(); b.drainEvents(); }
    view.setStage(data.lookup('stages','act2autochess_m01'));
    view.enterBattle({ ...b.fieldMeta(),t:b.time }); view.setCamera('normal',{rect:b.rect,instant:true});
    view.pushSnapshot(b.snapshot()); paintHud();
    for (const button of $('thresholds').querySelectorAll('button')) button.setAttribute('aria-pressed',String(Number(button.dataset.count)===count));
    demo.battle = b; demo.roster = roster; card(null);
  }
  demo.advance = seconds => { const ticks=Math.round(seconds*30);for(let i=0;i<ticks&&!b.finished;i++){b.step();feed();}return b.time; };
  demo.seek = seconds => { playing=false;reset(count,seconds);$('play').textContent='播放'; };
  demo.reset = reset;
  demo.pause = () => {playing=false;$('play').textContent='播放';};
  demo.play = () => {playing=true;$('play').textContent='暂停';};
  view.on('pieceClick', ev => { const info=b.fieldMeta().units.find(u=>u.id===ev.unitId);if(info)card({kind:'unit',unit:info}); });
  $('thresholds').onclick = e => { if(e.target.dataset.count)reset(Number(e.target.dataset.count)); };
  $('play').onclick = () => {playing=!playing;$('play').textContent=playing?'暂停':'播放';};
  $('reset').onclick = () => reset();
  $('kill').onclick = () => {if(body?.alive)b.kill(body);feed();};
  $('heal').onclick = () => {
    const soul=b.allyUnits.find(u=>u.kazdelSoul&&u.alive);
    const medic=b.allyUnits.find(u=>u.kind==='op'&&u.def.profession==='MEDIC');
    // Use an actual Medic soul: ordinary living Medics intentionally cannot heal souls.
    if(medic?.alive)b.kill(medic);
    const source=medic?.kazdelSoulUnit;
    if(soul&&source){soul.hp=Math.max(1,soul.hp-600);b.heal(source,soul,450);feed();}
  };
  reset(count,Number(q.get('t'))||0);
  render(roster.map(c=>html`<button data-roster=${c.charId} onClick=${()=>card({kind:'chess',id:c.chessId})}><img src=${chessAvatarUrl(raw.assets,c)} alt="" /><span>${c.name}<small>${c.tier} 阶 · ${c.profession}</small></span></button>`),$('roster'));
  $('play').textContent=playing?'暂停':'播放';
  let last=performance.now();
  function tick(now){const dt=Math.min(.1,(now-last)/1000);last=now;if(playing){acc+=dt;while(acc>=1/30){acc-=1/30;if(!b.finished)b.step();}}feed();requestAnimationFrame(tick);}
  requestAnimationFrame(tick); demo.ready=true;
}
main().catch(problem);
