import type {SocialConnection,SocialPlatform} from './types.js';

export type SocialCanonicalConnectionState='CONNECTED'|'CONFIGURATION_NEEDED'|'PERMISSION_REQUIRED'|'UNAVAILABLE'|'DEGRADED';
export type SocialAnalyticsAvailability='AVAILABLE'|'NO_VERIFIED_DATA'|'UNAVAILABLE';

export interface SocialConnectionTruth {
  id:string;
  platform:SocialPlatform;
  provider:string;
  state:SocialCanonicalConnectionState;
  displayName?:string;
  handle?:string;
  capabilities:string[];
  connectedAt:string;
  refreshedAt:string;
  reconnectRequired:boolean;
  detail:string;
}

export interface SocialConnectionTruthSnapshot {
  providerConfigured:boolean;
  state:SocialCanonicalConnectionState;
  connectedCount:number;
  permissionRequiredCount:number;
  degradedCount:number;
  configurationNeededCount:number;
  connections:SocialConnectionTruth[];
  analytics:{availability:SocialAnalyticsAvailability;detail:string};
}

export function canonicalSocialConnectionState(connection:Pick<SocialConnection,'state'>):SocialCanonicalConnectionState{
  switch(connection.state){
    case 'CONNECTED': return 'CONNECTED';
    case 'REAUTH_REQUIRED': return 'DEGRADED';
    case 'ERROR': return 'DEGRADED';
    case 'DISCONNECTED': return 'CONFIGURATION_NEEDED';
  }
}

export function projectSocialConnectionTruth(connection:SocialConnection):SocialConnectionTruth{
  const state=canonicalSocialConnectionState(connection);
  return {
    id:connection.id,
    platform:connection.platform,
    provider:connection.provider,
    state,
    displayName:connection.safeMetadata.displayName,
    handle:connection.safeMetadata.handle,
    capabilities:[...connection.capabilities].sort(),
    connectedAt:connection.connectedAt,
    refreshedAt:connection.refreshedAt,
    reconnectRequired:connection.state==='REAUTH_REQUIRED',
    detail:state==='CONNECTED'?'Connected and available to Social Cloud.':connection.state==='REAUTH_REQUIRED'?'Reconnect this account before Starli can publish externally.':state==='DEGRADED'?'The provider connection needs attention. Starli will not assume it is publish-ready.':'This account is not currently connected.',
  };
}

export function socialConnectionTruthSnapshot(input:{providerConfigured:boolean;connections:SocialConnection[];analyticsVerified?:boolean}):SocialConnectionTruthSnapshot{
  const connections=input.connections.map(projectSocialConnectionTruth);
  const connectedCount=connections.filter(c=>c.state==='CONNECTED').length;
  const permissionRequiredCount=connections.filter(c=>c.state==='PERMISSION_REQUIRED').length;
  const degradedCount=connections.filter(c=>c.state==='DEGRADED').length;
  const configurationNeededCount=connections.filter(c=>c.state==='CONFIGURATION_NEEDED').length;
  const state:SocialCanonicalConnectionState=!input.providerConfigured?'UNAVAILABLE':degradedCount?'DEGRADED':permissionRequiredCount?'PERMISSION_REQUIRED':connectedCount?'CONNECTED':'CONFIGURATION_NEEDED';
  const analytics=input.analyticsVerified?{availability:'AVAILABLE' as const,detail:'Verified provider analytics are available.'}:{availability:input.providerConfigured?'NO_VERIFIED_DATA' as const:'UNAVAILABLE' as const,detail:input.providerConfigured?'No verified social analytics have been ingested yet. Starli will not fabricate metrics.':'Social analytics are unavailable until the provider is configured.'};
  return{providerConfigured:input.providerConfigured,state,connectedCount,permissionRequiredCount,degradedCount,configurationNeededCount,connections,analytics};
}
