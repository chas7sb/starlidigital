import { validateStaticDocument, validateNextProjectFiles } from '../site-builder.js';
import { NEXT_DEPENDENCIES, NEXT_DEV_DEPENDENCIES, CORE_NEXT_PATHS, OPTIONAL_NEXT_PATHS, IMAGE_NEXT_PATHS, SEO_NEXT_PATHS } from '../next-template.js';

/**
 * Bounded Next.js Vercel adapter. Authorization and billing belong to the caller.
 * API contracts checked 2026-10-26 against:
 * https://vercel.com/docs/rest-api/deployments/create-a-new-deployment
 * https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url
 * Never automatically retry POST: a timeout can occur after Vercel accepted it.
 */
export type Deployment = { id: string; url: string; status: 'READY' | 'ERROR' | 'BUILDING'; projectId?:string; requestId?:string; sourceHash?:string };
export type DeploymentSourceFile = { path: string; content: string; encoding?: 'base64' };
const API = 'https://api.vercel.com';
export class VercelRequestError extends Error {
  constructor(message:string,public unknownOutcome=false,public status?:number){super(message);this.name='VercelRequestError';}
}
export function vercelConfigured(): boolean { return Boolean(process.env.VERCEL_TOKEN?.trim()); }

function endpoint(path: string): URL {
  const url = new URL(path, API);
  if (process.env.VERCEL_TEAM_ID?.trim()) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID.trim());
  return url;
}

function normalizeDeployment(value: unknown): Deployment {
  if (!value || typeof value !== 'object') throw new Error('Vercel a returnat un răspuns invalid.');
  const item = value as Record<string, unknown>;
  const id = item.id || item.uid;
  if (typeof id !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(id)) throw new Error('Vercel nu a returnat un identificator valid de publicare.');
  const rawUrl = item.url;
  if (typeof rawUrl !== 'string') throw new Error('Vercel nu a returnat adresa publicării.');
  let url: URL;
  try { url = new URL(rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`); }
  catch { throw new Error('Vercel a returnat o adresă invalidă.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.vercel.app') || url.pathname !== '/' || url.search || url.hash) throw new Error('Vercel a returnat o adresă neașteptată.');
  const state = item.readyState || item.status || item.state;
  if (typeof state !== 'string' || !['QUEUED','INITIALIZING','BUILDING','READY','ERROR','CANCELED','CANCELLED'].includes(state)) throw new Error('Starea publicării Vercel nu este recunoscută.');
  const result:Deployment={ id, url: url.origin, status: state === 'READY' ? 'READY' : ['ERROR','CANCELED','CANCELLED'].includes(state) ? 'ERROR' : 'BUILDING' };
  if(typeof item.projectId==='string'&&/^prj_[A-Za-z0-9]+$/.test(item.projectId))result.projectId=item.projectId;
  const meta=item.meta as Record<string,unknown>|undefined;
  if(meta&&typeof meta.starliRequestId==='string')result.requestId=meta.starliRequestId;
  if(meta&&typeof meta.starliSourceHash==='string')result.sourceHash=meta.starliSourceHash;
  return result;
}

async function apiJSON(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:Record<string,unknown>):Promise<any>{
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) throw new Error('Publicarea Vercel nu este conectată. Configurează VERCEL_TOKEN pe server.');
  let result: Response;
  try {
    result = await fetch(endpoint(path), {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
  } catch { throw new VercelRequestError('Conexiunea cu Vercel a eșuat. Verifică starea înainte de a reîncerca publicarea.',method==='POST'); }
  // Never expose provider response bodies: they may include account metadata.
  if (!result.ok) throw new VercelRequestError(`Vercel a respins operațiunea (${result.status}). Publicarea nu a fost confirmată.`,method==='POST'&&(result.status>=500||result.status===408),result.status);
  let data: unknown;
  try { data = await result.json(); } catch { throw new VercelRequestError('Vercel a returnat un răspuns invalid.',method==='POST'); }
  return data;
}
async function request(path: string, body?: Record<string, unknown>): Promise<Deployment> {
  const data=await apiJSON(path,body?'POST':'GET',body);
  try{return normalizeDeployment(data);}catch(error){if(body)throw new VercelRequestError(error instanceof Error?error.message:'Răspuns invalid.',true);throw error;}
}

/** @deprecated Retained for legacy internal tests; generated customer projects use deployNextSite. */
export async function deployStaticSite({ name, html }: { name: string; html: string }): Promise<Deployment> {
  if (!/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(name)) throw new Error('Numele proiectului Vercel trebuie să aibă 3–100 de caractere: litere mici, cifre și cratime.');
  const validated = validateStaticDocument(html);
  const data = Buffer.from(validated, 'utf8');
  if (data.length > 250000) throw new Error('Website-ul depășește limita publicării statice.');
  return request('/v13/deployments', {
    name,
    target: 'production',
    files: [{ file: 'index.html', data: data.toString('base64'), encoding: 'base64' }],
    projectSettings: { framework: null, buildCommand: '', installCommand: '', outputDirectory: '' },
  });
}

const NEXT_FILES = new Set<string>([...CORE_NEXT_PATHS]);
const NEXT_OPTIONAL = new Set<string>([...OPTIONAL_NEXT_PATHS,...SEO_NEXT_PATHS]);
const NEXT_IMAGES = new Set<string>([...IMAGE_NEXT_PATHS]);

function validateNextFiles(files: DeploymentSourceFile[]): DeploymentSourceFile[] {
  if (!Array.isArray(files) || files.length < NEXT_FILES.size || files.length > NEXT_FILES.size + NEXT_OPTIONAL.size + NEXT_IMAGES.size) throw new Error('Proiectul Next.js trebuie să conțină fișierele aprobate ale platformei.');
  const seen = new Set<string>(); let bytes = 0;
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || (!NEXT_FILES.has(file.path) && !NEXT_OPTIONAL.has(file.path) && !NEXT_IMAGES.has(file.path)) || seen.has(file.path)) throw new Error('Proiectul Next.js conține un fișier nepermis sau duplicat.');
    if (typeof file.content !== 'string' || !file.content.trim()) throw new Error('Un fișier Next.js are conținut invalid.');
    if (NEXT_IMAGES.has(file.path)) {
      if (file.encoding!=='base64' || file.content.length>16*1024*1024 || file.content.length%4!==0 || /[^A-Za-z0-9+/=]/.test(file.content)) throw new Error('Imaginea Next.js nu este base64 valid.');
      const image=Buffer.from(file.content,'base64');
      if(image.toString('base64')!==file.content) throw new Error('Imaginea Next.js nu este base64 valid.');
      if (image.length<8 || !image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Imaginea Next.js trebuie să fie PNG.');
      bytes+=image.length;
    } else {
      if (file.encoding || Buffer.byteLength(file.content,'utf8')>200000) throw new Error('Un fișier sursă Next.js are conținut invalid sau prea mare.');
      bytes+=Buffer.byteLength(file.content,'utf8');
    }
    seen.add(file.path);
  }
  if ([...NEXT_FILES].some(path=>!seen.has(path))) throw new Error('Lipsește un fișier sursă Next.js necesar.');
  if (bytes > 12*1024*1024) throw new Error('Proiectul Next.js depășește limita de publicare.');
  let pkg: Record<string, any>;
  try { pkg=JSON.parse(files.find(file=>file.path==='package.json')!.content); }
  catch { throw new Error('Manifestul proiectului Next.js nu este valid.'); }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) || pkg.private !== true) throw new Error('Manifestul Next.js trebuie să fie privat și valid.');
  const allowedKeys = new Set(['name','version','private','scripts','dependencies','devDependencies']);
  if (Object.keys(pkg).some(key=>!allowedKeys.has(key))) throw new Error('Manifestul Next.js conține opțiuni nepermise.');
  const scripts = pkg.scripts;
  if (!scripts || scripts.build !== 'next build' || Object.entries(scripts).some(([key,value])=>!({dev:'next dev',build:'next build',start:'next start'} as Record<string,string>)[key] || ({dev:'next dev',build:'next build',start:'next start'} as Record<string,string>)[key] !== value)) throw new Error('Proiectul Next.js conține scripturi nepermise.');
  const requiredDeps = ['next','react','react-dom'];
  if (!pkg.dependencies || Object.keys(pkg.dependencies).length !== requiredDeps.length || requiredDeps.some(name=>typeof pkg.dependencies[name] !== 'string')) throw new Error('Dependențele proiectului Next.js nu sunt aprobate.');
  const devDeps = pkg.devDependencies || {};
  const allowedDev = new Set(['typescript','@types/node','@types/react','@types/react-dom']);
  if (!devDeps || typeof devDeps !== 'object' || Array.isArray(devDeps) || Object.keys(devDeps).some(name=>!allowedDev.has(name))) throw new Error('Dependențele de dezvoltare Next.js nu sunt aprobate.');
  // Disallow URLs, Git references, local paths, tags and ranges in every dependency.
  if (Object.values({...pkg.dependencies,...devDeps}).some(version=>typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))) throw new Error('Dependențele Next.js trebuie să folosească versiuni fixe aprobate.');
  const fixedDeps:Record<string,string>=NEXT_DEPENDENCIES;
  const fixedDev:Record<string,string>=NEXT_DEV_DEPENDENCIES;
  if (Object.entries(fixedDeps).some(([name,version])=>pkg.dependencies[name]!==version) || Object.keys(devDeps).length!==Object.keys(fixedDev).length || Object.entries(fixedDev).some(([name,version])=>devDeps[name]!==version)) throw new Error('Versiunile dependențelor Next.js nu corespund șablonului aprobat.');
  return files;
}

export async function deployNextSite({ name, files, projectId, requestId, sourceHash }: { name: string; files: DeploymentSourceFile[]; projectId?:string;requestId?:string;sourceHash?:string }): Promise<Deployment> {
  if (!/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(name)) throw new Error('Numele proiectului Vercel trebuie să aibă 3–100 de caractere: litere mici, cifre și cratime.');
  const validated=validateNextFiles(files);
  await validateNextProjectFiles(validated);
  if(projectId&&!/^prj_[A-Za-z0-9]+$/.test(projectId))throw new Error('Identificatorul proiectului Vercel este invalid.');
  if(requestId&&!/^[A-Za-z0-9_-]{1,160}$/.test(requestId))throw new Error('Identificatorul cererii de publicare este invalid.');
  if(sourceHash&&!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Amprenta sursei nu este validă.');
  return request('/v13/deployments', {
    name,
    target:'production',
    files:validated.map(file=>({file:file.path,data:file.encoding==='base64'?file.content:Buffer.from(file.content,'utf8').toString('base64'),encoding:'base64'})),
    projectSettings:{framework:'nextjs'},
    ...(projectId?{project:projectId}:{}),
    ...(requestId?{meta:{starliRequestId:requestId,...(sourceHash?{starliSourceHash:sourceHash}:{})}}:{}),
  });
}

export async function getDeployment(id: string): Promise<Deployment> {
  if (!/^dpl_[A-Za-z0-9]+$/.test(id)) throw new Error('Identificatorul publicării Vercel este invalid.');
  return request(`/v13/deployments/${encodeURIComponent(id)}`);
}

export async function ensureVercelProject({name,expectedId,onCreated}:{name:string;expectedId?:string;onCreated?:(project:{id:string;name:string})=>void}):Promise<{id:string;name:string;publicConfigured:true}>{
  if(!/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(name))throw new Error('Numele proiectului Vercel este invalid.');
  if(expectedId&&!/^prj_[A-Za-z0-9]+$/.test(expectedId))throw new Error('Asocierea proiectului Vercel este invalidă.');
  let project:any;
  try{project=await apiJSON(`/v9/projects/${encodeURIComponent(expectedId||name)}`);}
  catch(error){
    if(!(error instanceof VercelRequestError)||error.status!==404||expectedId)throw error;
    project=await apiJSON('/v11/projects','POST',{name,framework:'nextjs',publicSource:false,ssoProtection:null});
    // A successful create response is authoritative; an ambiguous POST is never repeated here.
    if(typeof project?.id!=='string'||!/^prj_[A-Za-z0-9]+$/.test(project.id))throw new VercelRequestError('Vercel nu a confirmat proiectul creat.',true);
    expectedId=project.id;
    onCreated?.({id:project.id,name});
  }
  if(!expectedId)throw new Error('Numele proiectului există deja fără o asociere locală verificată. Alex trebuie să verifice proiectul înainte de publicare.');
  if(project?.id!==expectedId||project?.name!==name)throw new Error('Asocierea proiectului Vercel nu corespunde proiectului local.');
  if(project.framework&&project.framework!=='nextjs')throw new Error('Proiectul Vercel existent nu folosește Next.js.');
  if(project.ssoProtection||project.passwordProtection||project.trustedIps){
    await apiJSON(`/v9/projects/${encodeURIComponent(project.id)}`,'PATCH',{ssoProtection:null,passwordProtection:null,trustedIps:null});
  }
  project=await apiJSON(`/v9/projects/${encodeURIComponent(project.id)}`);
  if(project?.id!==expectedId||project?.name!==name||project.ssoProtection||project.passwordProtection||project.trustedIps)throw new Error('Protecția proiectului împiedică accesul public. Publicarea nu este confirmată.');
  return {id:expectedId!,name,publicConfigured:true};
}

/** Recover one unknown create request by its provider-stored metadata, never by name alone. */
export async function findDeploymentByRequest({projectId,requestId,since}:{projectId:string;requestId:string;since:number}):Promise<Deployment|null>{
  if(!/^prj_[A-Za-z0-9]+$/.test(projectId)||!/^[A-Za-z0-9_-]{1,160}$/.test(requestId)||!Number.isFinite(since))throw new Error('Datele de reconciliere nu sunt valide.');
  let until:string|undefined;
  for(let page=0;page<5;page++){
    const query=new URLSearchParams({projectId,limit:'100',since:String(Math.max(0,Math.floor(since-60000))),target:'production'});if(until)query.set('until',until);
    const result=await apiJSON('/v7/deployments?'+query.toString());
    if(!Array.isArray(result.deployments))throw new Error('Vercel nu a returnat lista publicărilor.');
    const matches=result.deployments.filter((item:any)=>item.meta?.starliRequestId===requestId);
    if(matches.length>1)throw new Error('Au fost găsite mai multe publicări pentru aceeași cerere. Este necesară verificarea administratorului.');
    if(matches.length){const deployment=await getDeployment(matches[0].uid||matches[0].id);if(deployment.requestId!==requestId||deployment.projectId!==projectId)throw new Error('Reconcilierea publicării nu a putut fi verificată.');return deployment;}
    const next=result.pagination?.next;if(typeof next!=='number'||!Number.isFinite(next)||String(next)===until)return null;until=String(next);
  }
  // A bounded search is not evidence of absence; caller must not submit another create request.
  return null;
}

export async function verifyPublicDeployment(url:string):Promise<boolean>{
  let parsed:URL;try{parsed=new URL(url);}catch{return false;}
  if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.vercel.app')||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)return false;
  try{const response=await fetch(parsed.origin,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html'}});const publicPage=response.ok&&(response.headers.get('content-type')||'').includes('text/html');await response.body?.cancel();return publicPage;}catch{return false;}
}
