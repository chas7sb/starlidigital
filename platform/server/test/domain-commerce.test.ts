import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Store} from '../src/store.js';
import {Events} from '../src/events.js';
import {stripeWebhook} from '../src/billing.js';
import {createDomainQuote,createDomainCheckout,listDomainPayments,listDomainQuotes,domainPriceCents,processDomainStripeEvent,tickDomainCommerce} from '../src/domain-commerce.js';

const contact={firstName:'Alex',lastName:'Titular',email:'titular-privat@example.com',phone:'+40722123456',address1:'Adresa privată 123',city:'Brașov',state:'Brașov',zip:'500001',country:'RO'};
function setup(t:TestContext,live=false){
 const keys=['EMAIL_FROM','EMAIL_OUTBOX_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_LIVE_ENABLED','DOMAIN_PURCHASE_ENABLED'];const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 process.env.EMAIL_FROM='Local <sender@example.test>';process.env.EMAIL_OUTBOX_KEY='ab'.repeat(32);process.env.STRIPE_SECRET_KEY=live?'sk_live_testfixture':'sk_test_testfixture';process.env.STRIPE_WEBHOOK_SECRET='whsec_fixture';process.env.STRIPE_LIVE_ENABLED=live?'true':'false';process.env.DOMAIN_PURCHASE_ENABLED='true';
 const oldFetch=globalThis.fetch;globalThis.fetch=(async()=>Response.json({id:live?'cs_live_domain':'cs_test_domain',url:'https://checkout.stripe.com/c/pay/domain',livemode:live})) as typeof fetch;
 const store=new Store(':memory:');const user={id:'user1',username:'client',role:'USER',recoveryEmail:'recovery@example.com'};const project={id:'project1',ownerId:user.id,name:'Proiect',publicVerified:true,deploymentStatus:'READY',deploymentId:'dpl_verified',providerProjectId:'prj_verified'};store.saveUser(user);store.put('projects',project);
 let time=Date.now();const quote=async(domain:string,years=1)=>({provider:'VERCEL' as const,domain,supported:true,available:true,currency:'USD' as const,purchasePrice:11.25,renewalPrice:12.25,years,quotedAt:new Date(time).toISOString(),expiresAt:new Date(time+600000).toISOString(),reason:null});
 const provider={quote,schema:async()=>({}),clock:()=>time,configured:()=>true};
 t.after(()=>{globalThis.fetch=oldFetch;store.close();for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
 return{store,user,project,provider,events:new Events(),advance:(ms=30000)=>{time+=ms;}};
}
async function paidFixture(t:TestContext,live=false){
 const fixture=setup(t,live);const{store,user,project,provider}=fixture;const quote=await createDomainQuote(store,project,user,'firma.ro',1,provider);const payment=await createDomainCheckout(store,quote.id,user,{autoRenew:false,consent:true,contactInformation:contact},provider);
 const stored=store.get('domain-payments',payment.id)!;
 const event={id:'evt_domain_paid',type:'checkout.session.completed',livemode:live,data:{object:{id:stored.sessionId,client_reference_id:user.id,amount_total:1125,currency:'usd',payment_status:'paid',payment_intent:'pi_domain',metadata:{starliProduct:'domain',domainPaymentId:payment.id,quoteId:quote.id,projectId:project.id,ownerId:user.id,domain:'firma.ro'}}}};
 return{...fixture,quote,payment,event};
}
function workerProvider(store:Store){return{configured:()=>true,purchase:async()=>({orderId:'order_domain',status:'PENDING' as const}),order:async()=>({orderId:'order_domain',status:'COMPLETED' as const,domains:[{domain:'firma.ro',years:1,autoRenew:false,status:'COMPLETED' as const}]}),deployment:async()=>({id:'dpl_verified',url:'https://project.vercel.app',status:'READY' as const,projectId:'prj_verified'}),lookup:async()=>null,attach:async()=>({domain:'firma.ro',verified:true,verification:[]}),verify:async()=>({domain:'firma.ro',verified:true,verification:[]}),dns:async()=>({configured:true,verification:[]})};}

test('quotes belong to owners, prices use exact USD cents and public records exclude registrants',async t=>{
 const{store,user,project,provider}=setup(t);assert.equal(domainPriceCents(11.25),1125);for(const value of[11.251,0,-1,Infinity,NaN])assert.throws(()=>domainPriceCents(value));
 const other={id:'other',username:'other',role:'USER'};store.saveUser(other);await assert.rejects(createDomainQuote(store,project,other,'firma.ro',1,provider),/proprietarul/);
 const quote=await createDomainQuote(store,project,user,'firma.ro',1,provider);assert.equal(quote.amount,1125);assert.equal(listDomainQuotes(store,other).length,0);
 await assert.rejects(createDomainCheckout(store,quote.id,user,{autoRenew:false,consent:false,contactInformation:contact},provider),/explicit/);
 const payment=await createDomainCheckout(store,quote.id,user,{autoRenew:false,consent:true,contactInformation:contact},provider);
 assert.equal(payment.amount,1125);assert.equal(payment.currency,'usd');assert.equal(payment.contactInformation,undefined);assert.equal(payment.ownerId,undefined);
 const privateRows=JSON.stringify(store.list('domain-contacts'));assert.ok(!privateRows.includes(contact.email));assert.ok(!privateRows.includes(contact.address1));assert.ok(store.list('domain-contacts')[0].ciphertext);
 assert.equal(listDomainPayments(store,other).length,0);assert.equal(listDomainPayments(store,user)[0].ciphertext,undefined);
});

test('a valid signed webhook is mandatory; replay is idempotent and no site fulfillment is granted',async t=>{
 const{store,event,payment,events}=await paidFixture(t);
 const raw=Buffer.from(JSON.stringify(event));const timestamp=Math.floor(Date.now()/1000);const signature=createHmac('sha256','whsec_fixture').update(timestamp+'.').update(raw).digest('hex');
 async function deliver(sig:string){const req={method:'POST',headers:{'stripe-signature':sig},async *[Symbol.asyncIterator](){yield raw;}};const res={statusCode:200,setHeader(){},writeHead(code:number){this.statusCode=code;},end(){}};await stripeWebhook(req as any,res as any,store,events,event=>processDomainStripeEvent(store,event));return res.statusCode;}
 assert.equal(await deliver(`t=${timestamp},v1=${'0'.repeat(64)}`),400);assert.equal(store.get('domain-payments',payment.id)!.status,'PENDING');
 assert.equal(await deliver(`t=${timestamp},v1=${signature}`),200);assert.equal(store.get('domain-payments',payment.id)!.status,'PAID');
 assert.equal(await deliver(`t=${timestamp},v1=${signature}`),200);assert.equal(store.list('domain-jobs').length,1);assert.equal(store.list('fulfillment-jobs').length,0);
});

test('webhook identity, currency and paid amount are tied to the immutable domain quote',async t=>{
 const{store,event,payment}=await paidFixture(t);const wrong=structuredClone(event);wrong.data.object.amount_total=1124;assert.throws(()=>processDomainStripeEvent(store,wrong),/mismatch/);
 wrong.data.object.amount_total=1125;wrong.data.object.metadata.ownerId='other';assert.throws(()=>processDomainStripeEvent(store,wrong),/mismatch/);assert.equal(store.get('domain-payments',payment.id)!.status,'PENDING');
 assert.equal(processDomainStripeEvent(store,{id:'evt_unrelated',type:'checkout.session.completed',data:{object:{metadata:{}}}}),undefined);
});

test('sandbox payments cannot buy or attach a real domain even when buying is enabled',async t=>{
 const f=await paidFixture(t,false);processDomainStripeEvent(f.store,f.event);let buys=0;
 await tickDomainCommerce(f.store,f.events,{...f.provider,...workerProvider(f.store),purchase:async()=>{buys++;throw new Error('Must not buy');}});
 assert.equal(buys,0);assert.equal(f.store.list('domain-jobs')[0].status,'SANDBOX_PAID');
});

test('live domain checkout cannot collect money while the registrar purchase connection is disabled',async t=>{
 const f=setup(t,true);const quote=await createDomainQuote(f.store,f.project,f.user,'firma.ro',1,f.provider);
 await assert.rejects(createDomainCheckout(f.store,quote.id,f.user,{autoRenew:false,consent:true,contactInformation:contact},{...f.provider,configured:()=>false}),/nu poate încasa bani reali/);
 assert.equal(f.store.list('domain-payments').length,0);
});

test('live paid purchase is write-ahead, single-shot and attaches only the provider-verified owned project',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let buys=0,attaches=0;
 const provider={...f.provider,...workerProvider(f.store),purchase:async(input:any)=>{buys++;const job=f.store.list('domain-jobs')[0];assert.equal(job.status,'SUBMITTING');assert.equal(job.submissionAttempted,true);assert.equal(input.expectedPrice,11.25);assert.equal(input.contactInformation.email,contact.email);return{orderId:'order_domain',status:'PENDING' as const};},attach:async(projectId:string,domain:string)=>{attaches++;assert.equal(projectId,'prj_verified');return{domain,verified:true,verification:[]};}};
 await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,1);assert.equal(f.store.list('domain-jobs')[0].status,'PURCHASE_PENDING');
 f.advance();await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,1);assert.equal(attaches,1);assert.equal(f.store.list('domain-jobs')[0].status,'CONNECTED');assert.equal(f.store.list('domain-jobs')[0].registrationVerified,true);
 f.advance();await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,1);assert.equal(attaches,1);
});

test('unknown purchase outcome and persisted SUBMITTING never trigger a second registrar charge',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let buys=0;
 const provider={...f.provider,...workerProvider(f.store),purchase:async()=>{buys++;throw new Error('Lost provider response');}};
 await tickDomainCommerce(f.store,f.events,provider);assert.equal(f.store.list('domain-jobs')[0].status,'NEEDS_REVIEW');f.advance();await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,1);
 const job=f.store.list('domain-jobs')[0];f.store.put('domain-jobs',{...job,status:'SUBMITTING',leaseUntil:0,nextAttemptAt:0});await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,1);assert.equal(f.store.list('domain-jobs')[0].status,'NEEDS_REVIEW');
});

test('expired quotes and revoked payments cannot authorize a purchase',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let buys=0;const provider={...f.provider,...workerProvider(f.store),purchase:async()=>{buys++;return{orderId:'order_domain',status:'PENDING' as const};}};
 f.advance(700000);await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,0);assert.equal(f.store.list('domain-jobs')[0].status,'NEEDS_REVIEW');
 const job=f.store.list('domain-jobs')[0];f.store.put('domain-jobs',{...job,status:'PENDING',nextAttemptAt:0});f.store.put('domain-payments',{...f.store.get('domain-payments',f.payment.id)!,quoteExpiresAt:new Date(Date.now()+900000).toISOString(),status:'REFUNDED'});await tickDomainCommerce(f.store,f.events,provider);assert.equal(buys,0);assert.equal(f.store.list('domain-jobs')[0].status,'BLOCKED');
});

test('registrant authentication-tag tampering fails before the write-ahead purchase marker',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let buys=0;const privateRow=f.store.get('domain-contacts',f.payment.id)!;
 f.store.put('domain-contacts',{...privateRow,tag:Buffer.alloc(16).toString('base64')});
 await tickDomainCommerce(f.store,f.events,{...f.provider,...workerProvider(f.store),purchase:async()=>{buys++;throw new Error('Must not buy');}});
 assert.equal(buys,0);assert.equal(f.store.list('domain-jobs')[0].status,'NEEDS_REVIEW');assert.equal(f.store.list('domain-jobs')[0].submissionAttempted,false);
});

test('a domain refund event revokes purchase authorization without changing site payment records',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let buys=0;
 assert.equal(processDomainStripeEvent(f.store,{id:'evt_domain_refund',type:'charge.refunded',livemode:true,data:{object:{payment_intent:'pi_domain',amount_refunded:1125}}}),true);
 await tickDomainCommerce(f.store,f.events,{...f.provider,...workerProvider(f.store),purchase:async()=>{buys++;throw new Error('Must not buy');}});
 assert.equal(buys,0);assert.equal(f.store.get('domain-payments',f.payment.id)!.status,'REFUNDED');assert.equal(f.store.list('domain-jobs')[0].status,'BLOCKED');assert.equal(f.store.list('payments').length,0);
});

test('ownership confirmation alone never claims DNS connected; exact provider recommendations remain visible',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let dnsReady=false;
 const provider={...f.provider,...workerProvider(f.store),dns:async()=>({configured:dnsReady,verification:[{type:'A',domain:'firma.ro',value:'192.0.2.1',reason:'Mock provider recommendation'}]})};
 await tickDomainCommerce(f.store,f.events,provider);f.advance();await tickDomainCommerce(f.store,f.events,provider);assert.equal(f.store.list('domain-jobs')[0].status,'DNS_PENDING');assert.equal(listDomainPayments(f.store,f.user)[0].verification[0].value,'192.0.2.1');
 dnsReady=true;f.advance(70000);await tickDomainCommerce(f.store,f.events,{...provider,lookup:async()=>({domain:'firma.ro',verified:true,verification:[]})});assert.equal(f.store.list('domain-jobs')[0].status,'CONNECTED');
});

test('a mismatched provider project blocks attachment after successful registration',async t=>{
 const f=await paidFixture(t,true);processDomainStripeEvent(f.store,f.event);let attaches=0;
 const provider={...f.provider,...workerProvider(f.store),deployment:async()=>({id:'dpl_verified',url:'https://project.vercel.app',status:'READY' as const,projectId:'prj_someoneelse'}),attach:async()=>{attaches++;return{domain:'firma.ro',verified:true,verification:[]};}};
 await tickDomainCommerce(f.store,f.events,provider);f.advance();await tickDomainCommerce(f.store,f.events,provider);assert.equal(attaches,0);assert.notEqual(f.store.list('domain-jobs')[0].status,'CONNECTED');
});
