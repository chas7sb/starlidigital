export type NativeAuthority={company_id:string;user_id:string;role:'owner'|'admin'|'member';kind:'person'|'bot';membership_revision:number;contract_version:2;capabilities:string[]};
const role=(v:unknown):v is NativeAuthority['role']=>['owner','admin','member'].includes(v as string);
const revision=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=1;
export function parseNativeAuthority(value:any,companyId:string,actorId:string):NativeAuthority{
 if(!companyId||!actorId||!value||Array.isArray(value)||value.company_id!==companyId||value.user_id!==actorId||value.contract_version!==2||!role(value.role)||!['person','bot'].includes(value.kind)||!revision(value.membership_revision)||!Array.isArray(value.capabilities)||value.capabilities.some((c:any)=>typeof c!=='string'||!c||c.length>120))throw Error('Company authority could not be verified.');
 return {...value,capabilities:[...new Set(value.capabilities)]};
}
export function parseNativeCompanyList(value:any){
 const envelope=!Array.isArray(value)&&value?.contract_version===2&&Array.isArray(value.companies)?value:null;
 const rows=Array.isArray(value)?value:envelope?.companies;if(!Array.isArray(rows))throw Error('Company list contract is unavailable.');const seen=new Set<string>();
 return rows.map((row:any)=>{const object=!Array.isArray(row)&&row&&typeof row==='object'&&(envelope||row.contract_version===2);const values=Array.isArray(row)&&row.length===4?row:object?[row.company_id,row.name,row.role,row.membership_revision]:[];const [id,name,r,rev]=values;if(typeof id!=='string'||!id||typeof name!=='string'||!role(r)||!revision(rev)||seen.has(id))throw Error('Company list could not be verified.');seen.add(id);return{id,name,role:r,revision:rev};});
}
export function projectNativeDirectory(value:any,scope:NativeAuthority){
 if(!Array.isArray(value))throw Error('Company directory could not be verified.');const seen=new Set<string>();return value.map(p=>{if(!p||typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!['person','bot'].includes(p.kind)||seen.has(p.id))throw Error('Company directory could not be verified.');seen.add(p.id);return{id:p.id,name:p.name,kind:p.kind,...(p.id===scope.user_id?{role:scope.role}:{})};});
}
