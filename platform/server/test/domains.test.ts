import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDomain,quoteDomain,purchaseDomain,getDomainOrder,getDomainContactSchema,attachProjectDomain,verifyProjectDomain,validateDomainContact,DomainProviderError} from '../src/domains.js';

const contact={firstName:'Alex',lastName:'Exemplu',email:'alex@example.com',phone:'+40722123456',address1:'Strada Exemplu 1',city:'Brașov',state:'Brașov',zip:'500001',country:'RO'};
function mockRegistrar(extra:(path:string,init?:RequestInit)=>Response|undefined=()=>undefined){return(async(url:URL|string|Request,init?:RequestInit)=>{
 const path=new URL(String(url)).pathname;
 const value=extra(path,init);if(value)return value;
 if(path.endsWith('/tlds/supported'))return Response.json(['com','ro','co.uk']);
 if(path.endsWith('/availability'))return Response.json({available:true});
 if(path.endsWith('/price'))return Response.json({years:Number(new URL(String(url)).searchParams.get('years')),purchasePrice:11.25,renewalPrice:12.25,transferPrice:11.25});
 if(path.endsWith('/contact-info/schema'))return Response.json({});
 throw new Error('Unexpected path '+path);
}) as typeof fetch;}

test('domain names reject URLs, subdomain purchases, traversal and unsupported IDNs',async()=>{
 assert.equal(normalizeDomain(' Firma.RO. '),'firma.ro');
 for(const value of ['https://firma.ro','firma.ro/path','firma.ro:443','../firma.ro','firma..ro','-firma.ro','firma_.ro','xn--caf-dma.ro','firmă.ro','127.0.0.1'])assert.throws(()=>normalizeDomain(value));
 const old=globalThis.fetch;globalThis.fetch=mockRegistrar();
 try{await assert.rejects(quoteDomain('www.firma.ro'),/subdomeniu/);await assert.rejects(quoteDomain('firma.ro',0),/între 1 și 10/);}
 finally{globalThis.fetch=old;}
});

test('quotes are domain-specific, term-specific, USD with explicit renewal and bounded validity',async()=>{
 const old=globalThis.fetch;globalThis.fetch=mockRegistrar();
 try{
  const quote=await quoteDomain('firma.ro',2);assert.equal(quote.supported,true);assert.equal(quote.available,true);assert.equal(quote.currency,'USD');assert.equal(quote.years,2);assert.equal(quote.purchasePrice,11.25);assert.equal(quote.renewalPrice,12.25);assert.equal(Date.parse(quote.expiresAt)-Date.parse(quote.quotedAt),600000);
  const unsupported=await quoteDomain('firma.unsupported');assert.equal(unsupported.supported,false);assert.equal(unsupported.purchasePrice,null);
 }finally{globalThis.fetch=old;}
});

test('unavailable names and nonnumeric prices never become payable quotes',async()=>{
 const old=globalThis.fetch;
 try{
  globalThis.fetch=mockRegistrar(path=>path.endsWith('/availability')?Response.json({available:false}):undefined);
  const taken=await quoteDomain('firma.com');assert.equal(taken.available,false);assert.equal(taken.purchasePrice,null);
  globalThis.fetch=mockRegistrar(path=>path.endsWith('/price')?Response.json({years:1,purchasePrice:'unavailable',renewalPrice:'12.25',transferPrice:1}):undefined);
  const quote=await quoteDomain('firma.com');assert.equal(quote.purchasePrice,null);assert.equal(quote.renewalPrice,null);assert.ok(quote.reason);
 }finally{globalThis.fetch=old;}
});

test('purchase is opt-in, rechecks price and sends exact accepted term/contact values',async()=>{
 const oldFetch=globalThis.fetch,oldToken=process.env.VERCEL_TOKEN,oldEnabled=process.env.DOMAIN_PURCHASE_ENABLED;
 process.env.VERCEL_TOKEN='unit-test-token';delete process.env.DOMAIN_PURCHASE_ENABLED;let buys=0;
 globalThis.fetch=mockRegistrar((path,init)=>{
  if(path.endsWith('/buy')){buys++;const body=JSON.parse(String(init?.body));assert.equal(body.expectedPrice,11.25);assert.equal(body.years,1);assert.equal(body.autoRenew,false);assert.equal(body.contactInformation.email,'alex@example.com');return Response.json({orderId:'order_test_123',_links:{}});}
  return undefined;
 });
 try{
  await assert.rejects(purchaseDomain({domain:'firma.com',years:1,autoRenew:false,expectedPrice:11.25,contactInformation:contact}),/dezactivate/);
  process.env.DOMAIN_PURCHASE_ENABLED='true';
  await assert.rejects(purchaseDomain({domain:'firma.com',years:1,autoRenew:false,expectedPrice:9,contactInformation:contact}),/s-a schimbat/);assert.equal(buys,0);
  assert.deepEqual(await purchaseDomain({domain:'firma.com',years:1,autoRenew:false,expectedPrice:11.25,contactInformation:contact}),{orderId:'order_test_123',status:'PENDING'});assert.equal(buys,1);
 }finally{globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;if(oldEnabled===undefined)delete process.env.DOMAIN_PURCHASE_ENABLED;else process.env.DOMAIN_PURCHASE_ENABLED=oldEnabled;}
});

test('contact validation and schema requirements fail before any purchase',async()=>{
 assert.throws(()=>validateDomainContact({...contact,email:'not-email'}),/Emailul/);
 assert.throws(()=>validateDomainContact({...contact,phone:'0722123456'}),/internațional/);
 assert.throws(()=>validateDomainContact({...contact,extra:'private'}),/nepermise/);
 const oldFetch=globalThis.fetch,oldToken=process.env.VERCEL_TOKEN,oldEnabled=process.env.DOMAIN_PURCHASE_ENABLED;process.env.VERCEL_TOKEN='unit-test-token';process.env.DOMAIN_PURCHASE_ENABLED='true';
 globalThis.fetch=mockRegistrar(path=>path.endsWith('/contact-info/schema')?Response.json({type:'object',required:['registrantType'],properties:{registrantType:{type:'string',enum:['company','person']}}}):undefined);
 try{
  assert.ok((await getDomainContactSchema('firma.ro')).properties);
  await assert.rejects(purchaseDomain({domain:'firma.ro',years:1,autoRenew:false,expectedPrice:11.25,contactInformation:contact}),/Lipsesc informații/);
 }finally{globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;if(oldEnabled===undefined)delete process.env.DOMAIN_PURCHASE_ENABLED;else process.env.DOMAIN_PURCHASE_ENABLED=oldEnabled;}
});

test('order completion and DNS ownership verification are independent, explicit states',async()=>{
 const oldFetch=globalThis.fetch,oldToken=process.env.VERCEL_TOKEN;process.env.VERCEL_TOKEN='unit-test-token';let complete=false;
 globalThis.fetch=mockRegistrar((path)=>{
  if(path.includes('/registrar/orders/'))return Response.json({orderId:'order_test_123',status:'completed',domains:[{domainName:'firma.ro',years:1,autoRenew:false,status:complete?'completed':'pending'}]});
  if(path.endsWith('/verify'))return Response.json({name:'firma.ro',verified:true});
  if(path.endsWith('/domains'))return Response.json({name:'firma.ro',verified:false,verification:[{type:'TXT',domain:'_vercel.firma.ro',value:'verification-proof',reason:'pending'}]});
 });
 try{
  assert.equal((await getDomainOrder('order_test_123')).status,'PENDING');complete=true;assert.equal((await getDomainOrder('order_test_123')).status,'COMPLETED');
  const attached=await attachProjectDomain('starli-project','firma.ro');assert.equal(attached.verified,false);assert.equal(attached.verification[0].type,'TXT');
  assert.equal((await verifyProjectDomain('starli-project','firma.ro')).verified,true);
  await assert.rejects(getDomainOrder('../orders'),/invalid/);
 }finally{globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;}
});

test('provider errors do not expose response bodies or retry purchase requests',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=(async()=>{calls++;return new Response('sensitive-provider-data',{status:403});}) as typeof fetch;
 try{await assert.rejects(quoteDomain('firma.ro'),error=>error instanceof Error&&error.message.includes('403')&&!error.message.includes('sensitive'));assert.equal(calls,1);}
 finally{globalThis.fetch=old;}
});

test('ambiguous purchase responses require reconciliation and are never retried',async()=>{
 const oldFetch=globalThis.fetch,oldToken=process.env.VERCEL_TOKEN,oldEnabled=process.env.DOMAIN_PURCHASE_ENABLED;
 process.env.VERCEL_TOKEN='unit-test-token';process.env.DOMAIN_PURCHASE_ENABLED='true';let calls=0;let mode='disconnect';
 globalThis.fetch=mockRegistrar(path=>{if(path.endsWith('/buy')){calls++;if(mode==='disconnect')throw new Error('simulated lost response');return Response.json({orderId:'../invalid'});}return undefined;});
 const input={domain:'firma.ro',years:1,autoRenew:false,expectedPrice:11.25,contactInformation:contact};
 try{
  await assert.rejects(purchaseDomain(input),error=>error instanceof DomainProviderError&&error.code==='RECONCILIATION_REQUIRED');assert.equal(calls,1);
  mode='invalid';await assert.rejects(purchaseDomain(input),error=>error instanceof DomainProviderError&&error.code==='RECONCILIATION_REQUIRED');assert.equal(calls,2);
 }finally{globalThis.fetch=oldFetch;if(oldToken===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=oldToken;if(oldEnabled===undefined)delete process.env.DOMAIN_PURCHASE_ENABLED;else process.env.DOMAIN_PURCHASE_ENABLED=oldEnabled;}
});
