import {readFileSync,mkdirSync} from 'node:fs';import {join,extname} from 'node:path';import {createHash,timingSafeEqual} from 'node:crypto';import {createServer} from 'node:http';import {parseArgs} from 'node:util';import {DatabaseSync} from 'node:sqlite';import {loadModelBuild} from './model-build-loader.mjs';import {createCollectionRoutes} from './collections.mjs';
const {values:v}=parseArgs({options:{config:{type:'string'}}}),sha=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status})};
try{
 for(const k of ['GB3_NATIVE_JWT','WEBUI_SECRET_KEY','STARLI_AUTHORITY_MASTER_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY'])if(process.env[k])fail('PRIVILEGED_APP_ENVIRONMENT',503);
 const c=JSON.parse(readFileSync(v.config));const key=process.env.STARLI_APP_AUTHORITY_KEY;if(typeof key!=='string'||key.length<32)fail('APP_AUTHORITY_KEY_REQUIRED',503);
 const build=loadModelBuild(c.build);
 if(build.receipt.artifactDigest!==c.artifactDigest||build.spec.appId!==c.buildId)fail('APP_BUILD_CONFIG_MISMATCH',503);
 if(!c.storageNamespace||!c.authorityURL||new URL(c.parentOrigin).origin!==c.parentOrigin)fail('APP_TRUSTED_CONFIG_REQUIRED',503);
 const cookieName='starli_app_'+sha(c.buildId).slice(0,16);
 const root=join(c.dataRoot,sha(c.storageNamespace));mkdirSync(root,{recursive:true,mode:0o700});const dbPath=join(root,'app.sqlite'),db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS authority_fence(id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL,revision INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS app_write_log(subject TEXT NOT NULL,at_ms INTEGER NOT NULL)');
 let origin;
 const headers={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors "+c.parentOrigin+"; base-uri 'none'; form-action 'self'"};
 const send=(res,status,value,extra={})=>{res.writeHead(status,{...headers,'content-type':'application/json',...extra});res.end(JSON.stringify(value))};
 async function parse(req,limit=16384){if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('JSON_REQUIRED',415);let text='',size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)fail('BODY_TOO_LARGE',413);text+=chunk}try{return JSON.parse(text)}catch{fail('BAD_JSON',400)}}
 async function rpc(action,payload){const response=await fetch(c.authorityURL+'/'+action,{method:'POST',headers:{'content-type':'application/json','X-Starli-App-Authority':key},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000)});if(!response.ok)fail('APP_SESSION_DENIED',response.status>=500?503:403);return await response.json()}
 function token(req){return(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)}
 function validate(value,permission){
  const a=value.actor;if(a&&typeof a.authorizationRevision==='string'&&/^[0-9]+$/.test(a.authorizationRevision))a.authorizationRevision=Number(a.authorizationRevision);if(!a||a.buildId!==c.buildId||a.artifactDigest!==c.artifactDigest||a.leaseId!==c.leaseId||a.storageNamespace!==c.storageNamespace||!Number.isSafeInteger(a.generation)||a.generation<c.generation||!Number.isSafeInteger(a.authorizationRevision)||!a.scope?.includes(permission)||!['GUEST_TEMPORARY','VERIFIED_REGISTERED_PERSON'].includes(a.principalKind))fail('APP_ACTOR_SCOPE_DENIED');
  return a;
 }
 async function authorized(req,permission){const session=token(req);if(!session)fail('APP_SESSION_REQUIRED',401);const value=await rpc('authorize',{sessionToken:session});validate(value,permission);return value}
 const routes=createCollectionRoutes({db,schema:build.schema,routes:JSON.parse(readFileSync(join(build.dir,'native-source/backend/routes.json'))),scope:{companyId:c.storageNamespace,projectId:c.buildId},
  authorizeRead:async req=>{await authorized(req,'app:read')},
  authorizeAndCommit:async(req,commit)=>{
   if(req.headers.origin!==origin)fail('ORIGIN_DENIED');
   const value=await authorized(req,'app:write'),a=value.actor;
   const supplied=Buffer.from(String(req.headers['x-csrf-token']||'')),expected=Buffer.from(String(value.csrfToken||''));
   if(!supplied.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))fail('CSRF_DENIED');
   db.exec('BEGIN IMMEDIATE');try{
    const old=db.prepare('SELECT * FROM authority_fence WHERE id=1').get();
    if(old&&(old.generation>a.generation||old.generation===a.generation&&old.revision>a.authorizationRevision))fail('STALE_AUTHORITY_ADMISSION');
    db.prepare('INSERT INTO authority_fence VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision').run(a.generation,a.authorizationRevision);
    if(Number(db.prepare('SELECT count(*) n FROM app_write_log WHERE subject=? AND at_ms>?').get(a.subjectId,Date.now()-60000).n)>=120)fail('APP_WRITE_RATE_LIMIT',429);
    const result=commit();db.prepare('INSERT INTO app_write_log VALUES(?,?)').run(a.subjectId,Date.now());db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e}
  }});
 const server=createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://local').pathname;
   if(path==='/health')return send(res,200,{ready:true,pid:process.pid,instanceNonce:c.instanceNonce,buildId:c.buildId,artifactDigest:c.artifactDigest,origin});
   if(path==='/api/app/session/bootstrap'){
    const parent=req.headers.origin;if(parent!==c.parentOrigin)fail('PARENT_ORIGIN_DENIED');
    const cors={'access-control-allow-origin':c.parentOrigin,'access-control-allow-credentials':'true','vary':'Origin'};
    if(req.method==='OPTIONS')return send(res,204,null,{...cors,'access-control-allow-methods':'POST','access-control-allow-headers':'Content-Type'});
    if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    const body=await parse(req,8192);if(Object.keys(body).length!==1||typeof body.ticket!=='string')fail('BOOTSTRAP_TICKET_REQUIRED',422);
    const value=await rpc('redeem',{ticket:body.ticket,appOrigin:origin});validate(value,'app:read');
    if(typeof value.sessionToken!=='string'||typeof value.csrfToken!=='string')fail('AUTHORITY_SESSION_INVALID',503);
    return send(res,200,{ready:true,buildId:c.buildId,principalKind:value.actor.principalKind}, {...cors,'set-cookie':cookieName+'='+value.sessionToken+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+Math.max(0,Math.floor(value.expiresAt-Date.now()/1000))});
   }
   if(path==='/api/app/session'){if(req.method!=='GET')fail('METHOD_NOT_ALLOWED',405);const value=await authorized(req,'app:read');return send(res,200,{csrfToken:value.csrfToken,principalKind:value.actor.principalKind})}
   if(path.startsWith('/api/app/')){const result=await routes.handle(req);return send(res,result.status,result.body)}
   if(req.method!=='GET'||path.startsWith('/_native/'))fail('RESOURCE_DENIED',403);
   const file=build.dist.get(path==='/'?'/index.html':path);if(!file)fail('NOT_FOUND',404);
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(path==='/'?'/index.html':path)]||'application/octet-stream';
   res.writeHead(200,{...headers,'content-type':mime});res.end(file);
  }catch(error){send(res,error.status??500,{error:{code:/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'APP_REQUEST_FAILED'}})}
 });
 const ready=()=>{origin='http://127.0.0.1:'+server.address().port;console.log(JSON.stringify({ready:true,pid:process.pid,instanceNonce:c.instanceNonce,buildId:c.buildId,artifactDigest:c.artifactDigest,baseUrl:origin,dbPath,storageNamespace:c.storageNamespace,generatedServerCodeExecuted:false,storageImplementation:'SQLITE_DECLARATIVE_COLLECTIONS',productionReady:false}))};
 if(Number.isSafeInteger(c.listenFd))server.listen({fd:c.listenFd},ready);else server.listen(c.port??0,'127.0.0.1',ready);
 let closing=false;const stop=()=>{if(closing)return;closing=true;server.close(()=>{db.close();process.exit(0)});setTimeout(()=>process.exit(1),3000).unref()};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1}
