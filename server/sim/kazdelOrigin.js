// Preserve cannon causality across only the callbacks created by a cannon hit or its derivatives.
// Ordinary callbacks keep their original function and execution context.
export function withKazdelCannonOrigin(battle, safeAllies, fn) {
  battle._kazdelCannonDamageDepth = (battle._kazdelCannonDamageDepth ?? 0) + 1;
  if (safeAllies) battle._kazdelCannonSafeAlliesDepth = (battle._kazdelCannonSafeAlliesDepth ?? 0) + 1;
  try { return fn(); } finally {
    battle._kazdelCannonDamageDepth--;
    if (safeAllies) battle._kazdelCannonSafeAlliesDepth--;
  }
}

export function captureKazdelCallback(battle, fn) {
  if (typeof fn !== 'function' || !(battle._kazdelCannonDamageDepth > 0)) return fn;
  const safeAllies = battle._kazdelCannonSafeAlliesDepth > 0;
  return function (...args) {
    return withKazdelCannonOrigin(battle, safeAllies, () => fn.apply(this, args));
  };
}
