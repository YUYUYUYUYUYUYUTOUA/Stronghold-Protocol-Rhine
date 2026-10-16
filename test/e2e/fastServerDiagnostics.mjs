// Opt-in observations for the test server only. No IPC requests, gameplay writes or watchdog changes.
import { getPriority } from 'node:os';
import { performance } from 'node:perf_hooks';

export const fastServerDiagnosticsEnabled = process.env.SP_E2E_SERVER_DIAG === '1';

const priority = pid => {
  try { return Number.isInteger(pid) ? getPriority(pid) : null; }
  catch (error) { return { unavailable: error?.code || error?.info?.code || String(error) }; }
};
const text = value => {
  try { return value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value); }
  catch { return '[unserializable diagnostic value]'; }
};

/** Both the parent FastMatch and the non-sandbox match child use their existing logger. */
export function beginFastMatchDiagnostic(match, stage, fields = {}) {
  if (!fastServerDiagnosticsEnabled) return null;
  try {
    const marker = { stage, at: performance.now(), date: Date.now(), cpu: process.cpuUsage() };
    markFastMatchDiagnostic(match, marker, 'begin', fields);
    return marker;
  } catch { return null; }
}

export function markFastMatchDiagnostic(match, marker, point, fields = {}) {
  if (!marker) return;
  try {
    const now = performance.now(), cpu = process.cpuUsage(marker.cpu);
    match.log?.info?.(`[fast-match] ${JSON.stringify({ stage: marker.stage, point, pid: process.pid,
      roomCode: match.roomCode, phase: match.phase, round: match.round, at: now, date: Date.now(),
      startedAt: marker.at, startedDate: marker.date, wallMs: now - marker.at,
      cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, ...fields })}`);
  } catch { /* A diagnostic must never change the synchronous fixture path. */ }
}

export function createFastServerDiagnostics() {
  if (!fastServerDiagnosticsEnabled) return null;
  const logs = [], rooms = new Map(), matches = new Map(), lagSamples = [];
  let srv = null, timer = null, signature = null, outputCount = 0, outputTruncated = false;
  let maxLagMs = 0, maxLagSample = null, droppedLogs = 0, droppedRooms = 0, droppedMatches = 0;
  let previousAt = performance.now(), previousCpu = process.cpuUsage();
  const emit = (kind, payload, force = false) => {
    try {
      if (!force && outputCount >= 240) {
        if (!outputTruncated) {
          outputTruncated = true;
          console.log('[fast-server-diag] ' + JSON.stringify({ kind: 'output-bound', date: Date.now(), limit: 240 }));
        }
        return;
      }
      outputCount++;
      console.log('[fast-server-diag] ' + JSON.stringify({ kind, date: Date.now(), pid: process.pid, ...payload }));
    } catch { /* Do not turn observation/serialization failures into server failures. */ }
  };
  const retain = () => {
    if (!srv) return;
    for (const room of srv.lobby.rooms.values()) {
      if (!rooms.has(room)) {
        rooms.set(room, room);
        if (rooms.size > 8) { rooms.delete(rooms.keys().next().value); droppedRooms++; }
      }
      const match = room.match;
      if (match && !matches.has(match)) {
        matches.set(match, { room, match, ctx: room.matchCtx, host: match.host ?? null, publicFrame: null, publicState: null });
        if (matches.size > 16) { matches.delete(matches.keys().next().value); droppedMatches++; }
      }
    }
  };
  const summary = value => value && { reason: value.reason ?? null, detail: value.detail ?? null,
    cs: value.cs ?? null, victory: value.victory ?? null };
  const snapshot = () => {
    retain();
    return { parent: { scope: 'fast-server-parent-only', pid: process.pid, priority: priority(process.pid),
      maxLagMs, maxLagSample, samples: lagSamples.slice() },
    rooms: [...rooms.keys()].map(room => ({ code: room.code, present: srv.lobby.rooms.get(room.code) === room,
      disposed: !!room.disposed, hasMatch: !!room.match, matchCount: room.matchCount,
      lastSummary: summary(room.lastSummary) })),
    matches: [...matches.values()].map(record => {
      const { room, match, ctx, host } = record;
      if (ctx?.lastPublic && ctx.lastPublic !== record.publicFrame) {
        record.publicFrame = ctx.lastPublic;
        try {
          const parsed = JSON.parse(ctx.lastPublic);
          record.publicState = { phase: parsed.phase ?? parsed.public?.phase ?? null,
            round: parsed.round ?? parsed.public?.round ?? null };
        } catch { record.publicState = { unreadablePublicFrame: true }; }
      }
      return { code: room.code, current: room.match === match, hosted: !!match.hosted, matchId: match.matchId ?? null,
        phase: match.phase ?? record.publicState?.phase ?? null, round: match.round ?? record.publicState?.round ?? null,
        started: match.started ?? null, ended: !!match.ended, disposed: !!match.disposed,
        pending: match.pending?.size ?? null, context: ctx && { live: ctx.live, ended: ctx.ended, disposed: ctx.disposed },
        host: host && { cs: host.cs, ready: host.ready, dead: host.dead, transport: host.transport,
          lastBeat: host.lastBeat, heartbeatAgeMs: Date.now() - host.lastBeat, matches: host.matches?.size ?? null,
          stderr: String(host.stderr || '').slice(-1000), child: host.child && { pid: host.child.pid,
            priority: priority(host.child.pid), connected: host.child.connected, exitCode: host.child.exitCode,
            signalCode: host.child.signalCode } } };
    }), bounds: { logs: 160, retainedRooms: 8, retainedMatches: 16, emittedRecords: 240,
      droppedLogs, droppedRooms, droppedMatches, outputTruncated } };
  };
  const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => {
    try {
      const entry = { date: Date.now(), level, text: args.map(text).join(' ').slice(0, 2400) };
      logs.push(entry);
      if (logs.length > 160) { logs.shift(); droppedLogs++; }
      // Retain the actual proxy at the lobby's start log, even if it ends before the next 1s sample.
      retain();
      if (level === 'warn' || level === 'error' || /\[fast-match\]|\[plugins\] match host|\[lobby\].*match #.*(?:starting|ended)/.test(entry.text)) emit('log', { entry });
    } catch { /* Custom logging must be as harmless as quiet logging. */ }
  }]));
  const sample = () => {
    try {
      const now = performance.now(), cpu = process.cpuUsage(), elapsedMs = now - previousAt;
      const lagMs = Math.max(0, elapsedMs - 1000);
      const lag = { date: Date.now(), elapsedMs, lagMs, cpuUserMs: (cpu.user - previousCpu.user) / 1000,
        cpuSystemMs: (cpu.system - previousCpu.system) / 1000 };
      previousAt = now; previousCpu = cpu;
      lagSamples.push(lag);
      if (lagSamples.length > 20) lagSamples.shift();
      if (lagMs > maxLagMs) { maxLagMs = lagMs; maxLagSample = lag; }
      const current = snapshot();
      // Heartbeats advance every second; exclude their age/time from the transition key to keep output small.
      const key = JSON.stringify({ rooms: current.rooms, matches: current.matches.map(match => ({ ...match,
        host: match.host && { ...match.host, lastBeat: undefined, heartbeatAgeMs: undefined } })) });
      if (key !== signature || lagMs > 1000) {
        signature = key;
        emit(lagMs > 1000 ? 'parent-lag' : 'state-transition', { ...current, logTail: logs.slice(-4) });
      }
    } catch { /* Read-only sampler failures do not affect matches or heartbeats. */ }
  };
  return { log,
    attach(server) {
      try {
        srv = server; previousAt = performance.now(); previousCpu = process.cpuUsage();
        sample(); timer = setInterval(sample, 1000); timer.unref();
      } catch { /* Optional observation only. */ }
    },
    final(reason = 'before-close') {
      try { emit('final', { reason, ...snapshot(), logTail: logs.slice(-40) }, true); } catch { /* Optional observation only. */ }
    },
    stop() { try { clearInterval(timer); } catch { /* Optional observation only. */ } },
  };
}
