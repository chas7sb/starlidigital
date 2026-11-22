/** UI port over reviewed registry core; HTTP binding intentionally waits for frozen router contract. */
export type McpServer={version:'starli.account-mcp.v1';id:string;name:string;url:string;transport:'streamable-http'|'sse';enabled:boolean;revision:number;credentialConfigured:boolean;toolCount:number;status:'UNTESTED'|'DISCOVERED'};
export type McpFields={name:string;url:string;transport:McpServer['transport'];credential?:string|null};
export interface McpRegistryPort {
 capabilities?:(signal:AbortSignal)=>Promise<McpCapabilities>;
 list(cursor:string,signal:AbortSignal):Promise<{items:McpServer[];hasMore:boolean;cursor:string}>;
 get?:(id:string,signal:AbortSignal)=>Promise<McpServer>;
 create(fields:McpFields,signal:AbortSignal):Promise<McpServer>;
 update(id:string,fields:McpFields&{expectedRevision:number},signal:AbortSignal):Promise<McpServer>;
 enable(id:string,expectedRevision:number,enabled:boolean,signal:AbortSignal):Promise<McpServer>;
 remove(id:string,expectedRevision:number,signal:AbortSignal):Promise<void>;
 discover?:(id:string,expectedRevision:number,signal:AbortSignal)=>Promise<McpServer>;
 test?:(id:string,expectedRevision:number,signal:AbortSignal)=>Promise<{tested:true;id:string;revision:number;toolCount:number}>;
}
export type McpCapabilities={version:'starli.account-mcp.v1';accountWide:true;maxServerCount:null;pageLimit:50;transports:{'streamable-http':boolean;sse:boolean;stdio:false};remoteConnected:boolean};
export function decodeMcpCapabilities(x:any):McpCapabilities {
 if(x?.version!=='starli.account-mcp.v1'||x.accountWide!==true||x.maxServerCount!==null||x.pageLimit!==50||typeof x.transports?.['streamable-http']!=='boolean'||typeof x.transports?.sse!=='boolean'||x.transports?.stdio!==false||typeof x.remoteConnected!=='boolean')throw Error('MCP_RESPONSE_INVALID');
 return {version:x.version,accountWide:true,maxServerCount:null,pageLimit:50,transports:{'streamable-http':x.transports['streamable-http'],sse:x.transports.sse,stdio:false},remoteConnected:x.remoteConnected};
}
export function decodeMcpServer(value:any):McpServer {
 if(value?.version!=='starli.account-mcp.v1'||typeof value.id!=='string'||!/^mcp_[a-f0-9]{32}$/.test(value.id)||
  typeof value.name!=='string'||!value.name.trim()||value.name.length>100||!validRemoteUrl(value.url)||
  !['streamable-http','sse'].includes(value.transport)||typeof value.enabled!=='boolean'||typeof value.credentialConfigured!=='boolean'||
  !Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.toolCount)||value.toolCount<0||value.toolCount>200||!['UNTESTED','DISCOVERED'].includes(value.status))throw Error('MCP_RESPONSE_INVALID');
 return {version:value.version,id:value.id,name:value.name,url:value.url,transport:value.transport,enabled:value.enabled,revision:value.revision,credentialConfigured:value.credentialConfigured,toolCount:value.toolCount,status:value.status};
}
export function validRemoteUrl(value:unknown):value is string {
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443');}catch{return false;}
}
export function mcpFields(name:string,url:string,transport:McpServer['transport'],credential:string,clearCredential=false):McpFields {
 if(!name.trim()||name.length>100||!validRemoteUrl(url)||!['streamable-http','sse'].includes(transport)||credential.length>8192||/[\u0000-\u001f\u007f]/.test(credential))throw Error('MCP_ARGUMENTS_INVALID');
 return {name:name.trim(),url,transport,...(clearCredential?{credential:null}:credential?{credential}: {})};
}
export function mcpError(error:any):string {
 const code=typeof error?.code==='string'?error.code:error?.message;
 return code==='MCP_REVISION_CONFLICT'?'This connection changed elsewhere. Refresh before saving; your non-secret edits are kept.':
  code==='MCP_ARGUMENTS_INVALID'?'Enter a name and a valid HTTPS endpoint without credentials, query, or fragment.':
  code==='MCP_RESPONSE_INVALID'?'The MCP service returned an unsupported response.':
  code==='MCP_AUTH_REQUIRED'?'Sign in again to manage your MCP connections.':
  'The MCP service could not complete this request. No connection result is confirmed.';
}
export function mcpRequestFence(){let n=0,c:AbortController|null=null;return {begin(){c?.abort();c=new AbortController();const id=++n,active=c;return {signal:active.signal,current:()=>id===n&&!active.signal.aborted}},clear(){n++;c?.abort();c=null}};}
/** Exact HTTP-CONTRACT e62cb0ca; native bearer only, no account/agent/schema claims. */
export function createMcpRegistryClient(token:()=>string,request:typeof fetch=fetch):McpRegistryPort {
 const prefix='/api/v1/starli/mcp';
 const serverPath=(id:string)=>{if(!/^mcp_[a-f0-9]{32}$/.test(id))throw Error('MCP_ARGUMENTS_INVALID');return '/servers/'+id;};
 async function call(path:string,signal:AbortSignal,method='GET',body?:object){
  const auth=token();if(!auth)throw Error('MCP_AUTH_REQUIRED');
  const response=await request(prefix+path,{method,signal,cache:'no-store',redirect:'error',headers:{Authorization:'Bearer '+auth,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('MCP_RESPONSE_INVALID');
  const value=await response.json().catch(()=>null);
  if(!response.ok){const code=[401,403].includes(response.status)?'MCP_AUTH_REQUIRED':typeof value?.detail==='string'&&/^MCP_[A-Z_]{1,80}$/.test(value.detail)?value.detail:'MCP_SERVICE_UNAVAILABLE';throw Error(code);}
  return value;
 }
 function updated(value:any,id:string,revision:number){const server=decodeMcpServer(value);if(server.id!==id||server.revision<=revision)throw Error('MCP_RESPONSE_INVALID');return server;}
 const revision=(value:number)=>{if(!Number.isSafeInteger(value)||value<1)throw Error('MCP_ARGUMENTS_INVALID');return value;};
 const fields=(value:McpFields)=>mcpFields(value.name,value.url,value.transport,value.credential??'',value.credential===null);
 return {
  async capabilities(signal){return decodeMcpCapabilities(await call('/capabilities',signal));},
  async get(id,signal){const server=decodeMcpServer(await call(serverPath(id),signal));if(server.id!==id)throw Error('MCP_RESPONSE_INVALID');return server;},
  async list(cursor,signal){const value=await call('/servers?'+new URLSearchParams({after:cursor,limit:'50'}),signal);if(!Array.isArray(value?.items)||value.items.length>50||typeof value.hasMore!=='boolean'||typeof value.cursor!=='string'||value.cursor.length>180||(value.hasMore&&(!value.cursor||value.cursor===cursor)))throw Error('MCP_RESPONSE_INVALID');return {items:value.items.map(decodeMcpServer),hasMore:value.hasMore,cursor:value.cursor};},
  async create(input,signal){const server=decodeMcpServer(await call('/servers',signal,'POST',fields(input)));if(server.enabled||server.revision!==1)throw Error('MCP_RESPONSE_INVALID');return server;},
  async update(id,input,signal){return updated(await call(serverPath(id),signal,'PATCH',{...fields(input),expectedRevision:revision(input.expectedRevision)}),id,input.expectedRevision);},
  async enable(id,expected,enabled,signal){if(typeof enabled!=='boolean')throw Error('MCP_ARGUMENTS_INVALID');const server=updated(await call(serverPath(id)+(enabled?'/enable':'/disable'),signal,'POST',{expectedRevision:revision(expected)}),id,expected);if(server.enabled!==enabled)throw Error('MCP_RESPONSE_INVALID');return server;},
  async remove(id,expected,signal){const value=await call(serverPath(id),signal,'DELETE',{expectedRevision:revision(expected)});if(value?.deleted!==true||value.id!==id)throw Error('MCP_RESPONSE_INVALID');},
  async test(id,expected,signal){const v=await call(serverPath(id)+'/test',signal,'POST',{expectedRevision:revision(expected)});if(v?.tested!==true||v.id!==id||v.revision!==expected||!Number.isSafeInteger(v.toolCount)||v.toolCount<0||v.toolCount>200)throw Error('MCP_RESPONSE_INVALID');return {tested:true,id,revision:expected,toolCount:v.toolCount};},
  async discover(id,expected,signal){const v=await call(serverPath(id)+'/discover',signal,'POST',{expectedRevision:revision(expected)});if(v?.tested!==true)throw Error('MCP_RESPONSE_INVALID');return updated(v.server,id,expected);}
 };
}
