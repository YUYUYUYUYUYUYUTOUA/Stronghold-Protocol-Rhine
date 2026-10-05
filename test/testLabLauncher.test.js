import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { startRealServer, ROOT } from './e2e/client.mjs';

function run(args,context=false){
 const env={...process.env};if(!context)delete env.NODE_TEST_CONTEXT;
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/test-lab-launch.mjs',...args],{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const timer=setTimeout(()=>{child.kill();reject(new Error('launcher check timed out'));},20000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
 });
}
test('laboratory launcher rejects the live port and remains inert under Node test discovery',async()=>{
 const blocked=await run(['--port','3000','--no-open']);assert.equal(blocked.code,1);assert.match(blocked.output,/不能使用正式/);
 const discovery=await run(['--port','3000','--no-open'],true);assert.equal(discovery.code,0);assert.equal(discovery.output,'');
});
test('laboratory launcher refuses a different server even when it returns the same bootstrap marker',async()=>{
 const foreign=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<script src="/dev/lab-bootstrap.js"></script>');});
 await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 try{const result=await run(['--port',String(foreign.address().port),'--no-open']);assert.equal(result.code,1);assert.match(result.output,/其他服务占用/);}
 finally{await new Promise(r=>foreign.close(r));}
});
test('Windows laboratory launcher reuses only the same directory and loopback listener',{skip:process.platform!=='win32'},async()=>{
 const service=await startRealServer();
 try{const result=await run(['--port',String(service.port),'--no-open']);assert.equal(result.code,0,result.output);assert.match(result.output,/本目录测试台已运行/);assert.equal((await(await fetch(service.base+'/healthz')).json()).matches,0);}
 finally{await service.stop();}
});
