// Diagnostics only: observe the unchanged test/update-package.test.js plain.zip call.
// node --import <this-file-URL> --test --test-name-pattern=<original-leaf> test/update-package.test.js
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalSpawnSync = childProcess.spawnSync;
const outputDir = process.env.SP_ZIP_DIAG_DIR || path.join(os.tmpdir(), 'rhine-zip-spawn-diag');
const outputFile = path.join(outputDir, `zip-spawn-${process.pid}.json`);
let installed = false;
let report = null;
let written = false;
const diagnosticErrors = [];
const serialError = e => e == null ? null : Object.fromEntries(['name','message','code','errno','syscall','path','spawnargs'].map(k => [k,e[k] ?? null]));
const text = value => value == null ? null : (Buffer.isBuffer(value) ? value.toString('utf8') : String(value)).slice(0,8192);
function outputState(file) {
  try { const s=fs.statSync(file);return {exists:true,isFile:s.isFile(),isDirectory:s.isDirectory(),bytes:s.size}; }
  catch(e) {return {exists:fs.existsSync(file),error:serialError(e)};}
}
// Do not touch process.stdin/stdout/stderr getters before the original spawn:
// initializing those streams could itself perturb Windows inherited-handle behavior.
function context() {return {node:process.version,platform:process.platform,arch:process.arch,pid:process.pid,execArgv:[...process.execArgv],nodeTestContext:process.env.NODE_TEST_CONTEXT ?? null};}
function targetOf(executable,args,options) {
  if(!Array.isArray(args)||!options||options.stdio!=='inherit'||typeof options.cwd!=='string')return null;
  if(!path.basename(options.cwd).startsWith('sp-update-zip-')||args.at(-1)!=='Stronghold-Protocol')return null;
  const target=executable==='zip'&&args.length===5&&args[0]==='-q'&&args[1]==='-r'&&args[2]==='-X'?args[3]
    :executable==='tar'&&args.length===8&&args[0]==='-c'&&args[1]==='--format'&&args[2]==='zip'&&args[3]==='--options'&&args[4]==='zip:hdrcharset=UTF-8'&&args[5]==='-f'?args[6]:null;
  return typeof target==='string'&&path.basename(target)==='plain.zip'&&path.resolve(target)===path.join(path.resolve(options.cwd),'plain.zip')?target:null;
}
function restore() {
  if(!installed)return;
  try {childProcess.spawnSync=originalSpawnSync;syncBuiltinESMExports();installed=false;}
  catch(e){diagnosticErrors.push({stage:'restore',error:serialError(e)});}
}
function resultOf(r) {return {error:serialError(r?.error),status:r?.status ?? null,signal:r?.signal ?? null,pid:r?.pid ?? null,stdout:text(r?.stdout),stderr:text(r?.stderr),output:Array.isArray(r?.output)?r.output.map(text):null};}
// These are diagnostic comparisons, never retries of plain.zip or a replacement
// for the original test result. Exported only for an external synthetic quickcheck.
export function controlledComparisons(originalOptions,originalTarArgs) {
  restore();
  if(installed||childProcess.spawnSync!==originalSpawnSync)return {notRun:'spawnSync bindings were not restored'};
  const cwd=originalOptions?.cwd;
  if(typeof cwd!=='string')return {notRun:'original cwd is unavailable'};
  const maxBuffer=16*1024*1024,timeout=10000;
  const packageUrl=new URL('../../tools/package.mjs',import.meta.url).href;
  const updateUrl=new URL('../../tools/package-update.mjs',import.meta.url).href;
  const cliTarget=path.join(cwd,'plain-cli-boundary.zip');
  const pipeTarget=path.join(cwd,'plain-direct-pipe.zip');
  const code=`import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const {zipFolder}=await import(${JSON.stringify(packageUrl)});
const {readBase}=await import(${JSON.stringify(updateUrl)});
const [cwd,target]=process.argv.slice(1);
zipFolder(cwd,target);
const base=readBase(target);
const digest=body=>({size:Buffer.byteLength(body),sha256:crypto.createHash('sha256').update(body).digest('hex')});
assert.deepEqual([base.version,base.art,base.update],['0.2.0',1,false]);
assert.deepEqual([...base.files.keys()].sort(),['package.json','public/assets/卫戍 a.png','server/empty.js']);
assert.deepEqual(base.files.get('public/assets/卫戍 a.png'),digest(Buffer.alloc(5000,7)));
assert.deepEqual(base.files.get('server/empty.js'),digest(''));
console.log(JSON.stringify({validation:'passed',version:base.version,art:base.art,update:base.update,entries:[...base.files.keys()].sort(),nodeTestContext:process.env.NODE_TEST_CONTEXT??null,execArgv:process.execArgv}));`;
  function compare(name,executable,args,options,target) {
    const item={name,executable,args,options:{cwd:options.cwd??null,stdio:options.stdio,encoding:options.encoding,maxBuffer:options.maxBuffer,timeout:options.timeout},target,outputBefore:outputState(target)};
    try {fs.lstatSync(target);item.notRun='separate comparison target already exists';return item;}
    catch(e){if(e.code!=='ENOENT'){item.notRun='cannot verify that comparison target is absent';item.targetCheckError=serialError(e);return item;}}
    try {item.result=resultOf(originalSpawnSync(executable,args,options));}
    catch(e){item.thrown=serialError(e);}
    finally {item.outputAfter=outputState(target);}
    return item;
  }
  const standalone=compare('standalone-original-zipFolder',process.execPath,
    ['--input-type=module','-e',code,'--',cwd,cliTarget],
    {encoding:'utf8',stdio:'pipe',maxBuffer,timeout},cliTarget);
  let directPipe;
  if(!Array.isArray(originalTarArgs)||originalTarArgs.length!==8||originalTarArgs[0]!=='-c'||originalTarArgs[1]!=='--format'||originalTarArgs[2]!=='zip'||originalTarArgs[3]!=='--options'||originalTarArgs[4]!=='zip:hdrcharset=UTF-8'||originalTarArgs[5]!=='-f'||originalTarArgs[7]!=='Stronghold-Protocol'){
    directPipe={name:'direct-original-tar-piped',target:pipeTarget,notRun:'original tar argument array was not observed',outputBefore:outputState(pipeTarget)};
  }else{
    const args=[...originalTarArgs];args[6]=pipeTarget;
    directPipe=compare('direct-original-tar-piped','tar',args,
      {...originalOptions,stdio:'pipe',encoding:'utf8',maxBuffer,timeout},pipeTarget);
  }
  return {diagnosticOnly:true,originalResultUnchanged:true,nodeTestContext:process.env.NODE_TEST_CONTEXT??null,standalone,directPipe};
}
function failureOnlyDetection() {
  const commands=[['zip',['-v']],['tar',['--version']]];
  if(process.platform==='win32')commands.push(['where.exe',['zip']],['where.exe',['tar']]);
  return commands.map(([executable,args])=>{
    try {return {executable,args,options:{encoding:'utf8',stdio:'pipe',maxBuffer:65536},result:resultOf(originalSpawnSync(executable,args,{encoding:'utf8',stdio:'pipe',maxBuffer:65536}))};}
    catch(e){return {executable,args,thrown:serialError(e)};}
  });
}
function writeReport() {
  if(!report||written)return;
  report.finishedAt=new Date().toISOString();report.spawnSyncRestored=childProcess.spawnSync===originalSpawnSync;report.diagnosticErrors=diagnosticErrors;
  try {fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(outputFile,JSON.stringify(report,null,2)+'\n');written=true;console.error(`[zip-spawn-diag] ${JSON.stringify({file:outputFile,node:process.version,pid:process.pid,nodeTestContext:report.context.nodeTestContext,backendAttempts:report.attempts.length,failure:report.backendFailure,spawnSyncRestored:report.spawnSyncRestored})}`);}
  catch(e){try{console.error(`[zip-spawn-diag] report write failed: ${e.code ?? e.name}`);}catch{}}
}
function observedSpawnSync(...callArgs) {
  const [executable,args,options]=callArgs;
  const target=targetOf(executable,args,options);
  if(!target)return Reflect.apply(originalSpawnSync,this,callArgs);
  // All actual backend arguments and object identities are forwarded unchanged.
  if(!report)report={schemaVersion:1,diagnosticOnly:true,createdAt:new Date().toISOString(),context:context(),target,scope:'Original plain.zip fixture only; no backend retries or replacements; original test assertions/timeout unchanged.',attempts:[]};
  const attempt={executable,args:[...args],options:{cwd:options.cwd,stdio:options.stdio},outputBefore:outputState(target)};
  let result,thrown,finished=false,failed=false;
  try {
    try {result=Reflect.apply(originalSpawnSync,this,callArgs);return result;}
    catch(e){thrown=e;throw e;}
  } finally {
    // Observation and probes must never replace the original result/exception.
    try {
      attempt.result=thrown?null:resultOf(result);attempt.thrown=serialError(thrown);attempt.outputAfter=outputState(target);report.attempts.push(attempt);
      const successful=!thrown&&!result?.error&&result?.status===0;
      finished=Boolean(thrown)||executable==='tar'||successful;
      failed=Boolean(thrown)||(executable==='tar'&&(!successful||!attempt.outputAfter.isFile));
    }catch(e){diagnosticErrors.push({stage:'observe',error:serialError(e)});finished=true;}
    if(finished){
      // Restore before any additional detection; production call receives its original return/throw.
      restore();report.backendFailure=failed;
      if(failed){
        try {report.controlledComparisons=controlledComparisons(options,executable==='tar'?args:null);}catch(e){diagnosticErrors.push({stage:'controlled-comparisons',error:serialError(e)});}
        try {report.failureOnlyDetection=failureOnlyDetection();}catch(e){diagnosticErrors.push({stage:'failure-only-detection',error:serialError(e)});}
      }
      writeReport();
    }
  }
}
childProcess.spawnSync=observedSpawnSync;
syncBuiltinESMExports();installed=true;
process.once('exit',()=>{restore();if(report&&!written){report.backendFailure=null;report.incomplete=true;writeReport();}});
