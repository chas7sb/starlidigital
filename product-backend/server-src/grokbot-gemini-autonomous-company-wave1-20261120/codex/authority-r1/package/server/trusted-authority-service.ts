import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AuthError, type Actor, type TrustedAppAuthority, type AuthorityKind } from './authority.ts';
import type { NativeAuthorityHost } from './native-host.ts';
export function createTrustedAuthorityService(cfg:{host:NativeAuthorityHost;internalSharedSecret:string}) {
 if(cfg.internalSharedSecret.length<32)throw new Error('INTERNAL_KEY_TOO_SHORT');
 return createServer(async(req,res)=>{
 const send=(s:number,b:unknown)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(b));};
 try {
 const supplied=Buffer.from(String(req.headers['x-starli-authority-key']||'')), expected=Buffer.from(cfg.internalSharedSecret);
 if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))throw new AuthError(403,'INTERNAL_AUTH_DENIED','Internal auth denied');
 if(req.method==='GET' && req.url==='/internal/v1/authority/meta')return send(200,{authorityKind:cfg.host.kind,executionClass:cfg.host.executionClass,authorityId:cfg.host.portable.authorityId,keyEpoch:cfg.host.portable.keyEpoch,...cfg.host.opts,masterKey:undefined,stateDir:undefined,nativeRoot:undefined});
 if(req.method!=='POST')return send(404,{error:{code:'NOT_FOUND'}});
 const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>16384)throw new AuthError(413,'BODY_TOO_LARGE','Body too large');chunks.push(c);}
 let b:any;try{b=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AuthError(400,'BAD_JSON','Bad JSON');}
 const h=cfg.host;
 switch(req.url){
 case '/internal/v1/authority/bootstrap-session':return send(200,h.bootstrap(b.ticket));
 case '/internal/v1/authority/resolve':return send(200,{actor:h.resolve(b.sessionToken)});
 case '/internal/v1/authority/csrf':return send(200,{csrfToken:h.csrf(b.actor)});
 case '/internal/v1/authority/verify-csrf':return send(200,{valid:h.verifyCsrf(b.actor,b.token)});
 case '/internal/v1/authority/admit-write':return send(200,h.admit(b.actor));
 default:return send(404,{error:{code:'NOT_FOUND'}});
 }
 }catch(e){const a=e as AuthError;send(a instanceof AuthError?a.status:503,{error:{code:a instanceof AuthError?a.code:'AUTHORITY_UNAVAILABLE',message:'Authority request denied'}});}
 });
}
export class RemoteTrustedAppAuthority implements TrustedAppAuthority {
 readonly kind:AuthorityKind='REMOTE_NATIVE_AUTHORITY'; readonly executionClass='NATIVE_NONPRODUCTION' as const;
 private opts:{baseUrl:string;sharedSecret:string};
 constructor(opts:{baseUrl:string;sharedSecret:string}){this.opts=opts;const u=new URL(opts.baseUrl);if(u.protocol!=='https:' && !(u.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('PRIVATE_AUTHORITY_TRANSPORT_REQUIRED');}
 private async post(path:string,payload:unknown):Promise<any>{let res;try{res=await fetch(this.opts.baseUrl+path,{method:'POST',headers:{'Content-Type':'application/json','X-Starli-Authority-Key':this.opts.sharedSecret},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000),redirect:'error'});}catch{throw new AuthError(403,'AUTHORITY_UNAVAILABLE','Trusted authority unavailable');}const d=await res.json();if(!res.ok)throw new AuthError(res.status,d.error?.code||'AUTHORITY_DENIED','Authority denied');return d;}
 async bootstrapSession(ticket:string){return this.post('/internal/v1/authority/bootstrap-session',{ticket});}
 async resolve(sessionToken:string|undefined):Promise<Actor>{return (await this.post('/internal/v1/authority/resolve',{sessionToken})).actor;}
 async csrfToken(actor:Actor){return (await this.post('/internal/v1/authority/csrf',{actor})).csrfToken;}
 async verifyCsrf(actor:Actor,token:string|undefined){return (await this.post('/internal/v1/authority/verify-csrf',{actor,token})).valid===true;}
 async assertWriteAdmission(actor:Actor){return this.post('/internal/v1/authority/admit-write',{actor});}
}
