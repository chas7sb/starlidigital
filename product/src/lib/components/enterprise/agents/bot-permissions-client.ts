import {CompanyClient,WorkspaceError} from '$lib/utils/company-workspace';
export type BotRole={id:string;name:string;kind:'person'|'bot';grants:string[];active:boolean};
export type Permission={name:string;delegable:boolean};
export type BotPermissionState={canManage:boolean;roles:BotRole[];permissions:Permission[];effective:string[]|null;assignedRoleIds:string[]|null};
const strings=(v:any):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length>0);
export class BotPermissionsClient {
 private client:CompanyClient;
 constructor(readonly companyId:string,readonly botId:string,token:()=>string,transport:typeof fetch=fetch){this.client=new CompanyClient(companyId,token,transport);}
 close(){this.client.close();}
 private call(path:string,method='GET',body?:unknown){return this.client.request(path,method,body,undefined,true);}
 private targetPath(){return '/members/'+encodeURIComponent(this.botId);}
 async load():Promise<BotPermissionState>{
  const actor=await this.call('/capabilities');
  if(actor.company_id!==this.companyId||actor.kind!=='person'||actor.contract_version!==2||typeof actor.user_id!=='string'||!strings(actor.capabilities)||!['owner','admin','member'].includes(actor.role))throw new WorkspaceError(0,'Company authority could not be verified.');
  const canManage=['owner','admin'].includes(actor.role)&&actor.capabilities.includes('roles.manage');
  const [roles,catalog]=await Promise.all([this.call('/roles'),this.call('/permissions')]);
  if(!Array.isArray(roles)||roles.some((r:any)=>typeof r.id!=='string'||!r.id||typeof r.name!=='string'||!['person','bot'].includes(r.kind)||typeof r.active!=='boolean'||!strings(r.grants))||new Set(roles.map((r:any)=>r.id)).size!==roles.length)throw new WorkspaceError(0,'Company roles could not be verified.');
  if(catalog.contract_version!==2||!Array.isArray(catalog.permissions)||catalog.permissions.some((p:any)=>typeof p.name!=='string'||typeof p.delegable!=='boolean'))throw new WorkspaceError(0,'Company permission catalog is unavailable.');
  if(!canManage)return {canManage,roles,permissions:catalog.permissions,effective:null,assignedRoleIds:null};
  const target=await this.call(this.targetPath()+'/capabilities');
  if(target.company_id!==this.companyId||target.user_id!==this.botId||target.kind!=='bot'||target.contract_version!==2||!strings(target.capabilities))throw new WorkspaceError(0,'Bot permission scope could not be verified.');
  let assignedRoleIds:string[]|null=null;
  if(target.role_ids!==undefined){if(!strings(target.role_ids))throw new WorkspaceError(0,'Bot role assignments could not be verified.');assignedRoleIds=target.role_ids;}
  else{
   try{
    const links=await this.call(this.targetPath()+'/roles');
    if(links.version!=='starli.company-bot-role-assignments.v1'||links.company_id!==this.companyId||links.user_id!==this.botId||links.kind!=='bot'||!strings(links.role_ids))throw new WorkspaceError(0,'Bot role assignment scope could not be verified.');
    assignedRoleIds=links.role_ids;
   }catch(e){if(![403,404].includes((e as WorkspaceError).status))throw e;}
  }
  if(assignedRoleIds?.some(id=>!roles.some((r:BotRole)=>r.id===id&&r.kind==='bot')))throw new WorkspaceError(0,'Bot role assignments do not match this company.');
  return {canManage,roles,permissions:catalog.permissions,effective:target.capabilities,assignedRoleIds};
 }
 async apply(role:BotRole,remove=false){
  const fresh=await this.load();if(!fresh.canManage)throw new WorkspaceError(403,'Company admin access is required.');
  const current=fresh.roles.find(r=>r.id===role.id&&r.kind==='bot'&&r.active);
  if(!current||JSON.stringify([...current.grants].sort())!==JSON.stringify([...role.grants].sort())||current.name!==role.name)throw new WorkspaceError(409,'This role changed. Reload and review its permissions.');
  if(!remove&&current.grants.some(g=>!fresh.permissions.some(p=>p.name===g&&p.delegable)))throw new WorkspaceError(403,'This role contains a permission that cannot be delegated.');
  await this.call('/roles/'+encodeURIComponent(role.id)+'/members/'+encodeURIComponent(this.botId),remove?'DELETE':'PUT');
  const result=await this.load();
  if(result.assignedRoleIds!==null&&result.assignedRoleIds.includes(role.id)===remove)throw new WorkspaceError(0,'Role assignment could not be confirmed. Reload to reconcile it.');
  if(!remove&&(!result.roles.some(r=>r.id===role.id&&r.active)||current.grants.some(g=>!result.effective?.includes(g))))throw new WorkspaceError(0,'Effective permissions changed during the update. Reload to reconcile them.');
  return result;
 }
 async createRole(name:string,grants:string[]){
  const fresh=await this.load();if(!fresh.canManage)throw new WorkspaceError(403,'Company admin access is required.');
  if(!name.trim()||name.trim().length>100||!grants.length||grants.some(g=>!fresh.permissions.some(p=>p.name===g&&p.delegable)))throw new WorkspaceError(0,'Choose a name and supported delegable permissions.');
  const unique=[...new Set(grants)].sort(),existing=fresh.roles.find(r=>r.kind==='bot'&&r.name===name.trim());
  if(existing){if(existing.active&&JSON.stringify([...existing.grants].sort())===JSON.stringify(unique))return existing;throw new WorkspaceError(409,'A bot role with this name already exists. Choose a different name.');}
  const receipt=await this.call('/roles','POST',{name:name.trim(),kind:'bot',grants:unique});if(typeof receipt.role_id!=='string')throw new WorkspaceError(0,'Role creation is unconfirmed. Reload the role list before retrying.');
  const result=await this.load(),role=result.roles.find(r=>r.id===receipt.role_id&&r.kind==='bot'&&r.active&&r.name===name.trim());
  if(!role||JSON.stringify([...role.grants].sort())!==JSON.stringify(unique))throw new WorkspaceError(0,'Created role could not be verified. Reload before continuing.');
  return role;
 }
}
