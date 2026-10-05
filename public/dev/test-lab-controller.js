// Local-only battle laboratory. The combat engine is injected unchanged; no net/store requests are made.
import { defaultLabScenario, normalizeLabScenario, buildLabSpec } from '../../shared/testLabScenario.js';
import { unitStatsEntry } from '../../shared/protocol.js';
import { GEO } from '../../shared/constants.js';
import { researchRange } from '../../shared/rhineRange.js';

export function createLabController({ records: initialRecords, view, sim, loadProfile, frame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame, now = () => performance.now() } = {}) {
  let records = initialRecords, scenario, battle, selectedUid = null, playing = false, speed = 1;
  let error = '', destroyed = false, accumulator = 0, animationPreview = null, fxPreviewUntil = 0;
  let frameId, last = now(), nextNotify = 0, damage = new Map(), eventCount = 0, revision = 0, loading = false;
  const listeners = new Set(), wrappedActors = new WeakMap();
  const baseFxUpdate = view.debug?.fx?.update?.bind(view.debug.fx);
  if (baseFxUpdate) view.debug.fx.update = dt => baseFxUpdate(playing || now() < fxPreviewUntil ? dt : 0);
  if (view.debug?.ctx) {
    view.debug.ctx.animRate = () => speed;
    view.debug.ctx.timeScale = () => speed;
  }
  const clone = x => JSON.parse(JSON.stringify(x));
  const sceneUid = u => u?.side === 'enemy' ? Number(String(u.tag ?? '').replace(/^lab:/, '')) || null : u?.uid;
  const find = uid => battle?.units.find(u => sceneUid(u) === Number(uid) && u.alive)
    ?? battle?.units.find(u => sceneUid(u) === Number(uid));
  const visual = uid => { const unit = find(uid); return unit && view.debug?.views?.get(unit.id); };
  const animations = uid => {
    const actor = visual(uid)?.actor;
    return actor ? [...actor.names].sort().map(name => ({ name, duration: actor.dur(name) })) : [];
  };
  function inspect(uid = selectedUid) {
    const unit = find(uid), entry = scenario?.units.find(u => u.uid === uid), enemy = scenario?.enemies.find(u => u.uid === uid);
    if (!unit && !entry && !enemy) return null;
    const record = entry ? records.chess?.[entry.id] ?? records.tokens?.[entry.id] : records.enemies?.[enemy?.enemyKey ?? unit?.defId];
    const related = new Set(record?.bonds ?? []);
    return { uid, unitId: unit?.id ?? null, kind: unit?.kind ?? (enemy ? 'enemy' : 'op'), name: unit?.name ?? record?.name ?? entry?.id,
      record, stats: unit ? unitStatsEntry(unit, unit._s ?? unit.s) : null,
      live: unit ? { hp: unit.hp, sp: unit.sp, spMax: unit.spMax, alive: unit.alive, deployed: unit.deployed, time: battle.time,
        damage: damage.get(unit.id) ?? 0, dps: (damage.get(unit.id) ?? 0) / Math.max(battle.time, 1 / 30) } : null,
      loadout: { skillIndex: entry?.skillIndex, moduleId: entry?.moduleId },
      bonds: Object.entries(battle?.players[0]?.bonds ?? {}).filter(([id,b]) => related.has(id) || b.active || b.layers > 0)
        .map(([id,b]) => ({ id, name: records.bonds?.[id]?.name ?? id, ...b })),
      errors: battle?.errors ?? [] };
  }
  function state() {
    return { scenario, records, selectedUid, playing, loading, time: battle?.time ?? 0, speed, error, revision,
      stats: { ...(view.stats?.() ?? {}), killed: battle?.killed ?? 0, total: battle?.total ?? 0,
        damage: [...damage.values()].reduce((a,b) => a+b,0), events: eventCount, errors: battle?.errorCount ?? 0 },
      inspect: inspect(), animationNames: animations(selectedUid), fxKinds: sim.fxKinds ?? [] };
  }
  function notify() { const s=state(); for (const listener of listeners) listener(s); }
  function fail(e) { error = e?.message ?? String(e); playing=false; notify(); return false; }
  function highlight() {
    view.highlightTiles?.(null);
    const unit=find(selectedUid); if (!unit) return;
    const range = researchRange({id:unit.defId,stage:unit.researchStage});
    const keys = sim.absoluteRangeKeys(range?.grid ?? unit.liveRangeGrid ?? unit.rangeGrid, Math.round(unit.y), Math.round(unit.x), unit.dir);
    view.highlightTiles?.(keys.map(key=>[Math.floor(key/GEO.COLS),key%GEO.COLS]), { color:0xffb85c,fill:.18,line:.8,group:'range' });
    view.highlightTiles?.([[Math.round(unit.y),Math.round(unit.x)]], { color:0x6fe8c1,fill:.12,line:1,group:'select' });
  }
  function feed(snapNow = false) {
    const ev = battle.drainEvents(); eventCount+=ev.length;
    if (ev.length) view.pushEvents({fieldId:'lab',gt:battle.time,ev});
    view.pushSnapshot(battle.snapshot());
    if (snapNow) view.debug?.interp?.snapToNewest();
  }
  function rebuild(input) {
    const next = normalizeLabScenario(input,records);
    const nextBattle = sim.createBattleFromSpec(buildLabSpec(next,records), new sim.DataSource(records), {quiet:true});
    nextBattle.autoFinish = false;
    battle?.forceEnd('lab-reset'); battle = nextBattle; scenario=next;
    playing=false; accumulator=0; animationPreview=null; fxPreviewUntil=now()+3000; error=''; damage=new Map(); eventCount=0;
    battle.on('damaged', ({source,credit,amount}) => { const u=credit??source; if (u?.side==='ally') damage.set(u.id,(damage.get(u.id)??0)+amount); });
    battle.start(); battle.step();
    view.setStage(records.stages[scenario.stageId]);
    view.enterBattle(battle.fieldMeta());
    view.setCamera('normal',{rect:battle.rect,side:'L',instant:true});
    view.setLocalFeed({on:true,speed}); feed(true);
    if (!scenario.units.some(u=>u.uid===selectedUid) && !scenario.enemies.some(u=>u.uid===selectedUid)) selectedUid=scenario.units[0]?.uid??scenario.enemies[0]?.uid??null;
    revision++; highlight(); notify(); return clone(scenario);
  }
  function tickOne() {
    if (!battle || battle.finished) { playing=false; return; }
    battle.step(); feed(true);
    if (battle.errorCount) { error=battle.errors[0]?.message??'战斗模拟出现错误'; playing=false; }
  }
  function loop(time) {
    if (destroyed) return;
    const dt=Math.min(.1,Math.max(0,(time-last)/1000)); last=time;
    if (playing) { accumulator+=dt*speed; let steps=0; while(accumulator>=1/30 && steps++<120) {tickOne();accumulator-=1/30;} }
    for (const v of view.debug?.views?.values() ?? []) {
      const actor=v.actor;
      if (actor && !wrappedActors.has(actor)) {
        const update=actor.update.bind(actor); wrappedActors.set(actor,update);
        actor.update = delta => { if (playing || animationPreview?.actor === actor) update(delta); };
      }
    }
    if (time>=nextNotify) { nextNotify=time+200; notify(); }
    frameId=frame(loop);
  }
  async function applyProfile(profile, input = null) {
    if (loading) throw new Error('数据档正在加载，请稍后再操作');
    const previousRecords=records, previousScenario=scenario;
    loading=true; playing=false; error=''; notify();
    try {
      const nextRecords=await loadProfile(profile);
      records=nextRecords;
      const next=normalizeLabScenario(input??defaultLabScenario(records,profile),records);
      return rebuild(next);
    } catch(e) {
      records=previousRecords;
      if (previousScenario) { await loadProfile(previousScenario.profile); sim.setSimData?.(records); }
      throw e;
    } finally { loading=false; notify(); }
  }
  const off = view.on?.('pieceClick', e => {
    const unit=e.unitId!=null ? battle?.units.find(u=>u.id===e.unitId) : find(e.uid);
    const uid=sceneUid(unit); if(uid!=null) {selectedUid=uid;highlight();notify();}
  });
  const controller={
    get records(){return records;}, get scenario(){return scenario;}, get battle(){return battle;}, get view(){return view;},
    get fxKinds(){return sim.fxKinds??[];}, state, inspect, animations,
    subscribe(fn){listeners.add(fn);fn(state());return()=>listeners.delete(fn);},
    select(uid){selectedUid=uid==null?null:Number(uid);highlight();notify();},
    setScenario(input){if(loading)throw new Error('数据档正在加载');try{return rebuild(input);}catch(e){fail(e);throw e;}},
    changeProfile:profile=>applyProfile(profile),
    start(){if(loading)return;animationPreview=null;for(const v of view.debug?.views?.values()??[]){if(v.actor?.mode==='labPreview'){v.actor.mode='base';v.actor._play(v.actor._baseName(),true);}}playing=true;error='';last=now();notify();},
    pause(){playing=false;accumulator=0;notify();},
    step(){playing=false;animationPreview=null;tickOne();highlight();notify();},
    reset(){return rebuild(scenario);},
    setSpeed(value){if(![.25,.5,1,2,4].includes(Number(value)))throw new Error('速度必须为0.25、0.5、1、2或4');speed=Number(value);view.setLocalFeed({on:true,speed});notify();},
    castSkill(uid=selectedUid){
      const u=find(Number(uid)); if(!u?.skill) return fail(new Error('该单位没有可主动开启的技能'));
      if(!u.skill.activate('lab',{free:true}))return fail(new Error('技能已持续开启、属于被动技能或单位尚未部署'));
      animationPreview=null;error='';fxPreviewUntil=now()+3000;feed(true);notify();return true;
    },
    playAnimation(uid,name,loopClip=true){
      const actor=visual(Number(uid))?.actor;
      if(!actor?.has(name))return fail(new Error('该动作不存在，或模型尚未加载完成'));
      playing=false;actor.mode='labPreview';actor.frozen=false;actor.windUntil=null;actor.endClip=null;
      actor.spine.state.clearTracks(); actor._play(name,!!loopClip,{mix:0});animationPreview={actor,name};error='';notify();return true;
    },
    previewFx(kind){
      if(!(sim.fxKinds??[]).includes(kind))return fail(new Error('未知特效'));
      const u=find(selectedUid)??battle.allyUnits[0], target=battle.aliveEnemies()[0]??u;
      if(!u)return fail(new Error('请先放置一个单位'));
      try { view.debug.fx.simFx(kind,target.x,target.y,{source:u.id,src:u.id,target:target.id,id:target.id,
        fromX:u.x,fromY:u.y,to:target.id,stage:u.researchStage??2,radius:2,duration:2,
        active:true,continuous:kind==='rhineEcology',bind:kind==='rhineEcology',skill:'sktok_doroth_3',
        tiles:[[Math.round(target.y),Math.round(target.x)]]});fxPreviewUntil=now()+8000;error='';notify();return true;
      } catch(e){return fail(e);}
    },
    exportScenario(){return clone(scenario);},
    async importScenario(input){const parsed=typeof input==='string'?JSON.parse(input):input;if(parsed.profile!==scenario.profile)return applyProfile(parsed.profile,parsed);return controller.setScenario(parsed);},
    preset(name){
      if(name!=='basic'&&scenario.profile!=='rhine')throw new Error('请先切换到莱茵数据档');
      const next=defaultLabScenario(records,scenario.profile);
      if(name==='rhine-energy'||name==='rhine-ecology'){
        const id=name==='rhine-energy'?'token_rhine_energy':'token_rhine_ecology';
        const retired=next.units.find(u=>records.tokens?.[u.id]&&u.id!==id);
        next.units=next.units.filter(u=>!records.tokens?.[u.id]||u.id===id);
        if(!next.units.some(u=>u.id===id)){
          let cell=retired?{row:retired.row,col:retired.col}:null;
          for(let row=GEO.NORMAL_RECT.r0;row<=GEO.NORMAL_RECT.r1&&!cell;row++)for(let col=GEO.NORMAL_RECT.c0;col<=GEO.NORMAL_RECT.c1;col++){
            if(!next.units.some(u=>u.row===row&&u.col===col)){cell={row,col};break;}
          }
          const uid=Math.max(0,...next.units.map(u=>u.uid),...next.enemies.map(u=>u.uid))+1;
          next.units.push({uid,id,...cell,dir:'RIGHT',stage:0,items:[]});
        }
        next.bonds.rhineShip={count:6,layers:name==='rhine-energy'?100:0};
      }
      return rebuild(next);
    },
    destroy(){destroyed=true;playing=false;cancelFrame(frameId);off?.();battle?.forceEnd('lab-close');listeners.clear();if(baseFxUpdate)view.debug.fx.update=baseFxUpdate;view.destroy?.();},
  };
  rebuild(defaultLabScenario(records,'rhine'));
  frameId=frame(loop); return controller;
}
