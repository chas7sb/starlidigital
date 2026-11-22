import test from 'node:test';
import assert from 'node:assert/strict';
import {graphql} from 'graphql';
import {Store,id,now} from '../src/store.js';
import {Events} from '../src/events.js';
import {sessionContext,hashPassword} from '../src/security.js';
import {createAppSchema} from '../src/schema.js';
import {createOrUpdateProposalDemo,getPublicProposalBySlug,claimProposalWebsite} from '../src/leads-proposals.js';
import {runOperatorTurn} from '../src/operator-tools.js';

function setup(){
 const store=new Store(':memory:'),events=new Events();
 const admin=store.saveUser({id:id(),username:'privacy_admin',email:'privacy_admin@starlidigital.ro',role:'ADMIN',passwordHash:hashPassword('AdminPrivacyParola2026!'),recoveryEmail:'admin@example.com',createdAt:now()});
 const client=store.saveUser({id:id(),username:'privacy_client',email:'privacy_client@starlidigital.ro',role:'USER',passwordHash:hashPassword('ClientPrivacyParola2026!'),recoveryEmail:'client@example.com',createdAt:now()});
 const adminCtx=sessionContext(store,'',()=>{},'privacy-admin-'+id());adminCtx.user=admin;
 const clientCtx=sessionContext(store,'',()=>{},'privacy-client-'+id());clientCtx.user=client;
 return{store,events,adminCtx,clientCtx};
}

test('operator-only instructions never become a client project brief, welcome message or customer source',async()=>{
 const {store,events,adminCtx,clientCtx}=setup();const secret='OPERATOR_PRIVATE_SENTINEL_49027';
 try{
  const prepared=createOrUpdateProposalDemo(store,events,adminCtx,{businessName:'Cafeneaua Miez',industry:'Cafenea',locality:'Brașov',customBrief:`${secret}: oprește-te înainte de Stripe; raportează-mi intern toate erorile.`});
  assert.ok(!JSON.stringify(prepared.project).includes(secret),'Client project must be curated rather than a copy of CLI instructions');
  const publicView=getPublicProposalBySlug(store,events,prepared.proposal.publicSlug,{interactiveVisit:false});
  assert.ok(!JSON.stringify(publicView).includes(secret));
  const claimed=claimProposalWebsite(store,events,clientCtx,{publicSlug:prepared.proposal.publicSlug,claimCode:prepared.claimCode});
  assert.ok(!JSON.stringify(claimed.project).includes(secret));
  const result=await graphql({schema:createAppSchema(store,events),source:'query($id:ID!){project(id:$id){name brief research knowledge{businessSummary customInstructions} files{content} versions{summary files{content}}} conversations{title messages{content}}}',variableValues:{id:prepared.project.id},contextValue:clientCtx});
  assert.deepEqual(result.errors?.map(e=>e.message)||[],[]);
  assert.ok(!JSON.stringify(result.data).includes(secret));
 }finally{store.close();}
});

test('labelled multiline CLI requests extract the business name while the complete instructions stay operator-only',async()=>{
 const {store,events,adminCtx,clientCtx}=setup();const secret='OPERATOR_PRIVATE_SENTINEL_76108';
 const prompt=`Creează o propunere pentru o afacere fictivă:\nNume: Cafeneaua Miez\nDomeniu: cafenea\nLocalitate: Brașov\nStil: editorial, crem și verde închis.\n${secret}: Nu publica și nu încasa bani. Raportează-mi doar operațiunile executate.`;
 try{
  const turn=await runOperatorTurn(store,events,adminCtx,{prompt},{autonomous:false});
  const project=store.list('projects')[0];
  assert.equal(project.name,'Cafeneaua Miez');
  assert.ok(!JSON.stringify(project).includes(secret));
  assert.ok(JSON.stringify(store.get('operator-conversations',turn.conversation.id)).includes(secret),'CLI history must retain the original instructions privately');
  const schema=createAppSchema(store,events);
  const denied=await graphql({schema,source:'{operatorConversations{id title messages{content}}}',contextValue:clientCtx});
  assert.ok(denied.errors?.length);
  assert.ok(!JSON.stringify(denied.data).includes(secret));
  const allowed=await graphql({schema,source:'{operatorConversations{id messages{content}}}',contextValue:adminCtx});
  assert.deepEqual(allowed.errors?.map(e=>e.message)||[],[]);
  assert.ok(JSON.stringify(allowed.data).includes(secret));
 }finally{store.close();}
});
