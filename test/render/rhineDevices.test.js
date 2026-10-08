import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { researchPose, RHINE_LOOK, laserFeedback } from '../../public/js/render/rhineDevices.js';
import { FxSystem, SHOT_HEIGHT } from '../../public/js/render/fx.js';
import { RHINE_DEVICES, RHINE_BALANCE } from '../../shared/rhineResearch.js';
import { energyPulseRange } from '../../shared/rhineRange.js';
import { createAssets } from '../../public/js/assets.js';
import { GEO } from '../../shared/constants.js';
import { COLORS } from '../../public/js/render/style.js';

let fake, UnitView, unitSpriteTexture, renderInfo;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
  ({ unitSpriteTexture } = await import('../../public/js/render/textures.js'));
  ({ renderInfo } = await import('../../public/js/render/app.js'));
});
after(() => fake.restore());
const cam = presetCamera('prep', { width: 1280, height: 720 });
const tick = () => new Promise(r => setImmediate(r));

test('the upstream frozen-gate marker stays pictorially distinct from Rhine full-sprite devices', async () => {
  const requested = [], img = { width: 160, height: 100 };
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: {
    picture: () => '/owner-portrait.png',
    image: async url => { requested.push(url); return img; },
  } });
  const ice = new UnitView(ctx, { id: 210, kind: 'token', defId: 'token_10058_sbell2_icetgt', side: 'ally', x: 5, y: 12 });
  const device = new UnitView(ctx, { id: 211, kind: 'token', defId: 'token_rhine_medical', side: 'ally', x: 6, y: 12 });
  await tick(); await tick();
  ice.update(1 / 60, cam, 0); device.update(1 / 60, cam, 0);
  assert.equal(ice._pic.state, 'none', 'the frozen gate must not load its operator portrait');
  assert.equal(ice._pic.color, 0x9fe6ff);
  assert.equal(ice.researchActor, null);
  assert.deepEqual(requested, [RHINE_DEVICES.find(d => d.key === 'medical').sprite]);
  assert.equal(device._pic.img, img);
  assert.equal(device.fallback.texture, unitSpriteTexture(img), 'research art must retain the uncropped sprite texture');
  ice.destroy(); device.destroy();
});

test('a late battle view preserves breakthrough lamps before any research effect is replayed', async () => {
  const info = renderInfo({ id: 200, kind: 'token', defId: 'token_rhine_medical', side: 'ally', x: 5, y: 12, researchStage: 2 });
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: { image: async () => ({ width: 100, height: 140 }) } });
  const v = new UnitView(ctx, info);
  await tick(); await tick(); v.update(1 / 60, cam, 0);
  assert.equal(v.researchActor.stage, 2);
  assert.equal(v.researchActor.lights.filter(light => light.visible).length, 3,
    'watching or reconnecting must not show prototype lamps until the next device activation');
  assert.equal(v.researchActor.pulse, 0);
  assert.equal(renderInfo({ id: 201, researchStage: '2' }).researchStage, undefined);
  assert.equal(renderInfo({ id: 201, researchStage: 99 }).researchStage, undefined);
  assert.equal(renderInfo({ id: 201, form: 'husk' }).form, 'husk', 'upstream model forms are still preserved');
  v.destroy();
});

test('late asset recovery retries device images without requesting a fictional Spine model', async () => {
  let ready = false, imageRequests = 0, spineRequests = 0;
  const assets = createAssets({ manifest: {},
    loadImage: async () => { imageRequests++; return ready ? { width: 100, height: 140 } : null; },
  });
  const spineEntry = assets.spineEntry;
  assets.spineEntry = (...args) => { spineRequests++; return spineEntry(...args); };
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets });
  const v = new UnitView(ctx, { id: 202, kind: 'token', defId: 'token_rhine_medical', side: 'ally', x: 5, y: 12 });
  await tick(); await tick();
  assert.equal(v._pic.state, 'none');
  const failedRequests = imageRequests;
  ready = true;
  v.retryAssets();
  await tick(); await tick(); v.update(1 / 60, cam, 0);
  assert.ok(imageRequests > failedRequests);
  assert.equal(v._pic.state, 'img');
  assert.equal(v._pic.shown, 'img');
  assert.ok(v.researchActor);
  assert.equal(spineRequests, 0);
  const recoveredRequests = imageRequests;
  v.retryAssets();
  await tick();
  assert.equal(imageRequests, recoveredRequests, 'a recovered device is not downloaded on every tab return');
  v.destroy();
});

test('PNG texture trims transparent export margins, preserves aspect and caches the result', () => {
  const create = globalThis.document.createElement;
  const drawn = [];
  globalThis.document.createElement = tag => {
    const canvas = create(tag);
    if (tag === 'canvas') {
      const ctx = canvas.getContext('2d');
      ctx.drawImage = (...args) => drawn.push(args);
      ctx.getImageData = () => {
        const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        for (let y = 30; y <= 90; y++) for (let x = 20; x <= 180; x++) data[(y * canvas.width + x) * 4 + 3] = 255;
        return { data };
      };
    }
    return canvas;
  };
  try {
    const img = { width: 800, height: 400 };
    const tx = unitSpriteTexture(img);
    assert.equal(unitSpriteTexture(img), tx);
    assert.deepEqual(drawn, [[img, 0, 0, 384, 192]], 'downsample once, no backdrop or diamond mask');
    assert.deepEqual({ ...tx.frame }, { x: 19, y: 29, width: 163, height: 63 }, 'one transparent pixel retained around the complete silhouette');
  } finally { globalThis.document.createElement = create; }
});

test('only the medical drone hovers; grounded equipment breathes without sliding or bouncing', () => {
  assert.notEqual(researchPose('medical', 0).y, researchPose('medical', 1).y);
  assert.notEqual(researchPose('medical', 0).rotation, researchPose('medical', 1).rotation);
  for (const key of ['energy', 'laser']) {
    assert.equal(researchPose(key, 0).y, researchPose(key, 3).y);
    assert.equal(researchPose(key, 1, 2, 1).rotation, 0);
    assert.ok(researchPose(key, 1, 2, 1).light > researchPose(key, 1, 0, 0).light);
  }
});

test('research rigs are bounded, show breakthrough lamps, react only to their own events and survive low quality', async () => {
  const kinds = { medical: 'rhineHeal', energy: 'rhinePulse', laser: 'rhineLaser' };
  for (const d of RHINE_DEVICES) {
    const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: { image: async () => ({ width: 100, height: 140 }) } });
    const v = new UnitView(ctx, { id: d.key, kind: 'token', defId: d.tokenId, side: 'ally', x: 5, y: 12, dir: 'RIGHT', maxHp: 1, researchStage: 1 });
    await tick(); await tick(); v.update(1 / 60, cam, 0);
    const rig = v.researchActor;
    assert.equal(rig.lights.filter(x => x.visible).length, d.key === 'laser' ? 1 : 2);
    assert.equal(v.facingArrow, null, 'radial research equipment has no directional wedge');
    assert.ok(v.fallback.width <= v.screen.s * RHINE_LOOK[d.key].width * 1.02);
    assert.ok(v.fallback.height <= v.screen.s * RHINE_LOOK[d.key].height * 1.02);
    assert.equal(rig.root.parent, v.body, 'same depth, culling and teardown as the summon');
    v.onResearchFx('anUnrelatedEffect', { stage: 2 });
    assert.equal(rig.pulse, 0); assert.equal(rig.stage, d.key === 'laser' ? 0 : 1);
    v.onResearchFx(kinds[d.key], { stage: 2, active: true });
    v.update(1 / 60, cam, 1);
    assert.ok(rig.pulse > 0); assert.equal(rig.lights.filter(x => x.visible).length, d.key === 'laser' ? 1 : 3);
    const canvases = fake.canvases.length, children = rig.root.children.length;
    ctx.settings.quality = 'low';
    for (let i = 0; i < 90; i++) v.update(1 / 60, cam, 1 + i / 60);
    assert.equal(rig.pulse, 0, 'a trigger fades instead of staying on indefinitely');
    assert.equal(rig.details.filter(x => x.visible).length, 1, 'low quality sheds cosmetic emitters');
    assert.equal(rig.root.children.length, children); assert.equal(fake.canvases.length, canvases, 'no per-frame texture allocations');
    v.setResearchStage(0); v.update(1 / 60, cam, 3);
    assert.equal(rig.lights.filter(x => x.visible).length, 1);
    ctx.viewport = () => ({ width: 1, height: 1 }); v.update(1 / 60, cam, 4);
    assert.equal(v.root.visible, false, 'offscreen body and attached rig are culled together');
    v.destroy(); assert.equal(v.root.destroyed, true);
  }
});

test('actual source ids animate the device while medical and pulse effects use their target point', () => {
  const activations = [], rings = [], beams = [], flashes = [], particles = [];
  const source = { id: 20, x: 1, y: 2, z: 0.16, onResearchFx: (...args) => activations.push(args) };
  const target = { id: 30, x: 3, y: 4, z: 0 };
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx: { cam: () => cam, heightAt: () => 0, view: id => ({ 20: source, 30: target })[id], timeScale: () => 2 },
    ring: (...args) => rings.push(args), tileFlash: (...args) => flashes.push(args), _beam: (...args) => beams.push(args),
    particle: (...args) => particles.push(args) });
  fx.simFx('rhineHeal', 3, 4, { source: 20, target: 30, stage: 1 });
  assert.deepEqual(activations[0], ['rhineHeal', { source: 20, target: 30, stage: 1 }]);
  assert.deepEqual(beams[0].slice(0, 2), [source, target]);
  assert.deepEqual(rings[0].slice(0, 2), [3, 4]);
  rings.length = 0;
  fx.simFx('rhinePulse', 3, 4, { source: 20, stage: 0 });
  assert.deepEqual(rings.map(r => r.slice(0, 2)), [[1, 2], [1, 2]]);
  assert.deepEqual(flashes[0][0], [[0,1],[1,0],[1,1],[1,2],[2,-1],[2,0],[2,1],[2,2],[2,3],[3,0],[3,1],[3,2],[4,1]].filter(([r,c]) => r >= 0 && c >= 0), 'prototype damage flashes complete cells around the device');
  assert.equal(beams[1][0], source, 'a visible beam starts at the firing tower');
  assert.deepEqual([beams[1][1].x, beams[1][1].y], [3, 4], 'instant hit cue terminates at the sim impact point');
  assert.equal(particles.length, 1, 'high quality adds a muzzle flare to the persistent actor pulse');
  const feet = cam.project(source.x, source.y, source.z);
  assert.equal(particles[0][1], feet.x);
  assert.equal(particles[0][2], feet.y - 1.2 * SHOT_HEIGHT.launch * feet.s,
    'the pulse muzzle flare shares the upstream beam launch height in screen space');
  rings.length = 0;
  fx.simFx('rhinePulse', 3, 4, { source: 20, stage: 2 });
  assert.equal(rings.length, 2);
  assert.deepEqual(flashes[1][0], energyPulseRange(2).grid.map(([r,c]) => [4+r,3+c]), 'the mature grid centres on the struck target, not the source');
  fx.simFx('rhineEcology', 1, 2, { source: 20, stage: 2, radius: 3, continuous: true, bind: true, duration: RHINE_BALANCE.ecologyInterval });
  assert.ok(flashes[2][0].length > 0, 'ecology activation lights complete cells instead of a round area');
  assert.equal(flashes[2][2], RHINE_BALANCE.ecologyInterval / 2, 'continuous field covers the full refresh interval at 2x battle speed');
  assert.equal(flashes[2][3], false, 'the continuous field is not a periodic danger flash');
  assert.equal(flashes[2][4].steady, true);
  assert.equal(flashes[3][2], RHINE_BALANCE.ecologyBindDuration / 2, 'bind is a separate one-game-second cue');
  assert.equal(flashes[3][3], true);
  assert.doesNotThrow(() => fx.simFx('rhineHeal', 3, 4, { source: 999, target: 999 }), 'missing/removed source leaves a safe point effect');
});

test('energy charge uses the real skill gauge under the tower, including zero/partial/full and reconnect states', async () => {
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: { image: async () => ({ width: 100, height: 140 }) } });
  const info = renderInfo({ id: 210, kind: 'token', defId: 'token_rhine_energy', side: 'ally', x: 5, y: 12,
    maxHp: 1, sp: 2, spMax: 3 });
  const v = new UnitView(ctx, info);
  await tick(); await tick(); v.update(1 / 60, cam, 0);
  assert.equal(v.spFill.visible, true, 'late observer sees charge before the next snapshot');
  assert.ok(Math.abs(v.spFill.width / (v.spBg.width - 2) - 2 / 3) < 1e-9);
  assert.ok(v.spFill.position.y > v.screen.y, 'the charge gauge sits below the tower feet');
  assert.equal(v.spFill.tint, 0xffbc70);
  const children = v.hud.children.length, canvases = fake.canvases.length;
  for (const charge of [0, 1, 2, 3, 0]) {
    v.sync({ x: 5, y: 12, hp: 1, maxHp: 1, sp: charge, spMax: 3, flags: 0, anim: 0, vx: 0 }, 1);
    v.update(1 / 60, cam, 1);
    assert.ok(Math.abs(v.spFill.width / (v.spBg.width - 2) - charge / 3) < 1e-9);
    assert.equal(v.spFill.tint, charge === 3 ? COLORS.spReady : 0xffbc70);
    assert.equal(v.spGlow.visible, charge === 3);
  }
  assert.equal(v.hud.children.length, children); assert.equal(fake.canvases.length, canvases);
  v.die(); v.update(1 / 60, cam, 2);
  assert.equal(v.spFill.visible, false, 'dead equipment never leaves an active charge meter');
  v.destroy();
  const prep = new UnitView(ctx, info, { prep: true });
  await tick(); await tick(); prep.update(1 / 60, cam, 0);
  assert.equal(prep.spFill.visible, false, 'charge is combat state, not a preparation progress counter');
  prep.destroy();
});

test('a fully charged tower stays visibly ready without inventing firing events, including after reconnect', async () => {
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, settings: { quality: 'low' }, assets: { image: async () => ({ width: 100, height: 140 }) } });
  const info = renderInfo({ id: 220, kind: 'token', defId: 'token_rhine_energy', side: 'ally', x: 5, y: 12,
    maxHp: 1, sp: 3, spMax: 3, researchStage: 2 });
  const v = new UnitView(ctx, info);
  await tick(); await tick();
  for (let i = 0; i <= 600; i++) v.update(1 / 60, cam, i / 60);
  assert.equal(v.spGlow.visible, true, 'held charge does not expire with the brief firing animation');
  assert.equal(v.spFill.tint, COLORS.spReady);
  assert.equal(v.researchActor.core.tint, 0xffe8c4);
  assert.equal(v.researchActor.pulse, 0, 'a full charge is not itself a successful shot');
  assert.ok(v.researchActor.core.alpha > researchPose('energy', 10 + v.bob, 2).light);
  v.sync({ x: 5, y: 12, hp: 1, maxHp: 1, sp: 0, spMax: 3, flags: 0, anim: 0, vx: 0 }, 1);
  v.update(1 / 60, cam, 11);
  assert.equal(v.spGlow.visible, false);
  assert.equal(v.researchActor.core.tint, RHINE_LOOK.energy.tint, 'the next snapshot clears readiness after consumption');
  v.destroy();
  const prep = new UnitView(ctx, info, { prep: true });
  await tick(); await tick(); prep.update(1 / 60, cam, 0);
  assert.equal(prep.researchActor.core.tint, RHINE_LOOK.energy.tint, 'preparation does not reuse combat readiness');
  prep.destroy();
});

test('low quality keeps the actual pulse beam and impact, and ecology visuals match the clipped field grid', () => {
  const beams = [], rings = [], flashes = [];
  const source = { id: 1, x: 6, y: 10, z: 0, onResearchFx() {} };
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx: { cam: () => cam, settings: { quality: 'low' }, heightAt: () => 0,
    fieldRect: () => GEO.NORMAL_RECT, view: id => id === 1 ? source : null, timeScale: () => 1 },
    ring: (...args) => rings.push(args), tileFlash: (...args) => flashes.push(args), _beam: (...args) => beams.push(args),
    particle: () => { throw new Error('low quality must shed the extra muzzle particle'); } });
  fx.simFx('rhinePulse', 8.4, 10.4, { source: 1, stage: 2 });
  assert.equal(beams.length, 1);
  assert.equal(rings.length, 2, 'source firing and the impact point remain clear');
  assert.deepEqual(flashes[0][0], energyPulseRange(2).grid.map(([r,c]) => [10+r,8+c]).filter(([r,c]) => r >= 9 && r <= 12 && c >= 0 && c <= 10));
  assert.equal(flashes[0][0].some(([r,c]) => r === 12 && c === 10), false, 'calcification is the 25-cell diamond, not the 29-cell ecology disc');
  const before = rings.length;
  fx.simFx('rhineEcology', 6, 10, { source: 1, stage: 2, radius: 3, continuous: true });
  assert.equal(rings.length, before, 'ecology range no longer emits a circular boundary');
  const tiles = flashes[1][0];
  assert.ok(tiles.every(([r,c]) => r >= 9 && r <= 12 && c >= 0 && c <= 10));
  assert.ok(tiles.some(([r,c]) => r === 10 && c === 9));
  assert.equal(tiles.some(([r,c]) => r === 12 && c === 9), false);
});

test('continuous ecology stays visible through its refresh interval and only bind events animate its activation', async () => {
  const fills = [], fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx: { cam: () => cam, heightAt: () => 0 }, tileFlashes: [], _p: {},
    tileGfx: { clear() {}, lineStyle() {}, beginFill(c, a) { fills.push(a); }, drawPolygon() {}, endFill() {} } });
  const field = { steady: true, key: 'rhineEcology:1' };
  fx.tileFlash([[10,6]], 0x73dfd5, RHINE_BALANCE.ecologyInterval, false, field);
  for (let i = 0; i < 20; i++) fx.tileFlash([[10,7]], 0xffffff, .3);
  assert.equal(fx.tileFlashes.filter(f => f.steady).length, 1, 'ordinary hit flashes cannot evict the continuous field');
  assert.equal(fx.tileFlashes.filter(f => !f.steady).length, 12);
  fx._updateTileFlashes(RHINE_BALANCE.ecologyInterval - .01);
  assert.equal(fx.tileFlashes.length, 1);
  assert.ok(fills.at(-1) > .05, 'a continuous aura does not fade away during the last part of its cycle');
  fx.tileFlash([[10,6]], 0x73dfd5, RHINE_BALANCE.ecologyInterval, false, field);
  assert.equal(fx.tileFlashes.length, 1, 'refresh replaces the same field instead of stacking brightness');
  assert.equal(fx.tileFlashes[0].t, 0);
  fx._updateTileFlashes(RHINE_BALANCE.ecologyInterval);
  assert.equal(fx.tileFlashes.length, 0, 'an unrefreshed field expires instead of leaking into another battle');
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: { image: async () => ({ width: 100, height: 140 }) } });
  const v = new UnitView(ctx, { id: 230, kind: 'token', defId: 'token_rhine_medical', side: 'ally', x: 5, y: 12, maxHp: 1, researchStage: 1 });
  await tick(); await tick();
  v.onResearchFx('rhineEcology', { stage: 1, continuous: true });
  assert.equal(v.researchActor.pulse, 0, 'the opening slow aura does not imply a bind');
  v.onResearchFx('rhineEcology', { stage: 1, continuous: true, bind: true });
  assert.equal(v.researchActor.pulse, 1);
  v.destroy();
});

test('joining mid-battle restores ecology immediately from effective UnitInfo and cleans it up with the device', async () => {
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, fieldRect: () => ({ r0: 0, r1: 18, c0: 0, c1: 20 }),
    assets: { image: async () => ({ width: 100, height: 140 }) } });
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx, tileFlashes: [], _p: {}, tileGfx: new fake.P.Graphics() });
  ctx.fx = fx;
  const info = renderInfo({ id: 240, kind: 'token', defId: 'token_rhine_medical', side: 'ally', x: 5, y: 12, maxHp: 1, researchStage: 0 });
  const v = new UnitView(ctx, info);
  ctx.view = id => id === v.id ? v : null;
  await tick(); await tick();
  v.update(1 / 60, cam, 15); // no research event has been replayed
  assert.equal(fx.tileFlashes.length, 1);
  const field = fx.tileFlashes[0], tiles = field.tiles;
  assert.equal(tiles.length, 13);
  assert.equal(field.anchor, v);
  assert.equal(field.dur, Infinity, 'effective deployed ecology is continuous rather than a stale eight-second burst');
  for (let i = 0; i < 600; i++) { v.update(1 / 60, cam, 15 + i / 60); fx._updateTileFlashes(1 / 60); }
  assert.equal(fx.tileFlashes.length, 1);
  assert.equal(fx.tileFlashes[0], field);
  assert.equal(field.tiles, tiles, 'idle updates allocate neither a new effect nor a new range array');
  v.setResearchStage(2); v.update(1 / 60, cam, 26);
  assert.equal(fx.tileFlashes[0], field);
  assert.equal(field.tiles.length, 29, 'metadata refresh replaces the smaller field');
  fx.simFx('rhineEcology', 5, 12, { source: v.id, stage: 2, continuous: true, active: false });
  assert.equal(v.info.researchActive, false);
  assert.equal(fx.tileFlashes.length, 0, 'an alliance shutdown removes the field immediately');
  for (let i = 0; i < 10; i++) v.update(1 / 60, cam, 26 + i / 60);
  assert.equal(fx.tileFlashes.length, 0, 'stage metadata alone cannot resurrect an explicitly inactive field');
  fx.simFx('rhineEcology', 5, 12, { source: v.id, stage: 2, radius: 3, continuous: true, active: true });
  v.update(1 / 60, cam, 26.5);
  assert.equal(fx.tileFlashes.length, 1);
  assert.equal(fx.tileFlashes[0].tiles.length, 29);
  assert.equal(fx.tileFlashes[0].dur, Infinity);
  assert.equal(v.researchActor.pulse, 0, 'reactivation resumes slow without replaying a bind');
  v.destroy(); fx._updateTileFlashes(1 / 60);
  assert.equal(fx.tileFlashes.length, 0, 'removed units cannot leave a persistent field behind');
  const prep = new UnitView(ctx, info, { prep: true });
  prep.update(1 / 60, cam, 27);
  assert.equal(fx.tileFlashes.length, 0, 'preparation metadata never implies an active combat aura');
  prep.destroy();
  const inactive = new UnitView(ctx, { ...info, id: 241, researchStage: undefined });
  inactive.update(1 / 60, cam, 27);
  assert.equal(fx.tileFlashes.length, 0, 'an unselected device without effective stage metadata stays inert');
  inactive.destroy();
  const stopped = new UnitView(ctx, { ...info, id: 242, researchStage: 2, researchActive: false });
  stopped.update(1 / 60, cam, 28);
  assert.equal(fx.tileFlashes.length, 0, 'joining a stopped device does not restore its old effective range');
  stopped.destroy();
});

test('an activation expires offscreen and is not replayed when its device re-enters the viewport', async () => {
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: { image: async () => ({ width: 100, height: 140 }) } });
  const v = new UnitView(ctx, { id: 100, kind: 'token', defId: 'token_rhine_energy', side: 'ally', x: 5, y: 12, maxHp: 1 });
  await tick(); await tick(); v.update(1 / 60, cam, 0);
  const rig = v.researchActor;
  let draws = 0;
  const update = rig.update.bind(rig);
  rig.update = (...args) => { draws++; return update(...args); };
  ctx.viewport = () => ({ width: 1, height: 1 });
  v.onResearchFx('rhinePulse', { stage: 2 });
  assert.equal(rig.pulse, 1);
  for (let i = 0; i < 180; i++) v.update(1 / 60, cam, i / 60);
  assert.equal(v.culled, true); assert.equal(draws, 0, 'hidden rig does not perform rendering work');
  assert.equal(rig.pulse, 0, 'its activation clock still advances while hidden');
  ctx.viewport = () => ({ width: 1280, height: 720 });
  v.update(1 / 60, cam, 3);
  assert.equal(v.culled, false); assert.equal(draws, 1); assert.equal(rig.pulse, 0);
  const idle = researchPose('energy', 3 + v.bob, 2, 0);
  assert.equal(rig.core.alpha, idle.light, 'returning to view shows the current idle pose');
  v.destroy();
});

test('laser restores one continuous beam from UnitInfo, keeps its lock on pause, and clears dead or absent targets', async () => {
  const target = { id: 301, x: 9, y: 11, z: 0, alive: true };
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, settings: { quality: 'low' },
    view: id => id === target.id ? target : null, assets: { image: async () => ({ width: 128, height: 160 }) } });
  const info = renderInfo({ id: 300, kind: 'token', defId: 'token_rhine_laser', side: 'ally', x: 5, y: 12, maxHp: 1,
    researchStage: 2, researchActive: true, researchLaserTarget: target.id, researchLaserProgress: 10, researchLaserActive: true });
  const v = new UnitView(ctx, info);
  await tick(); await tick(); v.update(1 / 60, cam, 10);
  const rig = v.researchActor;
  assert.equal(rig.stage, 0); assert.equal(rig.lights.length, 1, 'the single-stage drill has no breakthrough lamps');
  assert.equal(rig.beamActive, true); assert.equal(rig.laserGfx.visible, true, 'low quality preserves output feedback immediately on reconnect');
  assert.equal(rig.laserGfx.parent, v.root);
  assert.equal(rig.core.tint, 0xe6a4ff);
  const before = { ...rig.beamPoint }, canvases = fake.canvases.length;
  target.x += 1; v.update(1 / 60, cam, 10.1);
  assert.notEqual(rig.beamPoint.x, before.x, 'the persistent beam follows the target between sim events');
  v.onResearchFx('rhineLaser', { target: target.id, progress: 20, active: true }); v.update(1 / 60, cam, 20);
  assert.equal(rig.core.tint, 0xff674f); assert.equal(laserFeedback(v.info).full, true);
  assert.equal(fake.canvases.length, canvases, 'laser rendering reuses its Graphics and allocates no frame textures');
  v.onResearchFx('rhineLaser', { target: target.id, progress: 20, active: false }); v.update(1 / 60, cam, 21);
  assert.equal(rig.beamActive, false); assert.equal(v.info.researchLaserTarget, target.id);
  assert.equal(laserFeedback(v.info).progress, 1, 'a temporary pause keeps the real accumulated output progress');
  v.onResearchFx('rhineLaser', { target: target.id, progress: 20, active: true }); target.alive = false; v.update(1 / 60, cam, 22);
  assert.equal(rig.beamActive, false); assert.equal(rig.laserGfx.visible, false, 'a dead target cannot leave a ghost beam');
  target.alive = true; v.onResearchFx('rhineLaser', { target: null, progress: 0, active: false }); v.update(1 / 60, cam, 23);
  assert.equal(rig.laserGfx.visible, false); assert.equal(laserFeedback(v.info).progress, 0);
  v.destroy();
  const prep = new UnitView(ctx, info, { prep: true }); prep.update(1 / 60, cam, 24);
  assert.equal(prep.researchActor.beamActive, false, 'preparation never replays a combat laser'); prep.destroy();
});

test('laser FX dispatch updates only its actor and snapshot metadata is sanitised', () => {
  const events = [], source = { id: 1, x: 4, y: 10, onResearchFx: (...args) => events.push(args) };
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx: { view: id => id === 1 ? source : null, heightAt: () => 0 },
    ring() { throw new Error('laser must not be rendered as an ecology area'); }, tileFlash() { throw new Error('laser must not flash a range'); } });
  fx.simFx('rhineLaser', 8, 10, { source: 1, target: 2, progress: 20, active: true });
  assert.equal(events.length, 1); assert.equal(events[0][0], 'rhineLaser');
  assert.doesNotThrow(() => fx.simFx('rhineLaser', 4, 10, { source: 999, target: null, active: false, progress: 0 }));
  assert.equal(renderInfo({ id: 1, researchLaserProgress: 99 }).researchLaserProgress, 20);
  assert.equal(renderInfo({ id: 1, researchLaserProgress: '20' }).researchLaserProgress, undefined);
  assert.equal(renderInfo({ id: 1, researchLaserActive: 'false' }).researchLaserActive, undefined);
});

test('first real laser FX starts the beam after an initially inactive spawn, and a stop event retracts it', async () => {
  const target = { id: 321, x: 9, y: 11, z: 0, alive: true };
  const ctx = fakeViewCtx(fake.P, { cam: () => cam, settings: { quality: 'low' },
    assets: { image: async () => ({ width: 128, height: 160 }) } });
  const info = renderInfo({ id: 320, kind: 'token', defId: 'token_rhine_laser', side: 'ally', x: 5, y: 12, maxHp: 1,
    researchStage: 0, researchActive: false, researchLaserTarget: null, researchLaserProgress: 0, researchLaserActive: false });
  const v = new UnitView(ctx, info);
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx: { ...ctx, view: id => id === v.id ? v : id === target.id ? target : null } });
  ctx.fx = fx;
  await tick(); await tick(); v.update(1 / 60, cam, 0);
  assert.equal(v.researchActor.beamActive, false);
  fx.simFx('rhineLaser', target.x, target.y, { source: v.id, target: target.id, active: true, progress: .25 });
  v.update(1 / 60, cam, .25);
  assert.equal(v.info.researchActive, false, 'the initial generic spawn field has not been replaced');
  assert.equal(v.info.researchLaserActive, true);
  assert.equal(v.researchActor.beamActive, true, 'the first authoritative output event starts the beam without waiting for reconnect metadata');
  fx.simFx('rhineLaser', target.x, target.y, { source: v.id, target: target.id, active: false, progress: .25 });
  v.update(1 / 60, cam, .5);
  assert.equal(v.researchActor.beamActive, false, 'the specific stop event still controls output');
  assert.equal(v.info.researchLaserProgress, .25); v.destroy();
});
