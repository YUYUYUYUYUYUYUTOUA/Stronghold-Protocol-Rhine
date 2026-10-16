// Read-only source diagnostics: preserve the production test, assertions and host deadlines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SOURCE = 'bec8e325d72f40ac0d1301b11f2431611b9eee4b';
const ORIGINAL_SHA256 = '0ce4e2a8b85df35eef58680b8fef53678f9546e48b1eca6d7690ff7ea6347f74';
const CASE = 'all-bot match completes with script content and meta effects in production child';
const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  assert.ok(['--source', '--output', '--prepare-only'].includes(flag), flag);
  assert.equal(flags.has(flag), false, flag);
  flags.set(flag, flag === '--prepare-only' ? true : process.argv[++i]);
}
assert.ok(flags.get('--source') && flags.get('--output'));
const source = fs.realpathSync(flags.get('--source'));
const output = path.resolve(flags.get('--output'));
const relativeOutput = path.relative(source, output);
assert.ok(relativeOutput && (relativeOutput === '..' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)), 'Output must be outside the source checkout.');
fs.mkdirSync(output, { recursive: true });
const original = path.join(source, 'test/plugins/script-integration.test.js');
const diagnostic = path.join(source, 'test/plugins/.rhine-all-bot-native-diagnostic.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(original);
assert.equal(hash(bytes), ORIGINAL_SHA256, 'The original tracked test must match the immutable release source.');
assert.equal(fs.existsSync(diagnostic), false, 'Do not overwrite an existing diagnostic fixture.');
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' });
assert.equal(git.status, 0, git.stderr);
assert.equal(git.stdout.trim(), SOURCE);
const edits = [
  ["const quiet={info(){},warn(){},error(){}};", 'const quiet=console;'],
  ["broadcast(){},send(){return true;},onEnd:end});match.start();", `broadcast(){},send(){return true;},onEnd:end});
 const diagnosticHost=hosts._host(r.set.cs);
 const diagnosticStart=Date.now();
 const diagnosticMessages=[];
 let diagnosticHeartbeats=0;
 const diagnosticHostState=()=>({at:new Date().toISOString(),elapsedMs:Date.now()-diagnosticStart,
  transport:diagnosticHost?.transport,ready:diagnosticHost?.ready,dead:diagnosticHost?.dead,
  lastBeat:diagnosticHost?.lastBeat,sinceLastBeatMs:Date.now()-(diagnosticHost?.lastBeat||Date.now()),
  stderr:diagnosticHost?.stderr,pid:diagnosticHost?.child?.pid,connected:diagnosticHost?.child?.connected,
  heartbeatCount:diagnosticHeartbeats,lastMessages:diagnosticMessages});
 diagnosticHost?.child?.on('message',message=>{
  if(message?.type==='hb')diagnosticHeartbeats++;
  else {
   const frame=message?.msg;
   const sample={at:new Date().toISOString(),elapsedMs:Date.now()-diagnosticStart,type:message?.type,
    matchId:message?.matchId,frameType:frame?.t,phase:frame?.phase,round:frame?.round,
    error:message?.error,summary:message?.summary};
   diagnosticMessages.push(sample);if(diagnosticMessages.length>20)diagnosticMessages.shift();
   if(['ready','boot-error','failed','end'].includes(message?.type))console.error('RHINE_HOST_IPC',JSON.stringify(sample));
  }
 });
 diagnosticHost?.child?.once('exit',(code,signal)=>console.error('RHINE_HOST_EXIT',JSON.stringify({code,signal,host:diagnosticHostState()})));
 t.after(()=>console.error('RHINE_HOST_AFTER',JSON.stringify(diagnosticHostState())));
 console.error('RHINE_HOST_BEFORE',JSON.stringify(diagnosticHostState()));
 match.start();`],
  ["const summary=await Promise.race([done,timeout(100000)]);assert.equal(typeof summary.victory,'boolean');",
    "const summary=await Promise.race([done,timeout(100000)]);console.error('RHINE_MATCH_SUMMARY',JSON.stringify({summary,host:diagnosticHostState()}));assert.equal(typeof summary.victory,'boolean');"],
];
let instrumented = bytes.toString('utf8');
for (const [before, after] of edits) {
  assert.equal(instrumented.split(before).length, 2, 'Each logging-only edit must match exactly once.');
  instrumented = instrumented.replace(before, after);
}
let reversed = instrumented;
for (const [before, after] of [...edits].reverse()) reversed = reversed.replace(after, before);
assert.equal(reversed, bytes.toString('utf8'), 'Only the listed diagnostic insertions may differ.');
fs.writeFileSync(path.join(output, 'instrumented-fixture.mjs'), instrumented);
const runtimeEnv = { ...process.env, NO_COLOR: '1', SP_STUDIO: 'lan', SP_ASSET_INDEX: '0',
  SP_E2E: '0', SP_REAL_E2E: '0', RENDER_E2E: '0', SIM_E2E: '0', SP_UPDATE_E2E: '1', GH_TOKEN: '', GITHUB_TOKEN: '' };
delete runtimeEnv.NODE_TEST_CONTEXT;
const args = ['--test', '--test-reporter=spec', '--test-concurrency=3', `--test-name-pattern=^${CASE}$`, diagnostic];
const report = { schema: 'rhine-native-host-diagnostic/v1', sourceCommit: SOURCE, createdAt: new Date().toISOString(),
  prepareOnly: flags.has('--prepare-only'), source, output, original: { path: original, sha256: hash(bytes), bytes: bytes.length },
  diagnostic: { path: diagnostic, sha256: hash(Buffer.from(instrumented)), bytes: Buffer.byteLength(instrumented), loggingEdits: edits.length, exactReverseMatchesOriginal: true },
  case: CASE, args, limits: { raceMs: 100000, caseMs: 120000, defaultHostWatchdogMs: 10000, outerProcessMs: 300000 },
  runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
    osVersion: os.version(), release: os.release(), cpus: os.cpus().length, availableParallelism: os.availableParallelism() },
  env: Object.fromEntries(['NO_COLOR','SP_STUDIO','SP_ASSET_INDEX','SP_E2E','SP_REAL_E2E','RENDER_E2E','SIM_E2E','SP_UPDATE_E2E','GH_TOKEN','GITHUB_TOKEN'].map(key => [key, runtimeEnv[key]])),
  boundary: 'One isolated case in the immutable source checkout with fresh npm dependencies; not the portable payload or concurrent1003-case batch. Passing does not close the original failure.',
  permissions: 'No release API, publisher, package build, upload of release attachments or deployment is invoked.' };
let result;
try {
  fs.writeFileSync(diagnostic, instrumented, { flag: 'wx' });
  const syntax = spawnSync(process.execPath, ['--check', diagnostic], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  if (!flags.has('--prepare-only')) {
    assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.21.0');
    const beforePriority = os.getPriority(process.pid);
    os.setPriority(process.pid, os.constants.priority.PRIORITY_NORMAL);
    const actualPriority = os.getPriority(process.pid); assert.equal(actualPriority, 0);
    report.runtime.priority = { beforePriority, targetPriority: 0, actualPriority };
    result = spawnSync(process.execPath, args, { cwd: source, encoding: 'utf8', windowsHide: true,
      maxBuffer: 32 * 1024 * 1024, timeout: 300000, env: runtimeEnv });
    fs.writeFileSync(path.join(output, 'stdout.log'), result.stdout || '');
    fs.writeFileSync(path.join(output, 'stderr.log'), result.stderr || '');
    report.result = { status: result.status, signal: result.signal, error: result.error && String(result.error.stack || result.error) };
    console.log(result.stdout || ''); console.error(result.stderr || '');
  }
} finally {
  report.originalUnchangedAfterRun = fs.readFileSync(original).equals(bytes);
  assert.equal(report.originalUnchangedAfterRun, true);
  fs.rmSync(diagnostic, { force: true });
  fs.writeFileSync(path.join(output, 'diagnostic.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
if (result) { if (result.error) throw result.error; assert.equal(result.status, 0, 'The isolated original all-bot case failed; retain the raw logs.'); }
