// Small, persistent rigs for the three research devices. All parts belong to UnitView's body:
// culling, row depth, dragging, fading and destruction therefore follow the normal summon lifecycle.
import { fxAtlas } from './textures.js';
import { rhineStage } from '../../../shared/rhineResearch.js';

export const RHINE_LOOK = Object.freeze({
  medical: { width: 1.08, height: 0.74, head: 0.96, tint: 0x6fe8c1, core: [-0.055, 0.26] },
  energy: { width: 0.83, height: 1.16, head: 1.27, tint: 0xffbc70, core: [0.045, 0.57] },
  ecology: { width: 0.93, height: 0.96, head: 1.09, tint: 0x73dfd5, core: [-0.02, 0.52] },
});

/** Pure pose in tile units. Only the drone floats; the tower and cultivation tank stay on their feet. */
export function researchPose(key, time, stage = 0, pulse = 0) {
  const k = rhineStage(stage), p = Math.max(0, Math.min(1, pulse));
  return {
    y: key === 'medical' ? -0.14 + Math.sin(time * 2.2) * 0.025 - p * 0.035 : -0.006,
    rotation: key === 'medical' ? Math.sin(time * 1.25) * 0.012 : 0,
    scaleX: key === 'energy' ? 1 + p * 0.018 : 1,
    scaleY: key === 'energy' ? 1 - p * 0.014 : 1,
    light: 0.12 + k * 0.035 + (Math.sin(time * (key === 'energy' ? 2.5 : 1.8)) + 1) * 0.045 + p * 0.38,
  };
}

export class ResearchDeviceActor {
  constructor(view) {
    this.view = view;
    this.key = view.researchDevice.key;
    this.look = RHINE_LOOK[this.key];
    this.stage = rhineStage(view.info.researchStage ?? view.info.stage);
    this.pulse = 0;
    const { P } = view, tex = fxAtlas().tex;
    this.root = new P.Container();
    view.body.addChild(this.root);
    const add = (texture) => {
      const sp = new P.Sprite(texture);
      sp.anchor.set(0.5); sp.tint = this.look.tint; sp.blendMode = P.BLEND_MODES.ADD;
      this.root.addChild(sp); return sp;
    };
    this.core = add(tex.glow);
    this.lights = Array.from({ length: 3 }, () => add(tex.dot));
    this.details = Array.from({ length: this.key === 'medical' ? 2 : 3 }, () => add(this.key === 'medical' ? tex.ring : tex.dot));
  }

  setStage(stage) { this.stage = rhineStage(stage); }

  trigger(kind, extra) {
    if (kind !== { medical: 'rhineHeal', energy: 'rhinePulse', ecology: 'rhineEcology' }[this.key]) return;
    if (extra?.stage != null) this.setStage(extra.stage);
    this.pulse = 1;
  }

  // Kept separate from drawing so an offscreen device never replays an expired activation on re-entry.
  advance(dt) { this.pulse = Math.max(0, this.pulse - Math.max(0, dt) * 2.2); }

  update(time, tileSize) {
    const v = this.view, sp = v.fallback, l = this.look;
    this.root.visible = v.alive && v._pic?.state === 'img';
    const pose = researchPose(this.key, time + v.bob, this.stage, this.pulse);
    const scale = Math.min(l.width / sp.texture.width, l.height / sp.texture.height) * tileSize;
    sp.scale.set(scale * pose.scaleX, scale * pose.scaleY);
    sp.position.set(0, tileSize * pose.y); sp.rotation = pose.rotation;
    const w = sp.texture.width * scale, h = sp.texture.height * scale;
    this.root.position.set(sp.position.x, sp.position.y);
    this.root.rotation = sp.rotation;
    this.core.position.set(l.core[0] * w, -l.core[1] * h);
    this.core.scale.set(tileSize * (this.key === 'energy' ? 0.29 : 0.33) / 128, tileSize * (this.key === 'energy' ? 0.5 : 0.29) / 128);
    this.core.alpha = pose.light;
    // One/two/three small lamps indicate prototype / breakthrough I / II without making the body larger.
    this.lights.forEach((light, i) => {
      light.visible = i <= this.stage;
      light.position.set((i - this.stage / 2) * tileSize * 0.058, -h * 0.13);
      light.scale.set(tileSize * 0.038 / 32); light.alpha = 0.55 + this.pulse * 0.35;
    });
    const sparse = v.ctx.settings?.quality === 'low' || (v.ctx.loadLevel?.() || 0) >= 2;
    this.details.forEach((detail, i) => {
      detail.visible = !sparse || i === 0;
      if (this.key === 'medical') {
        detail.position.set((i ? 0.35 : -0.34) * w, (i ? -0.52 : -0.86) * h);
        detail.scale.set(w * 0.23 / 128, h * 0.12 / 128);
        detail.alpha = 0.16 + Math.sin(time * 17 + i) * 0.04 + this.pulse * 0.18;
      } else if (this.key === 'ecology') {
        const f = ((time * 0.24 + i / 3) % 1 + 1) % 1;
        detail.position.set((Math.sin(time * 1.3 + i * 2.1) * 0.13 - 0.015) * w, -h * (0.44 + f * 0.32));
        detail.scale.set(tileSize * (0.025 + this.stage * 0.004) / 32);
        detail.alpha = Math.sin(f * Math.PI) * (0.4 + this.pulse * 0.35);
      } else {
        detail.position.set(w * 0.045, -h * (0.39 + i * 0.11));
        detail.scale.set(tileSize * 0.032 / 32);
        detail.alpha = 0.15 + (Math.sin(time * 3.2 - i * 1.1) + 1) * 0.18 + this.pulse * 0.35;
      }
    });
  }
}
