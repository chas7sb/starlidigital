import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPreviewLifecycle} from './lifecycle.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const key=process.env.STARLI_PREVIEW_CONTROL_KEY||'';if(key.length<32)throw Error('PREVIEW_CONTROL_KEY_REQUIRED');
if(!process.env.STARLI_INSTANCE_NONCE)throw Error('INSTANCE_NONCE_REQUIRED');
const {resolveVerifiedBuild}=await import(pathToFileURL(config.buildResolver).href);
const lifecycle=createPreviewLifecycle({...config,resolveVerifiedBuild});
const server=createServer(async(req,res)=>{
 const send=(s,b)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(b));};
 if(req.method==='GET'&&req.url==='/instance')return send(200,{instanceNonce:process.env.STARLI_INSTANCE_NONCE,pid:process.pid});
 try{
  const a=Buffer.from(req.headers['x-starli-preview-key']||''),b=Buffer.from(key);if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('PREVIEW_CONTROL_AUTH_DENIED');
  const action=req.url?.split('/').pop();if(req.method!=='POST'||!['open','bootstrap','restart','stop','cleanup'].includes(action))return send(404,{error:{code:'NOT_FOUND'}});
  let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>16384)throw Error('BODY_TOO_LARGE');chunks.push(c);}const body=JSON.parse(Buffer.concat(chunks));
  if(Object.keys(body).some(k=>!['intentId','nativeJwt'].includes(k))||typeof body.intentId!=='string'||(action!=='cleanup'&&typeof body.nativeJwt!=='string'))throw Error('EXACT_NATIVE_REQUEST_REQUIRED');
  send(200,await lifecycle[action](body));
 }catch(e){const code=e.code||e.message||'PREVIEW_DENIED';if(req.url?.endsWith('/open')&&['ACTUAL_NATIVE_BUILD_REQUIRED','TWO_VERIFIED_NATIVE_WORKERS_REQUIRED'].includes(code))send(202,{status:'BUILD_PENDING',authorityState:'PENDING',statusMessage:'Your app is being built.'});else send(403,{error:{code}});}
});
server.listen(config.port??0,'127.0.0.1',()=>console.log(JSON.stringify({ready:true,pid:process.pid,port:server.address().port,instanceNonce:process.env.STARLI_INSTANCE_NONCE})));
let closing=false;const stop=async()=>{if(closing)return;closing=true;await lifecycle.close();server.close(()=>process.exit(0));};process.on('SIGTERM',stop);process.on('SIGINT',stop);
