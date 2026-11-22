import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Webhook} from 'svix';
import {Store,now,type RecordData} from './store.js';
import {Events} from './events.js';
import {parseSmtpConfig,validateSmtpConfig,sendSmtpMail,type SmtpSendResult} from './smtp.js';
import {redactSecrets} from './mailbox/sanitizer.js';

type Payload={to:string;subject:string;text:string;from:string};
export type MailKind='WELCOME'|'RESET'|'PAYMENT'|'LIVE'|'TEST'|'PROPOSAL';
const active=new WeakMap<Store,Promise<void>>();
const eventStatus:Record<string,string>={'email.sent':'SENT','email.delivered':'DELIVERED','email.delivery_delayed':'DELAYED','email.bounced':'BOUNCED','email.complained':'COMPLAINED','email.failed':'FAILED'};
const statusPriority:Record<string,number>={QUEUED:0,SENDING:0,ACCEPTED:1,SENT:2,DELAYED:3,DELIVERED:4,FAILED:5,BOUNCED:6,COMPLAINED:7};

export function recordTransactionalLifecycleEvent(
  store: Store,
  events: Events,
  entry: {
    outboxId: string;
    providerId: string | null;
    kind: MailKind;
    eventType: string;
    recipientMasked: string;
    subject: string;
    error?: string | null;
    relatedEntityId?: string | null;
  }
) {
  try {
    const eventId = 'txev-' + createHash('sha256').update(`${entry.outboxId}:${entry.eventType}:${now()}`).digest('hex').slice(0, 24);
    const eventRecord = {
      id: eventId,
      outboxId: entry.outboxId,
      providerId: entry.providerId || null,
      kind: entry.kind,
      eventType: entry.eventType,
      recipientMasked: entry.recipientMasked,
      subject: redactSecrets(entry.subject || ''),
      error: entry.error ? redactSecrets(entry.error) : null,
      relatedEntityId: entry.relatedEntityId || null,
      timestamp: now()
    };
    store.put('transactional-email-events', eventRecord);
    events.publish('email-lifecycle', eventRecord);
  } catch (err) {
    console.error('[email-lifecycle] Failed to record event:', err);
  }
}

function applyEmailEvent(store:Store,row:RecordData,type:string,events?:Events){
  const next=eventStatus[type];
  if(!next||(statusPriority[next]||0)<(statusPriority[row.status]||0))return false;
  store.put('email-outbox',{...row,status:next,deliveredAt:next==='DELIVERED'?row.deliveredAt||now():row.deliveredAt||null,error:['FAILED','BOUNCED','COMPLAINED'].includes(next)?'Furnizorul a raportat o problemă de livrare.':null,updatedAt:now()});
  if (events) {
    recordTransactionalLifecycleEvent(store, events, {
      outboxId: row.id,
      providerId: row.providerId || null,
      kind: row.kind,
      eventType: next,
      recipientMasked: row.recipientMasked,
      subject: row.subject,
      error: ['FAILED','BOUNCED','COMPLAINED'].includes(next)?'Furnizorul a raportat o problemă de livrare.':null,
      relatedEntityId: row.ownerId || null
    });
  }
  return true;
}
function key():Buffer{
 const value=process.env.EMAIL_OUTBOX_KEY||'';let result:Buffer;
 if(/^[a-f0-9]{64}$/i.test(value))result=Buffer.from(value,'hex');else{result=Buffer.from(value,'base64');if(result.toString('base64')!==value)throw new Error('Cheia outbox nu este configurată corect.');}
 if(result.length!==32)throw new Error('Cheia outbox trebuie să aibă 32 de bytes.');return result;
}
export function emailOutboxReady(){try{key();return true;}catch{return false;}}

export function proposalProvider(): 'RESEND' | 'SMTP' {
 const configured = String(process.env.EMAIL_PROPOSAL_PROVIDER || '').trim().toUpperCase();
 return configured === 'SMTP' ? 'SMTP' : 'RESEND';
}

export function smtpStatus() {
 const config = parseSmtpConfig();
 const validation = validateSmtpConfig(config);
 return {
  enabled: config.enabled,
  valid: validation.valid,
  error: validation.error || null,
  host: config.host,
  port: config.port,
  secure: config.secure,
  from: config.from,
  replyTo: config.replyTo || null
 };
}

export function emailStatus(){
 const outboxOk = emailOutboxReady();
 const resendConfigured = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM && outboxOk;
 const propProvider = proposalProvider();
 const smtpInfo = smtpStatus();

 const proposalReady = propProvider === 'SMTP'
  ? (smtpInfo.enabled && smtpInfo.valid && outboxOk)
  : resendConfigured;

 return {
  configured: resendConfigured,
  proposalReady,
  proposalProvider: propProvider,
  provider:'RESEND',
  sender:process.env.EMAIL_FROM||'',
  webhookConfigured:!!process.env.RESEND_WEBHOOK_SECRET,
  smtp: smtpInfo
 };
}

export function maskRecipient(email:string){const [local,domain='']=email.split('@');const dot=domain.lastIndexOf('.');return `${local?.[0]||'*'}***@${domain[0]||'*'}***${dot>=0?domain.slice(dot):''}`;}
function encrypt(payload:Payload,aad:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(aad));const data=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
function decrypt(record:RecordData):Payload{
 try{const encrypted=record.encryptedPayload;if(encrypted?.version!==1)throw new Error();const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(encrypted.iv,'base64'));decipher.setAAD(Buffer.from(record.id+':'+record.kind));decipher.setAuthTag(Buffer.from(encrypted.tag,'base64'));const data=Buffer.concat([decipher.update(Buffer.from(encrypted.data,'base64')),decipher.final()]);return JSON.parse(data.toString('utf8'));}catch{throw new Error('Payloadul email criptat nu poate fi verificat.');}
}
export function publicEmail(record:RecordData){return {id:record.id,kind:record.kind,recipientMasked:record.recipientMasked,subject:record.subject,status:record.status,providerId:record.providerId||null,attempts:record.attempts||0,error:record.error||null,createdAt:record.createdAt,updatedAt:record.updatedAt,deliveredAt:record.deliveredAt||null};}
export function enqueueEmail(store:Store,args:{kind:MailKind;reference:string;ownerId?:string;to:string;subject:string;text:string;expiresAt?:number}):RecordData{
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.to)||args.to.length>254)throw new Error('Destinatarul email nu este valid.');
 const id='mail-'+createHash('sha256').update(args.kind+':'+args.reference).digest('hex');const existing=store.get('email-outbox',id);if(existing)return existing;
 
 let defaultFrom = process.env.EMAIL_FROM || '';
 if (args.kind === 'PROPOSAL' && proposalProvider() === 'SMTP') {
  defaultFrom = parseSmtpConfig().from;
 }
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(defaultFrom.replace(/^[^\r\n<>]*<([^<>]+)>$/, '$1')))throw new Error('Configure a valid EMAIL_FROM or SMTP_FROM sender.');
 const payload:Payload={to:args.to,subject:args.subject,text:args.text,from:defaultFrom};
 const encryptedPayload=encrypt(payload,id+':'+args.kind);
 return store.put('email-outbox',{id,kind:args.kind,ownerId:args.ownerId||null,recipientMasked:maskRecipient(args.to),subject:args.subject,encryptedPayload,status:'QUEUED',attempts:0,providerId:null,error:null,createdAt:now(),updatedAt:now(),nextAttemptAt:0,expiresAt:args.expiresAt||null});
}
export function queueWelcome(store:Store,user:RecordData){return enqueueEmail(store,{kind:'WELCOME',reference:user.id,ownerId:user.id,to:user.recoveryEmail,subject:'Bun venit la Starlidigital',text:`Bun venit! Contul tău este ${user.email}. Autentifică-te cu acest identificator și parola aleasă. Identificatorul contului nu include o căsuță email. Adresa externă de recuperare nu necesită validare la înscriere. Dacă nu ai creat acest cont, ignoră mesajul.`});}
export function queuePasswordReset(store:Store,user:RecordData,token:string,expiresAt:number){
 for(const row of store.list('email-outbox',user.id))if(row.kind==='RESET'&&['QUEUED','RETRY','SETUP_REQUIRED'].includes(row.status))store.put('email-outbox',{...row,status:'CANCELED',updatedAt:now()});
 const app=new URL(process.env.PUBLIC_APP_URL||'http://localhost:5173');if(process.env.NODE_ENV==='production'&&app.protocol!=='https:')throw new Error('Recuperarea contului de producție necesită HTTPS.');const origin=app.origin;
 return enqueueEmail(store,{kind:'RESET',reference:createHash('sha256').update(token).digest('hex'),ownerId:user.id,to:user.recoveryEmail,subject:'Recuperarea contului Starlidigital',text:`Pentru a seta o parolă nouă, deschide ${origin}/reset-password?token=${encodeURIComponent(token)} . Linkul este valabil 30 de minute și poate fi folosit o singură dată. Dacă nu ai cerut recuperarea, ignoră mesajul.`,expiresAt});
}
export function retryEmail(store:Store,id:string){const row=store.get('email-outbox',id);if(!row)throw new Error('Emailul nu există.');if(['ACCEPTED','SENT','DELIVERED','BOUNCED','COMPLAINED'].includes(row.status))throw new Error('Un email acceptat de furnizor nu poate fi retrimis automat.');if(row.firstAttemptAt&&Date.now()-row.firstAttemptAt>=23*3600000)throw new Error('Fereastra de idempotency a expirat. Verifică furnizorul înainte de retrimitere.');return store.put('email-outbox',{...row,status:'QUEUED',nextAttemptAt:0,leaseUntil:0,error:null,updatedAt:now()});}
function businessNotifications(store:Store){
 if(!emailOutboxReady())return;
 for(const payment of store.list('payments'))if(payment.status==='PAID'&&payment.verifiedEventId){const user=store.user(payment.ownerId);if(user&&!user.disabled)enqueueEmail(store,{kind:'PAYMENT',reference:payment.id,ownerId:user.id,to:user.recoveryEmail,subject:'Plată confirmată — Starlidigital',text:`${payment.livemode?'Plata':'Plata de test (fără încasare reală)'} de ${(Number(payment.amount)/100).toFixed(2)} ${String(payment.currency).toUpperCase()} pentru website a fost confirmată pe server. Publicarea versiunii achitate este urmărită în dashboard. Domeniul și serviciile recurente nu sunt incluse în această plată.`});}
 for(const job of store.list('fulfillment-jobs'))if(job.status==='LIVE'&&job.publicVerified){const user=store.user(job.ownerId);if(user&&!user.disabled)enqueueEmail(store,{kind:'LIVE',reference:job.id,ownerId:user.id,to:user.recoveryEmail,subject:'Website-ul tău este online — Starlidigital',text:`Website-ul a fost compilat și accesul public a fost verificat. Îl poți vedea la ${job.deploymentUrl}. Administrează proiectul din ${new URL(process.env.PUBLIC_APP_URL||'http://localhost:5173').origin}/app .`});}
 for(const payment of store.list('domain-payments'))if(payment.status==='PAID'&&payment.verifiedEventId){const user=store.user(payment.ownerId);if(user&&!user.disabled)enqueueEmail(store,{kind:'PAYMENT',reference:'domain-'+payment.id,ownerId:user.id,to:user.recoveryEmail,subject:'Plată domeniu confirmată — Starlidigital',text:`${payment.livemode?'Plata':'Plata de test (fără încasare reală)'} de ${(Number(payment.amount)/100).toFixed(2)} ${String(payment.currency).toUpperCase()} pentru comanda domeniului a fost confirmată. Această confirmare nu dovedește înregistrarea domeniului. Starea registrarului și configurarea DNS sunt urmărite separat în dashboard.`});}
 for(const job of store.list('domain-jobs'))if(job.status==='CONNECTED'&&job.registrationVerified===true&&job.domainVerified===true&&job.orderId){const user=store.user(job.ownerId);if(user&&!user.disabled)enqueueEmail(store,{kind:'LIVE',reference:'domain-'+job.id,ownerId:user.id,to:user.recoveryEmail,subject:'Domeniul este conectat — Starlidigital',text:`Înregistrarea domeniului ${job.domain} a fost confirmată de registrar, iar conectarea lui la proiect a fost verificată. Poți administra comanda și configurarea din ${new URL(process.env.PUBLIC_APP_URL||'http://localhost:5173').origin}/app .`});}
}

export type SmtpSender = (args: { from?: string; to: string; subject: string; text: string; messageId: string }) => Promise<SmtpSendResult>;

async function runTick(
 store:Store,
 events:Events,
 send:typeof fetch,
 clock:()=>number,
 smtpSend?:SmtpSender
){
 businessNotifications(store);const row=store.list('email-outbox').filter(r=>['QUEUED','RETRY','SENDING','SETUP_REQUIRED'].includes(r.status)&&Number(r.nextAttemptAt||0)<=clock()&&Number(r.leaseUntil||0)<=clock()).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];if(!row)return;
 const update=(data:Record<string,unknown>)=>{store.put('email-outbox',{...store.get('email-outbox',row.id)!,...data,updatedAt:now()});events.publish('email');};
 if(row.expiresAt&&row.expiresAt<=clock()){update({status:'EXPIRED',error:'Linkul de recuperare a expirat înainte de livrare.'});return;}

 const isProposalSmtp = row.kind === 'PROPOSAL' && proposalProvider() === 'SMTP';

 if (isProposalSmtp) {
  const smtpInfo = smtpStatus();
  if (!smtpInfo.enabled) {
   update({status:'SETUP_REQUIRED',nextAttemptAt:clock()+60000,error:'Serviciul SMTP este dezactivat (SMTP_ENABLED=false).'});
   return;
  }
  if (!smtpInfo.valid || !emailOutboxReady()) {
   update({status:'SETUP_REQUIRED',nextAttemptAt:clock()+60000,error:smtpInfo.error || 'Configurația SMTP sau cheia de criptare outbox nu este validă.'});
   return;
  }
 } else {
  if(!emailStatus().configured){update({status:'SETUP_REQUIRED',nextAttemptAt:clock()+60000,error:'Resend sau cheia de criptare outbox nu este configurată.'});return;}
 }

 if(row.firstAttemptAt&&clock()-row.firstAttemptAt>=23*3600000){update({status:'NEEDS_REVIEW',error:'Fereastra de idempotency a expirat; emailul nu este retrimis automat.'});return;}
 let payload:Payload;try{payload=decrypt(row);}catch{update({status:'FAILED',error:'Payloadul criptat nu poate fi verificat. Verifică cheia outbox.'});return;}
 const attempts=Number(row.attempts||0)+1;update({status:'SENDING',attempts,firstAttemptAt:row.firstAttemptAt||clock(),leaseUntil:clock()+60000,error:null});

 if (isProposalSmtp) {
  const stableMessageId = `${row.id}@${payload.from.replace(/.*<([^>]+)>.*/, '$1').split('@')[1]}`;
  try {
   const sender = smtpSend || ((args) => sendSmtpMail(args));
   const result = await sender({
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    messageId: stableMessageId
   });

   if (result.success) {
    update({status:'ACCEPTED',providerId:stableMessageId,leaseUntil:0,error:null,acceptedAt:now()});
    recordTransactionalLifecycleEvent(store, events, {
     outboxId: row.id,
     providerId: stableMessageId,
     kind: row.kind,
     eventType: 'ACCEPTED',
     recipientMasked: row.recipientMasked,
     subject: row.subject,
     relatedEntityId: row.ownerId || null
    });
    events.publish('email');
    return;
   }

   if (result.uncertain) {
    const errorMsg = `Rezultatul SMTP este necunoscut după transmiterea datelor (${result.message}). Nu se retrimite automat pentru a evita duplicatele.`;
    update({status:'NEEDS_REVIEW',leaseUntil:0,error:errorMsg});
    recordTransactionalLifecycleEvent(store, events, {
     outboxId: row.id,
     providerId: null,
     kind: row.kind,
     eventType: 'NEEDS_REVIEW',
     recipientMasked: row.recipientMasked,
     subject: row.subject,
     error: errorMsg,
     relatedEntityId: row.ownerId || null
    });
    return;
   }

   const retriable = result.code && result.code >= 400 && result.code < 500;
   const finalStatus = retriable && attempts < 10 ? 'RETRY' : 'FAILED';
   const errorMsg = `Serverul SMTP a respins mesajul la etapa ${result.stage} (cod ${result.code || 'fără cod'}): ${result.message}`;
   update({
    status: finalStatus,
    leaseUntil: 0,
    nextAttemptAt: clock() + Math.min(1800000, 10000 * 2 ** attempts),
    error: errorMsg
   });
   recordTransactionalLifecycleEvent(store, events, {
    outboxId: row.id,
    providerId: null,
    kind: row.kind,
    eventType: finalStatus,
    recipientMasked: row.recipientMasked,
    subject: row.subject,
    error: errorMsg,
    relatedEntityId: row.ownerId || null
   });
  } catch (err: any) {
   const errorMsg = `Excepție neașteptată la transportul SMTP: ${err.message || String(err)}. Verificare necesară fără retrimitere.`;
   update({
    status: 'NEEDS_REVIEW',
    leaseUntil: 0,
    error: errorMsg
   });
   recordTransactionalLifecycleEvent(store, events, {
    outboxId: row.id,
    providerId: null,
    kind: row.kind,
    eventType: 'NEEDS_REVIEW',
    recipientMasked: row.recipientMasked,
    subject: row.subject,
    error: errorMsg,
    relatedEntityId: row.ownerId || null
   });
  }
  return;
 }

 try{
  const response=await send('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'starlidigital/'+row.id},body:JSON.stringify({from:payload.from,to:[payload.to],subject:payload.subject,text:payload.text,tags:[{name:'kind',value:row.kind.toLowerCase()},{name:'outbox_id',value:row.id}]}),signal:AbortSignal.timeout(20000)});
  if(!response.ok){
    const retriable=response.status===429||response.status>=500;
    const finalStatus = retriable&&attempts<10?'RETRY':'FAILED';
    const errText = `Resend a respins operațiunea (${response.status}). Livrarea nu este confirmată.`;
    update({status:finalStatus,leaseUntil:0,nextAttemptAt:clock()+Math.min(1800000,10000*2**attempts),error:errText});
    recordTransactionalLifecycleEvent(store, events, {
      outboxId: row.id,
      providerId: null,
      kind: row.kind,
      eventType: finalStatus,
      recipientMasked: row.recipientMasked,
      subject: row.subject,
      error: errText,
      relatedEntityId: row.ownerId || null
    });
    return;
  }
  const result=await response.json() as any;if(typeof result.id!=='string'||!/^[A-Za-z0-9_-]{6,100}$/.test(result.id))throw new Error('Invalid provider response');
  update({status:'ACCEPTED',providerId:result.id,leaseUntil:0,error:null,acceptedAt:now()});
  recordTransactionalLifecycleEvent(store, events, {
    outboxId: row.id,
    providerId: result.id,
    kind: row.kind,
    eventType: 'ACCEPTED',
    recipientMasked: row.recipientMasked,
    subject: row.subject,
    relatedEntityId: row.ownerId || null
  });
  for(const event of store.list('email-events').filter(event=>event.providerId===result.id))applyEmailEvent(store,store.get('email-outbox',row.id)!,event.type,events);
  events.publish('email');
 }catch{
   const finalStatus = attempts<10?'RETRY':'NEEDS_REVIEW';
   const errText = 'Rezultatul cererii Resend este necunoscut. Se păstrează aceeași cheie de idempotency.';
   update({status:finalStatus,leaseUntil:0,nextAttemptAt:clock()+Math.min(1800000,10000*2**attempts),error:errText});
   recordTransactionalLifecycleEvent(store, events, {
     outboxId: row.id,
     providerId: null,
     kind: row.kind,
     eventType: finalStatus,
     recipientMasked: row.recipientMasked,
     subject: row.subject,
     error: errText,
     relatedEntityId: row.ownerId || null
   });
 }
}

export function tickEmailOutbox(store:Store,events:Events,send:typeof fetch=fetch,clock:()=>number=Date.now,smtpSend?:SmtpSender):Promise<void>{const pending=active.get(store);if(pending)return pending;const promise=runTick(store,events,send,clock,smtpSend).finally(()=>active.delete(store));active.set(store,promise);return promise;}
export function startEmailWorker(store:Store,events:Events){const tick=()=>void tickEmailOutbox(store,events).catch(()=>console.error('[email] Outbox processing failed'));const timer=setInterval(tick,10000);timer.unref();tick();return ()=>clearInterval(timer);}

export function processResendEvent(store:Store,eventId:string,event:any){
 if(!eventId||eventId.length>200||typeof event?.type!=='string'||typeof event.data?.email_id!=='string')throw new Error('Invalid email event');
 if(store.get('email-events',eventId))return false;const row=store.list('email-outbox').find(r=>r.providerId===event.data.email_id);
 store.db.exec('BEGIN IMMEDIATE');try{if(row)applyEmailEvent(store,row,event.type);store.put('email-events',{id:eventId,type:event.type,providerId:event.data.email_id,createdAt:now()});store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}return !!row&&!!eventStatus[event.type];
}
export async function resendWebhook(req:IncomingMessage,res:ServerResponse,store:Store,events:Events){
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}if(!process.env.RESEND_WEBHOOK_SECRET){res.writeHead(503);res.end('Webhook not configured');return;}
 try{const parts:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000){res.writeHead(413);res.end();return;}parts.push(Buffer.from(chunk));}const raw=Buffer.concat(parts).toString('utf8');const verifier=new Webhook(process.env.RESEND_WEBHOOK_SECRET);verifier.verify(raw,{'svix-id':String(req.headers['svix-id']||''),'svix-timestamp':String(req.headers['svix-timestamp']||''),'svix-signature':String(req.headers['svix-signature']||'')});const event=JSON.parse(raw);if(processResendEvent(store,String(req.headers['svix-id']||''),event))events.publish('email');res.setHeader('Content-Type','application/json');res.end('{"received":true}');}catch{res.writeHead(400);res.end('Webhook rejected');}
}
