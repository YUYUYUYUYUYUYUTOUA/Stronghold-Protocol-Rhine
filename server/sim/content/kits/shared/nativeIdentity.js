// Native skills/talents can act on an operator's soul. Economy, garrisons and roster counts
// continue to use kind === 'op'; souls remain tokens outside native combat selection.
export const nativeOperator = u => !!u && (u.kind === 'op' || u.kazdelSoul === true);
