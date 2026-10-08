// Kazdel feedback: persistent, snapshot-driven square telegraphs and short soul/impact cues.
import { cannonStates } from '../../kazdelState.js';
import { KAZDEL_CANNON } from '../../../../shared/kazdel.js';

/** The cannon always affects the complete 3×3 cells, clipped to the current battle field. */
export function cannonTiles(x, y, bounds) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  const row = Math.round(y), col = Math.round(x), out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = row + dr, c = col + dc;
    if (!bounds || (r >= bounds.r0 && r <= bounds.r1 && c >= bounds.c0 && c <= bounds.c1)) out.push([r, c]);
  }
  return out;
}

export class FxKazdel {
  /** Called with the snapshot at the render clock: reconnects restore warnings, paused clocks hold them. */
  syncKazdel(states, gameTime) {
    this.kazdelGameTime = Number.isFinite(gameTime) ? gameTime : 0;
    this.kazdelWarnings = cannonStates(states).filter(s => s.warning && s.warning.until > this.kazdelGameTime);
  }

  _updateKazdel() {
    const g = this.kazdelGfx;
    g.clear();
    const cam = this.ctx.cam(), bounds = this.ctx.fieldRect?.();
    for (const s of this.kazdelWarnings) {
      const remaining = s.warning.until - this.kazdelGameTime;
      const progress = Math.max(0, Math.min(1, 1 - remaining / KAZDEL_CANNON.warningDuration));
      const pulse = .55 + .35 * Math.sin(this.kazdelGameTime * 13);
      for (const [r, c] of cannonTiles(s.warning.x, s.warning.y, bounds)) {
        const z = this._groundZ(c, r) + .015;
        const poly = [[-.46,-.46],[.46,-.46],[.46,.46],[-.46,.46]].flatMap(([dx,dy]) => {
          const p = cam.project(c + dx, r + dy, z); return [p.x, p.y];
        });
        g.lineStyle(1.5 + progress, 0xff6e62, pulse).beginFill(0xc0374b, .12 + progress * .18).drawPolygon(poly).endFill();
        // Cross-hatch every cell so the danger area remains unambiguous without relying on colour.
        const a = cam.project(c-.36,r-.36,z), b = cam.project(c+.36,r+.36,z);
        g.lineStyle(1, 0xffab86, pulse * .75).moveTo(a.x,a.y).lineTo(b.x,b.y);
        const d = cam.project(c-.36,r+.36,z), e = cam.project(c+.36,r-.36,z);
        g.moveTo(d.x,d.y).lineTo(e.x,e.y);
      }
    }
  }

  kazdelFx(kind, at, ex, dur) {
    if (kind === 'kazdelCannonWarning') {
      // The durable warning is drawn from snapshots; an event alone still gives immediate feedback.
      this.tileFlash(cannonTiles(at.x, at.y, this.ctx.fieldRect?.()), 0xff6e62, Math.max(.15, dur), true, { key: `kazdel-warning:${ex.ownerId}` });
      return;
    }
    if (kind === 'kazdelCannonImpact') {
      this.tileFlashes = this.tileFlashes.filter(f => f.key !== `kazdel-warning:${ex.ownerId}`);
      this.tileFlash(cannonTiles(at.x, at.y, this.ctx.fieldRect?.()), 0xffc69d, .48, false);
      const p = this.ctx.cam().project(at.x, at.y, at.z);
      // A vertical red-white strike and dark debris; the footprint itself is square, never a circle.
      this.particle('pillar', p.x, p.y, { tint: 0xffc7af, life: .35, s0: p.s / 55, s1: p.s / 80, a0: 1, a1: 0, ay: 1 });
      this.burst(p.x, p.y - p.s * .2, p.s, this.rich ? 12 : 5, 0xdf625c, { speed: 2, life: .5 });
      this.smoke(p.x, p.y, p.s * 1.2, 0x25151c, .7);
      return;
    }
    const p = this.ctx.cam().project(at.x, at.y, at.z + .3);
    if (kind === 'kazdelSoulHeal') {
      const source = this._viewOf(ex.source), target = this._viewOf(ex.target);
      if (source && target && source !== target) this._beam(source, target, 0xa1e6b6, .28, .08);
      this.particle('glow', p.x, p.y, { tint: 0xa1e6b6, life: .4, s0: p.s / 170, s1: p.s / 110, a0: .8, a1: 0 });
      return;
    }
    this.smoke(p.x, p.y, p.s * .7, 0x27131d, .65);
    this.burst(p.x, p.y, p.s, this.rich ? 7 : 3, 0xdd546b, { speed: .8, life: .55 });
    if (kind === 'kazdelSoulEnd' && ex.reason === 'kazdelReturn') {
      const soul = this._viewOf(ex.id), body = this._viewOf(ex.soulOf);
      if (soul && body) this._beam(soul, body, 0xc55268, .35, .08);
    }
  }
}
