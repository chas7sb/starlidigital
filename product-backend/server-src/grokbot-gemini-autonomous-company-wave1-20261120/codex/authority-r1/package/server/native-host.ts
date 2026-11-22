import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { PortableAppAuthority, type ScopedAuthorityClaims } from './portable-authority.ts';
import { NativeAppAuthority, type NativeVerdict } from './native-authority.ts';
import { CanonicalLeaseStore } from './lease-store.ts';
import { AuthError, type Actor } from './authority.ts';

export class NativeAuthorityHost {
  readonly kind = 'GROKBOT1_NATIVE_ADAPTER';
  readonly executionClass = 'NATIVE_NONPRODUCTION';
  readonly portable: PortableAppAuthority;
  readonly native: NativeAppAuthority;
  readonly db: DatabaseSync;
  readonly leases: CanonicalLeaseStore;
  readonly opts: {stateDir:string; nativeRoot:string; masterKey:string; companyId:string; projectId:string; leaseId:string; artifactDigest:string; processGeneration:number};
  constructor(opts: {stateDir:string; nativeRoot:string; masterKey:string; companyId:string; projectId:string; leaseId:string; artifactDigest:string; processGeneration:number}) {
    this.opts=opts;
    this.portable=PortableAppAuthority.open({stateDir:opts.stateDir, masterKey:opts.masterKey, pinnedStorePath:join(resolve(opts.nativeRoot),'data/company-authority.sqlite3')});
    this.db=new DatabaseSync(join(opts.stateDir,'nx_sessions.sqlite'));
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS trusted_session_claims (session_hash TEXT PRIMARY KEY, claims_json TEXT NOT NULL)');
    this.native=new NativeAppAuthority(this.db,opts.nativeRoot,opts);
    this.leases=new CanonicalLeaseStore(join(opts.stateDir,'lease-registry.sqlite'));
  }
  validate(c:ScopedAuthorityClaims) {
    const integrity=this.portable.verifyHistoryIntegrity();
    if(!integrity.ok) throw new AuthError(403,integrity.code,integrity.code);
    const o=this.opts;
    if(c.authorityId!==this.portable.authorityId || c.keyEpoch!==this.portable.keyEpoch) throw new AuthError(403,'AUTHORITY_EPOCH_MISMATCH','Recovery invalidated session');
    if(c.companyId!==o.companyId || c.projectId!==o.projectId || c.audience!=='PRIVATE_SCOPED' || c.artifactDigest!==o.artifactDigest || c.leaseId!==o.leaseId || c.processGeneration!==o.processGeneration) throw new AuthError(403,'BINDING_MISMATCH','Authority binding mismatch');
    if(c.nativeExp && c.nativeExp*1000<=Date.now()) throw new AuthError(401,'NATIVE_SESSION_EXPIRED','Native session expired');
    this.leases.assertActiveLease(c.leaseId,o);
  }
  bootstrap(ticket:string) {
    const v=this.portable.verifyTicket(ticket,{...this.opts,singleUseBootstrap:true},c=>{try{this.validate(c);return {ok:true};}catch(e){return {ok:false,status:403,code:(e as AuthError).code};}});
    if(!v.ok || !v.claims)throw new AuthError(v.status,v.code,v.code);
    const c=v.claims;
    const verdict={companyId:c.companyId,nativeUserId:c.userId,role:c.role,kind:'person',scope:c.scope,membershipRevision:c.authorityRevision,nativeTokenHash:c.nativeTokenHash,nativeFamilyHash:c.nativeFamilyHash,nativeExp:c.nativeExp} as NativeVerdict;
    const issued=this.native.grant(verdict,{projectId:c.projectId,ttlSeconds:Math.min(3600,Math.floor((c.nativeExp ? c.nativeExp*1000 : Date.now()+3600000)-Date.now())/1000),artifactDigest:c.artifactDigest,leaseId:c.leaseId});
    const actor=this.native.resolve(issued.token); // fail closed against current native membership/session
    this.db.prepare('INSERT INTO trusted_session_claims VALUES (?,?)').run(actor.sessionHash,JSON.stringify(c));
    const full=this.resolve(issued.token);
    return {sessionToken:issued.token,expiresAt:issued.expiresAt,actor:full,csrfToken:this.csrf(full)};
  }
  checked(actor:Actor):Actor {
    if(!actor || typeof actor.sessionHash!=='string') throw new AuthError(401,'UNAUTHENTICATED','Canonical session required');
    const row=this.db.prepare('SELECT claims_json FROM trusted_session_claims WHERE session_hash=?').get(actor.sessionHash) as {claims_json:string}|undefined;
    if(!row)throw new AuthError(401,'UNAUTHENTICATED','Unknown canonical session');
    const c=JSON.parse(row.claims_json) as ScopedAuthorityClaims;
    this.validate(c);
    const a=this.native.resolveHash(actor.sessionHash);
    if(a.companyId!==c.companyId || a.projectId!==c.projectId || a.subjectId!==c.userId || a.authorizationRevision!==c.authorityRevision)throw new AuthError(403,'REVOKED','Session binding changed');
    return {...a,role:c.role,scope:a.scope.filter(x=>c.scope.includes(x)),processGeneration:c.processGeneration,audience:c.audience,ticketJti:c.jti,authorityEpoch:c.keyEpoch};
  }
  resolve(token:string|undefined){return this.checked(this.native.resolve(token));}
  csrf(actor:Actor){return this.native.csrfToken(this.checked(actor));}
  verifyCsrf(actor:Actor,token:string|undefined){return this.native.verifyCsrf(this.checked(actor),token);}
  admit(actor:Actor){const a=this.checked(actor);this.native.assertWriteAdmission(a);return {admitted:true,authorizationRevision:a.authorizationRevision,processGeneration:a.processGeneration,checkedAt:new Date().toISOString()};}
  close(){this.portable.close();this.db.close();}
}
