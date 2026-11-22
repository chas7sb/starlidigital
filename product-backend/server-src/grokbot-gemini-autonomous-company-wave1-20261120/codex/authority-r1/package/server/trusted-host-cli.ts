import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { PortableAppAuthority } from './portable-authority.ts';
import { CanonicalLeaseStore } from './lease-store.ts';
import { verifyNativeJwt } from './native-authority.ts';
import { NativeAuthorityHost } from './native-host.ts';
import { createTrustedAuthorityService } from './trusted-authority-service.ts';
const [cmd,...args]=process.argv.slice(2);
const {values:v}=parseArgs({args,options:Object.fromEntries(['state-dir','native-root','company','project','lease-id','artifact-digest','generation','port','ttl'].map(k=>[k,{type:'string'}]))});
const need=(k:string)=>{const x=v[k];if(typeof x!=='string'||!x)throw new Error('--'+k+' required');return x;};
const out=(x:unknown)=>console.log(JSON.stringify(x));
try {
 const stateDir=resolve(need('state-dir'));
 if(cmd==='register-lease'){out(new CanonicalLeaseStore(join(stateDir,'lease-registry.sqlite')).registerLease({leaseId:need('lease-id'),companyId:need('company'),projectId:need('project'),artifactDigest:need('artifact-digest'),processGeneration:Number(need('generation'))}));}
 else if(cmd==='deactivate-lease'){out(new CanonicalLeaseStore(join(stateDir,'lease-registry.sqlite')).deactivateLease(need('lease-id')));}
 else {
 const nativeRoot=resolve(need('native-root')),masterKey=process.env.STARLI_AUTHORITY_MASTER_KEY||'';
 if(cmd==='provision'||cmd==='recover'){
 const opts={stateDir,masterKey,pinnedStorePath:join(nativeRoot,'data/company-authority.sqlite3')};
 const anchor=cmd==='provision'?PortableAppAuthority.provision(opts):PortableAppAuthority.recover(opts);
 CanonicalLeaseStore.provision(join(stateDir,'lease-registry.sqlite'));
 out({ok:true,authorityId:anchor.authorityId,keyEpoch:anchor.keyEpoch});
 } else {
 const binding={companyId:need('company'),projectId:need('project'),leaseId:need('lease-id'),artifactDigest:need('artifact-digest'),processGeneration:Number(need('generation'))};
 if(!Number.isSafeInteger(binding.processGeneration)||binding.processGeneration<1)throw new Error('BAD_GENERATION');
 const host=new NativeAuthorityHost({stateDir,nativeRoot,masterKey,...binding});
 if(cmd==='issue-ticket'){
 const verdict=verifyNativeJwt(nativeRoot,binding.companyId,process.env.GB3_NATIVE_JWT||'');
 host.leases.assertActiveLease(binding.leaseId,binding);
 const now=Date.now(),ttl=Math.min(120,Math.max(1,Number(v.ttl||120)));
 const issued=host.portable.issueTicket({...binding,userId:verdict.nativeUserId,role:verdict.role,scope:verdict.scope,authorityRevision:verdict.membershipRevision,nativeTokenHash:verdict.nativeTokenHash,nativeFamilyHash:verdict.nativeFamilyHash,nativeExp:verdict.nativeExp,issuedAt:now,expiresAt:Math.min(now+ttl*1000,verdict.nativeExp?verdict.nativeExp*1000:Infinity)});
 out({ok:true,...issued,authorityKind:host.kind,executionClass:host.executionClass});host.close();
 }else if(cmd==='start'){
 const service=createTrustedAuthorityService({host,internalSharedSecret:process.env.STARLI_APP_AUTHORITY_KEY||''});
 service.listen(Number(v.port||0),'127.0.0.1',()=>out({ready:true,pid:process.pid,port:(service.address() as any).port,authorityKind:host.kind,executionClass:host.executionClass,...binding}));
 const stop=()=>{service.close(()=>{host.close();process.exit(0);});setTimeout(()=>process.exit(1),2000).unref();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
 }else throw new Error('UNKNOWN_COMMAND');
 }
 }
}catch(e){console.error(JSON.stringify({error:(e as any).code||'ERROR',message:(e as Error).message}));process.exit(1);}
