// Bind within the existing trusted Node host. Transport/auth is host-owned.
// A Python EmailPanelAdapter calls this through its injected synchronous RPC.
export function emailPanelRpc(studio){
 return (operation,ctx,id,payload)=>{
  if(!ctx?.actorId||!ctx.companyId)throw Error('EMAIL_NATIVE_CONTEXT_REQUIRED');
  if(operation==='get')return studio.get(ctx,id);
  if(operation==='save')return studio.save(ctx,id,payload.head,payload.document);
  throw Error('EMAIL_PANEL_OPERATION_UNAVAILABLE');
 };
}
