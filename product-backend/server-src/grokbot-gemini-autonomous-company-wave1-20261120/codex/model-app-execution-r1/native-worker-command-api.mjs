// HTTP admission boundary. Native authentication/CSRF/role/message lookups are injected,
// never read from caller-authored tenant, owner, worker or original prompt fields.
export function createNativeWorkerCommandHandler({service,resolveActor,authorizeCommandRequest,resolveBuildContext}) {
 for(const fn of [resolveActor,authorizeCommandRequest,resolveBuildContext])if(typeof fn!=='function')throw Error('NATIVE_COMMAND_AUTHORITY_REQUIRED');
 const send=(res,status,payload)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));};
 return async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),match=url.pathname.match(/^\/api\/v1\/starli\/requests\/([^/]+)\/build$/);
  if(req.method!=='POST'||!match)return false;
  try{
   const actor=await resolveActor(req);if(!actor?.userId||!actor.workspaceTenantId){send(res,401,{error:'UNAUTHORIZED'});return true;}
   if(await authorizeCommandRequest(req,actor,{capability:'bots.run'})!==true){send(res,403,{error:'NATIVE_COMMAND_DENIED'});return true;}
   let bytes=0,text='';for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>4096)throw Error('COMMAND_BODY_TOO_LARGE');text+=chunk.toString();}
   const body=JSON.parse(text||'{}');
   if(!body||typeof body.commandMessageId!=='string'||!body.commandMessageId||Object.keys(body).some(k=>k!=='commandMessageId'))throw Error('COMMAND_MESSAGE_ID_ONLY');
   const requestId=decodeURIComponent(match[1]);
   const context=await resolveBuildContext({actor,requestId,commandMessageId:body.commandMessageId});
   const command=context?.command;
   if(!context||context.requestId!==requestId||context.companyId!==actor.workspaceTenantId||command?.messageId!==body.commandMessageId||command.actorUserId!==actor.userId||command.provenance!=='USER'||!/^start building[.!]?$/i.test(command.text.trim())||context.sourceMessageId!==command.messageId||context.originalPromptMessageId===command.messageId){send(res,403,{error:'NATIVE_HUMAN_BUILD_COMMAND_REQUIRED'});return true;}
   const {command:_,...input}=context;
   const prepared=await service.prepare({...input,actor});
   // Admission is synchronous; worker execution remains explicit and awaitable in service.execute.
   send(res,202,{status:'BUILD_ADMITTED',graphId:prepared.graph.graphId,machineryRunId:prepared.machineryRunId,requestId,originalPromptMessageId:context.originalPromptMessageId,sourceMessageId:context.sourceMessageId});
   return true;
  }catch(error){send(res,400,{error:'BUILD_ADMISSION_FAILED',detail:error.message});return true;}
 };
}
