import {validateGuestWorkspace} from './guest-workspace-client.ts';
const validIntent=(s:string)=>/^[a-f0-9]{40}$/i.test(s);
export async function readClaimedConversation(intentId:string,authToken:string,signal:AbortSignal,fetcher:typeof fetch=fetch){
 if(!validIntent(intentId)||!authToken)throw Error('A verified signed-in session is required.');
 const response=await fetcher('/api/v1/starli/grokbot1/claims/'+encodeURIComponent(intentId)+'/conversation',{
  method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+authToken,Accept:'application/json'},
  signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])
 });
 if(!response.ok){const error=Error('The complete claimed conversation could not be verified.');Object.assign(error,{status:response.status});throw error;}
 return validateGuestWorkspace(await response.json(),intentId);
}
export type AppAuthorityBinding={
 buildId:string;artifactDigest:string;leaseId:string;generation:number;authorizationRevision:string|number;
 companyId:string;projectId:string;
};
export function validateAppTicket(raw:any,expected:AppAuthorityBinding,owner:boolean,nowSeconds:number){
 const actor=raw?.actor;
 if(!raw||typeof raw.bootstrapTicket!=='string'||!raw.bootstrapTicket||raw.buildId!==expected.buildId||
 !Number.isFinite(raw.expiresAt)||raw.expiresAt<=nowSeconds||!actor||
 actor.principalKind!==(owner?'VERIFIED_REGISTERED_PERSON':'GUEST_TEMPORARY')||
 actor.buildId!==expected.buildId||actor.artifactDigest!==expected.artifactDigest||actor.leaseId!==expected.leaseId||
 !Number.isInteger(actor.generation)||actor.generation!==expected.generation||
 String(actor.authorizationRevision)!==String(expected.authorizationRevision)||
 actor.currentCompanyId!==expected.companyId||actor.currentProjectId!==expected.projectId||
 typeof actor.subjectId!=='string'||!actor.subjectId||
 !Array.isArray(actor.scope)||!actor.scope.includes('app:read')||!actor.scope.includes('app:write'))
 throw Error('The application ticket does not match this workspace and build.');
 return {bootstrapTicket:raw.bootstrapTicket,expiresAt:raw.expiresAt,buildId:raw.buildId};
}
export async function issueBoundAppTicket(opts:{
 intentId:string;expected:AppAuthorityBinding;owner:boolean;authToken?:string;signal:AbortSignal;fetcher?:typeof fetch;
}){
 if(!validIntent(opts.intentId)||!opts.expected.buildId||(opts.owner&&!opts.authToken))throw Error('A verified application binding is required.');
 const prefix=opts.owner?'/api/v1/starli/grokbot1/claims/':'/api/v1/starli/public/grokbot1/intents/';
 const response=await (opts.fetcher||fetch)(prefix+encodeURIComponent(opts.intentId)+'/builds/'+encodeURIComponent(opts.expected.buildId)+'/ticket',{
  method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json',Accept:'application/json',...(opts.owner?{'X-Starli-Claim':'1',Authorization:'Bearer '+opts.authToken}:{'X-Starli-Guest-Intent':'1'})},
  body:'{}',signal:AbortSignal.any([opts.signal,AbortSignal.timeout(15000)])
 });
 if(!response.ok)throw Error('Application access could not be authorized.');
 return validateAppTicket(await response.json(),opts.expected,opts.owner,Date.now()/1000);
}


export function modelPreviewTransport(build:any,intentId:string,parentOrigin:string,owner=false){
 const p=build?.preview;
 if(build?.intentId!==intentId||build?.status!=='READY'||p?.status!=='READY'||
 p.previewId!==build.buildId||!/^[a-f0-9]{64}$/i.test(p.artifactDigest||'')||!Number.isInteger(p.generation)||p.generation<1)
  throw Error('The model application is not ready.');
 const frame=new URL(p.previewUrl),bootstrap=new URL(p.bootstrapUrl),parent=new URL(parentOrigin);
 if(frame.origin===parent.origin||frame.username||frame.password||frame.search||frame.hash||frame.pathname!=='/'||
 bootstrap.origin!==frame.origin||bootstrap.pathname!=='/api/app/session/bootstrap'||bootstrap.search||bootstrap.hash||bootstrap.username||bootstrap.password||
 !(frame.protocol==='https:'||(frame.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(frame.hostname))))
 throw Error('The app must use its approved dedicated origin.');
 const ticketPath=(owner?'/api/v1/starli/grokbot1/claims/':'/api/v1/starli/public/grokbot1/intents/')+encodeURIComponent(intentId)+'/builds/'+encodeURIComponent(build.buildId)+'/ticket';
 if(owner?p.ticketPrincipalKind!=='VERIFIED_REGISTERED_PERSON':p.ticketPrincipalKind&&p.ticketPrincipalKind!=='GUEST_TEMPORARY')throw Error('The application ticket principal does not match this workspace.');
 const advertised=new URL(p.ticketUrl,parentOrigin);
 if(advertised.origin!==parent.origin||advertised.pathname!==ticketPath||advertised.search||advertised.hash)
  throw Error('The application ticket route could not be verified.');
 return {frameUrl:frame.href,bootstrapUrl:bootstrap.href,appOrigin:frame.origin,artifactDigest:p.artifactDigest,generation:p.generation};
}
export async function bootstrapModelPreview(opts:{
 build:any;intentId:string;companyId:string;projectId:string;owner:boolean;authToken?:string;
 parentOrigin:string;signal:AbortSignal;fetcher?:typeof fetch
}){
 const transport=modelPreviewTransport(opts.build,opts.intentId,opts.parentOrigin,opts.owner),fetcher=opts.fetcher||fetch;
 const prefix=opts.owner?'/api/v1/starli/grokbot1/claims/':'/api/v1/starli/public/grokbot1/intents/';
 const issued=await fetcher(prefix+encodeURIComponent(opts.intentId)+'/builds/'+encodeURIComponent(opts.build.buildId)+'/ticket',{
  method:'POST',credentials:'same-origin',cache:'no-store',body:'{}',
  headers:{'Content-Type':'application/json',Accept:'application/json',...(opts.owner?{'X-Starli-Claim':'1',Authorization:'Bearer '+opts.authToken}:{'X-Starli-Guest-Intent':'1'})},
  signal:opts.signal
 });
 if(!issued.ok)throw Error('Application access could not be authorized.');
 const ticket=await issued.json(),actor=ticket?.actor;
 const expected={buildId:opts.build.buildId,artifactDigest:transport.artifactDigest,leaseId:actor?.leaseId,
 generation:transport.generation,authorizationRevision:actor?.authorizationRevision,companyId:opts.companyId,projectId:opts.projectId};
 if(typeof expected.leaseId!=='string'||!expected.leaseId||(expected.authorizationRevision===undefined||expected.authorizationRevision===null||String(expected.authorizationRevision)==='')||
 (opts.owner&&!opts.authToken))throw Error('The application lease could not be verified.');
 const bound=validateAppTicket(ticket,expected,opts.owner,Date.now()/1000);
 const response=await fetcher(transport.bootstrapUrl,{
  method:'POST',credentials:'include',mode:'cors',cache:'no-store',
  headers:{'Content-Type':'application/json',Accept:'application/json'},
  body:JSON.stringify({ticket:bound.bootstrapTicket}),signal:opts.signal
 });
 if(response.status!==200)throw Error('The application session could not be established.');
 const session=await response.json();
 if(session?.ready!==true||session.buildId!==opts.build.buildId||session.principalKind!==actor.principalKind)
  throw Error('The application session does not match this authorized build.');
 return {...transport,leaseId:actor.leaseId,principalKind:actor.principalKind,generation:actor.generation};
}
