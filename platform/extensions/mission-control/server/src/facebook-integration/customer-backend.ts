/**
 * Isolated LCG10 composition adapter for LCG3 Page-selection + LCG4 durable
 * post-now + LCG10 customer MCP contract. No live registration or provider.
 */
import type { FacebookCustomerPostNowService } from '../facebook-customer/post-now.js';
import type { CustomerFacebookPageSelection } from '../facebook-pages/customer-page-selection.js';
import type { FacebookCustomerScheduler, FacebookScheduleReceipt } from '../facebook-customer/scheduler.js';
import type { CustomerFacebookMcpBackend, FacebookMcpJob } from '../../../control-plane/src/customer-facebook-mcp-contract.js';

export interface FacebookCustomerSchedulerPort {
  schedule: CustomerFacebookMcpBackend['schedule'];
  list: CustomerFacebookMcpBackend['list'];
  cancel: CustomerFacebookMcpBackend['cancel'];
}

export function createFacebookCustomerPilotBackend(input:{
  postNow:FacebookCustomerPostNowService;
  pages:CustomerFacebookPageSelection;
  scheduler?:FacebookCustomerSchedulerPort;
}):CustomerFacebookMcpBackend {
  const owner=(tenantId:string,subjectId:string)=>{
    if(!tenantId || subjectId !== tenantId)throw new Error('CUSTOMER_TENANT_MISMATCH');
    return {tenantId,userId:subjectId};
  };
  const selected=async(tenantId:string,subjectId:string,pageConnectionId:string)=>{
    const current=await input.pages.requireSelectedDispatchGrant(owner(tenantId,subjectId),pageConnectionId);
    if(current.connectionId!==pageConnectionId)throw new Error('FACEBOOK_PAGE_SELECTION_MISMATCH');
    return current;
  };
  return {
    async publishNow(cmd){
      if(cmd.explicitCustomerCommand!==true)throw new Error('EXPLICIT_CUSTOMER_COMMAND_REQUIRED');
      await selected(cmd.tenantId,cmd.subjectId,cmd.pageConnectionId);
      const receipt=await input.postNow.publishNow({tenantId:cmd.tenantId,userId:cmd.subjectId,audience:'customer-mcp',commandId:cmd.idempotencyKey},{pageConnectionId:cmd.pageConnectionId,caption:cmd.caption,mediaRefs:cmd.mediaRefs,idempotencyKey:cmd.idempotencyKey});
      const state:FacebookMcpJob['state']=receipt.state==='NOT_PUBLISHED'?'FAILED':receipt.state;
      if(state==='PUBLISHED'&&!receipt.providerPostId)throw new Error('PROVIDER_RECEIPT_UNAVAILABLE');
      return {id:receipt.id,tenantId:receipt.tenantId,pageConnectionId:receipt.pageConnectionId,state,
        ...(receipt.providerPostId?{providerPostRef:receipt.providerPostId}:{}),
        ...(receipt.publishedAt?{publishedAt:receipt.publishedAt}:{}),
        ...(receipt.errorCode?{errorCode:receipt.errorCode}:{}),
      };
    },
    async schedule(cmd){
      if(!input.scheduler)throw new Error('FACEBOOK_SCHEDULER_NOT_INTEGRATED');
      await selected(cmd.tenantId,cmd.subjectId,cmd.pageConnectionId);
      return input.scheduler.schedule(cmd);
    },
    async list(cmd){
      owner(cmd.tenantId,cmd.subjectId);
      if(!input.scheduler)throw new Error('FACEBOOK_SCHEDULER_NOT_INTEGRATED');
      return input.scheduler.list(cmd);
    },
    async cancel(cmd){
      owner(cmd.tenantId,cmd.subjectId);
      if(!input.scheduler)throw new Error('FACEBOOK_SCHEDULER_NOT_INTEGRATED');
      return input.scheduler.cancel(cmd);
    },
  };
}

/**
 * Compose LCG5's durable queue into the LCG10 customer tool contract.
 * The caller must inject an LCG5 instance whose authorization, Page, media,
 * due-dispatch provenance, cipher and publisher ports are independently trusted.
 * This adapter does NOT start the worker or manufacture a Meta provider job ID.
 */
export function createFacebookCustomerSchedulerPort(scheduler:FacebookCustomerScheduler):FacebookCustomerSchedulerPort {
  const owner=(tenantId:string,subjectId:string,commandId:string)=>{
    if(!tenantId || tenantId!==subjectId || !commandId)throw new Error('CUSTOMER_TENANT_MISMATCH');
    return {tenantId,userId:subjectId,commandId,audience:'customer-mcp' as const};
  };
  const receipt=(job:FacebookScheduleReceipt):FacebookMcpJob=>{
    const mapped:FacebookMcpJob['state']=job.state;
    if(mapped==='PUBLISHED'&&!job.providerPostRef)throw new Error('PUBLISHED_PROVIDER_RECEIPT_MISSING');
    return {
      id:job.id,tenantId:job.tenantId,pageConnectionId:job.pageConnectionId,state:mapped,
      scheduledAt:job.scheduledAt,
      ...(job.providerPostRef?{providerPostRef:job.providerPostRef}:{}),
      ...(job.publishedAt?{publishedAt:job.publishedAt}:{}),
      ...(job.errorCode?{errorCode:job.errorCode}:{}),
    };
  };
  return {
    async schedule(cmd){
      if(cmd.explicitCustomerCommand!==true)throw new Error('EXPLICIT_CUSTOMER_COMMAND_REQUIRED');
      const p=owner(cmd.tenantId,cmd.subjectId,cmd.idempotencyKey);
      return receipt(await scheduler.schedule(p,{
        pageConnectionId:cmd.pageConnectionId,caption:cmd.caption,mediaRefs:cmd.mediaRefs,
        idempotencyKey:cmd.idempotencyKey,localDate:cmd.localDate,localTime:cmd.localTime,
        timezone:cmd.timezone,
      }));
    },
    async list(cmd){
      const p=owner(cmd.tenantId,cmd.subjectId,'customer-list');
      const response=scheduler.list(p,{limit:cmd.limit,...(cmd.cursor?{cursor:cmd.cursor}:{})});
      return {jobs:response.jobs.map(receipt),...(response.nextCursor?{nextCursor:response.nextCursor}:{})};
    },
    async cancel(cmd){
      if(cmd.explicitCustomerCommand!==true)throw new Error('EXPLICIT_CUSTOMER_COMMAND_REQUIRED');
      const p=owner(cmd.tenantId,cmd.subjectId,cmd.idempotencyKey);
      const job=await scheduler.cancel(p,cmd.jobId,cmd.idempotencyKey);
      if(!job)throw new Error('CUSTOMER_JOB_NOT_FOUND');
      return receipt(job);
    },
  };
}
