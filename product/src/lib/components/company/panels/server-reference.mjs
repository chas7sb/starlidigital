// Framework-neutral reference route. Production authenticate/authorize must use
// native sessions and fresh company_authority; never accept an actor from JSON.
export function panelRoute({authenticate,authorize,store}) {
 return async function route(request){
  const actor=await authenticate(request);if(!actor)return Response.json({error:'Unauthenticated'},{status:401});
  const match=new URL(request.url).pathname.match(/^\/api\/v1\/panels\/(company|personal)\/([^/]+)\/([^/]+)\/([^/]+)\/(authorize|snapshot|edit)$/);
  if(!match)return Response.json({error:'Unknown panel resource'},{status:404});
  const [,scope,ownerId,kind,id,operation]=match,ref={scope,ownerId,kind,id};
  if(request.method!==(operation==='snapshot'?'GET':'POST'))return new Response(null,{status:405});
  const policy=store.getPolicy(kind);if(!policy)return new Response(null,{status:404});
  // Resource kind maps to server-owned permissions, independently of UI claims.
  const required=operation==='edit'?policy.write:policy.read;
  if(!await authorize(actor,ref,required))return Response.json({scope,ownerId,allowed:false},{status:403});
  if(operation==='authorize')return Response.json({scope,ownerId,allowed:true});
  let result;
  if(operation==='snapshot')result=await store.read(ref);
  else{let body;try{body=await request.json();}catch{return new Response(null,{status:400});}
   if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)return new Response(null,{status:400});
   // Store must enforce expectedRevision atomically in the same transaction as write.
   if(!await authorize(actor,ref,required))return new Response(null,{status:403});
   result=await store.compareAndSet(ref,body.expectedRevision,body.value);
   if(!result)return Response.json({error:'Revision conflict'},{status:409});
  }
  return Response.json({scope,ownerId,...result});
 };
}
