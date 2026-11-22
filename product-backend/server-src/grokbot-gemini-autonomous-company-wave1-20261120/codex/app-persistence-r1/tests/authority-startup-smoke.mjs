import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';import {createInterface} from 'node:readline';import {once} from 'node:events';import {randomBytes,createHash} from 'node:crypto';import assert from 'node:assert/strict';
const stage=join(dirname(fileURLToPath(import.meta.url)),'..');const wave=join(stage,'../..');const authority=join(stage,'../authority-r1/package');const root=mkdtempSync(join(tmpdir(),'grokbot1-w1-app-startup-'));const state=join(root,'authority');mkdirSync(state);
const env={...process.env,STARLI_AUTHORITY_MASTER_KEY:randomBytes(32).toString('hex'),STARLI_APP_AUTHORITY_KEY:randomBytes(32).toString('hex')};delete env.GB3_NATIVE_JWT;delete env.WEBUI_SECRET_KEY;
const flags=['--experimental-transform-types','--no-warnings'];const children=new Set();
const evidence={executionClass:'NATIVE_AUTHORITY_ADAPTER_STARTUP_NO_REGISTERED_IDENTITY',fullRecordRestartAcceptance:false,registeredUsersCreated:0,jwtMinted:false,modelCalls:0,checks:[],productionReady:false};
function cli(args){const r=spawnSync(process.execPath,[...flags,join(authority,'server/trusted-host-cli.ts'),...args],{env,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout}
async function start(command,args,childEnv){const p=spawn(command,args,{env:childEnv,stdio:['ignore','pipe','pipe']});children.add(p);let stderr='';p.stderr.on('data',x=>stderr+=x);return await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('START_TIMEOUT')),15000);p.once('exit',()=>{clearTimeout(timer);no(Error('START_FAILED '+stderr))});createInterface({input:p.stdout}).on('line',line=>{try{const j=JSON.parse(line);if(j.ready){clearTimeout(timer);ok({p,...j})}}catch{}})})}
async function stop(x){const done=once(x.p,'exit');x.p.kill('SIGTERM');await done;children.delete(x.p)}
try{
 const python="import sys;sys.path.insert(0,sys.argv[1]);import native_harness as h;p=h.prepare_env(sys.argv[2]);n=h.load_native(p);h.ensure_native_databases(n)";
 const initialized=spawnSync('/opt/starlidigital/webui-runtime/bin/python',['-B','-c',python,join(wave,'grokbot1'),join(root,'native')],{encoding:'utf8',timeout:45000});
 assert.equal(initialized.status,0,initialized.stderr);
 const build=join(stage,'generated/component-build');const receipt=JSON.parse(readFileSync(join(build,'APP_BUILD_RECEIPT.json'),'utf8'));const b=receipt.binding;const binding=['--company',b.companyId,'--project',b.projectId,'--lease-id','startup-only-component','--artifact-digest',receipt.artifactDigest,'--generation','1'];
 const common=['--state-dir',state,'--native-root',join(root,'native')];cli(['provision',...common]);cli(['register-lease','--state-dir',state,...binding]);
 const host=await start(process.execPath,[...flags,join(authority,'server/trusted-host-cli.ts'),'start',...common,...binding,'--port','0'],env);
 const cfg={authorityPackage:authority,authorityUrl:'http://127.0.0.1:'+host.port,build,dataRoot:join(root,'app-data'),leaseId:'startup-only-component',generation:1,approvedParentOrigin:'http://127.0.0.1:18080',port:0,loopbackTest:true};
 const config=join(root,'runtime.json');writeFileSync(config,JSON.stringify(cfg));
 const appEnv={...env};delete appEnv.STARLI_AUTHORITY_MASTER_KEY;delete appEnv.WEBUI_SECRET_KEY;delete appEnv.GB3_NATIVE_JWT;
 let app=await start(process.execPath,[...flags,join(stage,'start.mjs'),'--config',config],appEnv);
 const h=await (await fetch(app.baseUrl+'/api/v1/app/health')).json();assert.equal(h.authorityKind,'REMOTE_NATIVE_AUTHORITY');assert.equal(h.executionClass,'NATIVE_NONPRODUCTION');
 const denied=await fetch(app.baseUrl+'/api/v1/customer/dogs');assert.equal(denied.status,401);
 const first=app.pid,db=app.dbPath;await stop(app);app=await start(process.execPath,[...flags,join(stage,'start.mjs'),'--config',config],appEnv);assert.notEqual(app.pid,first);assert.equal(app.dbPath,db);
 evidence.checks=['real_native_schema_initialized_no_users','real_authority_host_started','app_bound_to_native_metadata','missing_session_denied_401','independent_app_process_restart_same_db'];evidence.restart={beforePid:first,afterPid:app.pid,dbPath:db};evidence.storageImplementation='SQLITE_DISK_BACKED';evidence.authorityKind=h.authorityKind;evidence.historicalBindingOnly=true;evidence.pass=true;
 await stop(app);await stop(host);
}catch(e){evidence.pass=false;evidence.error=e.message;process.exitCode=1}
finally{for(const p of children)p.kill('SIGTERM');writeFileSync(join(stage,'evidence/authority-startup-smoke.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence))}
