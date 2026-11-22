export interface ClaimedBuildScope {
 intentId:string; companyId:string; projectId:string; roomId:string;
}
export interface ClaimedBuildAdmission extends ClaimedBuildScope {
 graphId:string; requestId:string; originalPromptMessageId:string; sourceMessageId:string;
}
const identifier=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=256&&/^[a-zA-Z0-9_.:-]+$/.test(x);
export function validateBuildAdmission(raw:unknown,scope:ClaimedBuildScope):ClaimedBuildAdmission {
 if(!raw||typeof raw!=='object')throw Error('Invalid build admission response.');
 const d=raw as Record<string,unknown>;
 for(const key of ['intentId','companyId','projectId','roomId'] as const)
  if(!identifier(d[key])||d[key]!==scope[key])throw Error('Build admission scope mismatch.');
 for(const key of ['graphId','requestId','originalPromptMessageId','sourceMessageId'])
  if(!identifier(d[key]))throw Error('Incomplete build admission response.');
 if(d.sourceMessageId===d.originalPromptMessageId)throw Error('Build confirmation must be a separate human message.');
 return d as unknown as ClaimedBuildAdmission;
}
export async function confirmClaimedBuild(opts:{
 scope:ClaimedBuildScope;authToken:string;idempotencyKey:string;signal:AbortSignal;fetcher?:typeof fetch
}):Promise<ClaimedBuildAdmission>{
 if(!opts.authToken||!opts.idempotencyKey||!Object.values(opts.scope).every(identifier))throw Error('A verified claimed workspace and signed-in session are required.');
 const response=await (opts.fetcher||fetch)('/api/v1/starli/grokbot1/claims/'+encodeURIComponent(opts.scope.intentId)+'/execute',{
  method:'POST',headers:{Authorization:'Bearer '+opts.authToken,'Content-Type':'application/json',Accept:'application/json','Idempotency-Key':opts.idempotencyKey},
  body:JSON.stringify({command:'Start building'}),signal:opts.signal
 });
 if(response.status!==202){
  const e=Error(response.status===401?'Sign in again before starting your build.':response.status===403?'You no longer have permission to start this build.':response.status===404||response.status===501?'Building is unavailable for this request.':'Unable to confirm the build. Retry uses the same request.');
  Object.assign(e,{status:response.status});throw e;
 }
 return validateBuildAdmission(await response.json(),opts.scope);
}

export async function resumeClaimedBuild(opts:{scope:ClaimedBuildScope;authToken:string;signal:AbortSignal;graphId?:string;fetcher?:typeof fetch}):Promise<ClaimedBuildAdmission|null>{
 if(!opts.authToken||!Object.values(opts.scope).every(identifier))throw Error('Verified claimed workspace required.');
 const query=opts.graphId?'?graphId='+encodeURIComponent(opts.graphId):'';
 const response=await (opts.fetcher||fetch)('/api/v1/starli/grokbot1/claims/'+encodeURIComponent(opts.scope.intentId)+'/execution'+query,{headers:{Authorization:'Bearer '+opts.authToken,Accept:'application/json'},signal:opts.signal});
 if(response.status===404)return null;
 if(response.status!==200){const error=Error(response.status===409?'Choose the exact existing build to resume.':'Existing build access could not be verified.');Object.assign(error,{status:response.status});throw error;}
 return validateBuildAdmission(await response.json(),opts.scope);
}
