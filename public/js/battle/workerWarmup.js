// One not-yet-started Worker realm. A claimed realm belongs to exactly one battle and never returns here.
// The production host owns every load/install watchdog; cancellation never turns into a gameplay failure.
export function createWorkerWarmup({ createHost, onFailure }) {
  let idle = null;
  const fail = (slot, error) => {
    if (slot.cancelled || slot.error) return;
    slot.error = error instanceof Error ? error : new Error(String(error));
    slot.host?.stop();
    onFailure(slot.error, slot.owner);
  };
  const clear = () => {
    const slot = idle;
    idle = null;
    if (slot) { slot.cancelled = true; slot.host?.stop(); }
  };
  return {
    prepare(key, sim, { retryFailed = false } = {}) {
      if (idle?.key === key && (!idle.error || !retryFailed)) return idle;
      clear();
      const slot = { key, host: null, ready: null, owner: null, error: null, cancelled: false };
      idle = slot;
      try {
        slot.host = createHost(sim, error => fail(slot, error));
        slot.ready = Promise.resolve(slot.host.load(sim.cs, sim.content)).then(() => slot.host, error => {
          fail(slot, error);
          throw slot.error || error;
        });
      } catch (error) {
        fail(slot, error);
        slot.ready = Promise.reject(slot.error);
      }
      // An idle load may reject before a b.start claims it. Retain that rejection for its consumer without an
      // unhandled rejection or an automatic retry storm on every store update.
      slot.ready.catch(() => {});
      return slot;
    },
    take(key, owner) {
      if (!idle || idle.key !== key) return null;
      const slot = idle;
      idle = null;
      slot.owner = owner;
      return slot;
    },
    clear,
  };
}
