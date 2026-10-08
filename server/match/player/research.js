// Player-owned Rhine research reserve, deployment capacity and once-per-battle breakthroughs.
// Installed on PlayerState.prototype alongside the upstream method containers.

import { RHINE_BOND, RHINE_BALANCE, RHINE_DEVICES, rhineCapacity, rhineDevice, rhineDeviceUnlocked, rhineDeviceStage, advanceRhineResearch } from '../../../shared/rhineResearch.js';

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
    const bond = this.bonds[RHINE_BOND];
    const cap = this.alive ? rhineCapacity(bond) : 0;
    if (cap) this.research.unlocked = true;
    // Rebuild fixed slots by identity, not their saved array index. Older states can still contain the retired
    // ecology card; it cannot become a laser or cause a second medical/energy card to be generated.
    const reserve = this.research.hand.filter(Boolean);
    this.research.hand = RHINE_DEVICES.map(() => null);
    const seen = new Set();
    for (const [key, p] of this.board) {
      const d = rhineDevice(p.id);
      if (!p.research) {
        if (p.kind === 'token' && d) this.board.delete(key);
        continue;
      }
      if (!d || seen.has(d.key)) { this.board.delete(key); continue; }
      p.researchKey = d.key;
      seen.add(d.key);
    }
    for (const p of reserve) {
      const d = rhineDevice(p.id);
      if (!p.research || !d || seen.has(d.key)) continue;
      p.researchKey = d.key;
      seen.add(d.key);
      this._returnResearch(p);
    }
    delete this.research.points.ecology;
    delete this.research.stages.ecology;
    // A locked laser returns before capacity is counted, even when it precedes legal devices in board order.
    for (const [key, p] of this.board) {
      if (!p.research || (this.alive && rhineDeviceUnlocked(p.id, bond))) continue;
      this.board.delete(key);
      this._returnResearch(p);
    }
    let kept = 0;
    for (const [key, p] of this.board) {
      if (!p.research) continue;
      if (kept++ < cap) continue;
      this.board.delete(key);
      this._returnResearch(p);
    }
    for (const [idx, d] of RHINE_DEVICES.entries()) {
      if (d.maxStage === 0) {
        this.research.points[d.key] = 0;
        this.research.stages[d.key] = 0;
      }
      if (!this.alive || !rhineDeviceUnlocked(d, bond) || seen.has(d.key)) continue;
      this.research.points[d.key] ??= 0;
      this.research.stages[d.key] ??= 0;
      this.research.hand[idx] = this.newPiece('token', d.tokenId, { research: true, researchKey: d.key, ownerUid: null });
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
        const locked = !this.alive || !rhineDeviceUnlocked(d, this.bonds[RHINE_BOND]);
        const points = d.maxStage === 0 ? 0 : this.research.points[d.key] || 0;
        return { key: d.key, tokenId: d.tokenId, uid: p?.uid ?? null, points, stage: rhineDeviceStage(d, this.research.stages[d.key]),
          onBoard: !locked && !!p && deployed.has(p.uid), locked, minCount: d.minCount, maxStage: d.maxStage };
      }),
    };
  }

  /** Called only by real main-battle construction, never by previews, helper battles or reconnects. */
  freezeResearch(input, kind = 'normal') {
    if (!['normal', 'boss', 'hidden'].includes(kind) || this.research.battleRound === this.m.round) return;
    this.research.battleRound = this.m.round;
    const uids = new Set((input?.units || []).filter((u) => u.research).map((u) => u.uid));
    this.research.participants = input?.research?.active
      ? input.research.devices.filter((d) => d.onBoard && uids.has(d.uid) && rhineDevice(d.key)?.maxStage > 0
        && this.alive && rhineDeviceUnlocked(d.key, this.bonds[RHINE_BOND])).map((d) => d.key)
      : [];
  }

  settleResearch(success) {
    const round = this.m.round;
    if (this.research.battleRound !== round || this.research.settled.has(round)) return false;
    this.research.settled.add(round);
    const gain = success ? RHINE_BALANCE.successPoints : RHINE_BALANCE.failurePoints;
    for (const key of new Set(this.research.participants)) {
      const d = rhineDevice(key);
      if (!d || d.maxStage === 0) continue;
      const next = advanceRhineResearch({ stage: this.research.stages[key], points: this.research.points[key] }, gain);
      this.research.stages[key] = next.stage;
      this.research.points[key] = next.points;
    }
    for (const d of RHINE_DEVICES) if (d.maxStage === 0) {
      this.research.stages[d.key] = 0;
      this.research.points[d.key] = 0;
    }
    this.dirty();
    return true;
  }

}
