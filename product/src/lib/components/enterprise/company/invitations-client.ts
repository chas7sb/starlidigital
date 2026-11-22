import {CompanyClient,WorkspaceError} from '$lib/utils/company-workspace';
export type Invitation={id:string;email:string;role:string;expires:number;state:string};
export class InvitationsClient{
 private client:CompanyClient;
 constructor(readonly companyId:string,token:()=>string){this.client=new CompanyClient(companyId,token);}
 close(){this.client.close();}
 async list():Promise<Invitation[]>{const d=await this.client.request('/email-invitations');if(!Array.isArray(d.invitations)||d.invitations.some((v:any)=>typeof v.id!=='string'||typeof v.email!=='string'||typeof v.role!=='string'||typeof v.expires!=='number'))throw new WorkspaceError(0,'Invalid invitations response');return d.invitations;}
 create(email:string,role:string,previous?:string){return this.client.request('/email-invitations','POST',{email,role,previous:previous??null,ttl:86400});}
 revoke(id:string){return this.client.request('/email-invitations/'+encodeURIComponent(id),'DELETE');}
}
export async function invitationAction(action:'inspect'|'accept'|'register',token:string,bearer:string='',fields:Record<string,string>={},signal?:AbortSignal){
 const r=await fetch('/api/v1/companies/email-invitations/'+action,{method:'POST',signal,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify({token,...fields})});
 const d=await r.json();if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:'Invitation unavailable');return d;
}
