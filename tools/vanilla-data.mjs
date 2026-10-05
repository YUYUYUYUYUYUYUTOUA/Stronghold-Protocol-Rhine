// Preserve a complete, auditable upstream roster separately from the Rhine overlay.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const VANILLA_UPSTREAM_COMMIT = '9d404199df76f862eff7385b82f952ab0498f4c5';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function writeVanillaData(files,out,{source='build-data before the Rhine overlay'}={}){
  await fs.mkdir(out,{recursive:true});
  for(const [name,record] of Object.entries(files)){
    if(!/^[a-z][a-z-]*$/.test(name)||name==='manifest')throw new Error('Invalid vanilla data name');
    const dest=path.join(out,name+'.json'),tmp=dest+'.tmp-'+process.pid;
    await fs.writeFile(tmp,JSON.stringify(record));await fs.rename(tmp,dest);
  }
  const entries=[];
  for(const name of (await fs.readdir(out)).filter(n=>n.endsWith('.json')&&n!=='manifest.json').sort()){
    const bytes=await fs.readFile(path.join(out,name));JSON.parse(bytes.toString('utf8'));
    entries.push({path:name,size:bytes.length,sha256:hash(bytes)});
  }
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,profile:'vanilla',upstreamVersion:'0.1.2',source,files:entries},null,2)+'\n');
}

async function snapshot(){
  const out=path.join(ROOT,'data','vanilla');
  const git=(...args)=>execFileSync('git',['-C',ROOT,...args],{windowsHide:true,maxBuffer:32*1024*1024});
  const paths=git('ls-tree','--name-only',VANILLA_UPSTREAM_COMMIT,'data/').toString('utf8').trim().split(/\r?\n/);
  await fs.mkdir(out,{recursive:true});
  const entries=[];
  for(const rel of paths){
    if(!/^data\/[a-z-]+\.json$/.test(rel))throw new Error('Unexpected upstream data path');
    const bytes=git('show',`${VANILLA_UPSTREAM_COMMIT}:${rel}`);JSON.parse(bytes.toString('utf8'));
    const name=path.basename(rel);await fs.writeFile(path.join(out,name),bytes);
    entries.push({path:name,size:bytes.length,sha256:hash(bytes)});
  }
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,profile:'vanilla',upstreamVersion:'0.1.2',source:VANILLA_UPSTREAM_COMMIT,files:entries},null,2)+'\n');
  console.log(`Preserved ${entries.length} exact upstream data files in data/vanilla.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await snapshot();
