#!/usr/bin/env node
// Test branch launcher: its service is bound only to this computer, on a separate port.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { openBrowser } from './open-browser.mjs';

export async function main(){
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), index=args.indexOf('--port');
const port=index<0?3010:Number(args[index+1]);
if(!Number.isInteger(port)||port<1024||port>65535||port===3000){console.error('测试端口须为1024–65535且不能使用正式3000端口');process.exit(1);}
const base=`http://127.0.0.1:${port}`, url=`${base}/dev/test-lab.html`;
function sameOwner(){
  if(process.platform!=='win32')return false;
  const entry=path.join(root,'server','index.js');
  const pattern='(?:^|\\s)"?'+entry.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"?(?:\\s|$)';
  const literal="'"+pattern.replace(/'/g,"''")+"'";
  const command=`$labListeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop); if($labListeners.Count -eq 0){exit 1}; foreach($labListener in $labListeners){if($labListener.LocalAddress -ne '127.0.0.1'){exit 1}; $labProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$labListener.OwningProcess) -ErrorAction Stop; if(-not [regex]::IsMatch($labProcess.CommandLine,${literal},'IgnoreCase')){exit 1}}; 'same'`;
  try{return execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore'],timeout:10000}).trim()==='same';}
  catch{return false;}
}
async function ready() {
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(1000)});
    return response.ok && (await response.text()).includes('/dev/lab-bootstrap.js');
  } catch { return false; }
}
if(await ready()&&sameOwner()){console.log(`本目录测试台已运行：${url}`);if(!args.includes('--no-open'))openBrowser(url);process.exit(0);}
const available=await new Promise(resolve=>{
  const probe=net.createServer();probe.once('error',()=>resolve(false));
  probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));
});
if(!available){console.error(`端口 ${port} 已被其他服务占用。请换端口：启动测试模式.bat --port 3011`);process.exit(1);}
const child=spawn(process.execPath,[path.join(root,'server','index.js')],
  {cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'}});
let stopped=false;
child.on('error',error=>{console.error(error.message);stopped=true;process.exitCode=1;});
child.on('exit',code=>{stopped=true;process.exitCode=process.exitCode||(code??1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
let opened=false;
for(let retry=0;retry<100&&!stopped;retry++){
  if(await ready()){opened=true;console.log(`\n测试模式：${url}\n配置与战斗在此浏览器内运行；按 Ctrl+C 关闭本测试服务。`);if(!args.includes('--no-open'))openBrowser(url);break;}
  await new Promise(resolve=>setTimeout(resolve,250));
}
if(!opened&&!stopped){console.error('测试服务启动超时，请检查上方错误。');process.exitCode=1;child.kill('SIGTERM');}
}
if(!process.env.NODE_TEST_CONTEXT && process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
