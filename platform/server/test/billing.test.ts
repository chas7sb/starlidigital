import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCheckout,pricing,stripeMode,processStripeEvent,verifyStripeSignature,sourceHash,paidForSource } from '../src/billing.js';
import { Store } from '../src/store.js';

test('Stripe webhook validates exact bytes, timestamp and rotated v1 signatures',()=>{
 const raw=Buffer.from('{"id":"evt_signature","message":"plată"}');const secret='whsec_unit';const timestamp=Math.floor(Date.now()/1000);const signature=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
 assert.doesNotThrow(()=>verifyStripeSignature(raw,`t=${timestamp},v1=${'00'.repeat(32)},v1=${signature}`,secret));
 assert.throws(()=>verifyStripeSignature(Buffer.from(raw+' '),`t=${timestamp},v1=${signature}`,secret));
 assert.throws(()=>verifyStripeSignature(raw,`t=${timestamp-301},v1=${signature}`,secret));
 assert.throws(()=>verifyStripeSignature(raw,`t=${timestamp},v1=${signature}`,'wrong-secret'));
});

test('live Stripe keys and events stay blocked until explicit activation',async()=>{
 const saved={key:process.env.STRIPE_SECRET_KEY,enabled:process.env.STRIPE_LIVE_ENABLED,webhook:process.env.STRIPE_WEBHOOK_SECRET,price:process.env.STRIPE_SITE_PRICE_CENTS};const store=new Store(':memory:');
 try{
  process.env.STRIPE_SECRET_KEY='sk_live_unit_only';process.env.STRIPE_LIVE_ENABLED='false';process.env.STRIPE_WEBHOOK_SECRET='whsec_unit';process.env.STRIPE_SITE_PRICE_CENTS='10000';assert.equal(stripeMode(),null);assert.equal(pricing().configured,false);
  await assert.rejects(createCheckout(store,{id:'p',files:[]},{id:'u'}),/Cheile live sunt blocate/);assert.throws(()=>processStripeEvent(store,{id:'evt_live',type:'checkout.session.completed',livemode:true}),/explicit activation/);assert.equal(store.list('stripe-events').length,0);
  process.env.STRIPE_LIVE_ENABLED='true';assert.equal(stripeMode(),'live');assert.equal(pricing().configured,true);
  process.env.STRIPE_SECRET_KEY='sk_test_unit';process.env.STRIPE_LIVE_ENABLED='false';assert.equal(stripeMode(),'test');assert.equal(pricing().configured,true);
 }finally{for(const [key,value]of Object.entries({STRIPE_SECRET_KEY:saved.key,STRIPE_LIVE_ENABLED:saved.enabled,STRIPE_WEBHOOK_SECRET:saved.webhook,STRIPE_SITE_PRICE_CENTS:saved.price})){if(value===undefined)delete process.env[key];else process.env[key]=value;}store.close();}
});

test('checkout uses server price and stable idempotency; signed fulfillment is amount-bound and idempotent',async()=>{
 const saved={secret:process.env.STRIPE_SECRET_KEY,webhook:process.env.STRIPE_WEBHOOK_SECRET,price:process.env.STRIPE_SITE_PRICE_CENTS,currency:process.env.STRIPE_CURRENCY};const originalFetch=globalThis.fetch;
 process.env.STRIPE_SECRET_KEY='sk_test_unit';process.env.STRIPE_WEBHOOK_SECRET='whsec_unit';process.env.STRIPE_SITE_PRICE_CENTS='149900';process.env.STRIPE_CURRENCY='ron';
 const store=new Store(':memory:');const project={id:'project-1',ownerId:'user-1',name:'Atelier',files:[{path:'app/page.tsx',content:'export default function Page(){return <main>Atelier</main>}'}]};const user={id:'user-1',recoveryEmail:'owner@example.com'};let calls=0;let paymentId='';
 globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://api.stripe.com/v1/checkout/sessions');const body=new URLSearchParams(String(init?.body));assert.equal(body.get('line_items[0][price_data][unit_amount]'),'149900');assert.equal(body.get('locale'),'ro');assert.equal(body.get('metadata[sourceHash]'),sourceHash(project.files));paymentId=body.get('metadata[paymentId]')!;assert.equal((init?.headers as any)['Idempotency-Key'],`starli-checkout-${paymentId}`);return new Response(JSON.stringify({id:'cs_test_unit',url:'https://checkout.stripe.com/c/pay/test',livemode:false,expires_at:Math.floor(Date.now()/1000)+3600}),{status:200});};
 try{
   assert.equal(pricing().configured,true);const payment=await createCheckout(store,project,user);assert.equal(payment.amount,149900);assert.equal(payment.status,'PENDING');await createCheckout(store,project,user);assert.equal(calls,1);
   const object={id:'cs_test_unit',metadata:{paymentId,projectId:project.id,ownerId:user.id,sourceHash:sourceHash(project.files)},client_reference_id:user.id,amount_total:149900,currency:'ron',payment_status:'paid',payment_intent:'pi_unit'};
   assert.throws(()=>processStripeEvent(store,{id:'evt_wrong',type:'checkout.session.completed',livemode:false,data:{object:{...object,amount_total:1}}}));assert.equal(store.get('stripe-events','evt_wrong'),undefined);assert.equal(store.get('payments',payment.id)?.status,'PENDING');
   const event={id:'evt_paid',type:'checkout.session.completed',livemode:false,data:{object}};
   assert.equal(processStripeEvent(store,event),true);assert.equal(processStripeEvent(store,event),false);assert.equal(store.list('stripe-events').length,1);assert.equal(paidForSource(store,project),true);assert.equal(paidForSource(store,{...project,files:[{path:'app/page.tsx',content:'Changed revision'}]}),false);
   processStripeEvent(store,{id:'evt_expired',type:'checkout.session.expired',livemode:false,data:{object}});assert.equal(store.get('payments',payment.id)?.status,'PAID');
   processStripeEvent(store,{id:'evt_refund',type:'charge.refunded',data:{object:{payment_intent:'pi_unit',amount_refunded:149900}}});assert.equal(store.get('payments',payment.id)?.status,'REFUNDED');assert.equal(paidForSource(store,project),false);
   processStripeEvent(store,{...event,id:'evt_paid_late'});assert.equal(store.get('payments',payment.id)?.status,'REFUNDED');
 }finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries({STRIPE_SECRET_KEY:saved.secret,STRIPE_WEBHOOK_SECRET:saved.webhook,STRIPE_SITE_PRICE_CENTS:saved.price,STRIPE_CURRENCY:saved.currency})){if(value===undefined)delete process.env[key];else process.env[key]=value;}store.close();}
});
