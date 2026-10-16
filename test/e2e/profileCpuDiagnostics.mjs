// Opt-in, passive V8 sampling around a real page reload. No game, renderer, cache or Worker behavior is replaced.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const errorText = error => String(error?.stack || error);
const GAP_THRESHOLD_US = 100000;

function summarize(profile) {
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const topJavaScriptSelfSamples = profile.nodes.filter(node => node.callFrame?.scriptId !== '0'
    && node.callFrame?.lineNumber >= 0 && counts.has(node.id))
    .map(node => ({ nodeId: node.id, selfSamples: counts.get(node.id), ...node.callFrame }))
    .sort((a, b) => b.selfSamples - a.selfSamples).slice(0, 30);
  const deltas = profile.timeDeltas || [], finite = deltas.filter(Number.isFinite);
  const largeGaps = deltas.map((deltaUs, sampleIndex) => ({ sampleIndex, deltaUs }))
    .filter(gap => gap.deltaUs >= GAP_THRESHOLD_US).sort((a, b) => b.deltaUs - a.deltaUs);
  return { sampleCount: profile.samples?.length || 0, nodeCount: profile.nodes.length,
    profileStartUs: profile.startTime, profileEndUs: profile.endTime,
    profileElapsedUs: profile.endTime - profile.startTime,
    timeDeltaCount: deltas.length, sumTimeDeltasUs: finite.reduce((a, b) => a + b, 0),
    maxTimeDeltaUs: finite.reduce((maximum, delta) => Math.max(maximum, delta), 0),
    negativeTimeDeltaCount: finite.filter(delta => delta < 0).length,
    nonFiniteTimeDeltaCount: deltas.length - finite.length, largeGapThresholdUs: GAP_THRESHOLD_US,
    largeGapCount: largeGaps.length, largestGaps: largeGaps.slice(0, 30), topJavaScriptSelfSamples,
    interpretation: 'Self samples are counts. timeDeltas are elapsed sampling gaps, not CPU time or attribution to GL/native work.' };
}

export function profileCpuCoverage(profile, before, after) {
  const navigationStartUs = after?.metrics?.NavigationStart * 1000000;
  const documentObservedUntilUs = after?.metrics?.Timestamp * 1000000;
  const timeOriginChanged = !!before?.page && !!after?.page && before.page.timeOrigin !== after.page.timeOrigin;
  const navigationStartIncluded = Number.isFinite(navigationStartUs)
    && navigationStartUs >= profile.startTime && navigationStartUs <= profile.endTime;
  const intersectionStartUs = Math.max(profile.startTime, navigationStartUs);
  const intersectionEndUs = Math.min(profile.endTime, documentObservedUntilUs);
  const hasPositiveIntersection = Number.isFinite(intersectionStartUs) && Number.isFinite(intersectionEndUs)
    && intersectionEndUs > intersectionStartUs;
  let sampleTimestampUs = profile.startTime, samplesInNewDocumentWindow = 0;
  for (const delta of profile.timeDeltas || []) {
    sampleTimestampUs += delta;
    if (sampleTimestampUs >= intersectionStartUs && sampleTimestampUs <= intersectionEndUs) samplesInNewDocumentWindow++;
  }
  return { timeOriginChanged, navigationStartUs, documentObservedUntilUs, navigationStartIncluded,
    profileStartAfterNavigationUs: profile.startTime - navigationStartUs,
    effectiveNewDocumentSamplingWindow: hasPositiveIntersection ? { startUs: intersectionStartUs, endUs: intersectionEndUs,
      startOffsetUs: intersectionStartUs - navigationStartUs, endOffsetUs: intersectionEndUs - navigationStartUs } : null,
    samplesInNewDocumentWindow,
    coveredNewDocument: timeOriginChanged && hasPositiveIntersection && samplesInNewDocumentWindow > 0,
    basis: 'The sampled interval intersects the observed new-document lifetime, with actual samples in that intersection.',
    limitation: 'This does not claim coverage of the navigation instant or attribute unsampled gaps to CPU/GL work.' };
}

/** Best-effort diagnostics: start/stop failures are recorded and never replace the caller's test failure. */
export async function startProfileCpuDiagnostics(page, { outDir, label = 'rhine-profile-host-reload' } = {}) {
  const errors = [], anchors = {};
  let cdp, started = false, stopping;
  const warn = (stage, error) => {
    const detail = { stage, error: errorText(error) };
    errors.push(detail);
    console.log('Profile CPU diagnostic warning:', JSON.stringify({ label, ...detail }));
  };
  // Bound only diagnostic transport commands; no application/RPC timer or sampling clock is changed.
  const send = (method, params = {}) => cdp.send(method, params, { timeout: 5000 });
  const anchor = async name => {
    const nodeWallBeforeMs = Date.now();
    const [document, metrics] = await Promise.allSettled([
      send('Runtime.evaluate', { expression: '({url:location.href,timeOrigin:performance.timeOrigin,now:performance.now(),readyState:document.readyState,visibilityState:document.visibilityState})', returnByValue: true }),
      send('Performance.getMetrics'),
    ]);
    const value = { nodeWallBeforeMs, nodeWallAfterMs: Date.now() };
    if (document.status === 'fulfilled' && !document.value.exceptionDetails) value.page = document.value.result.value;
    else value.pageError = document.status === 'rejected' ? errorText(document.reason) : JSON.stringify(document.value.exceptionDetails);
    if (metrics.status === 'fulfilled') value.metrics = Object.fromEntries(metrics.value.metrics
      .filter(metric => ['Timestamp', 'NavigationStart'].includes(metric.name)).map(metric => [metric.name, metric.value]));
    else value.metricsError = errorText(metrics.reason);
    anchors[name] = value;
    console.log('Profile CPU clock anchor:', JSON.stringify({ label, name, ...value }));
    return value;
  };
  try {
    cdp = await page.target().createCDPSession();
    await send('Performance.enable', { timeDomain: 'timeTicks' });
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 1000 });
    await send('Profiler.start');
    started = true;
    await anchor('beforeReload');
  } catch (error) { warn('start', error); }

  return { stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      let profile;
      try {
        if (started) {
          await anchor('afterReloadBeforeStop');
          ({ profile } = await send('Profiler.stop'));
          started = false;
          await anchor('afterProfilerStop');
        }
      } catch (error) { warn('stop', error); }
      finally {
        if (cdp) {
          for (const method of ['Profiler.disable', 'Performance.disable']) {
            try { await send(method); } catch (error) { warn(method, error); }
          }
          try { await cdp.detach(); } catch (error) { warn('detach', error); }
        }
      }
      const metadata = { label, requestedSamplingIntervalUs: 1000, anchors, errors, profileAvailable: !!profile,
        units: { cpuProfileStartEndAndTimeDeltas: 'microseconds', performanceMetrics: 'monotonic seconds',
          pageTimeOriginAndNow: 'milliseconds', nodeWall: 'Unix epoch milliseconds' } };
      if (!profile) {
        console.log('Profile CPU metadata:', JSON.stringify(metadata));
        return { metadata };
      }
      // The original profile, including every sample and every gap, is serialized without rewriting any fields.
      const raw = Buffer.from(JSON.stringify(profile) + '\n'), zipped = gzipSync(raw);
      const stem = `${label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100)}-${Date.now()}-${process.pid}`;
      const directory = outDir || path.resolve('test/e2e/out');
      const rawPath = path.join(directory, `${stem}.cpuprofile`), gzipPath = `${rawPath}.gz`;
      const summary = summarize(profile);
      Object.assign(metadata, { raw: { path: rawPath, bytes: raw.length, sha256: sha256(raw) },
        gzip: { path: gzipPath, bytes: zipped.length, sha256: sha256(zipped) },
        coverage: profileCpuCoverage(profile, anchors.beforeReload, anchors.afterReloadBeforeStop) });
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(rawPath, raw);
        await writeFile(gzipPath, zipped);
        await writeFile(`${rawPath}.metadata.json`, JSON.stringify({ ...metadata, summary }, null, 2) + '\n');
      } catch (error) { warn('save', error); }
      console.log('Profile CPU metadata:', JSON.stringify(metadata));
      const { topJavaScriptSelfSamples, ...summaryCounts } = summary;
      console.log('Profile CPU sample summary:', JSON.stringify({ label, ...summaryCounts }));
      for (const [index, sample] of topJavaScriptSelfSamples.entries()) console.log('Profile CPU top JS self sample:', JSON.stringify({ label, rank: index + 1, ...sample }));
      const encoded = zipped.toString('base64'), chunkSize = 10000, chunks = Math.ceil(encoded.length / chunkSize);
      for (let index = 0; index < chunks; index++) console.log('Profile CPU gzip chunk:', JSON.stringify({ label, id: stem,
        index, chunks, encoding: 'gzip+base64', data: encoded.slice(index * chunkSize, (index + 1) * chunkSize) }));
      return { profile, metadata, summary };
    })().catch(error => {
      warn('diagnostic-finalize', error);
      return { metadata: { label, anchors, errors, profileAvailable: false } };
    });
    return stopping;
  } };
}
