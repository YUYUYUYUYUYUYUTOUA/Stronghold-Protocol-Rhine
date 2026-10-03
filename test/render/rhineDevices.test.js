import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { researchPose, RHINE_LOOK } from '../../public/js/render/rhineDevices.js';
import { FxSystem } from '../../public/js/render/fx.js';
import { RHINE_DEVICES } from '../../shared/rhineResearch.js';
import { createAssets } from '../../public/js/assets.js';

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

test('a late battle view preserves breakthrough lamps before any research effect is replayed', async () => {
  const info = renderInfo({ id: 200, kind: 'token', defId: 'token_rhine_ecology', side: 'ally', x: 5, y: 12, researchStage: 2 });
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
  for (const key of ['energy', 'ecology']) {
    assert.equal(researchPose(key, 0).y, researchPose(key, 3).y);
    assert.equal(researchPose(key, 1, 2, 1).rotation, 0);
    assert.ok(researchPose(key, 1, 2, 1).light > researchPose(key, 1, 0, 0).light);
  }
});

test('research rigs are bounded, show breakthrough lamps, react only to their own events and survive low quality', async () => {
  const kinds = { medical: 'rhineHeal', energy: 'rhinePulse', ecology: 'rhineEcology' };
  for (const d of RHINE_DEVICES) {
    const ctx = fakeViewCtx(fake.P, { cam: () => cam, assets: { image: async () => ({ width: 100, height: 140 }) } });
    const v = new UnitView(ctx, { id: d.key, kind: 'token', defId: d.tokenId, side: 'ally', x: 5, y: 12, dir: 'RIGHT', maxHp: 1, researchStage: 1 });
    await tick(); await tick(); v.update(1 / 60, cam, 0);
    const rig = v.researchActor;
    assert.equal(rig.lights.filter(x => x.visible).length, 2);
    assert.equal(v.facingArrow, null, 'radial research equipment has no directional wedge');
    assert.ok(v.fallback.width <= v.screen.s * RHINE_LOOK[d.key].width * 1.02);
    assert.ok(v.fallback.height <= v.screen.s * RHINE_LOOK[d.key].height * 1.02);
    assert.equal(rig.root.parent, v.body, 'same depth, culling and teardown as the summon');
    v.onResearchFx('anUnrelatedEffect', { stage: 2 });
    assert.equal(rig.pulse, 0); assert.equal(rig.stage, 1);
    v.onResearchFx(kinds[d.key], { stage: 2 });
    v.update(1 / 60, cam, 1);
    assert.ok(rig.pulse > 0); assert.equal(rig.lights.filter(x => x.visible).length, 3);
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
  const activations = [], rings = [], beams = [], zones = [];
  const source = { id: 20, x: 1, y: 2, z: 0.16, onResearchFx: (...args) => activations.push(args) };
  const target = { id: 30, x: 3, y: 4, z: 0 };
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, { ctx: { cam: () => cam, heightAt: () => 0, view: id => ({ 20: source, 30: target })[id], timeScale: () => 2 },
    ring: (...args) => rings.push(args), zone: (...args) => zones.push(args), _beam: (...args) => beams.push(args) });
  fx.simFx('rhineHeal', 3, 4, { source: 20, target: 30, stage: 1 });
  assert.deepEqual(activations[0], ['rhineHeal', { source: 20, target: 30, stage: 1 }]);
  assert.deepEqual(beams[0].slice(0, 2), [source, target]);
  assert.deepEqual(rings[0].slice(0, 2), [3, 4]);
  rings.length = 0;
  fx.simFx('rhinePulse', 3, 4, { source: 20, stage: 0 });
  assert.deepEqual(rings.map(r => r.slice(0, 2)), [[1, 2], [3, 4]]);
  assert.equal(rings[1][4], 0.38, 'prototype impact does not imply an area attack');
  rings.length = 0;
  fx.simFx('rhinePulse', 3, 4, { source: 20, stage: 2 });
  assert.equal(rings.length, 3); assert.equal(rings[1][4], 1);
  fx.simFx('rhineEcology', 1, 2, { source: 20, stage: 2, radius: 3 });
  assert.deepEqual(zones[0].slice(0, 4), [1, 2, 0, 3]);
  assert.equal(zones[0][5], 2, 'four game seconds at 2x battle speed');
  assert.equal(zones[0][6], 'ring', 'an outline leaves units and terrain readable');
  assert.doesNotThrow(() => fx.simFx('rhineHeal', 3, 4, { source: 999, target: 999 }), 'missing/removed source leaves a safe point effect');
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
