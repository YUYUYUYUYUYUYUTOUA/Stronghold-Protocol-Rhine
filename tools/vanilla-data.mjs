// Preserve a complete, auditable upstream roster separately from the Rhine overlay.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const VANILLA_UPSTREAM_COMMIT = '62eb113419123d9a3a63606107bbf85230c5dd2f';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function writeVanillaData(files,out,{source='build-data before the Rhine overlay'}={}){
  await fs.mkdir(out,{recursive:true});
  for(const [name,record] of Object.entries(files)){
    if(!/^(?:i18n\/)?[a-z][a-zA-Z-]*$/.test(name)||name==='manifest')throw new Error('Invalid vanilla data name');
    const dest=path.join(out,name+'.json'),tmp=dest+'.tmp-'+process.pid;
    await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.writeFile(tmp,JSON.stringify(record));await fs.rename(tmp,dest);
  }
  const entries=[];
  for(const name of (await fs.readdir(out,{recursive:true})).map(n=>n.split(path.sep).join('/')).filter(n=>n.endsWith('.json')&&n!=='manifest.json').sort()){
    const bytes=await fs.readFile(path.join(out,name));JSON.parse(bytes.toString('utf8'));
    entries.push({path:name,size:bytes.length,sha256:hash(bytes)});
  }
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,profile:'vanilla',upstreamVersion:'0.2.2',source,files:entries},null,2)+'\n');
}

async function snapshot(){
  const out=path.join(ROOT,'data','vanilla');
  const git=(...args)=>execFileSync('git',['-C',ROOT,...args],{windowsHide:true,maxBuffer:32*1024*1024});
  const paths=git('ls-tree','-r','--name-only',VANILLA_UPSTREAM_COMMIT,'data/').toString('utf8').trim().split(/\r?\n/);
  await fs.mkdir(out,{recursive:true});
  const entries=[];
  for(const rel of paths){
    if(!/^data\/(?:i18n\/)?[a-zA-Z0-9-]+\.json$/.test(rel))throw new Error('Unexpected upstream data path');
    const bytes=git('show',`${VANILLA_UPSTREAM_COMMIT}:${rel}`);JSON.parse(bytes.toString('utf8'));
    const name=rel.slice(5);await fs.mkdir(path.dirname(path.join(out,name)),{recursive:true});await fs.writeFile(path.join(out,name),bytes);
    entries.push({path:name,size:bytes.length,sha256:hash(bytes)});
  }
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,profile:'vanilla',upstreamVersion:'0.2.2',source:VANILLA_UPSTREAM_COMMIT,files:entries},null,2)+'\n');
  console.log(`Preserved ${entries.length} exact upstream data files in data/vanilla.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await snapshot();
