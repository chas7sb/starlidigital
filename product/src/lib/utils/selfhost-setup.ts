export type SetupStatus={setupRequired:boolean;singleCompany:true;registrationAllowed:false;companyConfigured?:boolean;setupLocked?:boolean};
export type InitialAdministrator={email:string;name:string;password:string;companyName:string};
export function verifiedSetupStatus(value:any):SetupStatus{
 if(typeof value?.setupRequired!=='boolean'||value.singleCompany!==true||value.registrationAllowed!==false)throw Error('The installation setup state could not be verified.');
 for(const key of ['companyConfigured','setupLocked','requiresMigration'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error('The installation setup state could not be verified.');
 if(value.requiresMigration||value.setupRequired&&(value.setupLocked||value.companyConfigured)||!value.setupRequired&&value.companyConfigured===false)throw Error('This installation requires administrator maintenance before it can open. Existing accounts are preserved.');
 return {setupRequired:value.setupRequired,singleCompany:true,registrationAllowed:false,companyConfigured:value.companyConfigured,setupLocked:value.setupLocked};
}
export function installationEntry(status:SetupStatus):'create-initial-administrator'|'workspace'{return verifiedSetupStatus(status).setupRequired?'create-initial-administrator':'workspace';}
export async function loadSetupStatus(signal:AbortSignal,transport:typeof fetch=fetch):Promise<SetupStatus>{
 const response=await transport('/api/v1/setup/status',{signal,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('Installation status is unavailable. Check the local service, then retry.');
 return verifiedSetupStatus(await response.json());
}
export async function createInitialAdministrator(input:InitialAdministrator,signal:AbortSignal,transport:typeof fetch=fetch):Promise<{setupComplete:true;companyId:string}>{
 if(!(await loadSetupStatus(signal,transport)).setupRequired)throw Error('This installation is already initialized. Sign in with the existing administrator account.');
 const response=await transport('/api/v1/setup',{method:'POST',signal,credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json','X-Starli-Setup':'1'},body:JSON.stringify(input)});
 if(response.status===409)throw Error('This installation was initialized by another request. Sign in with its existing administrator account.');
 if(response.status!==201||!response.headers.get('content-type')?.includes('application/json'))throw Error('Administrator creation could not be confirmed. Check installation status before trying again.');
 const result=await response.json();
 if(result?.setupComplete!==true||typeof result.companyId!=='string'||!result.companyId)throw Error('The setup receipt could not be verified. Check installation status.');
 if((await loadSetupStatus(signal,transport)).setupRequired)throw Error('Setup completion could not be verified. Check installation status.');
 return {setupComplete:true,companyId:result.companyId};
}
export async function signInInitialAdministrator(email:string,password:string,signal:AbortSignal,transport:typeof fetch=fetch):Promise<string>{
 const response=await transport('/api/v1/auths/signin',{method:'POST',signal,credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({email,password})});
 if(!response.ok)throw Error('Administrator created. Sign in with your new account to continue.');
 const session=await response.json();
 if(typeof session?.token!=='string'||!session.token)throw Error('Administrator created. Sign in to continue.');
 const verified=await transport('/api/v1/auths/',{signal,credentials:'same-origin',headers:{Accept:'application/json',Authorization:'Bearer '+session.token}});
 if(!verified.ok)throw Error('Administrator created. Sign in to continue.');
 const account=await verified.json();
 if(typeof account?.id!=='string'||account.role!=='admin'||account.email?.toLowerCase()!==email.toLowerCase())throw Error('The administrator session could not be verified. Sign in to continue.');
 return session.token;
}
export function onlyInstallationCompany<T extends {id:string}>(companies:T[]):T{
 if(companies.length!==1||typeof companies[0]?.id!=='string'||!companies[0].id)throw Error('This installation must expose exactly one company. Contact the administrator.');
 return companies[0];
}
