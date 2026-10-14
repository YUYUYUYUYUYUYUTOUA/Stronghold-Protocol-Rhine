// Preparation-side Rhine Lab research. Battle device effects live in rhine.js.
import { RHINE_BOND } from '../../../shared/rhineResearch.js';

export function registerMeta(registry) {
  registry.garrison('RHINE_RESEARCH_BY_MEMBER', {
    run(ctx) {
      if (!ctx.bondActive(RHINE_BOND)) return;
      const tiers = new Set();
      for (const piece of ctx.board()) {
        if (piece.kind !== 'chess' || !ctx.pieceBonds(piece.uid).includes(RHINE_BOND)) continue;
        // Each represented tier counts once; copies, names and quality do not add tiers.
        const tier = ctx.chessRecord(piece.id)?.tier;
        if (Number.isInteger(tier) && tier >= 1 && tier <= 6) tiers.add(tier);
      }
      const layer = Number(ctx.source.bb?.layer) || 0;
      if (layer > 0) ctx.addLayers(RHINE_BOND, tiers.size * layer, { requireActive: true, reason: 'garrison:rhine-research-by-member' });
    },
  });
}
