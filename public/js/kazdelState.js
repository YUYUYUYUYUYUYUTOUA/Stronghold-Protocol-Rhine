// Shared browser-side validation for authoritative cannon state; no UI or renderer dependencies.
import { KAZDEL_CANNON } from '../../shared/kazdel.js';

/** Keep each owner's cannon separate, drop malformed state and clamp the displayed charge. */
export function cannonStates(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(s => s && typeof s === 'object' && (typeof s.ownerId === 'string' || typeof s.ownerId === 'number') && Number.isInteger(s.stage) && s.stage >= 2 && s.stage <= 3)
    .map(s => {
      const max = Number.isFinite(s.maxCharge) && s.maxCharge > 0 ? s.maxCharge : KAZDEL_CANNON.capacity;
      const charge = Number.isFinite(s.charge) ? Math.max(0, Math.min(max, s.charge)) : 0;
      return { ...s, max, charge, warning: s.warning && Number.isFinite(s.warning.x) && Number.isFinite(s.warning.y) && Number.isFinite(s.warning.until) ? { ...s.warning } : null };
    });
}
