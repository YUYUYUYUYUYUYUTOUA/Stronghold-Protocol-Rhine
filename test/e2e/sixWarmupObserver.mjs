// Passive early Worker RPC evidence, independent of the later six-player combat/replay trace.
// Console transport retains earlier documents in Node when the real client reloads its page.
import assert from 'node:assert/strict';

const PREFIX = '[six-warmup] ';
const LIMIT = 250;

async function installObserver(prefix) {
  if (globalThis.__SP_SIX_WARMUP_OBSERVER__) return globalThis.__SP_SIX_WARMUP_OBSERVER__.ready;
  const state = globalThis.__SP_SIX_WARMUP_OBSERVER__ = { ready: null };
  const context = () => {
    try {
      const app = globalThis.__SP__, store = app?.store?.get(), room = store?.room, pub = store?.match?.public;
      return { room: room ? { code: room.code, cs: room.content?.cs, rhineEnabled: room.rhineEnabled,
        dataProfile: room.dataProfile, inMatch: room.inMatch } : null,
      profile: app?.data?.profileId ?? null, phase: pub?.phase ?? null, round: pub?.round ?? null };
    } catch (error) { return { diagnosticError: String(error?.message || error) }; }
  };
  const clock = () => ({ at: performance.now(), date: Date.now(), timeOrigin: performance.timeOrigin,
    documentId: String(performance.timeOrigin) });
  const failure = error => ({ code: error?.code ?? null, message: String(error?.message || error), stack: error?.stack ?? null });
  const report = event => { try { console.log(prefix + JSON.stringify(event)); } catch { /* Passive evidence only. */ } };
  state.ready = (async () => {
    const { WorkerSimHost } = await import('/js/battle/simHost.js');
    const rpc = WorkerSimHost.prototype.rpc, workers = new WeakMap();
    let sequence = 0;
    WorkerSimHost.prototype.rpc = function (...rpcArgs) {
      const [method, args = [], timeoutMs] = rpcArgs;
      if (!['load', 'install', 'start'].includes(method)) return rpc.apply(this, rpcArgs);
      if (!workers.has(this)) workers.set(this, ++sequence);
      const started = { ...clock(), workerId: workers.get(this), rpcId: this.seq + 1, method,
        cs: this.cs ?? args?.[0]?.cs ?? null, battleId: args?.[0]?.battleId ?? this.spec?.battleId ?? null,
        timeoutMs: timeoutMs ?? this.timeoutMs, context: context() };
      report({ type: 'rpc-start', ...started });
      const finish = error => {
        try {
          const ended = clock();
          report({ ...started, ...ended, type: 'rpc-end', startedAt: started.at, startedDate: started.date,
            startContext: started.context, context: context(), durationMs: ended.at - started.at,
            status: error ? 'error' : 'done', ...(error ? failure(error) : {}) });
        } catch { /* Observation cannot alter the original promise's settlement. */ }
      };
      let result;
      try { result = rpc.apply(this, rpcArgs); }
      catch (error) { finish(error); throw error; }
      // The caller receives the exact production Promise, with its original arguments and watchdog.
      result.then(() => finish(), error => finish(error));
      return result;
    };
    const installed = { type: 'observer-installed', ...clock(), context: context() };
    report(installed);
    return installed;
  })();
  state.ready.catch(error => report({ type: 'observer-install-error', ...clock(), context: context(), ...failure(error) }));
  return state.ready;
}

/** Call as soon as Client.open() has created its page, before entering/joining or starting the first match. */
export async function observeSixWarmup(client) {
  assert.ok(client.page, 'the client page exists before installing early Worker observation');
  if (client.sixWarmupHistory) return;
  const history = client.sixWarmupHistory = { events: [], dropped: 0 };
  client.page.on('console', message => {
    if (!message.text().startsWith(PREFIX)) return;
    try {
      const event = JSON.parse(message.text().slice(PREFIX.length));
      history.events.push({ ...event, receivedAt: Date.now() });
      if (history.events.length > LIMIT) { history.events.shift(); history.dropped++; }
    } catch { /* Diagnostic transport never changes the game or the test's existing combat trace. */ }
  });
  await client.page.evaluateOnNewDocument(installObserver, PREFIX);
  await client.page.evaluate(installObserver, PREFIX);
}

/** Node-side history survives page reloads; dropped records are explicit when its fixed bound is reached. */
export function readSixWarmup(client) {
  const history = client.sixWarmupHistory;
  return history ? { client: client.label, contextId: client.browserContext?.id ?? null, limit: LIMIT,
    dropped: history.dropped, documents: [...new Set(history.events.map(event => event.documentId))],
    events: structuredClone(history.events) } : null;
}
