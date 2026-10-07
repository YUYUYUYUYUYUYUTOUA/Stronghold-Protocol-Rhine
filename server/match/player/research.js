// Player-owned Rhine research reserve, deployment capacity and once-per-battle breakthroughs.
// Installed on PlayerState.prototype alongside the upstream method containers.

import { RHINE_BOND, RHINE_BALANCE, RHINE_DEVICES, rhineCapacity, rhineDevice, rhineStage, advanceRhineResearch } from '../../../shared/rhineResearch.js';

export class PlayerResearch {
  /** The reserve slot is fixed by device kind; points belong to the player, never to a transient token uid. */
  _returnResearch(piece) {
    const idx = RHINE_DEVICES.findIndex((d) => d.tokenId === piece?.id);
    if (idx < 0 || !piece.research) return false;
    const old = this.research.hand[idx];
    if (old && old.uid !== piece.uid) return false;
    this.research.hand[idx] = piece;
    return true;
  }

  _syncResearch() {
    const cap = this.alive ? rhineCapacity(this.bonds[RHINE_BOND]) : 0;
    if (cap && !this.research.unlocked) {
      this.research.unlocked = true;
      for (const [idx, d] of RHINE_DEVICES.entries()) {
        this.research.points[d.key] = 0;
        this.research.stages[d.key] = 0;
        this.research.hand[idx] = this.newPiece('token', d.tokenId, { research: true, researchKey: d.key, ownerUid: null });
      }
    }
    let kept = 0;
    for (const [key, p] of this.board) {
      if (!p.research) continue;
      if (kept++ < cap) continue;
      this.board.delete(key);
      this._returnResearch(p);
    }
  }

  researchView() {
    const capacity = this.alive ? rhineCapacity(this.bonds[RHINE_BOND]) : 0;
    const all = [...this.board.values(), ...this.research.hand.filter(Boolean)];
    const deployed = new Set([...this.board.values()].filter((p) => p.research).map((p) => p.uid));
    return {
      unlocked: this.research.unlocked, active: capacity > 0, capacity,
      layers: this.layers[RHINE_BOND] || 0,
      hand: this.research.hand.map((p) => p ? this.pieceView(p) : null),
      devices: RHINE_DEVICES.map((d) => {
        const p = all.find((x) => x.research && x.id === d.tokenId);
        const points = this.research.points[d.key] || 0;
        return { key: d.key, tokenId: d.tokenId, uid: p?.uid ?? null, points, stage: rhineStage(this.research.stages[d.key]), onBoard: !!p && deployed.has(p.uid) };
      }),
    };
  }

  /** Called only by real main-battle construction, never by previews, helper battles or reconnects. */
  freezeResearch(input, kind = 'normal') {
    if (!['normal', 'boss', 'hidden'].includes(kind) || this.research.battleRound === this.m.round) return;
    this.research.battleRound = this.m.round;
    const uids = new Set((input?.units || []).filter((u) => u.research).map((u) => u.uid));
    this.research.participants = input?.research?.active
      ? input.research.devices.filter((d) => d.onBoard && uids.has(d.uid) && rhineDevice(d.key)).map((d) => d.key)
      : [];
  }

  settleResearch(success) {
    const round = this.m.round;
    if (this.research.battleRound !== round || this.research.settled.has(round)) return false;
    this.research.settled.add(round);
    const gain = success ? RHINE_BALANCE.successPoints : RHINE_BALANCE.failurePoints;
    for (const key of new Set(this.research.participants)) {
      const next = advanceRhineResearch({ stage: this.research.stages[key], points: this.research.points[key] }, gain);
      this.research.stages[key] = next.stage;
      this.research.points[key] = next.points;
    }
    this.dirty();
    return true;
  }

}
