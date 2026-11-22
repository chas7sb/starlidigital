import {resourceKey} from './index.mjs';
// Server derives actor from its authenticated session; userId is never a credential.
export function httpAdapter(fetcher=fetch,root='/api/v1/panels'){
 const request=async(scope,ref,operation,signal,body)=>{
  const response=await fetcher(root+'/'+resourceKey(ref)+'/'+operation,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){const e=Error(response.status===409?'Revision conflict':'Panel request failed');e.status=response.status;throw e;}
  const data=await response.json();if(data.ownerId!==scope.ownerId||data.scope!==scope.kind)throw Error('Unverified resource scope');return data;
 };
 return {authorize:(s,r,capabilities,signal)=>request(s,r,'authorize',signal,{capabilities}),read:(s,r,signal)=>request(s,r,'snapshot',signal),edit:(s,r,value,expectedRevision,signal)=>request(s,r,'edit',signal,{value,expectedRevision}),
  async subscribe(s,r,listener,signal){let stopped=false,timer;const poll=async()=>{if(stopped||signal.aborted)return;try{listener(await request(s,r,'snapshot',signal));}catch(e){if([401,403,404].includes(e.status)){listener({revoked:true});stopped=true;}}finally{if(!stopped&&!signal.aborted)timer=setTimeout(poll,3000);}};timer=setTimeout(poll,3000);const stop=()=>{stopped=true;clearTimeout(timer);};signal.addEventListener('abort',stop,{once:true});return()=>{stop();signal.removeEventListener('abort',stop);};}
 };
}
