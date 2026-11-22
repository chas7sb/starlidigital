import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const arg=n=>args[args.indexOf(n)+1];
const sourcePackage=resolve(arg('--package'));
const evidencePath=resolve(arg('--evidence'));
assert.ok([join(ROOT,'baseline'),join(ROOT,'package')].includes(sourcePackage));
assert.ok(evidencePath.startsWith(join(ROOT,'evidence')+'/'));
const { NativeAppAuthority }=await import(pathToFileURL(join(sourcePackage,'server/native-authority.ts')));
const { createAppServer,loadVerifiedBuild }=await import(pathToFileURL(join(sourcePackage,'server/app-server.ts')));
const { openSqlite,migrateSqlite,SqliteDogStore }=await import(pathToFileURL(join(sourcePackage,'server/storage.ts')));
const build=loadVerifiedBuild(join(sourcePackage,'generated/doglove-r3'));
const work=join(ROOT,'test-runs');
mkdirSync(work,{recursive:true});
mkdirSync(dirname(evidencePath),{recursive:true});
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report={schemaVersion:'starli.coordinator.revocation-store-regression.v1',taskId:'GGB1-COORDINATOR-REVOCATION-REPAIR-R3',startedAt:new Date().toISOString(),sourcePackage,sourceSha256:sha(join(sourcePackage,'server/native-authority.ts')),testSha256:sha(fileURLToPath(import.meta.url)),executionClass:'FIXTURE',componentsExecuted:['NativeAppAuthority','createAppServer','SqliteDogStore','node:sqlite','loopback HTTP'],fixtures:['Synthetic NativeVerdict passed to grant()','Disposable native-shaped membership/revocation SQLite stores','App-scoped opaque fixture session'],nativeJwtVerificationExecuted:false,modelCalls:0,productionModified:false,uid:process.getuid?.(),nodeVersion:process.version,checks:[]};

async function makeFixture(check){
  const dir=mkdtempSync(join(work,'case-'));
  const nativeRoot=join(dir,'native-root');
  const authorityPath=join(nativeRoot,'data/company-authority.sqlite3');
  const revocationPath=join(nativeRoot,'state/session-revocations.sqlite');
  mkdirSync(dirname(authorityPath),{recursive:true});mkdirSync(dirname(revocationPath),{recursive:true});
  const C=build.spec.binding.companyId,P=build.spec.binding.projectId,U='fixture-coordinator-user';
  const tokenHash='a'.repeat(64),familyHash='b'.repeat(64),lease='lease_coordinator_security_r3';
  let d=new DatabaseSync(authorityPath);
  d.exec('CREATE TABLE members(company_id TEXT,user_id TEXT,role TEXT,active INTEGER,revision INTEGER,kind TEXT,PRIMARY KEY(company_id,user_id))');
  d.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run(C,U,'owner',1,7,'person');d.close();
  d=new DatabaseSync(revocationPath);
  d.exec('CREATE TABLE revoked_sessions(token_hash TEXT PRIMARY KEY); CREATE TABLE revoked_session_families(family_hash TEXT,native_user_id TEXT,PRIMARY KEY(family_hash,native_user_id));');d.close();
  const db=openSqlite(join(dir,'app.sqlite'));migrateSqlite(db);
  const authority=new NativeAppAuthority(db,nativeRoot,{artifactDigest:build.receipt.artifactDigest,leaseId:lease});
  const grant=authority.grant({ok:true,nativeUserId:U,companyId:C,role:'owner',kind:'person',membershipRevision:7,scope:['dog:read','dog:write'],nativeTokenHash:tokenHash,nativeFamilyHash:familyHash,nativeExp:Math.floor(Date.now()/1000)+600,nativeAuthorityDb:authorityPath,nativeRevocationDb:revocationPath,pins:{}},{projectId:P,ttlSeconds:300,artifactDigest:build.receipt.artifactDigest,leaseId:lease});
  const store=new SqliteDogStore(db,2);
  let beforeCreate=null;
  const originalCreate=store.create.bind(store);
  store.create=async(...a)=>{if(beforeCreate){const h=beforeCreate;beforeCreate=null;await h();}return originalCreate(...a);};
  const origins=[];
  const server=createAppServer({build,store,authority,allowedOrigins:origins,executionClass:'FIXTURE',leaseId:lease,startGeneration:1});
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  const port=server.address().port,base='http://127.0.0.1:'+port;origins.push(base);
  let requestNumber=0,csrf;
  check.loopbackPort=port;
  const request=async(method,path,body)=>{
    const headers={cookie:'dl_app_session='+grant.token};
    if(method==='POST'){headers.origin=base;headers['content-type']='application/json';headers['x-csrf-token']=csrf;headers['idempotency-key']='repair-'+(++requestNumber);}
    const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
    const text=await r.text();let json;try{json=JSON.parse(text);}catch{json=null;}
    return {status:r.status,code:json?.error?.code??null,json};
  };
  const get=()=>request('GET','/api/v1/customer/dogs');
  const post=()=>request('POST','/api/v1/customer/dogs',{name:'CoordinatorFixtureDog',breed:'Akita'});
  const counts=()=>Object.fromEntries(['dogs','idempotency','write_log'].map(t=>[t,Number(db.prepare('SELECT COUNT(*) n FROM '+t).get().n)]));
  const withDb=(path,fn)=>{const q=new DatabaseSync(path);try{return fn(q);}finally{q.close();}};
  const backupRev=()=>{const backup=revocationPath+'.saved';renameSync(revocationPath,backup);return()=>{if(existsSync(revocationPath))rmSync(revocationPath,{force:true});renameSync(backup,revocationPath);};};
  const close=async()=>{
    server.closeAllConnections?.();
    await new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()));
    db.close();rmSync(dir,{recursive:true,force:true});
    check.cleanup={listenerClosed:!server.listening,fixtureDirectoryRemoved:!existsSync(dir)};
  };
  try{
    const read=await get();assert.equal(read.status,200,'Positive precondition must allow an existing session');
    const c=await request('GET','/api/v1/customer/csrf');assert.equal(c.status,200);csrf=c.json.csrfToken;assert.ok(csrf);
    const written=await post();assert.equal(written.status,201,'Positive precondition must persist a real dog');
    check.positiveBefore={get:read.status,post:written.status,counts:counts()};
  }catch(e){await close();throw e;}
  return {dir,nativeRoot,authorityPath,revocationPath,db,C,P,U,tokenHash,familyHash,get,post,counts,withDb,backupRev,close,setHook:h=>{beforeCreate=h;}};
}
const brief=r=>({status:r.status,code:r.code});
async function denyBoth(c,check,code='NATIVE_AUTHORITY_UNAVAILABLE',status=403){
  const before=c.counts(),read=await c.get(),write=await c.post(),after=c.counts();
  check.denial={before,read:brief(read),write:brief(write),after};
  assert.equal(read.status,status,'Read must deny');assert.equal(read.code,code);
  assert.equal(write.status,status,'Write must deny');assert.equal(write.code,code);
  assert.deepEqual(after,before,'Denied requests must not persist dog/idempotency/write-log effects');
}
const tests=[
['valid_store_allows_real_read_write',async(c,k)=>{const r=await c.get();assert.equal(r.status,200);assert.equal(r.json.dogs.length,1);assert.equal(r.json.dogs[0].createdBy,c.U);k.verifiedRows=r.json.dogs.length;}],
['missing_store_denies_and_does_not_recreate_file',async(c,k)=>{const restore=c.backupRev();try{await denyBoth(c,k);assert.equal(existsSync(c.revocationPath),false,'Read-only check must not create a missing DB');k.absentFileNotRecreated=true;}finally{restore();}}],
['unreadable_store_denies',async(c,k)=>{assert.notEqual(process.getuid?.(),0,'Permission test requires unprivileged execution');chmodSync(c.revocationPath,0);try{let error;try{readFileSync(c.revocationPath);}catch(e){error=e.code;}assert.equal(error,'EACCES','Verify actual OS permission denial');k.permissionProbe=error;await denyBoth(c,k);}finally{chmodSync(c.revocationPath,0o600);}}],
['corrupt_store_denies',async(c,k)=>{const restore=c.backupRev();try{writeFileSync(c.revocationPath,'not a sqlite database');await denyBoth(c,k);}finally{restore();}}],
['missing_schema_denies',async(c,k)=>{const restore=c.backupRev();try{const d=new DatabaseSync(c.revocationPath);d.exec('CREATE TABLE unrelated(x TEXT)');d.close();await denyBoth(c,k);}finally{restore();}}],
['missing_family_table_denies',async(c,k)=>{const restore=c.backupRev();try{const d=new DatabaseSync(c.revocationPath);d.exec('CREATE TABLE revoked_sessions(token_hash TEXT PRIMARY KEY)');d.close();await denyBoth(c,k);}finally{restore();}}],
['token_revocation_remains_denied',async(c,k)=>{c.withDb(c.revocationPath,d=>d.prepare('INSERT INTO revoked_sessions VALUES(?)').run(c.tokenHash));await denyBoth(c,k,'REVOKED');}],
['family_revocation_remains_denied',async(c,k)=>{c.withDb(c.revocationPath,d=>d.prepare('INSERT INTO revoked_session_families VALUES(?,?)').run(c.familyHash,c.U));await denyBoth(c,k,'REVOKED');}],
['inactive_membership_remains_denied',async(c,k)=>{c.withDb(c.authorityPath,d=>d.prepare('UPDATE members SET active=0 WHERE company_id=? AND user_id=?').run(c.C,c.U));await denyBoth(c,k,'REVOKED');}],
['changed_membership_revision_remains_denied',async(c,k)=>{c.withDb(c.authorityPath,d=>d.prepare('UPDATE members SET revision=8 WHERE company_id=? AND user_id=?').run(c.C,c.U));await denyBoth(c,k,'REVOKED');}],
['missing_membership_store_remains_denied',async(c,k)=>{renameSync(c.authorityPath,c.authorityPath+'.saved');await denyBoth(c,k);}],
['restored_valid_store_resumes_access',async(c,k)=>{const restore=c.backupRev();try{await denyBoth(c,k);}finally{restore();}const r=await c.get(),w=await c.post();assert.equal(r.status,200);assert.equal(w.status,201);k.restored={read:r.status,write:w.status,counts:c.counts()};}],
['deletion_between_resolve_and_write_admission_rolls_back',async(c,k)=>{
  const before=c.counts();let restore;let called=false;
  c.setHook(()=>{called=true;restore=c.backupRev();});
  try{const w=await c.post();k.admissionRace={hookRan:called,write:brief(w),before,after:c.counts()};assert.equal(called,true);assert.equal(w.status,403);assert.equal(w.code,'NATIVE_AUTHORITY_UNAVAILABLE');assert.deepEqual(c.counts(),before,'In-transaction admission must roll back all write effects');}finally{restore?.();}
}],
['revocation_between_resolve_and_write_admission_rolls_back',async(c,k)=>{
  const before=c.counts();let called=false;
  c.setHook(()=>{called=true;c.withDb(c.revocationPath,d=>d.prepare('INSERT INTO revoked_sessions VALUES(?)').run(c.tokenHash));});
  const w=await c.post();k.admissionRace={hookRan:called,write:brief(w),before,after:c.counts()};assert.equal(called,true);assert.equal(w.status,403);assert.equal(w.code,'REVOKED');assert.deepEqual(c.counts(),before);
}],
['expired_app_session_remains_denied',async(c,k)=>{c.db.prepare('UPDATE nx_sessions SET expires_at=?').run(new Date(Date.now()-60000).toISOString());await denyBoth(c,k,'UNAUTHENTICATED',401);}]
];
for(const [id,fn] of tests){
  const check={id,status:'RUNNING',startedAt:new Date().toISOString()};report.checks.push(check);let c;
  try{c=await makeFixture(check);await fn(c,check);check.status='PASS';}
  catch(e){check.status='FAIL';check.error={name:e.name,message:e.message,actual:e.actual,expected:e.expected};}
  finally{if(c){try{await c.close();}catch(e){check.status='FAIL';check.cleanup={error:e.message};}}check.finishedAt=new Date().toISOString();}
  console.log(check.status+' '+id);
}
report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(x=>x.status==='PASS').length;report.total=report.checks.length;report.failed=report.total-report.passed;
report.allFixturesClean=report.checks.every(x=>x.cleanup?.listenerClosed===true&&x.cleanup?.fixtureDirectoryRemoved===true);
report.overall=report.failed===0&&report.allFixturesClean?'PASS':'FAIL';
writeFileSync(evidencePath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({overall:report.overall,passed:report.passed,total:report.total,allFixturesClean:report.allFixturesClean,evidencePath,sourceSha256:report.sourceSha256}));
process.exitCode=report.overall==='PASS'?0:1;
