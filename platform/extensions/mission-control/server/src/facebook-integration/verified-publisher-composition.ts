import {assertFacebookCustomerPilotEffectsAllowed} from './pilot-effect-stop.js';
import {isCanonicalFacebookPermalink} from './openai-image-generation-integration.js';
/** Trusted server-only composition. No provider/client credentials are created here.
 * The caller must supply current Page selection, token, private media and Graph ports.
 */
import type {Store} from '../store.js';
import {CustomerFacebookMcpAuth} from '../customer-mcp/customer-auth.js';
import {VerifiedFacebookPostNow,type VerifiedFacebookPostNowDependencies} from '../facebook-customer/verified-post-now.js';
import {createTrustedFacebookPublishAuthPort} from './trusted-publish-auth.js';
import type {FacebookTrustedPageTokenResolver,FacebookResolvedPageBinding} from '../facebook-pages/oauth.js';

export function createVerifiedFacebookPublisherComposition(input:{
 store:Store;
 customerAuth:CustomerFacebookMcpAuth;
 pages:VerifiedFacebookPostNowDependencies['pages'];
 pageTokens:FacebookTrustedPageTokenResolver;
 media:VerifiedFacebookPostNowDependencies['media'];
 provider:VerifiedFacebookPostNowDependencies['provider'];
 externalWritesEnabled:boolean;
 /** Supplied by the per-request HTTP factory, never customer tool JSON. */
 requestAuthorization?:unknown;
}):VerifiedFacebookPostNow{
 if(!input || input.externalWritesEnabled!==true)throw Error('FACEBOOK_EXTERNAL_WRITES_DISABLED');
 for(const [port,method] of [['pages','requireSelectedPublishPage'],['pageTokens','resolveCurrentPageToken'],
  ['pageTokens','assertResolvedPageTokenCurrent'],['media','readOwnedForPublish'],['provider','publishNow']] as const){
  if(typeof (input[port] as unknown as Record<string,unknown>)?.[method]!=='function')throw Error('TRUSTED_FACEBOOK_PORT_REQUIRED:'+port);
 }
 const auth=createTrustedFacebookPublishAuthPort(input.customerAuth);
 return new VerifiedFacebookPostNow(input.store,{
  auth,
  pages:input.pages,pageTokens:input.pageTokens,media:input.media,
  provider:{publishNow:async(binding,command)=>{
   // Last trusted boundary: same-Page reselection invalidates the exact token lease.
   // No asynchronous work between this check and the single provider attempt.
   if(binding.canCreateContent!==true)throw Error('PAGE_TOKEN_GRANT_DENIED');
   await input.pageTokens.assertResolvedPageTokenCurrent(binding as FacebookResolvedPageBinding);
   if(input.requestAuthorization!==undefined){
    const current=auth.authenticateBearer(input.requestAuthorization);
    auth.assertPublishTool(current);
    if(current.tenantId!==command.tenantId)throw Error('CUSTOMER_MCP_CONTEXT_CHANGED');
   }
   const live=input.store.user(command.tenantId);
   if(!live||live.disabled||!['USER','CUSTOMER'].includes(String(live.role)))
    throw Error('CUSTOMER_ACCOUNT_REQUIRED');
   assertFacebookCustomerPilotEffectsAllowed(input.store);
   const result=await input.provider.publishNow(binding,command);
   const {providerPostUrl,...receipt}=result as typeof result & {providerPostUrl?:unknown};
   return receipt.state==='PUBLISHED'&&receipt.providerPostRef&&
    isCanonicalFacebookPermalink(providerPostUrl,binding.verifiedPageId,receipt.providerPostRef)
     ? {...receipt,providerPostUrl}:receipt;
  }},
 },{externalWritesEnabled:true});
}
