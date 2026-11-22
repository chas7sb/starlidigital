/** Server-only registrar adapter. The caller owns authorization, paid-order gating and idempotency. */
export type DomainQuote={provider:'VERCEL';domain:string;supported:boolean;available:boolean;currency:'USD';purchasePrice:number|null;renewalPrice:number|null;years:number;quotedAt:string;expiresAt:string;reason:string|null};
export type DomainContact={firstName:string;lastName:string;email:string;phone:string;address1:string;city:string;state:string;zip:string;country:string;address2?:string;companyName?:string;fax?:string;additional?:Record<string,unknown>};
export type DomainPurchaseInput={domain:string;years:number;autoRenew:boolean;expectedPrice:number;contactInformation:DomainContact};
export type DomainOrder={orderId:string;status:'PENDING'|'COMPLETED'|'FAILED';domains:{domain:string;status:'PENDING'|'COMPLETED'|'FAILED';years:number;autoRenew?:boolean}[]};
export type ProjectDomain={domain:string;verified:boolean;verification:{type:string;domain:string;value:string;reason:string}[]};
export class DomainProviderError extends Error{
 constructor(message:string,public readonly code:'REGISTRAR_UNAVAILABLE'|'PROVIDER_REJECTED'|'RECONCILIATION_REQUIRED'){super(message);this.name='DomainProviderError';}
}
/** Other registrars can implement this interface; an unsupported TLD is never simulated. */
export interface RegistrarProvider{quote(domain:string,years?:number):Promise<DomainQuote>;contactSchema(domain:string):Promise<Record<string,unknown>>;purchase(input:DomainPurchaseInput):Promise<{orderId:string;status:'PENDING'}>;order(orderId:string):Promise<DomainOrder>}

const API='https://api.vercel.com';
const QUOTE_TTL=10*60000;
export function domainsConfigured():boolean{return Boolean(process.env.VERCEL_TOKEN?.trim());}
export function normalizeDomain(value:string):string{
 if(typeof value!=='string')throw new Error('Numele domeniului nu este valid.');
 const domain=value.trim().toLowerCase().replace(/\.$/,'');
 if(domain.length<4||domain.length>253||!/^[a-z0-9.-]+$/.test(domain)||!/[a-z]{2,}$/.test(domain)||domain.split('.').length<2||domain.split('.').some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw new Error('Introdu un domeniu valid, fără protocol, port, cale sau caractere speciale.');
 if(domain.split('.').some(label=>label.startsWith('xn--')))throw new Error('Domeniile internaționalizate necesită verificarea separată a limbii de înregistrare. Folosește un nume fără diacritice.');
 return domain;
}
function yearsValue(years:number):number{if(!Number.isInteger(years)||years<1||years>10)throw new Error('Perioada de înregistrare trebuie să fie între 1 și 10 ani.');return years;}
function price(value:unknown):number|null{
 // Strings in the registrar API can represent unavailable operations. Never coerce them into payable quotes.
 return typeof value==='number'&&Number.isFinite(value)&&value>=0.01&&value<=100000&&Math.abs(Math.round(value*100)-value*100)<0.000001?value:null;
}
function object(value:unknown):value is Record<string,any>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function safeId(value:string,label:string):string{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{3,160}$/.test(value))throw new Error(`${label} invalid.`);return value;}
async function api(path:string,options:{method?:'GET'|'POST';body?:unknown;auth?:boolean;query?:Record<string,string>}={}):Promise<any>{
 const token=process.env.VERCEL_TOKEN?.trim();if(options.auth&&!token)throw new Error('Conexiunea Vercel pentru domenii nu este configurată.');
 const url=new URL(path,API);if(process.env.VERCEL_TEAM_ID?.trim())url.searchParams.set('teamId',process.env.VERCEL_TEAM_ID.trim());
 for(const[key,value]of Object.entries(options.query||{}))url.searchParams.set(key,value);
 let response:Response;
 try{response=await fetch(url,{method:options.method||'GET',headers:{'Content-Type':'application/json',...(options.auth?{Authorization:`Bearer ${token}`}:{})},...(options.body!==undefined?{body:JSON.stringify(options.body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}
 catch{throw new DomainProviderError(options.method==='POST'?'Conexiunea cu registrarul s-a întrerupt. Starea operațiunii trebuie reconciliată înainte de reîncercare.':'Registrarul nu a răspuns în timp util. Reîncearcă mai târziu.',options.method==='POST'?'RECONCILIATION_REQUIRED':'REGISTRAR_UNAVAILABLE');}
 if(!response.ok)throw new DomainProviderError(`Operațiunea pentru domeniu nu a fost confirmată de Vercel (${response.status}).`,options.method==='POST'&&response.status>=500?'RECONCILIATION_REQUIRED':'PROVIDER_REJECTED');
 try{
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty response');
  const decoder=new TextDecoder();let content='',length=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>100000){await reader.cancel();throw new Error('Response limit');}content+=decoder.decode(chunk.value,{stream:true});}
  content+=decoder.decode();return JSON.parse(content);
 }catch{throw new DomainProviderError('Registrarul a returnat un răspuns invalid sau incomplet. Starea trebuie verificată înainte de reîncercare.',options.method==='POST'?'RECONCILIATION_REQUIRED':'REGISTRAR_UNAVAILABLE');}
}
async function supportedTld(domain:string):Promise<string|null>{
 const catalog=await api('/v1/registrar/tlds/supported');
 if(!Array.isArray(catalog)||catalog.length<1||catalog.length>3000||catalog.some(value=>typeof value!=='string'))throw new Error('Catalogul extensiilor registrarului este invalid.');
 const suffix=catalog.map(value=>value.toLowerCase().replace(/^\./,'')).filter(value=>domain.endsWith('.'+value)).sort((a,b)=>b.length-a.length)[0];
 if(!suffix)return null;
 if(domain.slice(0,-suffix.length-1).includes('.'))throw new Error('Pentru achiziție, alege domeniul principal, fără un subdomeniu precum www.');
 return suffix;
}
export async function quoteDomain(value:string,years=1):Promise<DomainQuote>{
 const domain=normalizeDomain(value);yearsValue(years);
 const quotedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(quotedAt)+QUOTE_TTL).toISOString();
 const base={provider:'VERCEL' as const,domain,currency:'USD' as const,years,quotedAt,expiresAt};
 if(!await supportedTld(domain))return{...base,supported:false,available:false,purchasePrice:null,renewalPrice:null,reason:'Extensia nu este disponibilă la registrarul conectat. Este necesar un registrar alternativ; nu s-a plasat nicio comandă.'};
 const availability=await api(`/v1/registrar/domains/${encodeURIComponent(domain)}/availability`);
 if(!object(availability)||typeof availability.available!=='boolean')throw new Error('Disponibilitatea domeniului nu a putut fi confirmată.');
 if(!availability.available)return{...base,supported:true,available:false,purchasePrice:null,renewalPrice:null,reason:'Domeniul nu este disponibil pentru înregistrare.'};
 const data=await api(`/v1/registrar/domains/${encodeURIComponent(domain)}/price`,{query:{years:String(years)}});
 if(!object(data)||data.years!==years)throw new Error('Registrarul nu a confirmat prețul pentru perioada cerută.');
 const purchasePrice=price(data.purchasePrice),renewalPrice=price(data.renewalPrice);
 return{...base,supported:true,available:true,purchasePrice,renewalPrice,reason:purchasePrice===null?'Registrarul nu a furnizat un preț numeric sigur pentru achiziție.':renewalPrice===null?'Prețul de reînnoire nu este disponibil. Reînnoirea automată nu poate fi activată.':null};
}
export async function getDomainContactSchema(value:string):Promise<Record<string,unknown>>{
 const domain=normalizeDomain(value);if(!await supportedTld(domain))throw new Error('Extensia nu este acceptată de registrarul conectat.');
 const data=await api(`/v1/registrar/domains/${encodeURIComponent(domain)}/contact-info/schema`);
 if(!object(data)||JSON.stringify(data).length>30000)throw new Error('Schema datelor de înregistrare nu este validă.');return data;
}
function validateSchema(value:unknown,schema:any,depth=0):void{
 if(depth>5||!object(schema)||schema.$ref||schema.anyOf||schema.oneOf||schema.allOf||schema.not)throw new Error('Schema suplimentară a registrarului necesită verificare manuală.');
 if(schema.enum&&(!Array.isArray(schema.enum)||!schema.enum.includes(value)))throw new Error('O informație suplimentară nu corespunde opțiunilor registrarului.');
 if(schema.type==='object'||schema.properties||schema.required){
  if(!object(value))throw new Error('Informațiile suplimentare trebuie completate.');
  const properties=object(schema.properties)?schema.properties:{};
  if(Array.isArray(schema.required)&&schema.required.some((key:unknown)=>typeof key!=='string'||value[key]===undefined||value[key]===''))throw new Error('Lipsesc informații suplimentare cerute de registrar.');
  for(const[key,item]of Object.entries(value)){if(properties[key])validateSchema(item,properties[key],depth+1);else if(schema.additionalProperties===false)throw new Error('O informație suplimentară nu este permisă de registrar.');}
 }else if(schema.type==='string'){
  if(typeof value!=='string'||(typeof schema.minLength==='number'&&value.length<schema.minLength)||(typeof schema.maxLength==='number'&&value.length>schema.maxLength))throw new Error('O informație suplimentară are un format invalid.');
  // Arbitrary remote regular expressions are not executed in the API process.
  if(schema.pattern)throw new Error('Câmpul suplimentar cu reguli speciale necesită verificare manuală.');
 }else if(schema.type==='boolean'&&typeof value!=='boolean')throw new Error('O opțiune suplimentară nu este validă.');
 else if(['integer','number'].includes(schema.type)&&(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value))))throw new Error('O valoare suplimentară nu este validă.');
 else if(schema.type&& !['object','string','boolean','integer','number'].includes(schema.type))throw new Error('Tipul datelor suplimentare necesită verificare manuală.');
}
export function validateDomainContact(value:unknown):DomainContact{
 if(!object(value))throw new Error('Completează datele titularului domeniului.');
 const required=['firstName','lastName','email','phone','address1','city','state','zip','country'];
 const optional=['address2','companyName','fax'];const allowed=new Set([...required,...optional,'additional']);
 if(Object.keys(value).some(key=>!allowed.has(key)))throw new Error('Datele titularului conțin câmpuri nepermise.');
 const result:Record<string,unknown>={};
 for(const field of [...required,...optional]){
  const item=value[field];if(item===undefined&&!required.includes(field))continue;
  if(typeof item!=='string'||!item.trim()||item.length>300||/[\u0000-\u001f]/.test(item))throw new Error(`Completează corect câmpul ${field}.`);result[field]=item.trim();
 }
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.email))||String(result.email).length>254)throw new Error('Emailul titularului nu este valid.');
 if(!/^\+[1-9]\d{6,14}$/.test(String(result.phone))||(result.fax&&!/^\+[1-9]\d{6,14}$/.test(String(result.fax))))throw new Error('Telefonul trebuie introdus în format internațional, de exemplu +40722123456.');
 result.country=String(result.country).toUpperCase();if(!/^[A-Z]{2}$/.test(String(result.country)))throw new Error('Țara trebuie să folosească un cod de două litere, de exemplu RO.');
 if(value.additional!==undefined){if(!object(value.additional)||Object.keys(value.additional).length>50||Object.entries(value.additional).some(([key,item])=>!/^[a-zA-Z0-9_-]{1,100}$/.test(key)||['__proto__','constructor','prototype'].includes(key)||!['string','number','boolean'].includes(typeof item)||(typeof item==='number'&&!Number.isFinite(item))||String(item).length>1000))throw new Error('Datele suplimentare ale titularului nu sunt valide.');result.additional={...value.additional};}
 return result as DomainContact;
}
export async function purchaseDomain(input:DomainPurchaseInput):Promise<{orderId:string;status:'PENDING'}>{
 if(process.env.DOMAIN_PURCHASE_ENABLED!=='true')throw new Error('Achizițiile de domenii sunt dezactivate. Este necesară activarea explicită a registrarului.');
 if(!domainsConfigured())throw new Error('Conexiunea Vercel pentru domenii nu este configurată.');
 const domain=normalizeDomain(input.domain);yearsValue(input.years);
 if(typeof input.autoRenew!=='boolean'||price(input.expectedPrice)===null)throw new Error('Prețul așteptat sau opțiunea de reînnoire nu este validă.');
 const contactInformation=validateDomainContact(input.contactInformation);
 const live=await quoteDomain(domain,input.years);
 if(!live.supported||!live.available||live.purchasePrice===null)throw new Error('Domeniul nu poate fi cumpărat în condițiile ofertei.');
 if(Math.round(live.purchasePrice*100)!==Math.round(input.expectedPrice*100))throw new Error('Prețul domeniului s-a schimbat. Este necesară o ofertă și o autorizare nouă.');
 if(input.autoRenew&&live.renewalPrice===null)throw new Error('Reînnoirea automată necesită un preț de reînnoire confirmat.');
 const schema=await getDomainContactSchema(domain);if(Object.keys(schema).length)validateSchema(contactInformation.additional||{},schema);
 // Never retry this POST automatically: an interrupted response can follow a successful charge.
 const data=await api(`/v1/registrar/domains/${encodeURIComponent(domain)}/buy`,{method:'POST',auth:true,body:{autoRenew:input.autoRenew,years:input.years,expectedPrice:input.expectedPrice,contactInformation}});
 if(!object(data)||typeof data.orderId!=='string'||!/^[a-zA-Z0-9_-]{3,160}$/.test(data.orderId))throw new DomainProviderError('Registrarul nu a returnat identificatorul comenzii. Verifică înainte de reîncercare.','RECONCILIATION_REQUIRED');
 return{orderId:safeId(data.orderId,'Identificatorul comenzii'),status:'PENDING'};
}
const status=(value:unknown):'PENDING'|'COMPLETED'|'FAILED'=>{
 if(['draft','purchasing','pending'].includes(String(value)))return'PENDING';
 if(value==='completed')return'COMPLETED';
 if(['failed','refunded','refund-failed'].includes(String(value)))return'FAILED';
 throw new Error('Registrarul a returnat o stare necunoscută.');
};
export async function getDomainOrder(orderId:string):Promise<DomainOrder>{
 safeId(orderId,'Identificatorul comenzii');const data=await api(`/v1/registrar/orders/${encodeURIComponent(orderId)}`,{auth:true});
 if(!object(data)||data.orderId!==orderId||!Array.isArray(data.domains)||data.domains.length>50)throw new Error('Comanda registrarului nu a putut fi confirmată.');
 const domains=data.domains.map((item:any)=>{if(!object(item))throw new Error('Domeniu invalid în comandă.');return{domain:normalizeDomain(item.domainName),status:status(item.status),years:yearsValue(item.years),...(typeof item.autoRenew==='boolean'?{autoRenew:item.autoRenew}:{})};});
 let orderStatus=status(data.status);if(orderStatus==='COMPLETED'&&(domains.length===0||domains.some((item:any)=>item.status!=='COMPLETED')))orderStatus=domains.some((item:any)=>item.status==='FAILED')?'FAILED':'PENDING';
 return{orderId,status:orderStatus,domains};
}
function projectDomain(data:unknown,domain:string):ProjectDomain{
 if(!object(data)||data.name!==domain||typeof data.verified!=='boolean')throw new Error('Conectarea domeniului la proiect nu a putut fi confirmată.');
 const verification=Array.isArray(data.verification)?data.verification.slice(0,10).map((item:any)=>{if(!object(item)||['type','domain','value','reason'].some(key=>typeof item[key]!=='string'||item[key].length>2000))throw new Error('Provocarea DNS a registrarului este invalidă.');return{type:item.type,domain:item.domain,value:item.value,reason:item.reason};}):[];
 return{domain,verified:data.verified,verification};
}
export async function attachProjectDomain(projectId:string,value:string):Promise<ProjectDomain>{
 safeId(projectId,'Proiectul Vercel');const domain=normalizeDomain(value);
 return projectDomain(await api(`/v10/projects/${encodeURIComponent(projectId)}/domains`,{method:'POST',auth:true,body:{name:domain}}),domain);
}
export async function verifyProjectDomain(projectId:string,value:string):Promise<ProjectDomain>{
 safeId(projectId,'Proiectul Vercel');const domain=normalizeDomain(value);
 return projectDomain(await api(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}/verify`,{method:'POST',auth:true,body:{}}),domain);
}
export const vercelRegistrar:RegistrarProvider={quote:quoteDomain,contactSchema:getDomainContactSchema,purchase:purchaseDomain,order:getDomainOrder};
