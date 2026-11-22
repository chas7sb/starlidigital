import type { ProviderPublishInput, ProviderPublishResult, SocialConnection, SocialConnectionFlow, SocialPlatformResult, SocialProviderAdapter, SocialTarget, SocialInteractionSummary, SocialWriteReceipt } from './types.js';
export class FakeSocialProviderAdapter implements SocialProviderAdapter {
  readonly provider='fake';
  calls:ProviderPublishInput[]=[];
  outcomes=new Map<string,ProviderPublishResult>();
  async createConnectionFlow():Promise<SocialConnectionFlow>{return {provider:this.provider,flowRef:'flow_fake',launchUrl:'https://example.invalid/connect'};}
  async listConnectedAccounts(){return [] as Array<Omit<SocialConnection,'id'|'tenantId'|'connectedAt'|'refreshedAt'>>;}
  async listTargets(_i:{connection:SocialConnection;kind:SocialTarget['kind']}){return [] as SocialTarget[];}
  private async pub(i:ProviderPublishInput){this.calls.push(structuredClone(i));return this.outcomes.get(i.connection.id)||{state:i.schedule.mode==='SCHEDULE'?'SCHEDULED':i.schedule.mode==='QUEUE'?'QUEUED':'PUBLISHED',providerPostRef:`post_${i.connection.id}`,publishedAt:new Date().toISOString()} as ProviderPublishResult;}
  publishVideo(i:ProviderPublishInput){return this.pub(i)} publishImages(i:ProviderPublishInput){return this.pub(i)} publishText(i:ProviderPublishInput){return this.pub(i)}
  async editScheduled(){return {state:'SCHEDULED'} as ProviderPublishResult} async cancelScheduled(){return {state:'CANCELLED'} as ProviderPublishResult} async getStatus(){return {state:'PUBLISHED'} as ProviderPublishResult}
  async history(_i:{connection:SocialConnection;limit:number}){return [] as SocialPlatformResult[]} async recentMedia(_i:{connection:SocialConnection;limit:number}){return []} async postAnalytics(_i:{connection:SocialConnection;providerPostRef:string}){return {views:10}} async profileAnalytics(_i:{connection:SocialConnection}){return {followers:20}}
  async listComments(){return [] as SocialInteractionSummary[]} async replyToComment(){return {state:'PUBLISHED'} as SocialWriteReceipt} async moderateComment(){return {state:'PUBLISHED'} as SocialWriteReceipt}
  async listDms(){return [] as SocialInteractionSummary[]} async sendDm(){return {state:'PUBLISHED'} as SocialWriteReceipt}
  async listGoogleBusinessReviews(){return [] as SocialInteractionSummary[]} async replyGoogleBusinessReview(){return {state:'PUBLISHED'} as SocialWriteReceipt}
}
