import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, chmod, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateNextProjectFiles, type SourceFile } from './next-template.js';

const DEFAULT_IMAGE='starlidigital-next-worker:16.4.3';
const MAX_LOG=65536;
let active=false;
export function nextWorkerEnabled():boolean{return process.env.NEXT_WORKER_ENABLED==='true';}
function imageName():string{
  const image=process.env.NEXT_WORKER_IMAGE||DEFAULT_IMAGE;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,250}$/.test(image))throw new Error('Imaginea workerului Next.js nu este validă.');
  return image;
}
export function dockerBuildArguments(source:string,output:string,name:string,image:string):string[]{
  return ['run','--rm','--name',name,'--network','none','--user','1000:1000','--read-only',
    '--tmpfs','/work:rw,exec,nosuid,nodev,size=1073741824,uid=1000,gid=1000,mode=0700',
    '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=134217728,uid=1000,gid=1000,mode=0700',
    '--cpus','2','--memory','2g','--memory-swap','2g','--pids-limit','256',
    '--cap-drop','ALL','--security-opt','no-new-privileges',
    '--mount',`type=bind,source=${source},target=/source,readonly`,
    '--mount',`type=bind,source=${output},target=/export`,
    '--env','NEXT_TELEMETRY_DISABLED=1',image];
}
function dockerEnvironment():NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={};
  for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','USERPROFILE','HOME','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_CERT_PATH','DOCKER_TLS_VERIFY'])if(process.env[key])env[key]=process.env[key];
  return env;
}
async function command(args:string[],timeout:number):Promise<{code:number;log:string}>{
  return new Promise((done,reject)=>{
    const child=spawn('docker',args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:dockerEnvironment()});
    const chunks:Buffer[]=[];let length=0;let overflow=false;let settled=false;
    const collect=(chunk:Buffer)=>{const remaining=MAX_LOG-length;if(chunk.length>remaining)overflow=true;if(remaining>0){const part=chunk.subarray(0,remaining);chunks.push(part);length+=part.length;}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    const timer=setTimeout(()=>{child.kill('SIGKILL');if(!settled){settled=true;reject(new Error('Workerul Next.js a depășit timpul maxim de execuție.'));}},timeout);
    child.on('error',()=>{clearTimeout(timer);if(!settled){settled=true;reject(new Error('Docker nu este disponibil pentru workerul Next.js.'));}});
    child.on('close',code=>{clearTimeout(timer);if(!settled){settled=true;done({code:code??1,log:Buffer.concat(chunks).toString('utf8')+(overflow?'\n[Log limit reached]':'')});}});
  });
}
function inlineSnapshot(html:string,css:string,files:SourceFile[]):string{
  let result=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<link\b[^>]*>/gi,'').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,'');
  let snapshotCss=css;
  for(const file of files.filter(file=>file.encoding==='base64')){
    const asset='/'+file.path.replace(/^public\//,'');
    const data=`data:image/png;base64,${file.content}`;
    result=result.split('.'+asset).join(data).split(asset).join(data).split(asset.slice(1)).join(data);
    snapshotCss=snapshotCss.split('.'+asset).join(data).split(asset).join(data).split(asset.slice(1)).join(data);
  }
  const csp="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
  const safeCss=snapshotCss.replace(/<\/style/gi,'<\\/style');
  result=result.replace(/<meta\b[^>]*name\s*=\s*["']robots["'][^>]*>/gi,'').replace(/<head\b[^>]*>/i,match=>match+'<meta name="robots" content="noindex, nofollow">');
  if(!/<html\b/i.test(result)||!/<head\b[^>]*>/i.test(result))throw new Error('Workerul nu a produs un document Next.js valid.');
  return result.replace(/<head\b[^>]*>/i,match=>`${match}<meta http-equiv="Content-Security-Policy" content="${csp}"><style>${safeCss}</style>`);
}
async function cleanup(path:string):Promise<void>{
  const root=resolve(tmpdir()),target=resolve(path),rel=relative(root,target);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!rel.startsWith('starli-next-worker-'))throw new Error('Worker cleanup path rejected.');
  await rm(target,{recursive:true,force:true,maxRetries:3});
}
export async function verifyNextProject(files:SourceFile[]):Promise<{previewHtml:string;validationStatus:'PASSED';validationProvider:'DOCKER';buildLog:string}>{
  if(!nextWorkerEnabled())throw new Error('Workerul Next.js nu este activat. Sursele sunt păstrate pentru verificare ulterioară.');
  validateNextProjectFiles(files);
  if(active)throw new Error('Workerul Next.js verifică deja un proiect. Reîncearcă după finalizare.');
  active=true;let temp:string|undefined;const name='starli-next-'+randomUUID();
  try{
    const image=imageName();
    const inspected=await command(['image','inspect',image,'--format','{{.Os}}'],15000);
    if(inspected.code!==0||!inspected.log.split(/\r?\n/).some(line=>line.trim()==='linux'))throw new Error('Imaginea Linux a workerului Next.js nu este instalată.');
    temp=await mkdtemp(join(tmpdir(),'starli-next-worker-'));
    const source=join(temp,'source'),output=join(temp,'export');await mkdir(source);await mkdir(output,{mode:0o777});await chmod(output,0o777);
    for(const file of files){const path=join(source,...file.path.split('/'));await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,file.encoding==='base64'?Buffer.from(file.content,'base64'):file.content,{flag:'wx'});}
    const built=await command(dockerBuildArguments(source,output,name,image),180000);
    if(built.code!==0)throw new Error(`Verificarea Next.js a eșuat.\n${built.log.slice(-12000)}`);
    if(!built.log.includes('STARLI_NEXT_BUILD_VERIFIED'))throw new Error('Workerul nu a confirmat finalizarea buildului Next.js.');
    const path=join(output,'snapshot.json');const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||info.size>3000000)throw new Error('Snapshotul workerului Next.js este invalid sau prea mare.');
    const report=JSON.parse(await readFile(path,'utf8'));
    if(typeof report.html!=='string'||typeof report.css!=='string')throw new Error('Snapshotul workerului Next.js este invalid.');
    return {previewHtml:inlineSnapshot(report.html,report.css,files),validationStatus:'PASSED',validationProvider:'DOCKER',buildLog:built.log};
  }finally{
    try{await command(['rm','--force',name],10000).catch(()=>{});if(temp)await cleanup(temp);}finally{active=false;}
  }
}

