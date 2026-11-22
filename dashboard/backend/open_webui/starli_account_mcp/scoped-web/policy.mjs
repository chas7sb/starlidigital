import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createHash} from 'node:crypto';
export class PolicyError extends Error {constructor(code){super(code);this.code=code;}}
export const fail=code=>{throw new PolicyError(code);};
export const requirePolicy=(ok,code)=>{if(!ok)fail(code);};
export function exact(value,keys,code='CONFIG_INVALID'){
 requirePolicy(value&&typeof value==='object'&&!Array.isArray(value),code);
 requirePolicy(Object.keys(value).every(k=>keys.includes(k)),code);
}
export function identifier(v){requirePolicy(typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v)&&!v.includes('..'), 'IDENTITY_INVALID');return v;}
export function json(value){
 const seen=new Set();
 function clean(v){
  if(v===null||typeof v==='string'||typeof v==='boolean')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  requirePolicy(v&&typeof v==='object'&&!seen.has(v),'ARGUMENTS_INVALID');seen.add(v);
  let result;
  if(Array.isArray(v))result=v.map(clean);
  else {
   requirePolicy([Object.prototype,null].includes(Object.getPrototypeOf(v)),'ARGUMENTS_INVALID');
   requirePolicy(!Object.keys(v).some(k=>['__proto__','constructor','prototype'].includes(k)),'ARGUMENTS_INVALID');
   result=Object.fromEntries(Object.keys(v).sort().map(k=>[k,clean(v[k])]));
  }
  seen.delete(v);return result;
 }
 const text=JSON.stringify(clean(value));requirePolicy(Buffer.byteLength(text)<=32768,'ARGUMENTS_TOO_LARGE');return text;
}
export const digest=value=>createHash('sha256').update(json(value)).digest('hex');
export async function noLinks(value){
 const absolute=path.resolve(value);let p=path.parse(absolute).root;
 for(const part of absolute.slice(p.length).split(path.sep).filter(Boolean)){
  p=path.join(p,part);const st=await fs.lstat(p);requirePolicy(!st.isSymbolicLink(),'SYMLINK_DENIED');
 }
 requirePolicy(await fs.realpath(absolute)===absolute,'PATH_NOT_CANONICAL');return absolute;
}
export function publicIPv4(value){
 if(net.isIP(value)!==4)return false;
 const a=value.split('.').map(Number),[x,y,z]=a;
 return !(x===0||x===10||x===127||x>=224||x===100&&y>=64&&y<=127||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&(y===168||y===0||y===2)||x===198&&(y===18||y===19||y===51&&z===100)||x===203&&y===0&&z===113);
}
export function webURL(value,hosts){
 requirePolicy(typeof value==='string'&&value.length<=4096,'URL_INVALID');let u;
 try{u=new URL(value);}catch{fail('URL_INVALID');}
 const host=u.hostname.toLowerCase();
 requirePolicy(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!u.hash,'URL_DENIED');
 requirePolicy(net.isIP(host)===0&&!host.startsWith('[')&&host!=='localhost'&&!host.endsWith('.localhost')&&!host.endsWith('.local')&&!/^[0-9.]+$/.test(host),'IP_OR_LOCAL_HOST_DENIED');
 requirePolicy(!/%(?:2e|2f|5c|25)/i.test(u.pathname)&&!u.pathname.includes('\\'),'ENCODED_PATH_DENIED');
 const allowed=hosts.find(h=>h.host===host);
 requirePolicy(allowed&&allowed.pathPrefixes.some(p=>p==='/'||u.pathname===p||u.pathname.startsWith(p+'/')),'HOST_OR_PATH_DENIED');
 return u;
}
export function privateSearchOrigin(value){
 let u;try{u=new URL(value);}catch{fail('SEARCH_ORIGIN_INVALID');}
 requirePolicy(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port&&Number(u.port)>=1024&&Number(u.port)<=65535&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password,'SEARCH_ORIGIN_DENIED');
 return u.origin;
}
export async function validateConfiguration(raw){
 exact(raw,['version','scopeBase','search','servers']);requirePolicy(raw.version===1,'CONFIG_VERSION_INVALID');
 const base=await noLinks(raw.scopeBase);requirePolicy((await fs.stat(base)).isDirectory(),'SCOPE_BASE_INVALID');
 exact(raw.search,['provider','origin']);requirePolicy(raw.search.provider==='searxng','SEARCH_PROVIDER_DENIED');
 const search={provider:'searxng',origin:privateSearchOrigin(raw.search.origin)};
 requirePolicy(raw.servers&&typeof raw.servers==='object'&&!Array.isArray(raw.servers),'SERVERS_INVALID');
 const servers=structuredClone(raw.servers);
 for(const [id,s]of Object.entries(servers)){
  identifier(id);exact(s,['kind','command','commandSHA256','args','entrypoint','entrypointSHA256','tools']);
  requirePolicy(['filesystem','git','time','memory','pi-web-access'].includes(s.kind),'SERVER_KIND_UNSUPPORTED');
  requirePolicy(typeof s.command==='string'&&path.isAbsolute(s.command)&&!/^(?:npx|npm|pip|bash|sh|curl)$/.test(path.basename(s.command))&&/^[a-f0-9]{64}$/.test(s.commandSHA256),'SERVER_COMMAND_INVALID');
  requirePolicy(Array.isArray(s.args)&&s.args.every(a=>typeof a==='string'&&a.length<=1024&&!['-e','--eval','-c'].includes(a)),'SERVER_ARGS_INVALID');
  if(s.entrypoint!==undefined)requirePolicy(path.isAbsolute(s.entrypoint)&&/^[a-f0-9]{64}$/.test(s.entrypointSHA256),'SERVER_ENTRYPOINT_INVALID');
  requirePolicy(s.tools&&typeof s.tools==='object'&&!Array.isArray(s.tools),'SERVER_TOOLS_INVALID');
  for(const [name,t]of Object.entries(s.tools)){
   identifier(name);exact(t,['effect','arguments','pathFields','urlFields']);
   requirePolicy(['read','write'].includes(t.effect)&&Array.isArray(t.arguments)&&Array.isArray(t.pathFields)&&Array.isArray(t.urlFields)&&[...t.arguments,...t.pathFields,...t.urlFields].every(k=>typeof k==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(k)),'TOOL_POLICY_INVALID');
   requirePolicy(t.pathFields.every(k=>t.arguments.includes(k))&&t.urlFields.every(k=>t.arguments.includes(k)),'TOOL_FIELDS_INVALID');
   if(s.kind==='pi-web-access')requirePolicy(name==='web_search'&&t.effect==='read','PI_WEB_CAPABILITY_UNSUPPORTED');
  }
 }
 return {version:1,scopeBase:base,search,servers};
}
export async function validateGrant(raw,config,principal){
 exact(raw,['grantId','version','tenantId','accountId','agentId','workspaceId','workspaceRoot','expiresAt','web','servers']);
 for(const name of ['grantId','tenantId','accountId','agentId','workspaceId'])identifier(raw[name]);
 requirePolicy(Number.isSafeInteger(raw.version)&&raw.version>0&&Number.isFinite(raw.expiresAt)&&raw.expiresAt>Date.now(),'GRANT_EXPIRED_OR_INVALID');
 requirePolicy(['tenantId','accountId','agentId','workspaceId'].every(k=>raw[k]===principal[k]),'SCOPE_DENIED');
 const expected=path.join(config.scopeBase,raw.tenantId,raw.accountId,raw.agentId,raw.workspaceId);
 requirePolicy(raw.workspaceRoot===expected&&await noLinks(raw.workspaceRoot)===expected,'WORKSPACE_DENIED');
 exact(raw.web,['read','search','hosts']);requirePolicy(typeof raw.web.read==='boolean'&&typeof raw.web.search==='boolean'&&Array.isArray(raw.web.hosts),'WEB_GRANT_INVALID');
 for(const h of raw.web.hosts){
  exact(h,['host','pathPrefixes']);
  requirePolicy(typeof h.host==='string'&&h.host===h.host.toLowerCase()&&!h.host.includes('*')&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(h.host)&&!net.isIP(h.host),'HOST_POLICY_INVALID');
  requirePolicy(Array.isArray(h.pathPrefixes)&&h.pathPrefixes.length&&h.pathPrefixes.every(p=>typeof p==='string'&&p.startsWith('/')&&!p.endsWith('/')||p==='/'),'PATH_POLICY_INVALID');
  for(const p of h.pathPrefixes)requirePolicy(!p.includes('..')&&!p.includes('%')&&!p.includes('\\')&&!p.includes('?')&&!p.includes('#')&&!p.startsWith('//'),'PATH_POLICY_INVALID');
 }
 requirePolicy(raw.servers&&typeof raw.servers==='object'&&!Array.isArray(raw.servers),'SERVER_GRANT_INVALID');
 for(const [server,names]of Object.entries(raw.servers))requirePolicy(config.servers[server]&&Array.isArray(names)&&new Set(names).size===names.length&&names.every(n=>config.servers[server].tools[n]),'SERVER_GRANT_INVALID');
 return structuredClone(raw);
}
export async function scopedPath(root,value){
 requirePolicy(typeof value==='string'&&value.length<=4096,'TOOL_PATH_INVALID');
 const target=path.resolve(root,value);requirePolicy(target===root||target.startsWith(root+path.sep),'WORKSPACE_ESCAPE');
 // Existing paths only in this first prepared slice; creation/artifact allocation stays unsupported.
 await noLinks(target);return target;
}
export function piWebConfiguration(searchOrigin,hosts){
 return {provider:'searxng',searxngBaseUrl:privateSearchOrigin(searchOrigin),workflow:'none',webSearch:{enabled:true,allowedProviders:['searxng']},tools:{webSearch:{enabled:true},sourceCheck:{enabled:false},fetchContent:{enabled:false},getSearchContent:{enabled:false}},openaiSearchProviders:[],allowBrowserCookies:false,autoOpenBrowser:false,githubClone:{enabled:false},githubPrIssue:{enabled:false},youtube:{enabled:false},video:{enabled:false},image:{enabled:false},pdf:{enabled:false},fetchRouting:{providers:['http'],allowRemoteHostedProviders:false},fetch:{allowedModes:['raw'],defaultMode:'raw'},fetchContent:{domainPolicy:{allow:hosts.map(h=>h.host)},redirects:'same-origin'},ssrf:{allowRanges:[],trustEnvProxy:false},maxInlineContentChars:10000};
}
export function isolatedEnvironment(workspace,state,searchOrigin){
 return {HOME:path.join(state,'home'),LOGNAME:'',USER:'',SHELL:'/bin/false',TERM:'dumb',PATH:'/usr/bin:/bin',LANG:'C.UTF-8',TZ:'UTC',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',PI_CODING_AGENT_DIR:path.join(state,'pi'),PI_WEB_ACCESS_CACHE_ROOT:path.join(state,'cache'),SEARXNG_BASE_URL:privateSearchOrigin(searchOrigin),MEMORY_FILE_PATH:path.join(state,'memory.jsonl')};
}
