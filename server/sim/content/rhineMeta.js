// Preparation-side Rhine Lab research. Battle device effects live in rhine.js.
import { RHINE_BOND } from '../../../shared/rhineResearch.js';

export function registerMeta(registry) {
  registry.garrison('RHINE_RESEARCH_BY_MEMBER', {
    run(ctx) {
      if (!ctx.bondActive(RHINE_BOND)) return;
      let members = 0;
      for (const piece of ctx.board()) {
        if (piece.kind !== 'chess' || !ctx.pieceBonds(piece.uid).includes(RHINE_BOND)) continue;
        // Count actual deployed pieces, including same-name normal/elite copies. Harmony's
        // virtual bond count and reserve/token pieces never enter this roster.
        members++;
      }
      const layer = Number(ctx.source.bb?.layer) || 0;
      if (layer > 0) ctx.addLayers(RHINE_BOND, members * layer, { requireActive: true, reason: 'garrison:rhine-research-by-member' });
    },
  });
}
