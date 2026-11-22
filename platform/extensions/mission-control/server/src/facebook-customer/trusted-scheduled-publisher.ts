/**
 * LCG4-only scheduled dispatch publisher boundary. NOT a customer MCP endpoint.
 * An LCG5 worker may invoke it only for a durable DISPATCHING job, with
 * independently server-verified original scheduling consent. No customer
 * bearer token is manufactured, persisted or reused after expiration.
 */
import {createHash} from 'node:crypto';
import type {Store} from '../store.js';
import {
  FacebookCustomerPostNowService,translateFacebookPilotAdapterReceipt,
  type FacebookCustomerPrincipal,type FacebookPostNowCommand,
  type FacebookPostNowReceipt,type FacebookPostNowPorts,type FacebookPageGrant,type FacebookMediaGrant,
} from './post-now.js';
import {
  verifyOwnedFacebookMediaBytes,
  type TrustedFacebookPageBinding,type VerifiedPostNowMediaBytes,type VerifiedPostNowProviderMedia,
  type VerifiedPostNowProviderReceipt,
} from './verified-post-now.js';

const JOBS='facebook-customer-schedule';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const scopes=['pages_show_list','pages_read_engagement','pages_manage_posts'];
const ident=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const fail=(msg:string):never=>{throw Error(msg);};
function must(condition:unknown,msg:string):asserts condition {if(!condition)fail(msg);}

type ScheduleJob={
  id:string;tenantId:string;userId:string;commandId:string;pageConnectionId:string;
  scheduledAt:string;state:string;payloadHash:string;sealedPayload:string;
};
type SealedSchedulePayload={
  tenantId:string;userId:string;commandId:string;pageConnectionId:string;
  caption:string;mediaRefs:string[];connectionRevision:string;
  selectionRevision?:string;pageId:string;mediaHashes:string[];scheduledAt:string;
};
export type ScheduledPageGrant=FacebookPageGrant&{selectionRevision?:string};
export interface TrustedScheduledFacebookPorts {
  /** LCG5 AES-GCM private schedule payload, injected SERVER-ONLY. */
  cipher:{open(ciphertext:string):string};
  /**
   * LCG1 + LCG5 server-owned current, persisted scheduling consent verification.
   * The original command, job, tenant, immutable hash and revocation MUST be
   * checked; a public request boolean or expired customer Bearer is invalid.
   */
  authorizeOriginalSchedule(input:{tenantId:string;userId:string;originalCommandId:string;jobId:string;payloadHash:string}):Promise<boolean>;
  /** LCG3 current selected Page, task, owner, OAuth and selection revisions. */
  resolveCurrentPage(input:{tenantId:string;userId:string;pageConnectionId:string}):Promise<ScheduledPageGrant|undefined>;
  /** LCG6/8 trusted server job-scoped private bytes, never customer-supplied URL/path. */
  readOwnedMediaForDue(input:{tenantId:string;userId:string;jobId:string;mediaRef:string}):Promise<VerifiedPostNowMediaBytes>;
  /** LCG2 Page token fetched server-only from the CURRENT Page connection revision. */
  resolveCurrentPageToken(input:{tenantId:string;userId:string;pageConnectionId:string;pageId:string;connectionRevision:string}):Promise<TrustedFacebookPageBinding>;
  /** LCG8 one-attempt provider, injected fake for offline tests only. */
  provider:{publishNow(binding:TrustedFacebookPageBinding,cmd:{tenantId:string;pageId:string;commandId:string;mode:'NOW';caption:string;media?:VerifiedPostNowProviderMedia}):Promise<VerifiedPostNowProviderReceipt>};
}

/** Adapter for LCG5 SchedulerPorts.publisher. No separate route or worker. */
export class TrustedScheduledFacebookPublisher {
  constructor(private readonly store:Store,private readonly ports:TrustedScheduledFacebookPorts,
    private readonly options:{externalWritesEnabled?:boolean;clock?:()=>Date}={}){}

  private claimed(p:FacebookCustomerPrincipal,c:FacebookPostNowCommand):{job:ScheduleJob;payload:SealedSchedulePayload}{
    must(p?.audience==='customer-mcp'&&typeof p.tenantId==='string'&&p.tenantId===p.userId&&ident.test(p.tenantId)&&ident.test(p.commandId),
      'DUE_JOB_CUSTOMER_SCOPE_DENIED');
    // LCG5/14's durable original schedule consent is not proof that the
    // customer account is still an enabled ordinary customer at dispatch.
    // This check runs on EVERY claim, including after asynchronous token,
    // Page, private media and consent reads immediately before provider send.
    const live=this.store.user(p.userId);
    must(live&&!live.disabled&&['USER','CUSTOMER'].includes(String(live.role)),
      'DUE_JOB_CUSTOMER_REVOKED');
    must(c&&c.idempotencyKey===p.commandId&&/^fbsc-due-[0-9a-f]{60}$/.test(p.commandId),'DUE_JOB_COMMAND_DENIED');
    // Do not treat p as a real customer MCP principal. Read an independently
    // stored LCG5 DISPATCHING claim, never trust a caller's structural object.
    const jobs=(this.store.list(JOBS,p.tenantId) as ScheduleJob[]).filter(x=>
      x.tenantId===p.tenantId&&x.userId===p.userId&&x.state==='DISPATCHING'&&
      `fbsc-due-${sha(x.id).slice(0,60)}`===p.commandId);
    must(jobs.length===1,'DUE_JOB_CLAIM_NOT_FOUND');
    const job=jobs[0]!;
    must(typeof job.commandId==='string'&&ident.test(job.commandId)&&
      job.id===`fbsc-${sha(`${job.tenantId}\u0000${job.commandId}`)}`,'DUE_JOB_ID_TAMPERED');
    const at=Date.parse(job.scheduledAt),now=this.options.clock?.()||new Date();
    must(Number.isFinite(at)&&Number.isFinite(now.getTime())&&at<=now.getTime(),'DUE_JOB_NOT_DUE');
    let payload:SealedSchedulePayload;
    try{payload=JSON.parse(this.ports.cipher.open(job.sealedPayload)) as SealedSchedulePayload;}
    catch{return fail('DUE_JOB_SEALED_PAYLOAD_INVALID');}
    must(payload&&payload.tenantId===job.tenantId&&payload.userId===job.userId&&
      payload.commandId===job.commandId&&payload.pageConnectionId===job.pageConnectionId&&
      payload.scheduledAt===job.scheduledAt&&typeof payload.caption==='string'&&
      Array.isArray(payload.mediaRefs)&&payload.mediaRefs.every(x=>typeof x==='string')&&
      Array.isArray(payload.mediaHashes)&&payload.mediaHashes.length===payload.mediaRefs.length&&
      typeof payload.pageId==='string'&&typeof payload.connectionRevision==='string',
      'DUE_JOB_SEALED_PAYLOAD_SCOPE_DENIED');
    const expected=sha(JSON.stringify([job.tenantId,job.userId,job.commandId,payload.pageConnectionId,payload.caption,payload.mediaRefs,job.scheduledAt]));
    must(expected===job.payloadHash&&c.pageConnectionId===payload.pageConnectionId&&
      c.caption.trim()===payload.caption&&eq(c.mediaRefs||[],payload.mediaRefs),
      'DUE_JOB_PAYLOAD_CHANGED');
    return {job,payload};
  }
  private async entitled(p:FacebookCustomerPrincipal,c:FacebookPostNowCommand){
    const claim=this.claimed(p,c);
    const ok=await this.ports.authorizeOriginalSchedule({tenantId:claim.job.tenantId,userId:claim.job.userId,
      originalCommandId:claim.job.commandId,jobId:claim.job.id,payloadHash:claim.job.payloadHash});
    must(ok===true,'DUE_JOB_CONSENT_REVOKED');
    // Authorization is server-owned, NOT a cloned or forged customer MCP Bearer.
    return this.claimed(p,c);
  }
  private async page(p:FacebookCustomerPrincipal,c:FacebookPostNowCommand):Promise<ScheduledPageGrant>{
    const {payload}=await this.entitled(p,c);
    const grant=await this.ports.resolveCurrentPage({tenantId:p.tenantId,userId:p.userId,pageConnectionId:c.pageConnectionId});
    must(grant&&grant.tenantId===p.tenantId&&grant.ownerUserId===p.userId&&grant.connectionId===payload.pageConnectionId&&
      grant.pageId===payload.pageId&&grant.connectionRevision===payload.connectionRevision&&
      grant.selectionRevision===payload.selectionRevision&&grant.targetType==='PAGE'&&grant.status==='CONNECTED'&&
      grant.tasks.includes('CREATE_CONTENT')&&scopes.every(s=>grant.scopes.includes(s)),'DUE_JOB_PAGE_CHANGED');
    return grant;
  }
  private async media(p:FacebookCustomerPrincipal,c:FacebookPostNowCommand,ref:string){
    const {job,payload}=await this.entitled(p,c);
    const i=payload.mediaRefs.indexOf(ref);
    must(i>=0&&payload.mediaRefs.indexOf(ref,i+1)===-1,'DUE_JOB_MEDIA_REF_DENIED');
    const raw=await this.ports.readOwnedMediaForDue({tenantId:p.tenantId,userId:p.userId,jobId:job.id,mediaRef:ref});
    const result=verifyOwnedFacebookMediaBytes(raw,ref,{tenantId:p.tenantId,subjectId:p.userId});
    must(result.grant.sha256===payload.mediaHashes[i],'DUE_JOB_MEDIA_CHANGED');
    return result;
  }
  async publishNow(p:FacebookCustomerPrincipal,c:FacebookPostNowCommand):Promise<FacebookPostNowReceipt>{
    must(this.options.externalWritesEnabled===true,'FACEBOOK_SCHEDULE_DISPATCH_DISABLED');
    await this.entitled(p,c);
    const source=this.ports;
    const corePorts:FacebookPostNowPorts={
      authorizeExplicitCommand:async meta=>{
        // This permission is the original, durable, authenticated SCHEDULE
        // consent, not an invented instantaneous customer publish consent.
        if(meta.tenantId!==p.tenantId||meta.userId!==p.userId||meta.commandId!==p.commandId||
          meta.pageConnectionId!==c.pageConnectionId||!(/^[a-f0-9]{64}$/.test(meta.payloadHash)))return false;
        await this.entitled(p,c);return true;
      },
      resolvePage:async input=>{
        must(input.tenantId===p.tenantId&&input.userId===p.userId,'DUE_JOB_TENANT_DENIED');
        return this.page(p,c);
      },
      resolveMedia:async input=>{
        must(input.tenantId===p.tenantId&&input.userId===p.userId,'DUE_JOB_MEDIA_TENANT_DENIED');
        return (await this.media(p,c,input.mediaRef)).grant;
      },
      provider:{publishNow:async input=>{
        must(input.tenantId===p.tenantId&&input.userId===p.userId,'DUE_JOB_PROVIDER_TENANT_DENIED');
        const current=await this.page(p,c); // fresh, immediately before token retrieval
        must(current.pageId===input.page.pageId&&current.connectionRevision===input.page.connectionRevision,'DUE_JOB_PAGE_ROTATED');
        const binding=await source.resolveCurrentPageToken({tenantId:p.tenantId,userId:p.userId,
          pageConnectionId:current.connectionId,pageId:current.pageId,connectionRevision:current.connectionRevision});
        must(binding&&binding.tenantId===p.tenantId&&binding.pageId===current.pageId&&binding.verifiedPageId===current.pageId&&
          binding.connectionRevision===current.connectionRevision&&binding.canCreateContent===true&&
          typeof binding.pageToken==='string'&&binding.pageToken.length>0&&scopes.every(x=>binding.scopes.includes(x)),
          'DUE_JOB_PAGE_TOKEN_DENIED');
        must(input.media.length<=1,'DUE_JOB_MULTIPLE_MEDIA_DENIED');
        let upload:VerifiedPostNowProviderMedia|undefined;
        if(input.media.length){
          const latest=await this.media(p,c,input.media[0]!.ref);
          must(latest.grant.sha256===input.media[0]!.sha256&&latest.grant.bytes===input.media[0]!.bytes&&
            latest.grant.mimeType===input.media[0]!.mimeType,'DUE_JOB_MEDIA_CHANGED');
          upload=latest.upload;
        }
        // Re-evaluate current selected Page after async token/media reads.
        // A grant/token callback may cause selection revision or Page task
        // downgrade; neither the old Page grant nor the old token is enough.
        const finalPage=await this.page(p,c);
        must(finalPage.pageId===current.pageId&&finalPage.connectionRevision===current.connectionRevision&&
          finalPage.selectionRevision===current.selectionRevision,'DUE_JOB_PAGE_ROTATED');
        if(input.media.length){
          // The Page recheck itself was asynchronous: a media revoke may have
          // happened while that Page operation ran. Re-read bytes immediately.
          const last=await this.media(p,c,input.media[0]!.ref);
          must(last.grant.sha256===input.media[0]!.sha256&&last.grant.bytes===input.media[0]!.bytes,
            'DUE_JOB_MEDIA_CHANGED');
          upload=last.upload;
        }
        // Every async credential/media lookup can revoke a job. Verify the
        // persisted DISPATCHING state and durable original consent LAST.
        await this.entitled(p,c);
        const receipt=await source.provider.publishNow(binding,{tenantId:p.tenantId,pageId:current.pageId,
          commandId:p.commandId,mode:'NOW',caption:c.caption,...(upload?{media:upload}:{})});
        return translateFacebookPilotAdapterReceipt(receipt,upload?.kind||null);
      }},
    };
    return new FacebookCustomerPostNowService(this.store,corePorts,{externalWritesEnabled:true}).publishNow(p,c);
  }
}
