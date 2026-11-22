import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {publicIPv4} from '../scoped-web/policy.mjs';
const require=createRequire('/opt/starlidigital/account-mcp-sdk/releases/sdk-1.32.2/package.json');
const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const {StreamableHTTPClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const {SSEClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/sse.js'));
export class McpFault extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new McpFault(code)};
export function validateURL(value){
 let u;try{u=new URL(value)}catch{fail('MCP_URL_INVALID')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.port&&u.port!=='443'||!u.hostname||u.hostname.endsWith('.'))fail('MCP_URL_DENIED');
 return u;
}
export function pinnedFetch(configuration,{authorize,resolve=async host=>(await dns.lookup(host,{all:true,family:4})).map(x=>x.address),addressPolicy=publicIPv4,requestFactory,allowFixtureHTTP=false}={}){
 const initial=allowFixtureHTTP?new URL(configuration.url):validateURL(configuration.url);
 const active=new Set();let closed=false;
 async function fetcher(input,init={}){
  if(closed||init.signal?.aborted)fail("MCP_CANCELLED");
  await authorize();
  if(closed||init.signal?.aborted)fail("MCP_CANCELLED");
  const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(u.origin!==initial.origin||u.username||u.password||u.hash||!['https:',...(allowFixtureHTTP?['http:']:[])].includes(u.protocol))fail('MCP_ORIGIN_DENIED');
  const addresses=await resolve(u.hostname);
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||!addresses.every(addressPolicy))fail('MCP_DNS_DENIED');
  if(closed||init.signal?.aborted)fail("MCP_CANCELLED");
  const approved=new Set(addresses);await authorize();
  if(closed||init.signal?.aborted)fail("MCP_CANCELLED");
  const headers=new Headers(init.headers||{});
  const safe={};
  for(const key of ['accept','content-type','mcp-session-id','mcp-protocol-version','last-event-id'])if(headers.has(key))safe[key]=headers.get(key);
  if(configuration.credential)safe.authorization='Bearer '+configuration.credential;
  const method=init.method||'GET';
  if(!['GET','POST','DELETE'].includes(method))fail('MCP_METHOD_DENIED');
  if(init.body!==undefined&&typeof init.body!=='string')fail('MCP_BODY_INVALID');
  if(Buffer.byteLength(init.body||'')>65536)fail('MCP_ARGUMENT_LIMIT');
  return await new Promise((resolveResponse,reject)=>{
   const client=u.protocol==='https:'?https:http;
   const req=(requestFactory||client.request)(u,{method,agent:false,rejectUnauthorized:true,headers:safe,
    lookup:(_host,options,callback)=>options.all?callback(null,[{address:addresses[0],family:4}]):callback(null,addresses[0],4)},res=>{
     const peer=req.socket?.remoteAddress?.replace(/^::ffff:/,'');
     if(!approved.has(peer)||!addressPolicy(peer)){req.destroy(new McpFault('MCP_PEER_DENIED'));reject(new McpFault('MCP_PEER_DENIED'));return}
     if(res.statusCode>=300&&res.statusCode<400){req.destroy(new McpFault('MCP_REDIRECT_DENIED'));reject(new McpFault('MCP_REDIRECT_DENIED'));return}
     let size=0;
     const source=(async function*(){try{for await(const chunk of res){size+=chunk.length;if(size>1048576)fail('MCP_OUTPUT_LIMIT');await authorize();yield chunk}}finally{req.destroy()}})();
     const stream=Readable.toWeb(Readable.from(source));
     const responseHeaders=new Headers();
     for(const key of ['content-type','mcp-session-id','mcp-protocol-version'])if(typeof res.headers[key]==='string')responseHeaders.set(key,res.headers[key]);
     // Fetch Response forbids a body for these status codes.
     resolveResponse(new Response([204,205,304].includes(res.statusCode)?null:stream,{status:res.statusCode,headers:responseHeaders}));
   });
   active.add(req);req.once('close',()=>active.delete(req));req.once('error',reject);
   req.setTimeout(10000,()=>req.destroy(new McpFault('MCP_TIMEOUT')));
   const abort=()=>req.destroy(new McpFault('MCP_CANCELLED'));init.signal?.addEventListener('abort',abort,{once:true});
   req.once('close',()=>init.signal?.removeEventListener('abort',abort));if(init.signal?.aborted)abort();
   req.end(init.body);
  });
 }
 fetcher.close=async()=>{
  closed=true;
  const requests=[...active];
  await Promise.all(requests.map(req=>new Promise(resolve=>{req.once('close',resolve);req.destroy();if(req.closed)resolve()})));
 };
 return fetcher;
}
export async function remoteOperation(configuration,request,{authorize,...options}={}){
 const fetch=pinnedFetch(configuration,{authorize,...options});
 const client=new Client({name:'starli-account-mcp',version:'1.0.0'},{capabilities:{}});
 const transport=configuration.transport==='streamable-http'?new StreamableHTTPClientTransport(new URL(configuration.url),{fetch,reconnectionOptions:{maxRetries:0}}):
  configuration.transport==='sse'?new SSEClientTransport(new URL(configuration.url),{fetch,eventSourceInit:{fetch}}):fail('MCP_TRANSPORT_UNAVAILABLE');
 const deadline=setTimeout(()=>{void client.close();void fetch.close()},20000);
 try{
  await authorize();await client.connect(transport,{timeout:10000});
  if(request.action==='discover'){
   const tools=[];let cursor;const seen=new Set();
   do{
    await authorize();const page=await client.listTools(cursor?{cursor}:{},{timeout:10000});
    tools.push(...page.tools);if(tools.length>200)fail('MCP_TOOL_LIMIT');
    cursor=page.nextCursor;if(cursor&&seen.has(cursor))fail('MCP_CURSOR_INVALID');seen.add(cursor);
    if(seen.size>20)fail('MCP_TOOL_LIMIT');
   }while(cursor);
   await authorize();return tools;
  }
  if(request.action==='invoke'){
   await authorize();
   const result=await client.callTool({name:request.name,arguments:request.arguments},undefined,{timeout:10000});
   if(Buffer.byteLength(JSON.stringify(result))>1048576)fail('MCP_OUTPUT_LIMIT');
   await authorize();return result;
  }
  fail('MCP_ACTION_INVALID');
 }finally{clearTimeout(deadline);try{await client.close()}finally{await fetch.close()}}
}
