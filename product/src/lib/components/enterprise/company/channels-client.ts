import {CompanyClient,WorkspaceError} from '$lib/utils/company-workspace';
import {parseNativeAuthority} from '$lib/utils/company-authority';

export type ChannelSettings={version:'starli.company-channel-settings.v1';id:string;companyId:string;name:string;description:string;visibility:'public'|'private';revision:number;createdBy:string;membershipPolicy:'company'|'participants';memberIds:string[];agentIds:string[];canOpen:boolean;cancelledRunIds?:string[]};
export type ChannelDraft={name:string;description:string;visibility:'public'|'private';memberIds:string[];agentIds:string[]};
export type ChannelPage={version:'starli.company-channels.v1';companyId:string;canManage:true;channels:ChannelSettings[];hasMore:boolean;next:string};
const ids=(v:unknown,max=1000):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=128)&&new Set(v).size===v.length;
export class ChannelManagementDenied extends WorkspaceError {readonly managementDenied=true;constructor(){super(403,'Only company owners and administrators can manage channels.');}}
const pendingCreates=new Map<string,{draft:ChannelDraft;key:string}>();
export function channelDraft(value:ChannelDraft):ChannelDraft{return {name:value.name.trim(),description:value.description,visibility:value.visibility,memberIds:value.visibility==='public'?[]:[...value.memberIds].sort(),agentIds:[...value.agentIds].sort()};}
export class CompanyChannelsClient {
 private client:CompanyClient;private initialToken:string;
 constructor(readonly companyId:string,readonly actorId:string,private token:()=>string,transport:typeof fetch=(...args)=>fetch(...args)){this.initialToken=token();this.client=new CompanyClient(companyId,token,transport);}
 close(){this.client.close();}
 private key(){return JSON.stringify([this.companyId,this.actorId,this.initialToken]);}
 forgetSession(){pendingCreates.delete(this.key());this.close();}
 resumeCreate(){const request=pendingCreates.get(this.key());return request?{key:request.key,draft:channelDraft(request.draft)}:null;}
 private async authority(){const raw=await this.client.request('/capabilities','GET',undefined,undefined,true);const scope=parseNativeAuthority(raw,this.companyId,this.actorId);if(scope.kind!=='person'||!['owner','admin'].includes(scope.role))throw new ChannelManagementDenied();return scope;}
 private value(raw:any,expectedId?:string):ChannelSettings{
  if(raw?.version!=='starli.company-channel-settings.v1'||raw.companyId!==this.companyId||typeof raw.id!=='string'||!raw.id||(expectedId!==undefined&&raw.id!==expectedId)||typeof raw.name!=='string'||typeof raw.description!=='string'||!['public','private'].includes(raw.visibility)||!Number.isSafeInteger(raw.revision)||raw.revision<1||typeof raw.createdBy!=='string'||!raw.createdBy||raw.membershipPolicy!==(raw.visibility==='public'?'company':'participants')||!ids(raw.memberIds)||!ids(raw.agentIds,16)||typeof raw.canOpen!=='boolean'||(raw.cancelledRunIds!==undefined&&!ids(raw.cancelledRunIds)))throw new WorkspaceError(0,'Channel configuration scope could not be verified.');
  return raw;
 }
 private draft(value:ChannelDraft){if(typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>100||typeof value.description!=='string'||value.description.length>2000||!['public','private'].includes(value.visibility)||!ids(value.memberIds)||!ids(value.agentIds,16)||(value.visibility==='public'&&value.memberIds.length>0))throw new WorkspaceError(422,'Check the channel name, description and selected members. Public channels include the whole company.');return channelDraft(value);}
 async list(after=''):Promise<ChannelPage>{await this.authority();const raw=await this.client.request('/channels?limit=100'+(after?'&after='+encodeURIComponent(after):''));if(raw.version!=='starli.company-channels.v1'||raw.canManage!==true||!Array.isArray(raw.channels)||typeof raw.hasMore!=='boolean'||typeof raw.next!=='string'||(raw.hasMore&&(!raw.next||raw.next===after)))throw new WorkspaceError(0,'Company channels could not be verified.');const channels=raw.channels.map((v:any)=>this.value(v));if(new Set(channels.map((v:ChannelSettings)=>v.id)).size!==channels.length)throw new WorkspaceError(0,'Duplicate channel identities were returned.');return {...raw,channels};}
 async read(id:string){await this.authority();return this.value(await this.client.request('/channels/'+encodeURIComponent(id)),id);}
 async create(value:ChannelDraft){
  const draft=this.draft(value),cache=this.key(),prior=pendingCreates.get(cache);
  if(prior&&JSON.stringify(prior.draft)!==JSON.stringify(draft))throw new WorkspaceError(409,'A channel creation is unconfirmed. Retry its original configuration first.');
  const request=prior||{draft,key:crypto.randomUUID()};pendingCreates.set(cache,request);
  try{await this.authority();const result=this.value(await this.client.request('/channels','POST',request.draft,request.key));if(result.createdBy!==this.actorId)throw new WorkspaceError(0,'The created channel identity could not be verified.');pendingCreates.delete(cache);return result;}
  catch(error){if([400,401,403,404,409,422].includes((error as WorkspaceError).status))pendingCreates.delete(cache);throw error;}
 }
 async archive(id:string,revision:number){await this.authority();const raw=await this.client.request('/channels/'+encodeURIComponent(id)+'/archive','POST',{expectedRevision:revision});if(raw.id!==id||raw.archived!==true||raw.revision!==revision+1)throw new WorkspaceError(0,'Channel archive could not be confirmed. Reload before continuing.');return raw;}
 async update(id:string,revision:number,value:ChannelDraft){if(!Number.isSafeInteger(revision)||revision<1)throw new WorkspaceError(409,'Reload the current channel revision before saving.');const draft=this.draft(value);if(draft.visibility==='private'&&!draft.memberIds.length)throw new WorkspaceError(422,'Choose at least one human for a private channel.');await this.authority();const result=this.value(await this.client.request('/channels/'+encodeURIComponent(id),'PUT',{...draft,expectedRevision:revision}),id);if(!ids(result.cancelledRunIds))throw new WorkspaceError(0,'The channel update could not be confirmed. Reload before continuing.');return result;}
}
