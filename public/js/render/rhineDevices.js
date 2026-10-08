// Small, persistent rigs for the three research devices. All parts belong to UnitView's body:
// culling, row depth, dragging, fading and destruction therefore follow the normal summon lifecycle.
import { fxAtlas } from './textures.js';
import { RHINE_BALANCE, rhineDeviceStage } from '../../../shared/rhineResearch.js';

export const RHINE_LOOK = Object.freeze({
  medical: { width: 1.08, height: 0.74, head: 0.96, tint: 0x6fe8c1, core: [-0.055, 0.26] },
  energy: { width: 0.83, height: 1.16, head: 1.27, tint: 0xffbc70, core: [0.045, 0.57] },
  laser: { width: 0.98, height: 1.2, head: 1.28, tint: 0xe6a4ff, core: [0.35, 0.58] },
});

/** Pure pose in tile units. Only the drone floats; the tower and cultivation tank stay on their feet. */
export function researchPose(key, time, stage = 0, pulse = 0) {
  const k = rhineDeviceStage(key, stage), p = Math.max(0, Math.min(1, pulse));
  return {
    y: key === 'medical' ? -0.14 + Math.sin(time * 2.2) * 0.025 - p * 0.035 : -0.006,
    rotation: key === 'medical' ? Math.sin(time * 1.25) * 0.012 : 0,
    scaleX: key === 'energy' ? 1 + p * 0.018 : 1,
    scaleY: key === 'energy' ? 1 - p * 0.014 : 1,
    light: 0.12 + k * 0.035 + (Math.sin(time * (key === 'energy' ? 2.5 : 1.8)) + 1) * 0.045 + p * 0.38,
  };
}

/** Snapshot-driven feedback. A laser has one level; its colour reflects output time rather than research. */
export function laserFeedback(info = {}) {
  const seconds = Math.max(0, Math.min(RHINE_BALANCE.laserRampSeconds, Number(info.researchLaserProgress) || 0));
  const progress = seconds / RHINE_BALANCE.laserRampSeconds;
  return { seconds, progress, full: progress >= 1, active: info.researchLaserActive === true,
    target: info.researchLaserTarget ?? null, color: progress >= 1 ? 0xff674f : 0xe6a4ff };
}

export class ResearchDeviceActor {
  constructor(view) {
    this.view = view;
    this.key = view.researchDevice.key;
    this.look = RHINE_LOOK[this.key];
    this.stage = rhineDeviceStage(this.key, view.info.researchStage ?? view.info.stage);
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
    this.lights = Array.from({ length: this.key === 'laser' ? 1 : 3 }, () => add(tex.dot));
    this.details = Array.from({ length: this.key === 'medical' ? 2 : 3 }, () => add(this.key === 'medical' ? tex.ring : tex.dot));
    if (this.key === 'laser') {
      // A root child shares the unit's removal lifecycle, while screen coordinates let the beam
      // follow the actual moving target independently of the drill's sprite pose.
      this.laserGfx = new P.Graphics();
      this.laserGfx.blendMode = P.BLEND_MODES.ADD;
      view.root.addChild(this.laserGfx);
      this.beamClock = 0; this.beamPoint = {}; this.beamActive = false;
    }
  }

  setStage(stage) { this.stage = rhineDeviceStage(this.key, stage); }

  trigger(kind, extra) {
    if (this.key === 'laser' && kind === 'rhineLaser') {
      if (extra && 'target' in extra) this.view.info.researchLaserTarget = extra.target;
      if (Number.isFinite(extra?.progress)) this.view.info.researchLaserProgress = Math.max(0, Math.min(RHINE_BALANCE.laserRampSeconds, extra.progress));
      if (typeof extra?.active === 'boolean') this.view.info.researchLaserActive = extra.active;
      this.pulse = extra?.active ? .35 : 0;
      this.advance(0);
      return;
    }
    if (kind !== { medical: 'rhineHeal', energy: 'rhinePulse' }[this.key] && !(this.key === 'medical' && kind === 'rhineEcology')) return;
    if (extra?.stage != null) this.setStage(extra.stage);
    if (kind === 'rhineEcology' && extra?.active === false) { this.pulse = 0; return; }
    if (kind === 'rhineEcology' && extra?.continuous && !extra.bind) return;
    this.pulse = 1;
  }

  // Kept separate from drawing so an offscreen device never replays an expired activation on re-entry.
  advance(dt) {
    this.pulse = Math.max(0, this.pulse - Math.max(0, dt) * 2.2);
    if (this.key === 'medical') this.field = this.view.ctx.fx?.researchArea?.(this.view, this.field);
    if (this.key === 'laser') this.drawLaser(dt);
  }

  drawLaser(dt) {
    const v = this.view, g = this.laserGfx, state = laserFeedback(v.info);
    this.beamClock += Math.max(0, dt); g.clear(); this.beamActive = false;
    const target = v.ctx.fx?._viewOf?.(state.target) || v.ctx.view?.(state.target);
    const valid = !v.prep && v.alive && !v.remove && !v.destroyed && target && target.alive !== false && !target.remove && !target.destroyed;
    g.visible = !!valid;
    if (!valid) return;
    const cam = v.ctx.cam(), s = v.screen.s;
    // The output meter stays on the locked target's current progress when firing pauses.
    const width = s * .7, y = s * .08;
    g.lineStyle(Math.max(2, s * .04), 0x293541, .85).moveTo(-width / 2, y).lineTo(width / 2, y);
    g.lineStyle(Math.max(2, s * .04), state.color, .9).moveTo(-width / 2, y).lineTo(-width / 2 + width * state.progress, y);
    // The initial spawn precedes the first active laser event. Its generic researchActive
    // may still be false until a new UnitInfo arrives; laserActive is the output authority.
    if (!state.active) return;
    this.beamActive = true;
    const sp = v.fallback, l = this.look, scale = Math.min(l.width / sp.texture.width, l.height / sp.texture.height) * s;
    const ax = l.core[0] * sp.texture.width * scale, ay = -l.core[1] * sp.texture.height * scale;
    const p = v.ctx.fx?._bodyPt ? v.ctx.fx._bodyPt(target, .5, this.beamPoint)
      : cam.project(target.x, target.y, (target.z || 0) + .6, this.beamPoint);
    const bx = p.x - v.root.x, by = p.y - v.root.y;
    const low = v.ctx.settings?.quality === 'low' || (v.ctx.loadLevel?.() || 0) >= 2;
    const strength = 1 + state.progress * .55, flick = .9 + Math.sin(this.beamClock * 18) * .06;
    if (!low) g.lineStyle(Math.max(3, s * .14 * strength), state.color, .18 * flick).moveTo(ax, ay).lineTo(bx, by);
    g.lineStyle(Math.max(2, s * .055 * strength), state.color, .8 * flick).moveTo(ax, ay).lineTo(bx, by);
    g.lineStyle(Math.max(1, s * .018 * strength), state.full ? 0xfff3d4 : 0xffffff, .95).moveTo(ax, ay).lineTo(bx, by);
    g.lineStyle(Math.max(1, s * .025), state.color, .85).drawCircle(ax, ay, s * .105);
    g.lineStyle(0).beginFill(state.full ? 0xfff3d4 : state.color, .9).drawCircle(ax, ay, s * (state.full ? .065 : .04)).endFill();
    // Both emitter and impact cores remain at low quality, including the full-output colour transition.
    g.lineStyle(Math.max(1, s * .025), state.color, .7).drawCircle(bx, by, s * .15);
    g.lineStyle(0).beginFill(state.full ? 0xfff3d4 : state.color, .7).drawCircle(bx, by, s * (state.full ? .06 : .035)).endFill();
  }

  update(time, tileSize) {
    const v = this.view, sp = v.fallback, l = this.look;
    this.root.visible = v.alive && v._pic?.state === 'img';
    const pose = researchPose(this.key, time + v.bob, this.stage, this.pulse);
    // A charged tower can wait indefinitely for a target. Keep that state distinct from the
    // short firing pulse; snapshots (including reconnects) are the sole source of charge.
    const charge = this.key === 'energy' && !v.prep && v.spMax > 0 ? Math.max(0, Math.min(1, v.sp / v.spMax)) : 0;
    const laser = this.key === 'laser' ? laserFeedback(v.info) : null;
    const ready = charge >= 1;
    const scale = Math.min(l.width / sp.texture.width, l.height / sp.texture.height) * tileSize;
    sp.scale.set(scale * pose.scaleX, scale * pose.scaleY);
    sp.position.set(0, tileSize * pose.y); sp.rotation = pose.rotation;
    const w = sp.texture.width * scale, h = sp.texture.height * scale;
    this.root.position.set(sp.position.x, sp.position.y);
    this.root.rotation = sp.rotation;
    this.core.position.set(l.core[0] * w, -l.core[1] * h);
    this.core.scale.set(tileSize * (this.key === 'energy' ? 0.29 : 0.33) / 128, tileSize * (this.key === 'energy' ? 0.5 : 0.29) / 128);
    this.core.alpha = pose.light + charge * .09 + (ready ? .12 : 0) + (laser?.active && this.beamActive ? .15 + laser.progress * .22 : 0);
    this.core.tint = laser ? laser.color : ready ? 0xffe8c4 : l.tint;
    // One/two/three small lamps indicate prototype / breakthrough I / II without making the body larger.
    this.lights.forEach((light, i) => {
      light.visible = i <= this.stage;
      light.position.set((i - this.stage / 2) * tileSize * 0.058, -h * 0.13);
      light.scale.set(tileSize * 0.038 / 32); light.alpha = 0.55 + this.pulse * 0.35;
      if (laser) { light.tint = laser.color; light.alpha = this.beamActive ? .9 : .35; }
    });
    const sparse = v.ctx.settings?.quality === 'low' || (v.ctx.loadLevel?.() || 0) >= 2;
    this.details.forEach((detail, i) => {
      detail.visible = !sparse || i === 0;
      if (this.key === 'medical') {
        detail.position.set((i ? 0.35 : -0.34) * w, (i ? -0.52 : -0.86) * h);
        detail.scale.set(w * 0.23 / 128, h * 0.12 / 128);
        detail.alpha = 0.16 + Math.sin(time * 17 + i) * 0.04 + this.pulse * 0.18;
      } else {
        detail.position.set(w * 0.045, -h * (0.39 + i * 0.11));
        detail.scale.set(tileSize * 0.032 / 32);
        detail.alpha = 0.15 + (Math.sin(time * 3.2 - i * 1.1) + 1) * 0.18 + this.pulse * 0.35 + charge * .12;
        if (laser) { detail.tint = laser.color; detail.alpha *= this.beamActive ? 1 + laser.progress : .5; }
      }
    });
  }
}
