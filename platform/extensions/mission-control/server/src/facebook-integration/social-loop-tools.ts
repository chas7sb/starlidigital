/** Optional authenticated lifecycle tools; no consent provisioning or worker startup. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Store} from '../store.js';
import type {CustomerMcpPrincipal} from '../customer-mcp/customer-auth.js';
import type {CustomerFacebookHttpTool} from '../customer-mcp/customer-http.js';
import type {DailyFacebookLoopEngine} from '../facebook-customer/lcg14-recurring-loop.js';
export interface CustomerSocialLoopOptions {
 store:Store;engine:DailyFacebookLoopEngine;
 /** Must load current approval from persistent server storage, never tool JSON. */
 resolveStandingConsent:(principal:CustomerMcpPrincipal,consentRef:string)=>unknown;
}
export function createCustomerSocialLoopTools(options:CustomerSocialLoopOptions):CustomerFacebookHttpTool[]{
 if(!options.engine||typeof options.resolveStandingConsent!=='function')throw Error('TRUSTED_SOCIAL_LOOP_PORTS_REQUIRED');
 const opaque=z.string().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
 const prompt=z.string().min(10).max(4000);
 const localTime=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional();
 const id=z.object({loopId:opaque}).strict();
 const actor=(ctx:Parameters<CustomerFacebookHttpTool['invoke']>[0],commandId:string)=>({
  tenantId:ctx.principal.tenantId,userId:ctx.principal.subjectId,audience:'customer-mcp' as const,commandId
 });
 const names=['social_loop_create','social_loop_list','social_loop_get','social_loop_pause','social_loop_resume','social_loop_update','social_loop_cancel','social_loop_history'] as const;
 return names.map(name=>({name,description:({
  social_loop_create:'Create a daily Europe/Bucharest loop (default 07:00) using an existing explicit standing approval; does not publish now.',
  social_loop_list:'List your daily loops.',social_loop_get:'Inspect your daily loop.',
  social_loop_pause:'Pause future occurrences.',social_loop_resume:'Resume only with current standing approval.',
  social_loop_update:'Change the prompt only with matching renewed standing approval.',
  social_loop_cancel:'Cancel future occurrences; does not undo an already submitted post.',
  social_loop_history:'Inspect durable occurrence history; CLAIMED is unresolved, not confirmed publication.'
 })[name],
 inputSchema:name==='social_loop_create'?z.object({requestKey:opaque,pageConnectionId:opaque,consentRef:opaque,standingPrompt:prompt,localTime}).strict():
  name==='social_loop_update'?z.object({loopId:opaque,consentRef:opaque,standingPrompt:prompt}).strict():
  name==='social_loop_list'?z.object({}).strict():id,
 ...(name==='social_loop_list'?{}:{loadStoredResource:(principal:CustomerMcpPrincipal,raw:unknown)=>{
  const args=raw as {loopId?:unknown;consentRef?:unknown;pageConnectionId?:unknown;standingPrompt?:unknown;localTime?:unknown};
  let loop:Record<string,any>|undefined;
  if(name!=='social_loop_create'){
   if(typeof args?.loopId!=='string')throw Error('OWNED_SOCIAL_LOOP_REQUIRED');
   loop=options.store.get('facebook-customer-daily-loops',args.loopId);
   if(!loop||loop.id!==args.loopId||loop.tenantId!==principal.tenantId||loop.userId!==principal.subjectId)
    throw Error('OWNED_SOCIAL_LOOP_REQUIRED');
  }
  if(!['social_loop_create','social_loop_update','social_loop_resume'].includes(name))
   return {ownerId:loop!.userId,tenantId:loop!.tenantId};
  const ref=name==='social_loop_resume'?loop!.consentRef:args?.consentRef;
  if(typeof ref!=='string')throw Error('STANDING_APPROVAL_REQUIRED');
  const approval=options.resolveStandingConsent(principal,ref) as Record<string,any>|undefined;
  const expectedPage=name==='social_loop_create'?args.pageConnectionId:loop!.pageConnectionId;
  const expectedHash=name==='social_loop_resume'?loop!.promptHash:
   typeof args.standingPrompt==='string'?createHash('sha256').update(args.standingPrompt.trim()).digest('hex'):undefined;
  const expectedTime=name==='social_loop_create'?args.localTime??'07:00':loop!.localTime;
  if(!approval||approval.id!==ref||approval.ownerId!==principal.subjectId||approval.tenantId!==principal.tenantId||
   approval.pageConnectionId!==expectedPage||approval.promptHash!==expectedHash||
   (approval.localTime??'07:00')!==expectedTime)
   throw Error('STANDING_APPROVAL_BINDING_MISMATCH');
  return {ownerId:approval.ownerId,tenantId:approval.tenantId,standingConsent:approval.standingConsent};
 }}),
 invoke:async(ctx,raw:any)=>{
  const p=actor(ctx,name==='social_loop_create'?raw.requestKey:name);
  switch(name){
   case 'social_loop_create':return options.engine.create(p,raw);
   case 'social_loop_list':return {loops:options.engine.list(p)};
   case 'social_loop_get':{const loop=options.engine.get(p,raw.loopId);if(!loop)throw Error('OWNED_SOCIAL_LOOP_REQUIRED');return loop}
   case 'social_loop_history':return {occurrences:options.engine.history(p,raw.loopId)};
   case 'social_loop_update':return options.engine.update(p,raw.loopId,{standingPrompt:raw.standingPrompt,consentRef:raw.consentRef});
   default:return options.engine.changeState(p,raw.loopId,name==='social_loop_pause'?'PAUSED':name==='social_loop_resume'?'ACTIVE':'CANCELLED');
  }
 }
 }));
}
