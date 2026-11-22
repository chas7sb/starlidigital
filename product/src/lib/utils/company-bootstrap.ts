import {parseNativeAuthority,parseNativeCompanyList,projectNativeDirectory} from './company-authority';
/** Native foundation contract: no fixture responses or standalone bootstrap API. */
export type NativeCompany={id:string;name:string;role:string;revision:number};
export type NativeDirectoryEntry={id:string;name:string;kind:'person'|'bot'};
export type NativeRequest=(path:string,signal:AbortSignal,options?:RequestInit)=>Promise<any>;
export const nativeCompaniesPath='/api/v1/companies';
function fresh(signal:AbortSignal){if(signal.aborted)throw new DOMException('Workspace selection changed','AbortError');}
export async function listNativeCompanies(request:NativeRequest,signal:AbortSignal):Promise<NativeCompany[]>{
 const rows=await request(nativeCompaniesPath,signal);fresh(signal);
 return parseNativeCompanyList(rows);
}
export async function switchNativeCompany(request:NativeRequest,actorId:string,company:NativeCompany,signal:AbortSignal){
 const path=nativeCompaniesPath+'/'+encodeURIComponent(company.id);
 const scope=await request(path+'/switch',signal,{method:'POST'});fresh(signal);
 let verified;try{verified=parseNativeAuthority(scope,company.id,actorId);}catch{throw Error('Company membership could not be verified.');}
 return {...company,role:verified.role,revision:verified.membership_revision,scope:verified};
}

export async function activateNativeCompany(request:NativeRequest,actorId:string,company:NativeCompany,signal:AbortSignal){
 const selected=await switchNativeCompany(request,actorId,company,signal);fresh(signal);
 const directory=await request(nativeCompaniesPath+'/'+encodeURIComponent(company.id)+'/directory',signal);fresh(signal);
 return{...selected,directory:projectNativeDirectory(directory,selected.scope) as NativeDirectoryEntry[]};
}
