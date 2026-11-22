import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {Store,id,now,type RecordData} from './store.js';
import {Events} from './events.js';
import {stripeMode} from './billing.js';
import {quoteDomain,getDomainContactSchema,purchaseDomain,getDomainOrder,attachProjectDomain,verifyProjectDomain,validateDomainContact,domainsConfigured,DomainProviderError,type DomainContact,type ProjectDomain} from './domains.js';
import {getDeployment} from './integrations/vercel.js';

type DnsConfiguration={configured:boolean;verification:ProjectDomain['verification']};
type Provider={quote:typeof quoteDomain;schema:typeof getDomainContactSchema;purchase:typeof purchaseDomain;order:typeof getDomainOrder;attach:typeof attachProjectDomain;verify:typeof verifyProjectDomain;deployment:typeof getDeployment;lookup:(projectId:string,domain:string)=>Promise<ProjectDomain|null>;dns:(projectId:string,domain:string)=>Promise<DnsConfiguration>;configured:()=>boolean;clock:()=>number};
const providers:Provider={quote:quoteDomain,schema:getDomainContactSchema,purchase:purchaseDomain,order:getDomainOrder,attach:attachProjectDomain,verify:verifyProjectDomain,deployment:getDeployment,lookup:lookupDomain,dns:domainDnsConfiguration,configured:()=>domainsConfigured()&&process.env.DOMAIN_PURCHASE_ENABLED==='true',clock:Date.now};
const active=new WeakMap<Store,Promise<void>>();const checkouts=new WeakMap<Store,Set<string>>();
const terminal=new Set(['CONNECTED','FAILED','BLOCKED','CANCELED','SANDBOX_PAID','NEEDS_REVIEW']);
const quoteFields=['id','projectId','domain','supported','available','currency','purchasePrice','renewalPrice','amount','years','quotedAt','expiresAt','reason','status','contactSchemaJson'];
const paymentFields=['id','quoteId','projectId','domain','amount','currency','status','checkoutUrl','createdAt','paidAt','fulfillmentStatus','error','orderId','verification','autoRenew','years','connectedAt'];
const pick=(record:RecordData,fields:string[])=>Object.fromEntries(fields.map(field=>[field,record[field]??null])) as RecordData;
function actor(store:Store,user:RecordData):RecordData{const current=store.user(user.id);if(!current||current.disabled)throw new Error('Contul nu este activ.');return current;}
function ownProject(store:Store,project:RecordData,user:RecordData):RecordData{actor(store,user);const current=store.get('projects',project.id);if(!current||current.ownerId!==user.id)throw new Error('Domeniile pot fi comandate doar de proprietarul proiectului.');return current;}
export function domainPriceCents(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new Error('Prețul domeniului nu este valid.');const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||cents<1||cents>10000000||Math.abs(cents-value*100)>0.000001)throw new Error('Prețul domeniului nu poate fi reprezentat în siguranță.');return cents;}
function key():Buffer{const raw=process.env.EMAIL_OUTBOX_KEY||'';const decoded=/^[a-f0-9]{64}$/i.test(raw)?Buffer.from(raw,'hex'):/^[A-Za-z0-9+/]{43}=$/.test(raw)?Buffer.from(raw,'base64'):Buffer.alloc(0);if(decoded.length!==32)throw new Error('Configurează cheia de criptare EMAIL_OUTBOX_KEY de 32 de octeți.');return decoded;}
function aad(payment:RecordData):Buffer{return Buffer.from(`domain-registrant:v1:${payment.id}:${payment.ownerId}:${payment.quoteId}`);}
function encrypt(payment:RecordData,contact:DomainContact):RecordData{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(aad(payment));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(contact),'utf8'),cipher.final()]);return{id:payment.id,ownerId:payment.ownerId,version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),createdAt:now()};}
function decrypt(store:Store,payment:RecordData):DomainContact{const record=store.get('domain-contacts',payment.id);if(!record||record.ownerId!==payment.ownerId||record.version!==1)throw new Error('Datele criptate ale titularului nu sunt disponibile.');try{const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(record.iv,'base64'));decipher.setAAD(aad(payment));decipher.setAuthTag(Buffer.from(record.tag,'base64'));return validateDomainContact(JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]).toString('utf8')));}catch{throw new Error('Datele titularului nu au putut fi decriptate și verificate.');}}
export function listDomainQuotes(store:Store,user:RecordData):RecordData[]{const current=actor(store,user);return store.list('domain-quotes',current.role==='ADMIN'?undefined:current.id).sort((a,b)=>b.quotedAt.localeCompare(a.quotedAt)).map(record=>pick(record,quoteFields));}
export function listDomainPayments(store:Store,user:RecordData):RecordData[]{const current=actor(store,user);return store.list('domain-payments',current.role==='ADMIN'?undefined:current.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(record=>pick(record,paymentFields));}

export async function createDomainQuote(store:Store,project:RecordData,user:RecordData,domain:string,years=1,overrides:Partial<Provider>={}):Promise<RecordData>{
 ownProject(store,project,user);const provider={...providers,...overrides};const result=await provider.quote(domain,years);ownProject(store,project,user);
 if(result.currency!=='USD'||result.years!==years||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=provider.clock())throw new Error('Oferta registrarului nu este validă.');
 const amount=result.purchasePrice===null?null:domainPriceCents(result.purchasePrice);
 const schema=result.supported?await provider.schema(result.domain):{};
 const expiresAt=new Date(Math.min(Date.parse(result.expiresAt),provider.clock()+600000)).toISOString();
 const record=store.put('domain-quotes',{...result,id:id(),ownerId:user.id,projectId:project.id,amount,expiresAt,status:'QUOTED',contactSchemaJson:JSON.stringify(schema)});
 return pick(record,quoteFields);
}
export async function createDomainCheckout(store:Store,quoteId:string,user:RecordData,input:{autoRenew:boolean;consent:boolean;contactInformation:DomainContact},overrides:Partial<Provider>={}):Promise<RecordData>{
 actor(store,user);const provider={...providers,...overrides};const quote=store.get('domain-quotes',quoteId);
 if(!quote||quote.ownerId!==user.id)throw new Error('Oferta domeniului nu există pentru acest cont.');
 ownProject(store,{id:quote.projectId},user);
 if(input.consent!==true||typeof input.autoRenew!=='boolean')throw new Error('Confirmă explicit înregistrarea domeniului, perioada, prețul și opțiunea de reînnoire.');
 const contact=validateDomainContact(input.contactInformation);key();
 if(quote.currency!=='USD'||!quote.supported||!quote.available||quote.purchasePrice===null||quote.amount!==domainPriceCents(quote.purchasePrice)||Date.parse(quote.expiresAt)<=provider.clock())throw new Error('Oferta domeniului a expirat sau nu poate fi achitată. Solicită o ofertă nouă.');
 if(input.autoRenew&&quote.renewalPrice===null)throw new Error('Reînnoirea automată necesită un preț de reînnoire confirmat.');
 const mode=stripeMode();if(!mode||!process.env.STRIPE_WEBHOOK_SECRET)throw new Error('Stripe nu este configurat pentru comanda de domeniu.');
 if(mode==='live'&&!provider.configured())throw new Error('Registrarul nu este activ pentru comenzi live. Checkout-ul de domeniu nu poate încasa bani reali înainte de configurare.');
 let locks=checkouts.get(store);if(!locks){locks=new Set();checkouts.set(store,locks);}if(locks.has(quoteId))throw new Error('Checkout-ul domeniului se pregătește deja.');locks.add(quoteId);
 try{
  let payment=store.list('domain-payments',user.id).find(record=>record.quoteId===quoteId);
  if(payment){if(payment.autoRenew!==input.autoRenew||payment.livemode!==(mode==='live')||JSON.stringify(decrypt(store,payment))!==JSON.stringify(contact))throw new Error('Această ofertă are deja o comandă cu alte opțiuni sau date ale titularului. Solicită o ofertă nouă.');if(payment.status!=='PENDING')throw new Error('Comanda domeniului a fost deja procesată.');if(payment.checkoutUrl)return pick(payment,paymentFields);}
  if(!payment){
   const fresh=await provider.quote(quote.domain,quote.years);ownProject(store,{id:quote.projectId},user);
   if(!fresh.available||!fresh.supported||fresh.currency!=='USD'||fresh.purchasePrice===null||domainPriceCents(fresh.purchasePrice)!==quote.amount||fresh.years!==quote.years||Date.parse(quote.expiresAt)<=provider.clock())throw new Error('Condițiile domeniului s-au schimbat. Solicită o ofertă nouă.');
   const app=new URL(process.env.PUBLIC_APP_URL||'http://localhost:5173');if(process.env.NODE_ENV==='production'&&app.protocol!=='https:')throw new Error('Checkout-ul de producție necesită HTTPS.');
   payment={id:id(),ownerId:user.id,projectId:quote.projectId,quoteId:quote.id,domain:quote.domain,years:quote.years,autoRenew:input.autoRenew,amount:quote.amount,currency:'usd',status:'PENDING',livemode:mode==='live',checkoutUrl:null,sessionId:null,consentAt:now(),consentVersion:'domain-registration-v1',quoteExpiresAt:quote.expiresAt,appOrigin:app.origin,checkoutExpiresAt:Math.floor(provider.clock()/1000)+1860,createdAt:now(),paidAt:null,fulfillmentStatus:'AWAITING_PAYMENT',error:null,orderId:null,verification:[]};
   const encrypted=encrypt(payment,contact);
   store.db.exec('BEGIN IMMEDIATE');try{if(store.list('domain-payments',user.id).some(record=>record.quoteId===quoteId))throw new Error('Oferta are deja o comandă.');store.put('domain-payments',payment);store.put('domain-contacts',encrypted);store.put('domain-quotes',{...quote,status:'CHECKOUT_CREATED',paymentId:payment.id});store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
  }
  const body=new URLSearchParams({mode:'payment',locale:'ro',success_url:`${payment.appOrigin}/app?domaincheckout=return`,cancel_url:`${payment.appOrigin}/app?domaincheckout=cancel`,client_reference_id:user.id,billing_address_collection:'required',expires_at:String(payment.checkoutExpiresAt),'line_items[0][quantity]':'1','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(payment.amount),'line_items[0][price_data][product_data][name]':`Înregistrare domeniu — ${payment.domain}`,'line_items[0][price_data][product_data][description]':`${payment.years} ani. Reînnoire automată: ${payment.autoRenew?'da':'nu'}. Oferta este reverificată înainte de achiziție; disponibilitatea nu este rezervată.`,'metadata[starliProduct]':'domain','metadata[domainPaymentId]':payment.id,'metadata[quoteId]':payment.quoteId,'metadata[projectId]':payment.projectId,'metadata[ownerId]':payment.ownerId,'metadata[domain]':payment.domain});
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`starli-domain-${payment.id}`},body:body.toString(),signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!response.ok)throw new Error(`Checkout-ul domeniului nu a fost confirmat (${response.status}). Nu s-a confirmat nicio plată.`);
  const session=await response.json() as any;let url:URL;try{url=new URL(session.url);}catch{throw new Error('Stripe nu a returnat un checkout valid.');}
  if(typeof session.id!=='string'||!/^cs_[A-Za-z0-9_]+$/.test(session.id)||url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||session.livemode!==payment.livemode)throw new Error('Stripe a returnat un checkout dintr-un mediu sau format invalid.');
  payment=store.put('domain-payments',{...payment,sessionId:session.id,checkoutUrl:session.url});return pick(payment,paymentFields);
 }finally{locks.delete(quoteId);}
}

/** This hook must only be called by billing after verification of the original raw Stripe signature. */
export function processDomainStripeEvent(store:Store,event:any):boolean|undefined{
 const session=event?.data?.object;const type=event?.type;
 let payment:RecordData|undefined;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(type)){
  if(session?.metadata?.starliProduct!=='domain')return undefined;
  payment=typeof session.metadata.domainPaymentId==='string'?store.get('domain-payments',session.metadata.domainPaymentId):undefined;
  if(!payment)throw new Error('Unknown domain checkout.');
 }else if(['charge.refunded','charge.dispute.created'].includes(type)){
  payment=typeof session?.payment_intent==='string'?store.list('domain-payments').find(record=>record.paymentIntent===session.payment_intent):undefined;if(!payment)return undefined;
 }else return undefined;
 if(typeof event.id!=='string'||!/^evt_[A-Za-z0-9_]{1,200}$/.test(event.id)||typeof event.livemode!=='boolean')throw new Error('Invalid domain payment event.');
 if(store.get('stripe-events',event.id))return false;
 if(event.livemode!==payment.livemode||(event.livemode&&process.env.STRIPE_LIVE_ENABLED!=='true'))throw new Error('Domain checkout environment mismatch.');
 let changes:Record<string,unknown>|undefined;
 if(type.startsWith('checkout.')){
  const meta=session.metadata;
  if(payment.sessionId!==session.id||payment.quoteId!==meta.quoteId||payment.projectId!==meta.projectId||payment.ownerId!==meta.ownerId||payment.domain!==meta.domain||session.client_reference_id!==payment.ownerId||session.amount_total!==payment.amount||session.currency!==payment.currency)throw new Error('Domain checkout identity or amount mismatch.');
  if(type==='checkout.session.expired'){if(payment.status==='PENDING')changes={status:'EXPIRED'};}
  else if(session.payment_status==='paid'&&['PENDING','EXPIRED'].includes(payment.status))changes={status:'PAID',paidAt:now(),verifiedEventId:event.id,paymentIntent:typeof session.payment_intent==='string'?session.payment_intent:null,fulfillmentStatus:event.livemode?'PENDING':'SANDBOX_PAID'};
 }else changes={status:type==='charge.dispute.created'?'DISPUTED':session.amount_refunded>=payment.amount?'REFUNDED':'PARTIALLY_REFUNDED'};
 store.db.exec('BEGIN IMMEDIATE');try{
  if(changes){payment=store.put('domain-payments',{...payment,...changes});if(changes.status==='PAID'&&!store.get('domain-jobs','domain-'+payment.id))store.put('domain-jobs',{id:'domain-'+payment.id,ownerId:payment.ownerId,projectId:payment.projectId,paymentId:payment.id,quoteId:payment.quoteId,domain:payment.domain,status:payment.livemode?'PENDING':'SANDBOX_PAID',submissionAttempted:false,createdAt:now(),updatedAt:now(),nextAttemptAt:0});}
  store.put('stripe-events',{id:event.id,type,product:'domain',processedAt:now()});store.db.exec('COMMIT');
 }catch(error){store.db.exec('ROLLBACK');throw error;}return Boolean(changes);
}
function emit(events:Events){for(const topic of ['domains','payments','projects','platform'])events.publish(topic);}
function save(store:Store,events:Events,job:RecordData,changes:Record<string,unknown>):RecordData{
 const updated=store.put('domain-jobs',{...job,...changes,updatedAt:now()});const payment=store.get('domain-payments',job.paymentId);
 if(payment)store.put('domain-payments',{...payment,fulfillmentStatus:updated.status,error:updated.error||null,orderId:updated.orderId||null,verification:updated.verification||[],connectedAt:updated.connectedAt||null});emit(events);return updated;
}
function authorized(store:Store,job:RecordData):boolean{
 const payment=store.get('domain-payments',job.paymentId),quote=store.get('domain-quotes',job.quoteId),user=store.user(job.ownerId),project=store.get('projects',job.projectId);
 if(!payment||!quote||!user||!project)return false;
 return Boolean(!user.disabled&&project.ownerId===job.ownerId&&payment.ownerId===job.ownerId&&payment.status==='PAID'&&payment.projectId===job.projectId&&payment.quoteId===job.quoteId&&payment.domain===job.domain&&payment.consentVersion==='domain-registration-v1'&&payment.consentAt&&quote.ownerId===job.ownerId&&quote.projectId===job.projectId&&quote.domain===job.domain&&quote.years===payment.years&&quote.amount===payment.amount&&quote.currency==='USD'&&payment.currency==='usd'&&payment.verifiedEventId&&store.get('stripe-events',payment.verifiedEventId));
}
async function lookupDomain(projectId:string,domain:string):Promise<ProjectDomain|null>{
 if(!/^prj_[A-Za-z0-9]+$/.test(projectId)||!process.env.VERCEL_TOKEN)throw new Error('Proiectul Vercel verificat nu este disponibil.');
 const url=new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`);if(process.env.VERCEL_TEAM_ID)url.searchParams.set('teamId',process.env.VERCEL_TEAM_ID);
 const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`},signal:AbortSignal.timeout(15000),redirect:'error'});if(response.status===404)return null;if(!response.ok)throw new Error('Asocierea domeniului nu a putut fi verificată.');const result=await response.json() as any;
 if(result.name!==domain||result.projectId!==projectId||typeof result.verified!=='boolean')throw new Error('Asocierea domeniului nu corespunde proiectului achitat.');
 const verification=Array.isArray(result.verification)?result.verification.slice(0,10).map((entry:any)=>({type:String(entry.type||'').slice(0,100),domain:String(entry.domain||'').slice(0,253),value:String(entry.value||'').slice(0,2000),reason:String(entry.reason||'').slice(0,500)})):[];
 return{domain,verified:result.verified,verification};
}
async function domainDnsConfiguration(projectId:string,domain:string):Promise<DnsConfiguration>{
 const url=new URL(`https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config`);url.searchParams.set('projectIdOrName',projectId);if(process.env.VERCEL_TEAM_ID)url.searchParams.set('teamId',process.env.VERCEL_TEAM_ID);
 const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`},signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw new Error('Configurația DNS nu a putut fi confirmată.');const data=await response.json() as any;
 if(typeof data.misconfigured!=='boolean'||!Array.isArray(data.recommendedCNAME)||!Array.isArray(data.recommendedIPv4))throw new Error('Furnizorul a returnat o configurație DNS invalidă.');
 const verification:ProjectDomain['verification']=[];
 for(const record of data.recommendedCNAME.filter((entry:any)=>entry.rank===1).slice(0,5))if(typeof record.value==='string'&&record.value.length<=253)verification.push({type:'CNAME',domain,value:record.value,reason:'Recomandare DNS furnizată de Vercel pentru domeniul proiectului.'});
 for(const record of data.recommendedIPv4.filter((entry:any)=>entry.rank===1).slice(0,5))if(Array.isArray(record.value))for(const value of record.value.slice(0,5))if(typeof value==='string'&&/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value))verification.push({type:'A',domain,value,reason:'Recomandare DNS furnizată de Vercel pentru domeniul proiectului.'});
 return{configured:data.misconfigured===false&&['A','CNAME','http'].includes(data.configuredBy),verification};
}
async function run(store:Store,events:Events,provider:Provider):Promise<void>{
 const jobs=store.list('domain-jobs').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const candidate=jobs.find((job,index)=>!terminal.has(job.status)&&Number(job.nextAttemptAt||0)<=provider.clock()&&Number(job.leaseUntil||0)<=provider.clock()&&!jobs.slice(0,index).some(prior=>prior.domain===job.domain&&!terminal.has(prior.status)));if(!candidate)return;
 let job:RecordData;store.db.exec('BEGIN IMMEDIATE');try{const fresh=store.get('domain-jobs',candidate.id)!;if(terminal.has(fresh.status)||Number(fresh.leaseUntil||0)>provider.clock()){store.db.exec('COMMIT');return;}job=store.put('domain-jobs',{...fresh,lease:randomUUID(),leaseUntil:provider.clock()+180000});store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
 const payment=store.get('domain-payments',job.paymentId)!;
 if(!authorized(store,job)){save(store,events,job,{status:job.submissionAttempted?'NEEDS_REVIEW':'BLOCKED',leaseUntil:0,error:'Plata, contul sau autorizația comenzii nu mai este validă.'});return;}
 // A sandbox payment can never buy or attach a real domain, even when adapters are injected.
 if(payment.livemode!==true){save(store,events,job,{status:'SANDBOX_PAID',leaseUntil:0,error:null});return;}
 if(process.env.STRIPE_LIVE_ENABLED!=='true'){save(store,events,job,{status:'BLOCKED',leaseUntil:0,error:'Comenzile live nu sunt activate.'});return;}
 try{
  if(!job.orderId){
   if(job.submissionAttempted){save(store,events,job,{status:'NEEDS_REVIEW',leaseUntil:0,error:'Rezultatul achiziției este necunoscut. Registrarul trebuie verificat; plata nu este repetată.'});return;}
   if(Date.parse(payment.quoteExpiresAt)<=provider.clock()){save(store,events,job,{status:'NEEDS_REVIEW',leaseUntil:0,error:'Oferta domeniului a expirat înainte de achiziție. Este necesară o ofertă nouă sau rambursarea manuală.'});return;}
   if(!provider.configured()){save(store,events,job,{status:'SETUP_REQUIRED',leaseUntil:0,nextAttemptAt:provider.clock()+30000,error:'Achiziția live de domenii nu este activată sau registrarul nu este configurat.'});return;}
   if(store.list('domain-jobs').some(other=>other.id!==job.id&&other.domain===job.domain&&other.submissionAttempted&&other.status!=='FAILED'))throw new Error('Există deja o achiziție pentru acest domeniu. Verificarea manuală este necesară.');
   const contactInformation=decrypt(store,payment);
   if(!authorized(store,job))throw new Error('Autorizația a fost revocată înainte de achiziție.');
   job=save(store,events,job,{status:'SUBMITTING',submissionAttempted:true,submissionStartedAt:provider.clock()});
   const result=await provider.purchase({domain:payment.domain,years:payment.years,autoRenew:payment.autoRenew,expectedPrice:payment.amount/100,contactInformation});
   job=save(store,events,job,{status:'PURCHASE_PENDING',orderId:result.orderId,nextAttemptAt:provider.clock()+15000,leaseUntil:0,error:null});return;
  }
  const order=await provider.order(job.orderId);const domain=order.domains.find(entry=>entry.domain===job.domain);
  if(order.orderId!==job.orderId||order.domains.length!==1||!domain||domain.years!==payment.years||(domain.autoRenew!==undefined&&domain.autoRenew!==payment.autoRenew))throw new Error('Comanda registrarului nu corespunde domeniului autorizat.');
  if(order.status==='FAILED'||domain.status==='FAILED'){save(store,events,job,{status:'FAILED',leaseUntil:0,error:'Registrarul a confirmat eșecul înregistrării. Plata clientului necesită soluționare; achiziția nu este repetată.'});return;}
  if(order.status!=='COMPLETED'||domain.status!=='COMPLETED'){save(store,events,job,{status:'PURCHASE_PENDING',leaseUntil:0,nextAttemptAt:provider.clock()+15000,error:null});return;}
  if(!authorized(store,job))throw new Error('Autorizația a fost revocată după înregistrare. Verifică domeniul manual.');
  job=save(store,events,job,{status:'REGISTERED',registrationVerified:true,registeredAt:job.registeredAt||now()});
  const project=store.get('projects',job.projectId)!;
  if(!project.publicVerified||project.deploymentStatus!=='READY'||!/^prj_[A-Za-z0-9]+$/.test(project.providerProjectId||'')||!project.deploymentId){save(store,events,job,{status:'WAITING_PROJECT',leaseUntil:0,nextAttemptAt:provider.clock()+30000,error:'Domeniul este înregistrat. Conectarea așteaptă publicarea verificată a website-ului.'});return;}
  const deployment=await provider.deployment(project.deploymentId);if(deployment.status!=='READY'||deployment.projectId!==project.providerProjectId)throw new Error('Identitatea proiectului publicat nu a fost confirmată de Vercel.');
  let attached=await provider.lookup(project.providerProjectId,job.domain);
  if(!attached){
   if(job.attachAttempted){save(store,events,job,{status:'NEEDS_REVIEW',leaseUntil:0,error:'Asocierea domeniului are un rezultat necunoscut. Verifică Vercel înainte de repetare.'});return;}
   if(!authorized(store,job))throw new Error('Autorizația a fost revocată înainte de conectare.');
   job=save(store,events,job,{attachAttempted:true,status:'ATTACHING',providerProjectId:project.providerProjectId});attached=await provider.attach(project.providerProjectId,job.domain);
  }
  if(attached.domain!==job.domain)throw new Error('Registrarul a asociat un domeniu neașteptat.');
  if(!attached.verified){
   job=save(store,events,job,{status:'DNS_PENDING',verification:attached.verification,leaseUntil:0,nextAttemptAt:provider.clock()+60000,error:'Înregistrarea este confirmată. Verificarea proprietății DNS este în curs.'});
   try{attached=await provider.verify(project.providerProjectId,job.domain);}catch{return;}
   if(!attached.verified)return;
  }
  const dns=await provider.dns(project.providerProjectId,job.domain);
  if(!dns.configured){save(store,events,job,{status:'DNS_PENDING',domainVerified:true,verification:dns.verification,leaseUntil:0,nextAttemptAt:provider.clock()+60000,error:'Proprietatea este confirmată. Rutarea DNS sau eligibilitatea certificatului TLS este încă în curs.'});return;}
  if(!authorized(store,job))throw new Error('Autorizația a fost revocată în timpul verificării domeniului.');
  save(store,events,job,{status:'CONNECTED',domainVerified:true,providerProjectId:project.providerProjectId,verification:[],connectedAt:now(),leaseUntil:0,error:null});
 }catch(error){
  const latest=store.get('domain-jobs',job.id)||job;
  if(latest.submissionAttempted&&!latest.orderId){save(store,events,latest,{status:error instanceof DomainProviderError&&error.code==='PROVIDER_REJECTED'?'FAILED':'NEEDS_REVIEW',leaseUntil:0,error:error instanceof Error?error.message:'Rezultatul achiziției necesită verificare.'});}
  else{const failures=Number(latest.failures||0)+1;save(store,events,latest,{status:failures>=5?'NEEDS_REVIEW':latest.orderId?'PURCHASE_PENDING':'NEEDS_REVIEW',failures,leaseUntil:0,nextAttemptAt:provider.clock()+30000,error:error instanceof Error?error.message:'Comanda necesită verificare.'});}
 }
}
export function tickDomainCommerce(store:Store,events:Events,overrides:Partial<Provider>={}):Promise<void>{const existing=active.get(store);if(existing)return existing;const promise=run(store,events,{...providers,...overrides}).finally(()=>active.delete(store));active.set(store,promise);return promise;}
export function startDomainCommerceWorker(store:Store,events:Events):()=>void{const tick=()=>void tickDomainCommerce(store,events).catch(error=>console.error('[domains]',error instanceof Error?error.message:'Failed'));const timer=setInterval(tick,15000);timer.unref();tick();return()=>clearInterval(timer);}
