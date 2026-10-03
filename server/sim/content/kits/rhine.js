// Rhine operators use the same resolved skill/module loadouts as the original roster.
import { RHINE_SUPPORT_KITS, RHINE_SUPPORT_TOKEN_KITS } from './rhineSupport.js';
import { RHINE_ASSAULT_KITS } from './rhineAssault.js';

export { mayer, wuhoo } from './rhineSupport.js';
export { eunectes, ifrit } from './rhineAssault.js';
export const tokenKits = RHINE_SUPPORT_TOKEN_KITS;
export default { ...RHINE_SUPPORT_KITS, ...RHINE_ASSAULT_KITS };
