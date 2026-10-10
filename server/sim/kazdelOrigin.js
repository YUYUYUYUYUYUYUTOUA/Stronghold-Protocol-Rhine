// Preserve cannon causality across only the callbacks created by a cannon hit or its derivatives.
// Ordinary callbacks keep their original function and execution context.
// Keep the original player, not a reflecting enemy / ally or a shared field's authority.
export function kazdelCannonOwner(battle, source, dmg) {
  return (source?.kazdelCannon ? source.ownerId : null)
    ?? dmg?.kazdelCannonOwnerId ?? dmg?.origin?.kazdelCannonOwnerId ?? battle._kazdelCannonOwnerId ?? null;
}

export function withKazdelCannonOrigin(battle, safeAllies, fn, ownerId = null) {
  const previousOwner = battle._kazdelCannonOwnerId;
  battle._kazdelCannonOwnerId = ownerId;
  battle._kazdelCannonDamageDepth = (battle._kazdelCannonDamageDepth ?? 0) + 1;
  if (safeAllies) battle._kazdelCannonSafeAlliesDepth = (battle._kazdelCannonSafeAlliesDepth ?? 0) + 1;
  try { return fn(); } finally {
    battle._kazdelCannonDamageDepth--;
    battle._kazdelCannonOwnerId = previousOwner;
    if (safeAllies) battle._kazdelCannonSafeAlliesDepth--;
  }
}

export function captureKazdelCallback(battle, fn) {
  if (typeof fn !== 'function' || !(battle._kazdelCannonDamageDepth > 0)) return fn;
  const safeAllies = battle._kazdelCannonSafeAlliesDepth > 0;
  const ownerId = battle._kazdelCannonOwnerId;
  return function (...args) {
    return withKazdelCannonOrigin(battle, safeAllies, () => fn.apply(this, args), ownerId);
  };
}
