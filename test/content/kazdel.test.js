// Owner-approved fan mechanics, 2026-10-09: first-death resources and repeatable souls are independent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants, hashOf } from '../helpers/battleHarness.js';
import { KAZDEL_BOND as K, KAZDEL_CHARACTERS as CHAR } from '../../shared/kazdel.js';
import { chainHealNext, acquireTargets } from '../../server/sim/ai.js';
import { canReceiveHeal } from '../../server/sim/damage.js';
import { soulBaseline } from '../../server/sim/content/kazdel/souls.js';
import { cannonKeys } from '../../server/sim/content/kazdel/cannon.js';

const bond = (count = 3, layers = 0) => ({ active: true, count, tier: count >= 9 ? 3 : count >= 6 ? 2 : 1, layers });
const entry = (key, row = 10, col = 5) => ({ chessId: `kaz_${key}`, row, col });
function fixture(keys = ['vigna'], { elite = false, count = 3, layers = 0, bonds = {}, ...opts } = {}) {
  const chess = {}, kits = {};
  for (const key0 of keys) {
    const key = key0.replace(/\d+$/, ''), id = `kaz_${key0}`;
    const record = chessRec({ id, charId: CHAR[key] ?? id, golden: elite, bonds: [K], skill: null,
      profession: key === 'paprika' || key === 'medic' ? 'MEDIC' : key === 'meteorite' ? 'SNIPER' : 'WARRIOR',
      subProf: key === 'paprika' ? 'chainhealer' : key === 'mudrock' ? 'juggernaut' : key === 'meteorite' ? 'aoesniper' : null,
      stats: { maxHp: 2000, atk: 500, def: 100, res: 10, blockCnt: 2, cost: 10, respawnTime: 1000 },
      rangeGrid: [[0,0],[0,1],[0,2],[1,0],[-1,0],[1,1],[-1,1]] });
    if (key in CHAR && key !== 'ines') record.garrisonIds = [`garrison_kazdel_${key}_${elite ? 'b' : 'a'}`];
    chess[id] = record; kits[id] = () => ({});
  }
  const units = keys.map((key, i) => entry(key, 10 + Math.floor(i / 8), 3 + i % 8));
  const h = makeBattle({ defs: { chess, enemies: { kaz_enemy: enemyRec({ key: 'kaz_enemy', hp: 1e6, speed: 0, atk: 0, def: 0 }) }, ...opts.defs },
    units, kits, bonds: { [K]: bond(count, layers), skillfulShip: bond(2), steadShip: {active:false,count:0,tier:0,layers:0}, ...bonds },
    autoFinish: false, timeLimit: 120, ...opts });
  h.step();
  return h;
}
const die = (h, u, source = null, tags = []) => h.b.dealDamage(source, u, { amount: 1e9, type: 'true', canDodge: false, tags });
const soul = u => u.kazdelSoulUnit;
const layers = (h, id = K, owner = 'p1') => h.b.getPlayer(owner).bonds[id].layers;
const shots = h => h.events.filter(e => e[0] === 'fx' && e[1] === 'kazdelCannonImpact');

test('Kazdel stage freezes at start; body and soul receive layer stats once; same-name pieces are independent', () => {
  const h = fixture(['vigna1', 'vigna2'], { layers: 10 });
  const a = h.unit('kaz_vigna1'), b = h.unit('kaz_vigna2');
  assert.equal(a.s.maxHp, 2100);
  die(h, a); assert.equal(layers(h), 12); assert.equal(layers(h, 'skillfulShip'), 2);
  assert.equal(soul(a).s.maxHp, 1320); assert.equal(soul(a).s.atk, 436);
  assert.equal(soul(a).skill.noSkill, true);
  assert.equal(soul(a).profile.install, null); assert.equal(soul(a).items.length, 0);
  assert.equal(h.b.getPlayer('p1').bonds[K].count, 3);
  h.b.getPlayer('p1').bonds[K].count = 0;
  die(h, b); assert.ok(soul(b)); assert.equal(h.b.snapshot().kazdel[0].stage, 1);
  assert.equal(layers(h), 14);
  die(h, soul(a)); assert.equal(layers(h), 14);
  assert.equal(h.b.redeploy(a), true); die(h, a);
  assert.equal(layers(h), 14); assert.equal(h.b.allyUnits.filter(u => u.kazdelSoul).length, 3);
  assert.ok(soul(a).alive);
  assert.ok(checkInvariants(h.b));
});

test('every real body death creates a fresh soul after returns, even after cannon deaths; first-death charge remains once', () => {
  for (const count of [3,6,9]) {
    const h=fixture(['plain'],{count}),u=h.unit('kaz_plain');
    const charge=h.b.snapshot().kazdel[0].charge;
    let previous=null;
    for(let i=0;i<4;i++) {
      die(h,u,null,i===1?['kazdelCannon']:[]);
      const current=soul(u);
      assert.ok(current.alive);assert.notEqual(current,previous);
      assert.equal(h.b.allyUnits.filter(v=>v.kazdelSoul&&v.alive).length,1);
      assert.equal(h.b.snapshot().kazdel[0].charge-charge,count>=6?3:0);
      if(i%2===0)die(h,current);
      assert.equal(h.b.redeploy(u,{free:true}),true);
      assert.equal(current.alive,false);previous=current;
      assert.ok(checkInvariants(h.b));
    }
    assert.equal(h.b.allyUnits.filter(v=>v.kazdelSoul).length,4);
    assert.equal(layers(h),0);
  }
});

test('retreat and prevented/revived deaths produce no soul or resources', () => {
  const h = fixture(['vigna1','vigna2','vigna3']);
  const a = h.unit('kaz_vigna1'), b = h.unit('kaz_vigna2'), c = h.unit('kaz_vigna3');
  h.b.retreat(a); assert.equal(soul(a), undefined);
  h.b.on('kill', ctx => { if (ctx.victim === b) b.hp = 100; }, { priority: 100 });
  die(h,b); assert.equal(b.alive,true); assert.equal(soul(b),undefined);
  h.b.on('death', ctx => { if (ctx.unit === c) h.b.redeploy(c); }, { priority: 10 });
  die(h,c); assert.equal(c.alive,true); assert.equal(soul(c),undefined);
  assert.equal(layers(h),0);
  assert.ok(checkInvariants(h.b));
});

test('soul shares only its own corpse; failed or unpaid redeploy preserves it; automatic return clears it', () => {
  const h = fixture(['vigna','plain']);
  const a = h.unit('kaz_vigna'), p = h.unit('kaz_plain'); die(h,a);
  const s = soul(a), [r,c] = h.b.restTile(a);
  assert.equal(h.b._occ[r*21+c],s);
  assert.equal(h.b.spawnToken(p,'unlisted',r,c,{def:{stats:{atk:1,maxHp:1}}}),null);
  assert.equal(h.b.spawnDevice('unlisted',r,c),null);
  assert.equal(h.b.redeploy(a,{tile:[-1,c]}),false); assert.equal(s.alive,true);
  h.b.getPlayer('p1').dp=0;
  assert.equal(h.b.redeploy(a,{free:false}),false); assert.equal(s.alive,true);
  a.respawnAt=h.b.time; h.b.getPlayer('p1').dp=20; h.step();
  assert.equal(a.alive,true); assert.equal(s.alive,false); assert.equal(s.removeReason,'kazdelReturn');
  assert.equal(h.b._occ[r*21+c],a); assert.ok(checkInvariants(h.b));
});

test('soul baselines exclude skill/talent procs and regeneration; numerical bonds/static gear apply exactly once', () => {
  const h=fixture(['plain'],{layers:10}), u=h.unit('kaz_plain');
  h.b.addBuff(u,{key:'bond:test',persist:true,mods:{hpPct:.5,atkPct:.2,aspd:20}});
  h.b.addBuff(u,{key:'item:test:stat:atk',persist:true,mods:{atkFlat:100}});
  h.b.addBuff(u,{key:'skill:test',persist:true,mods:{hpPct:3,atkPct:4,aspd:200,hpRegen:100}});
  h.b.addBuff(u,{key:'talent:proc',persist:true,mods:{atkFlat:1000}});
  assert.equal(soulBaseline(u).maxHp,3000); assert.equal(soulBaseline(u).atk,720);
  die(h,u); const s=soul(u);
  assert.equal(s.s.maxHp,1900); assert.equal(s.s.atk,606); assert.equal(s.s.aspd,120); assert.equal(s.s.hpRegen,0);
  assert.ok(checkInvariants(h.b));
});

test('ordinary medicine/regen cannot heal souls; medicine souls heal only souls; chain selection respects both groups', () => {
  const h=fixture(['vigna','paprika','medic','plain']);
  const a=h.unit('kaz_vigna'), p=h.unit('kaz_paprika'), m=h.unit('kaz_medic'), plain=h.unit('kaz_plain');
  die(h,a);die(h,p);const s=soul(a), healer=soul(p);s.hp=100;plain.hp=100;
  assert.equal(healer.profile.heal.mode,'chain');
  assert.equal(canReceiveHeal(m,s),false); assert.equal(h.b.heal(m,s,500),0);
  assert.equal(h.b.heal(s,s,500,{regen:true}),0);
  assert.equal(h.b.heal(healer,plain,500),0);
  assert.equal(h.b.heal(healer,s,100),125);
  assert.equal(canReceiveHeal(m,plain),true);
  assert.equal(canReceiveHeal(m,s,{tags:['kazdelSoulHeal'],regen:true}),true);
  assert.equal(h.b.heal(m,s,100,{tags:['kazdelSoulHeal'],regen:true}),100);
  assert.equal(chainHealNext(h.b,m,plain,new Set([plain.id])),m);
  const next=chainHealNext(h.b,healer,s,new Set([s.id])); assert.equal(next,healer);
  assert.ok(acquireTargets(h.b,healer,healer.profile).every(u=>u.kazdelSoul));
});

test('Mudrock soul loses native noHeal, keeps block3 and its extra layer HP; Logos gains layer ATK and multitarget attacks', () => {
  for(const elite of [false,true]) {
    const h=fixture(['mudrock','logos','paprika'],{elite,layers:20}), m=h.unit('kaz_mudrock'), l=h.unit('kaz_logos');
    die(h,m);die(h,l);const ms=soul(m),ls=soul(l);
    assert.equal(ms.profile.noHeal,false); assert.equal(ms.s.blockCnt,3);
    assert.equal(ms.s.maxHp,1200+(elite?20:15)*20);
    assert.equal(ls.s.atk,400+(elite?5:4)*20);assert.equal(ls.profile.maxTargets,elite?3:2);
  }
});

test('Odda gains on each assisted kill and each death pays all prior assists again, without personal caps', () => {
  for(const elite of [false,true]) {
    const h=fixture(['odda'],{elite,bonds:{steadShip:bond(2)}}), u=h.unit('kaz_odda');
    const perKill=elite?2:1;
    for(let i=0;i<9;i++) {
      const e=h.spawn('kaz_enemy',{pos:[9,8]});
      h.b.dealDamage(u,e,{amount:1,type:'true'});h.b.dealDamage(u,e,{amount:1,type:'true'});
      assert.equal(layers(h),i*perKill);die(h,e);
      assert.equal(layers(h),(i+1)*perKill);
      assert.equal(layers(h,'steadShip'),(i+1)*perKill);
      die(h,e);assert.equal(layers(h),(i+1)*perKill);
    }
    const uncredited=h.spawn('kaz_enemy',{pos:[9,8]});die(h,uncredited);
    const cannon=h.spawn('kaz_enemy',{pos:[9,8]});h.b.dealDamage(u,cannon,{amount:1,type:'true'});die(h,cannon,null,['kazdelCannon']);
    assert.equal(layers(h),10*perKill);
    die(h,u);assert.equal(layers(h),20*perKill);assert.equal(layers(h,'steadShip'),20*perKill);
    assert.equal(u.mem.kazdelParticipatedKills.size,10);
    const e=h.spawn('kaz_enemy',{pos:[9,8]});h.b.dealDamage(soul(u),e,{amount:1,type:'true'});die(h,e);
    assert.equal(u.mem.kazdelParticipatedKills.size,10);
    assert.equal(layers(h),20*perKill);
    assert.equal(h.b.redeploy(u,{free:true}),true);
    const later=h.spawn('kaz_enemy',{pos:[9,8]});die(h,later,u);
    assert.equal(layers(h),21*perKill);
    die(h,u);assert.equal(layers(h),32*perKill);assert.equal(layers(h,'steadShip'),32*perKill);
    assert.ok(checkInvariants(h.b));
  }
});

test('Odda ignores zero body damage and soul kills, skips inactive bonds, and cannon friendly-fire deaths do not repay assists', () => {
  const h=fixture(['odda1','odda2'],{count:6}),a=h.unit('kaz_odda1'),b=h.unit('kaz_odda2');
  const e=h.spawn('kaz_enemy',{pos:[9,8]});h.b.dealDamage(a,e,{amount:0,type:'true'});die(h,e);
  assert.equal(layers(h),0);
  const assisted=h.spawn('kaz_enemy',{pos:[9,8]});
  h.b.dealDamage(a,assisted,{amount:1,type:'true'});die(h,assisted,b);
  assert.equal(layers(h),2);assert.equal(layers(h,'steadShip'),0);
  die(h,a,null,['kazdelCannon']);assert.equal(layers(h),2);assert.ok(soul(a).alive);
  assert.equal(h.b.redeploy(a,{free:true}),true);die(h,a);assert.equal(layers(h),3);
  assert.ok(checkInvariants(h.b));
});

test('Hoederer strongest body/soul aura counts own qualifying pieces including self, without personal caps', () => {
  const keys=['hoederer1','hoederer2',...Array.from({length:13},(_,i)=>`plain${i}`)];
  for(const elite of [false,true]) {
    const h=fixture(keys,{elite});
    for(const key of keys) die(h,h.unit(`kaz_${key}`));
    assert.equal(layers(h),keys.length*(elite?10:6));
    const former=h.unit('kaz_plain0'); h.b.redeploy(former);die(h,former);
    assert.equal(layers(h),keys.length*(elite?10:6));
  }
});

test('Hoederer mixed normal/elite auras select 10 layers once per qualifying piece rather than stacking', () => {
  const h=fixture(['hoederer1','hoederer2','plain']);
  h.unit('kaz_hoederer2').def.raw.garrisonIds=['garrison_kazdel_hoederer_b'];
  for(const key of ['plain','hoederer1','hoederer2'])die(h,h.unit(`kaz_${key}`));
  assert.equal(layers(h),30);assert.ok(checkInvariants(h.b));
});

test('Tinman aura excludes self, follows live body/soul and chooses strongest overlapping aura', () => {
  const h=fixture(['tinman1','tinman2','plain']);
  const t1=h.unit('kaz_tinman1'), t2=h.unit('kaz_tinman2'), p=h.unit('kaz_plain');
  die(h,t1);die(h,p);h.step();
  assert.equal(soul(p).s.aspd,115);assert.equal(soul(t1).s.aspd,115);
  die(h,t2);h.step(); assert.equal(soul(p).s.aspd,115);
  die(h,soul(t1));die(h,soul(t2));h.step();assert.equal(soul(p).s.aspd,100);
});

test('all normal/elite Kazdel garrison records yield literal combat bonuses, not just registered coverage keys', () => {
  for (const elite of [false,true]) {
    const v=fixture(['vigna'],{elite});die(v,v.unit('kaz_vigna'));assert.equal(layers(v),elite?4:2);
    const p=fixture(['paprika','plain'],{elite});die(p,p.unit('kaz_paprika'));die(p,p.unit('kaz_plain'));
    const healer=soul(p.unit('kaz_paprika')), patient=soul(p.unit('kaz_plain'));patient.hp=100;
    assert.equal(p.b.heal(healer,patient,100),elite?150:125);
    const t=fixture(['tinman','plain'],{elite});die(t,t.unit('kaz_plain'));t.step();
    assert.equal(soul(t.unit('kaz_plain')).s.aspd,elite?130:115);
    const m=fixture(['meteorite','plain'],{elite});die(m,m.unit('kaz_plain'));
    const e=m.spawn('kaz_enemy',{pos:[10,5]});e.blockedBy=soul(m.unit('kaz_plain'));soul(m.unit('kaz_plain')).blocking.push(e);
    const hp=e.hp;m.b.dealDamage(m.unit('kaz_meteorite'),e,{amount:100,type:'true'});assert.equal(hp-e.hp,elite?140:120);
    const w=fixture(['wisdel','plain'],{elite,count:6});die(w,w.unit('kaz_plain'));const spirit=soul(w.unit('kaz_plain'));
    const foe=w.spawn('kaz_enemy',{pos:[10,10]});const before=foe.hp;w.b.dealDamage(spirit,foe,{amount:100,type:'true'});
    assert.equal(before-foe.hp,elite?140:120);
    for(const u of w.b.allyUnits)u.profile.noAttack=true;w.run(16);
    assert.equal(spirit.mem.kazdelNextAttackBonus,elite?1:.5);
  }
});

test('Meteorite uses any allied soul blocker; Wisdel boosts souls but never cannon, next-attack bonus refreshes once', () => {
  const h=fixture(['meteorite','plain','wisdel'],{count:6,layers:0}), m=h.unit('kaz_meteorite'), p=h.unit('kaz_plain'), w=h.unit('kaz_wisdel');
  die(h,p);const s=soul(p), e=h.spawn('kaz_enemy',{pos:[10,7]}); e.blockedBy=s;s.blocking.push(e);
  const before=e.hp;h.b.dealDamage(m,e,{amount:100,type:'true'});assert.equal(before-e.hp,120);
  const before2=e.hp;h.b.dealDamage(s,e,{amount:100,type:'true'});assert.equal(before2-e.hp,120);
  die(h,w);const ws=soul(w);assert.ok(ws);
  h.run(15);assert.ok(shots(h).length>=1);
  // Any auto attacks may already consume it: explicitly compare fresh profile-captured bonus.
  s.profile.projectile='none';s.profile.attack='melee';s.mem.kazdelNextAttackBonus=.5;
  const hp=e.hp;h.b.forceAttack(s,[e]);assert.equal(s.mem.kazdelNextAttackBonus,0);
  assert.ok(e.hp<hp); const dealt=hp-e.hp;
  const hp2=e.hp;h.b.forceAttack(s,[e]);assert.ok(Math.abs(dealt/(hp2-e.hp)-1.5)<1e-9);
  assert.ok(checkInvariants(h.b));
});

test('cannon charge is independent of SP/ASPD; 3sec floor and final2sec warning do not add shot delay', () => {
  const h=fixture(['plain'],{count:6,layers:600}),u=h.unit('kaz_plain');
  const times=[]; const originalFx=h.b.fx.bind(h.b);
  h.b.fx=(kind,params)=>{if(kind==='kazdelCannonImpact')times.push(h.b.time);originalFx(kind,params);};
  u.profile.noAttack=true;h.b.addBuff(u,{key:'speed',mods:{aspd:500,spRecoveryFlat:100}});
  h.spawn('kaz_enemy',{pos:[10,8]});
  h.run(12);
  const impacts=shots(h);assert.ok(impacts.length>=3);const view=h.b.snapshot().kazdel[0];
  assert.equal(view.rate,4);assert.equal(view.maxCharge,15);
  assert.ok(Math.abs(times[0]-3.75)<2*h.b.dt);
  assert.ok(times.every((time,i)=>i===0||Math.abs(time-times[i-1]-3.75)<2*h.b.dt));
  const warning=h.events.find(e=>e[0]==='fx'&&e[1]==='kazdelCannonWarning');assert.ok(warning&&warning[4].dur<=2+1e-9);
  assert.ok(h.b.fieldMeta().kazdel);assert.equal(h.b.allyUnits.some(x=>x.defId==='kazdel_cannon'),false);
});

test('deaths filling the cannon still leave a complete2sec warning; repeated overcharge never beats3sec shot spacing', () => {
  const h=fixture(['plain',...Array.from({length:12},(_,i)=>`plain${i}`)],{count:6,layers:999});
  h.spawn('kaz_enemy',{pos:[10,10]});for(const u of h.b.allyUnits)u.profile.noAttack=true;
  const times=[];const fx=h.b.fx.bind(h.b);h.b.fx=(kind,p)=>{if(kind==='kazdelCannonImpact')times.push(h.b.time);fx(kind,p);};
  for(let i=0;i<5;i++)die(h,h.unit(`kaz_plain${i}`));h.step();
  const view=h.b.snapshot().kazdel[0];assert.equal(view.charge,15);assert.ok(view.warning);
  assert.ok(view.warning.until-view.warning.startedAt>=2-1e-9);
  h.run(1.8);assert.equal(times.length,0);h.run(.3);assert.equal(times.length,1);
  for(let i=5;i<10;i++)die(h,h.unit(`kaz_plain${i}`));h.step();h.run(2.5);assert.equal(times.length,1);
  h.run(.6);assert.ok(times.length>=2);assert.ok(times[1]-times[0]>=3-1e-9);
});

test('Tinman native S2 heals a soul through the explicit capability while ordinary living regeneration stays native', () => {
  const h=makeBattle({units:[{chessId:'chess_char_2_19_a',row:10,col:5},{chessId:'chess_char_1_05_a',row:10,col:6}],
    bonds:{[K]:bond(3)},autoFinish:false});h.step();
  const t=h.unit('chess_char_2_19_a'),v=h.unit('chess_char_1_05_a');die(h,v);const s=soul(v);
  s.hp=100;t.hp=100;t.skill.setSpTotal(t.skill.spCost);
  assert.equal(t.skill.activate(),true);h.run(1);
  assert.ok(s.hp>100);assert.equal(s.s.hpRegen,0);assert.ok(t.s.hpRegen>0||t.hp>100);
  assert.equal(s.profile.install,null);assert.ok(checkInvariants(h.b));
});

test('merged fields keep death resources/cannon states per player; Tin aura and Meteorite soul-block bonus accept allied teammates', () => {
  const players=[
    {playerId:'p1',seat:0,coords:'field',units:[entry('vigna',10,9),entry('meteorite',10,8)],bonds:{[K]:bond(6,10),skillfulShip:bond(2)}},
    {playerId:'p2',seat:1,coords:'field',colOffset:8,units:[entry('plain',11,9),entry('tinman',11,10)],bonds:{[K]:bond(9,40)}},
  ];
  const h=fixture(['vigna','meteorite','plain','tinman'],{players,kind:'unite',flags:{layerGainsEnabled:true}});
  const v=h.unit('kaz_vigna'),p=h.unit('kaz_plain'),m=h.unit('kaz_meteorite'),t=h.unit('kaz_tinman');
  const before=h.b.snapshot().kazdel.map(s=>s.charge);die(h,v);
  assert.equal(layers(h,K,'p1'),12);assert.equal(layers(h,K,'p2'),40);
  assert.equal(h.b.snapshot().kazdel[0].charge-before[0],3);assert.equal(h.b.snapshot().kazdel[1].charge,before[1]);
  die(h,p);h.step();assert.equal(soul(v).s.aspd,115);assert.equal(soul(p).s.aspd,115);
  const e=h.spawn('kaz_enemy',{pos:[11,9]});e.blockedBy=soul(p);soul(p).blocking.push(e);
  const hp=e.hp;h.b.dealDamage(m,e,{amount:100,type:'true'});assert.equal(hp-e.hp,120);
  for(const u of h.b.allyUnits)u.profile.noAttack=true;
  h.run(15);const owners=new Set(shots(h).map(e=>e[4].ownerId));assert.deepEqual(owners,new Set(['p1','p2']));
  const snap=h.b.snapshot().kazdel;assert.equal(snap[0].stage,2);assert.equal(snap[1].stage,3);
  assert.equal(snap[0].layers,12);assert.equal(snap[1].layers,40);
  assert.ok(checkInvariants(h.b));
});

test('active Harmony recipients inherit Kazdel HP/soul/death charge through canonical membership without changing frozen counts', () => {
  for(const harmony of [false,true]) {
    const rec=chessRec({id:'kaz_mani',bonds:['maniShip'],skill:null,stats:{maxHp:2000,respawnTime:1000}});
    const h=makeBattle({defs:{chess:{kaz_mani:rec}},units:[{chessId:'kaz_mani',row:10,col:5},{chessId:'chess_kazdel_hoederer_a',row:10,col:4}],
      kits:{kaz_mani:()=>({})},bonds:{[K]:bond(6,10),maniShip:{active:harmony,count:2,tier:1,layers:0}},autoFinish:false});h.step();
    const u=h.unit('kaz_mani'),before=h.b.snapshot().kazdel[0].charge;
    assert.equal(u.s.maxHp,harmony?2100:2000);die(h,u);
    assert.equal(!!soul(u),harmony);assert.equal(layers(h),harmony?16:10);
    assert.equal(h.b.snapshot().kazdel[0].charge-before,harmony?3:0);
    if(harmony)assert.equal(soul(u).s.maxHp,1360);
    assert.equal(h.b.getPlayer('p1').bonds[K].count,6);assert.equal(h.b.snapshot().kazdel[0].stage,2);
    assert.ok(checkInvariants(h.b));
  }
});

test('cannon derivatives cannot hit souls; stage9 additionally shields living allies across damage, HP loss and direct kills', () => {
  for(const count of [6,9]) {
    const h=fixture(['plain','plain2'],{count}),living=h.unit('kaz_plain'),fallen=h.unit('kaz_plain2');die(h,fallen);const s=soul(fallen);
    const e=h.spawn('kaz_enemy',{pos:[9,8]}); const hp=living.hp,sh=s.hp;
    h.b.on('damaged',ctx=>{
      if(ctx.target!==e)return;
      h.b.dealDamage(e,s,{amount:100,type:'true'});
      h.b.loseHp(s,100,{source:e});h.b.kill(s,e);
      h.b.dealDamage(e,living,{amount:100,type:'true'});
      h.b.loseHp(living,100,{source:e});
    });
    die(h,e,null,count===9?['kazdelCannon','kazdelCannonEnemiesOnly']:['kazdelCannon']);
    assert.equal(s.hp,sh);assert.equal(s.alive,true);assert.equal(hp-living.hp,count===9?0:200);
    assert.equal(h.b._kazdelCannonDamageDepth,0);
    // A delayed copy of the origin DamageInfo retains the same protection without any open damage frame.
    assert.equal(h.b.loseHp(s,100,{from:{tags:['kazdelCannon']}}),0);
    assert.equal(h.b.loseHp(living,100,{from:{tags:['kazdelCannon','kazdelCannonEnemiesOnly']}}),0);
    assert.ok(checkInvariants(h.b));
  }
});

test('actual enemy death pollution retains cannon origin on scheduled ticks: souls immune at6/9, living allies safe only at9', () => {
  for(const count of [6,9]) {
    const h=fixture(['plain','plain2'],{count}),living=h.unit('kaz_plain'),fallen=h.unit('kaz_plain2');
    die(h,fallen);const s=soul(fallen);for(const u of h.b.allyUnits)u.profile.noAttack=true;
    const e=h.spawn('enemy_1267_nhpbr',{pos:[living.tileR,living.tileC]});const hp=living.hp,sh=s.hp;
    die(h,e,null,count===9?['kazdelCannon','kazdelCannonEnemiesOnly']:['kazdelCannon']);h.run(2.2);
    assert.equal(s.hp,sh);assert.equal(hp-living.hp,count===9?0:100);assert.equal(layers(h),0);
    assert.equal(h.b._kazdelCannonDamageDepth,0);assert.ok(checkInvariants(h.b));
  }
});

test('cannon-created projectile and buff callbacks preserve origin, while ordinary callbacks still damage souls normally', () => {
  const h=fixture(['plain','plain2'],{count:9}),body=h.unit('kaz_plain'),fallen=h.unit('kaz_plain2');die(h,fallen);const s=soul(fallen);
  for(const u of h.b.allyUnits)u.profile.noAttack=true;const e=h.spawn('kaz_enemy',{pos:[9,8]});const hp=body.hp,sh=s.hp;
  h.b.on('damaged',ctx=>{
    if(ctx.target!==e)return;
    h.b.after(.1,()=>h.b.loseHp(body,100));
    h.b.addProjectile({from:e,to:{x:s.x,y:s.y},speed:10,onHit:()=>h.b.dealDamage(e,s,{amount:100,type:'true'})});
    h.b.addBuff(body,{key:'cannon:derived',duration:.2,onTick:()=>h.b.loseHp(body,100),onExpire:()=>h.b.loseHp(s,100)});
  });
  die(h,e,null,['kazdelCannon','kazdelCannonEnemiesOnly']);h.run(1);
  assert.equal(body.hp,hp);assert.equal(s.hp,sh);assert.equal(h.b._kazdelCannonDamageDepth,0);
  h.b.after(.1,()=>h.b.loseHp(s,100));h.run(.2);assert.equal(s.hp,sh-100);
  assert.ok(checkInvariants(h.b));
});

test('stage6 cannon friendly fire cannot generate layers or charge, including immediate split/reflection derivatives; still generates souls', () => {
  const h=fixture(['vigna','plain','plain2'],{count:6});
  const v=h.unit('kaz_vigna'), p=h.unit('kaz_plain'), p2=h.unit('kaz_plain2');
  const e=h.spawn('kaz_enemy',{pos:[v.tileR,v.tileC]}); for(const u of [v,p,p2]) {u.hp=1;u.profile.noAttack=true;}
  h.b.on('damaged',c=>{if(c.target===v&&c.dmg.tags.includes('kazdelCannon'))h.b.loseHp(p2,1e6,{source:p});});
  h.run(15);
  assert.equal(v.alive,false);assert.equal(p2.alive,false);assert.ok(soul(v));assert.ok(soul(p2));
  assert.equal(layers(h),0);assert.equal(layers(h,'skillfulShip'),0);
  assert.ok(soul(v).alive); assert.ok(h.b.snapshot().kazdel[0].charge<1);
  assert.ok(checkInvariants(h.b));
});

test('stage9 cannon never harms living allies, ignores souls at all tiers, and cannot survive by itself', () => {
  const h=fixture(['vigna','plain'],{count:9});const v=h.unit('kaz_vigna'),p=h.unit('kaz_plain');
  h.spawn('kaz_enemy',{pos:[v.tileR,v.tileC]});v.profile.noAttack=true;p.profile.noAttack=true;
  const hp=v.hp;die(h,p);const s=soul(p);s.profile.noAttack=true;const sh=s.hp;
  h.run(15);assert.equal(v.hp,hp);assert.equal(s.hp,sh);assert.ok(shots(h).length);
  die(h,v,null,['kazdelCannon']);die(h,soul(v));die(h,s);
  const count=shots(h).length,charge=h.b.snapshot().kazdel[0].charge;h.run(20);
  assert.equal(shots(h).length,count);assert.equal(h.b.snapshot().kazdel[0].charge,charge);
  h.b.forceEnd();assert.equal(h.b.finished,true);
});

test('boss/unite/hidden have local souls/cannon but no persistent layer gains; end cleans souls and cannot change result', () => {
  for(const kind of ['unite','boss','hidden']) {
    const h=fixture(['vigna'],{kind,count:6,layers:10}),u=h.unit('kaz_vigna');const charge=h.b.snapshot().kazdel[0].charge;die(h,u);
    assert.ok(soul(u));assert.equal(layers(h),10);assert.deepEqual(h.b._pp('p1').layerGains,{});
    assert.equal(h.b.snapshot().kazdel[0].charge-charge,3);h.b.forceEnd();assert.equal(soul(u).alive,false);
    const before=JSON.stringify(h.b.result());h.step();assert.equal(JSON.stringify(h.b.result()),before);
    assert.equal(h.b.snapshot().kazdel[0].warning,null);
  }
});

test('tile-square at edge never wraps negative columns; same-seed replay and death order produce identical result', () => {
  assert.equal(cannonKeys(0,10).has(9*21+20),false);
  const run=()=>{
    const h=fixture(['vigna','hoederer','wisdel','paprika'],{count:6,layers:30,seed:1234});
    h.spawn('kaz_enemy',{pos:[10,8]});die(h,h.unit('kaz_vigna'));die(h,h.unit('kaz_paprika'));h.run(25);h.b.forceEnd();
    assert.equal(h.b._errKeys.size,0);assert.ok(checkInvariants(h.b));
    return hashOf([h.b.result(),h.b.snapshot(),h.events]);
  };
  assert.equal(run(),run());
});
