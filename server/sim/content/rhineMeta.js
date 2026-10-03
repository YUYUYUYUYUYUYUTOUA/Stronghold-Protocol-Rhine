// Preparation-side Rhine Lab research. Battle device effects live in rhine.js.
import { RHINE_BOND } from '../../../shared/rhineResearch.js';

export function registerMeta(registry) {
  registry.garrison('RHINE_RESEARCH_BY_TIER', {
    run(ctx) {
      if (!ctx.bondActive(RHINE_BOND)) return;
      const tiers = new Set();
      for (const piece of ctx.board()) {
        if (piece.kind !== 'chess' || !ctx.pieceBonds(piece.uid).includes(RHINE_BOND)) continue;
        const tier = ctx.chessRecord(piece.id)?.tier;
        if (Number.isInteger(tier)) tiers.add(tier);
      }
      const layer = Number(ctx.source.bb?.layer) || 0;
      if (layer > 0) ctx.addLayers(RHINE_BOND, tiers.size * layer, { requireActive: true, reason: 'garrison:rhine-research-by-tier' });
    },
  });
}
