import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';
/** Server-only due-job assembly: original consent and job-scoped media remain
 * mandatory trusted ports. Never manufactures a customer bearer or consent.
 */
import {createHash} from 'node:crypto';
import {GENERATED_PROVENANCE_COLLECTION, GENERATED_PUBLISH_APPROVAL_COLLECTION, readSchedulePageSelection, isCanonicalFacebookPermalink} from './openai-image-generation-integration.js';
import type {Store} from '../store.js';
import {TrustedScheduledFacebookPublisher,type TrustedScheduledFacebookPorts} from '../facebook-customer/trusted-scheduled-publisher.js';
import type {FacebookTrustedPageTokenResolver,FacebookResolvedPageBinding} from '../facebook-pages/oauth.js';

export function createTrustedScheduledFacebookPublisherComposition(input:{
 store:Store;
 ports:Omit<TrustedScheduledFacebookPorts,'resolveCurrentPageToken'|'provider'>;
 pageTokens:FacebookTrustedPageTokenResolver;
 provider:TrustedScheduledFacebookPorts['provider'];
 externalWritesEnabled:boolean;
 clock?:()=>Date;
}){
 if(input.externalWritesEnabled!==true)throw Error('FACEBOOK_EXTERNAL_WRITES_DISABLED');
 for(const [port,methods] of [
  [input.ports,['authorizeOriginalSchedule','resolveCurrentPage','readOwnedMediaForDue']],
  [input.ports?.cipher,['open']],
  [input.pageTokens,['resolveCurrentPageToken','assertResolvedPageTokenCurrent']],
  [input.provider,['publishNow']],
 ] as const){
  if(!port||methods.some(method=>typeof (port as unknown as Record<string,unknown>)[method]!=='function'))
   throw Error('TRUSTED_SCHEDULED_FACEBOOK_PORT_REQUIRED');
 }
 return new TrustedScheduledFacebookPublisher(input.store,{
  ...input.ports,
  resolveCurrentPageToken:request=>input.pageTokens.resolveCurrentPageToken(request),
  provider:{publishNow:async(binding,command)=>{
   // The due publisher has finished its async Page/media/original-consent checks.
   // Pin the exact resolver-issued lease immediately before the one Graph effect.
   const matches=input.store.list('facebook-customer-schedule',command.tenantId).filter(row=>
    row.tenantId===command.tenantId&&row.userId===command.tenantId&&row.state==='DISPATCHING'&&
    'fbsc-due-'+createHash('sha256').update(String(row.id)).digest('hex').slice(0,60)===command.commandId);
   if(matches.length!==1)throw Error('DUE_JOB_CLAIM_NOT_FOUND');
   const claimed=matches[0]!;
   const snapshot=JSON.stringify(claimed);
   await input.pageTokens.assertResolvedPageTokenCurrent(binding as FacebookResolvedPageBinding);
   if(JSON.stringify(input.store.get('facebook-customer-schedule',claimed.id))!==snapshot)
    throw Error('DUE_JOB_CLAIM_CHANGED');
   // Lease validation is asynchronous too: recheck persisted account authority
   // after it, with no further await before the one provider invocation.
   const live=input.store.user(command.tenantId);
   if(!live||live.disabled||!['USER','CUSTOMER'].includes(String(live.role)))
    throw Error('DUE_JOB_CUSTOMER_REVOKED');
   const payload=JSON.parse(input.ports.cipher.open(claimed.sealedPayload));
   const expectedDigest=createHash('sha256').update(JSON.stringify([
    claimed.tenantId,claimed.userId,claimed.commandId,claimed.pageConnectionId,
    payload.caption,payload.mediaRefs,claimed.scheduledAt
   ])).digest('hex');
   if(claimed.payloadHash!==expectedDigest)throw Error('DUE_JOB_PAYLOAD_TAMPERED');
   if(payload.tenantId!==claimed.tenantId||payload.userId!==claimed.userId)
    throw Error('DUE_JOB_TENANT_MISMATCH');
   if(payload.commandId!==claimed.commandId)throw Error('DUE_JOB_COMMAND_MISMATCH');
   if(payload.pageConnectionId!==claimed.pageConnectionId)throw Error('DUE_JOB_PAGE_CONNECTION_MISMATCH');
   if(payload.scheduledAt!==claimed.scheduledAt)throw Error('DUE_JOB_SCHEDULE_MISMATCH');
   if(payload.caption.trim()!==command.caption.trim())throw Error('DUE_JOB_CAPTION_MISMATCH');
   if(payload.mediaRefs.length===0&&command.media)throw Error('DUE_JOB_MEDIA_UNEXPECTED');
   if(payload.mediaRefs.length>0&&!command.media)throw Error('DUE_JOB_MEDIA_MISSING');
   for(const ref of payload.mediaRefs){
    const storedMedia=input.store.get('facebook-customer-media',ref) as {
     id:string;tenantId:string;mediaRef:string;state:string;sha256:string;revokedAt?:unknown;
    }|undefined;
    if(storedMedia){
     if(storedMedia.revokedAt!==undefined||storedMedia.state!=='STORED_PRIVATE'||
        storedMedia.tenantId!==claimed.tenantId||storedMedia.mediaRef!==ref){
       throw Error('DUE_JOB_MEDIA_REVOKED');
     }
    }
    const provenance=input.store.get(GENERATED_PROVENANCE_COLLECTION,ref);
    const approval=input.store.get(GENERATED_PUBLISH_APPROVAL_COLLECTION,`pub-approval:${claimed.tenantId}:${ref}`);
    if(!provenance&&!approval)continue;
    const selection=readSchedulePageSelection(input.store,claimed.tenantId,claimed.userId,claimed.pageConnectionId);
    const approvedSchedule=approval?.schedule;
    if(!approvedSchedule||approvedSchedule.jobId!==claimed.id||
       approvedSchedule.scheduledAt!==claimed.scheduledAt||
       approvedSchedule.selectionNonce!==selection.selectionNonce||
       approvedSchedule.connectionRevision!==binding.connectionRevision||
       approvedSchedule.connectionRevision!==selection.connectionRevision||
       approvedSchedule.pageId!==selection.pageId||approvedSchedule.pageId!==binding.pageId){
      throw Error('DUE_GENERATED_SCHEDULE_APPROVAL_MISMATCH');
    }
    const now=(input.clock?.()??new Date()).getTime();
    const mediaDigest=command.media&&createHash('sha256').update(command.media.bytes).digest('hex');
    if(!provenance||!approval||approval.approved!==true||approval.revokedAt!==undefined||
       !Number.isFinite(approval.expiresAt)||approval.expiresAt<=now||
       approval.tenantId!==claimed.tenantId||approval.userId!==claimed.userId||
       approval.pageConnectionId!==claimed.pageConnectionId||approval.mediaRef!==ref||
       !mediaDigest||approval.mediaSha256!==mediaDigest||provenance.sha256!==mediaDigest||
       (storedMedia&&storedMedia.sha256!==mediaDigest)||
       approval.captionSha256!==createHash('sha256').update(command.caption.trim()).digest('hex')||
       !['SCHEDULE','BOTH'].includes(approval.mode)){
     throw Error('DUE_GENERATED_PUBLISH_APPROVAL_REVOKED');
    }
   }
   assertFacebookCustomerPilotEffectsAllowed(input.store);
   const result=await input.provider.publishNow(binding,command);
   const {providerPostUrl,...receipt}=result as typeof result & {providerPostUrl?:unknown};
   return receipt.state==='PUBLISHED'&&receipt.providerPostRef&&
    isCanonicalFacebookPermalink(providerPostUrl,binding.verifiedPageId,receipt.providerPostRef)
     ? {...receipt,providerPostUrl}:receipt;
  }},
 },{externalWritesEnabled:true,...(input.clock?{clock:input.clock}:{})});
}
