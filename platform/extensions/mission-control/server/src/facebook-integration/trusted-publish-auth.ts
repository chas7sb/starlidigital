/** Server-only bridge: the verified publisher must authenticate each raw request
 * with the same persisted Customer MCP bearer authority as the HTTP listener.
 * Never construct a principal from MCP JSON or from an unverified context.
 */
import {CustomerFacebookMcpAuth,assertCustomerFacebookTool} from '../customer-mcp/customer-auth.js';
import type {VerifiedFacebookPostNowDependencies,VerifiedMcpFacebookPublisher} from '../facebook-customer/verified-post-now.js';

export function createTrustedFacebookPublishAuthPort(auth:CustomerFacebookMcpAuth):VerifiedFacebookPostNowDependencies['auth']{
  if(!auth || typeof auth.authenticateBearer!=='function')throw Error('TRUSTED_CUSTOMER_AUTH_REQUIRED');
  return {
    authenticateBearer(authorization:unknown):VerifiedMcpFacebookPublisher{
      const p=auth.authenticateBearer(authorization);
      assertCustomerFacebookTool(p,'facebook_pages_publish_now');
      return {source:p.source,audience:p.audience,tenantId:p.tenantId,ownerId:p.ownerId,
        subjectId:p.subjectId,scopes:p.scopes,expiresAt:p.expiresAt};
    },
    assertPublishTool(p:VerifiedMcpFacebookPublisher):void{
      if(p.source!=='CUSTOMER_MCP'||p.audience!=='starli-customer-facebook-mcp'||
         p.tenantId!==p.subjectId||p.ownerId!==p.subjectId||
         !p.scopes.includes('facebook.pages.publish')||!Number.isFinite(p.expiresAt)||p.expiresAt<=Date.now())
        throw Error('CUSTOMER_MCP_PUBLISH_DENIED');
    }
  };
}
