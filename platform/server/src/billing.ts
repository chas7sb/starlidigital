import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import type { IncomingMessage,ServerResponse } from 'node:http';
import { Store,id,now,type RecordData } from './store.js';
import { Events } from './events.js';

export type SourceFile={path:string;content:string;encoding?:string};
export const sourceHash=(source:string|SourceFile[])=>createHash('sha256').update(typeof source==='string'?source:JSON.stringify([...source].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).map(file=>({path:file.path,content:file.content,encoding:file.encoding||'utf8'})))).digest('hex');
export function stripeMode(): 'test'|'live'|null {
  const match=/^(?:sk|rk)_(test|live)_/.exec(process.env.STRIPE_SECRET_KEY||'');
  if(!match)return null;if(match[1]==='live'&&process.env.STRIPE_LIVE_ENABLED!=='true')return null;
  return match[1] as 'test'|'live';
}
export function pricing() {
  const raw=process.env.STRIPE_SITE_PRICE_CENTS||'';const amount=/^\d+$/.test(raw)?Number(raw):NaN;const currency=(process.env.STRIPE_CURRENCY||'ron').toLowerCase();
  const mode=stripeMode();const configured=!!mode&&!!process.env.STRIPE_WEBHOOK_SECRET&&Number.isSafeInteger(amount)&&amount>=100&&amount<=10000000&&['ron','eur','usd'].includes(currency);
  return {configured,amount:configured?amount:null,currency,mode};
}
export function paidForSource(store:Store,project:RecordData) { if(!Array.isArray(project.files)||!project.files.length)return false;const hash=sourceHash(project.files);return store.list('payments',project.ownerId).some(payment=>payment.projectId===project.id&&payment.sourceHash===hash&&payment.status==='PAID'); }

/** Stripe receives one immutable, server-priced Next.js source revision per checkout. */
export async function createCheckout(store:Store,project:RecordData,user:RecordData):Promise<RecordData> {
  const price=pricing();if(!price.configured)throw new Error('Configurează Stripe sandbox, secretul webhook și prețul. Cheile live sunt blocate fără activare explicită.');
  if(!Array.isArray(project.files)||!project.files.length)throw new Error('Generează sursa Next.js înainte de plată.');
  if(paidForSource(store,project))throw new Error('Această versiune a website-ului este deja achitată.');
  const hash=sourceHash(project.files);const recent=store.list('payments',user.id).find(payment=>payment.projectId===project.id&&payment.sourceHash===hash&&payment.status==='PENDING'&&payment.amount===price.amount&&payment.currency===price.currency&&payment.expiresAt>Date.now());
  if(recent?.checkoutUrl&&recent.livemode===(price.mode==='live'))return recent;
  const payment=recent&&recent.livemode===(price.mode==='live')?recent:store.put('payments',{id:id(),ownerId:user.id,projectId:project.id,sourceHash:hash,amount:price.amount,currency:price.currency,status:'PENDING',livemode:price.mode==='live',checkoutUrl:null,sessionId:null,createdAt:now(),paidAt:null,expiresAt:Date.now()+23*3600000});
  const snapshotId=user.id+':'+hash;if(!store.get('source-snapshots',snapshotId))store.put('source-snapshots',{id:snapshotId,ownerId:user.id,projectId:project.id,sourceHash:hash,files:project.files,createdAt:now()});
  const app=new URL(process.env.PUBLIC_APP_URL||'http://localhost:5173');if(process.env.NODE_ENV==='production'&&app.protocol!=='https:')throw new Error('Checkout în producție necesită PUBLIC_APP_URL HTTPS.');
  const body=new URLSearchParams({mode:'payment',locale:'ro',success_url:`${app.origin}/app?checkout=return`,cancel_url:`${app.origin}/app?checkout=cancel`,client_reference_id:user.id,customer_email:user.recoveryEmail,'billing_address_collection':'required','line_items[0][quantity]':'1','line_items[0][price_data][currency]':price.currency,'line_items[0][price_data][unit_amount]':String(price.amount),'line_items[0][price_data][product_data][name]':`Website Starlidigital — ${project.name.slice(0,100)}`,'line_items[0][price_data][product_data][description]':'Realizare website Next.js și publicarea versiunii aprobate. Domeniul și serviciile recurente nu sunt incluse.','metadata[paymentId]':payment.id,'metadata[projectId]':project.id,'metadata[ownerId]':user.id,'metadata[sourceHash]':hash});
  const result=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`starli-checkout-${payment.id}`},body:body.toString(),signal:AbortSignal.timeout(25000)});
  if(!result.ok)throw new Error(`Stripe nu a putut crea checkout-ul (${result.status}). Nu s-a confirmat nicio plată.`);
  const session=await result.json() as any;if(typeof session.id!=='string'||!session.id.startsWith('cs_')||typeof session.url!=='string'||!session.url.startsWith('https://checkout.stripe.com/'))throw new Error('Stripe a furnizat un checkout invalid.');
  if(session.livemode!==(price.mode==='live'))throw new Error('Stripe a returnat un checkout din alt mediu. Nicio plată nu este confirmată.');
  return store.put('payments',{...payment,sessionId:session.id,checkoutUrl:session.url,livemode:session.livemode===true,expiresAt:typeof session.expires_at==='number'?session.expires_at*1000:payment.expiresAt});
}

/** Manual Stripe v1 signature verification against the original bytes, never parsed/reencoded JSON. */
export function verifyStripeSignature(raw:Buffer,header:string,secret:string,currentTime=Date.now()) {
  if(!secret||raw.length>1000000)throw new Error('Invalid webhook configuration or payload.');
  const entries=header.split(',').map(part=>part.trim().split('='));const timestamp=entries.find(([key])=>key==='t')?.[1];
  if(!timestamp||!/^\d+$/.test(timestamp)||Math.abs(currentTime/1000-Number(timestamp))>300)throw new Error('Webhook signature expired.');
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  const valid=entries.filter(([key,value])=>key==='v1'&&/^[a-f0-9]{64}$/i.test(value||'')).some(([,value])=>timingSafeEqual(expected,Buffer.from(value,'hex')));
  if(!valid)throw new Error('Invalid webhook signature.');
}

export function processStripeEvent(store:Store,event:any):boolean {
  if(typeof event?.id!=='string'||!/^evt_[a-zA-Z0-9_]{1,200}$/.test(event.id)||typeof event.type!=='string')throw new Error('Invalid event.');
  if(store.get('stripe-events',event.id))return false;
  if(event.livemode===true&&process.env.STRIPE_LIVE_ENABLED!=='true')throw new Error('Live Stripe events require explicit activation.');
  const session=event.data?.object;let updated:RecordData|undefined;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(event.type)){
    const payment=typeof session?.metadata?.paymentId==='string'?store.get('payments',session.metadata.paymentId):undefined;
    // Ignore unrelated checkout events belonging to other applications in the same Stripe account.
    if(payment){
      if(payment.sessionId!==session.id||payment.projectId!==session.metadata.projectId||payment.ownerId!==session.metadata.ownerId||payment.sourceHash!==session.metadata.sourceHash||payment.ownerId!==session.client_reference_id)throw new Error('Checkout identity mismatch.');
      if(session.amount_total!==payment.amount||session.currency!==payment.currency)throw new Error('Checkout amount mismatch.');
      if(typeof payment.livemode==='boolean'&&event.livemode!==payment.livemode)throw new Error('Checkout environment mismatch.');
      if(event.type==='checkout.session.expired'){if(payment.status==='PENDING')updated={...payment,status:'EXPIRED'};}
      else if(session.payment_status==='paid'&&['PENDING','EXPIRED'].includes(payment.status))updated={...payment,status:'PAID',paidAt:now(),verifiedEventId:event.id,paymentIntent:typeof session.payment_intent==='string'?session.payment_intent:null};
    }
  }else if(['charge.refunded','charge.dispute.created'].includes(event.type)){
    const paymentIntent=typeof session?.payment_intent==='string'?session.payment_intent:null;
    const payment=paymentIntent?store.list('payments').find(p=>p.paymentIntent===paymentIntent):undefined;
    if(payment)updated={...payment,status:event.type==='charge.dispute.created'?'DISPUTED':session.amount_refunded>=payment.amount?'REFUNDED':'PARTIALLY_REFUNDED'};
  }
  store.db.exec('BEGIN IMMEDIATE');try{if(updated){store.put('payments',updated);if(updated.status==='PAID'&&!store.get('fulfillment-jobs','payment-'+updated.id))store.put('fulfillment-jobs',{id:'payment-'+updated.id,ownerId:updated.ownerId,projectId:updated.projectId,paymentId:updated.id,sourceHash:updated.sourceHash,status:'PENDING',requestId:'fulfill-'+updated.id,submissionAttempted:false,attempts:0,nextAttemptAt:0,createdAt:now(),updatedAt:now()});}store.put('stripe-events',{id:event.id,type:event.type,processedAt:now()});store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}return !!updated;
}

export async function stripeWebhook(req:IncomingMessage,res:ServerResponse,store:Store,events:Events,processOtherEvent?:(event:any)=>boolean|undefined) {
  if(req.method!=='POST'){res.writeHead(405);res.end('POST required');return;}
  if(!process.env.STRIPE_WEBHOOK_SECRET){res.writeHead(503);res.end('Webhook not configured');return;}
  try{
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000){res.writeHead(413);res.end();return;}chunks.push(Buffer.from(chunk));}
    const raw=Buffer.concat(chunks);verifyStripeSignature(raw,String(req.headers['stripe-signature']||''),process.env.STRIPE_WEBHOOK_SECRET);
    const event=JSON.parse(raw.toString('utf8'));if(event.livemode===true&&process.env.STRIPE_LIVE_ENABLED!=='true')throw new Error('Live Stripe events require explicit activation.');
    // Extension runs only after raw-byte signature verification. Undefined means "not this product".
    const other=processOtherEvent?.(event);const updated=other===undefined?processStripeEvent(store,event):other;if(updated){events.publish('payments');events.publish('projects');events.publish('platform');}
    res.setHeader('Content-Type','application/json');res.end('{"received":true}');
  }catch(error){console.error('[stripe] Webhook rejected:',error instanceof Error?error.message:'invalid');res.writeHead(400);res.end('Webhook rejected');}
}
