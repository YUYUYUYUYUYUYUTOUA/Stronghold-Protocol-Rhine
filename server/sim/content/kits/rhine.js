// Rhine operators use the same resolved skill/module loadouts as the original roster.
import { RHINE_SUPPORT_KITS, RHINE_SUPPORT_TOKEN_KITS } from './rhineSupport.js';
import { RHINE_ASSAULT_KITS } from './rhineAssault.js';
import { RHINE_NEW_KITS, RHINE_NEW_TOKEN_KITS } from './rhineNew.js';

export { mayer, wuhoo } from './rhineSupport.js';
export { eunectes, ifrit } from './rhineAssault.js';
export { astgenne, dorothy, resonator } from './rhineNew.js';
export const tokenKits = { ...RHINE_SUPPORT_TOKEN_KITS, ...RHINE_NEW_TOKEN_KITS };
export default { ...RHINE_SUPPORT_KITS, ...RHINE_ASSAULT_KITS, ...RHINE_NEW_KITS };
