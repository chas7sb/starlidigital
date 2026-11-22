import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, id, now } from '../src/store.js';
import { Events } from '../src/events.js';
import { hashPassword, hashToken, sessionContext } from '../src/security.js';
import { issueOperatorToken, revokeOperatorToken } from '../src/operator-auth.js';
import {
  upsertLead,
  createOrUpdateProposalDemo,
  promoteOperatorProposal,
  getPublicProposalBySlug,
  requestProposalClaimOtp,
  rotateOrRevokeClaimCode,
  claimProposalWebsite,
  publicOptOutFromProposal,
  isContactOptedOut
} from '../src/leads-proposals.js';
import { prepareProposalMessage } from '../src/messaging.js';
import { selectVerticalAndVariant, buildProposalSpec, renderVerticalTemplate } from '../src/proposal-templates.js';
import { executeOperatorTool, runOperatorTurn } from '../src/operator-tools.js';
import { isDevicePathAllowed, validateStructuredArgs, redactDeviceOutput } from '../../device/src/index.js';
import { shouldTrackRoute, isSensitiveSearch, sanitizePathForAnalytics } from '../../web/src/analytics-route.js';

function setupOperatorEnv() {
  const store = new Store(':memory:');
  const events = new Events();

  const admin = store.saveUser({
    id: id(),
    username: 'admin',
    email: 'admin@starlidigital.ro',
    passwordHash: hashPassword('AdminParolaSigura2026!'),
    recoveryEmail: 'admin-recovery@starlidigital.ro',
    role: 'ADMIN',
    disabled: false,
    createdAt: now()
  });

  const client = store.saveUser({
    id: id(),
    username: 'client_ana',
    email: 'ana@starlidigital.ro',
    passwordHash: hashPassword('ClientParolaSigura2026!'),
    recoveryEmail: 'ana@gmail.com',
    role: 'USER',
    disabled: false,
    createdAt: now()
  });

  const adminCtx = sessionContext(store, '', () => {}, '127.0.0.1');
  adminCtx.user = admin;

  const clientCtx = sessionContext(store, '', () => {}, '127.0.0.1');
  clientCtx.user = client;

  // Issue scoped operator token
  const issued = issueOperatorToken(store, adminCtx, {
    label: 'Ubuntu CLI Token',
    permissions: ['READ', 'LEADS', 'PROPOSALS', 'DEVICES', 'JOBS', 'MESSAGES', 'PLATFORM_STAGE', 'CONVERSATIONS', 'PROJECTS'],
    ttlHours: 24
  });

  const opTokenCtx = sessionContext(store, '', () => {}, '127.0.0.1', `Bearer ${issued.token}`);

  return { store, events, admin, client, adminCtx, clientCtx, opTokenCtx, tokenRecord: issued.record, rawToken: issued.token };
}

test('1. Modul Snapshot (Opțiunea 2) este implicit și NU apelează generatorul complet Next.js', () => {
  const { store, events, opTokenCtx } = setupOperatorEnv();

  // Create lead & proposal with default mode (snapshot)
  const res = createOrUpdateProposalDemo(store, events, opTokenCtx, {
    businessName: 'Auto Expert Timișoara',
    industry: 'Service auto și detailing',
    locality: 'Timișoara',
    phone: '0722111222'
  });

  assert.equal(res.proposal.generationMode, 'snapshot');
  assert.equal(res.proposal.templateVertical, 'auto-service');
  assert.equal(res.proposal.costAiUnits, 70); // Low compute!
  assert.equal(res.proposal.leadScore, 'cold');
  assert.ok(res.proposal.specJson);

  // Fast demos still deliver real, editable Next.js source without invoking an AI builder.
  assert.ok(res.project.files.some((f:any)=>f.path==='app/page.tsx'));
  assert.ok(res.project.files.some((f:any)=>f.path==='app/contact/page.tsx'));

  // Proposal spec is valid and structured
  const spec = JSON.parse(res.proposal.specJson);
  assert.equal(spec.business.name, 'Auto Expert Timișoara');
  assert.equal(spec.template.vertical, 'auto-service');
  assert.ok(spec.conversion.whatsapp?.includes('40722111222'));

  store.close();
});

test('legacy visual demos receive the current React template at claim without overwriting existing client source',()=>{
 const {store,events,opTokenCtx,clientCtx}=setupOperatorEnv();
 try{
  const prep=createOrUpdateProposalDemo(store,events,opTokenCtx,{businessName:'Cafeneaua Legacy',industry:'Cafenea',locality:'Sibiu',phone:'0722111222'});
  const legacySpec=JSON.parse(prep.proposal.specJson!);legacySpec.template.version='v1.0.0';legacySpec.content.headline='PROMISIUNE VECHE';
  store.put('proposals',{...prep.proposal,specJson:JSON.stringify(legacySpec)},prep.proposal.ownerId);
  store.put('projects',{...prep.project,files:[]},prep.project.ownerId);
  const preview=getPublicProposalBySlug(store,events,prep.proposal.publicSlug,{interactiveVisit:false,path:'/servicii'});
  assert.ok(!preview.previewHtml.includes('PROMISIUNE VECHE'));
  const claimed=claimProposalWebsite(store,events,clientCtx,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode});
  assert.ok(claimed.project.files.some((f:any)=>f.path==='app/page.tsx'));
  assert.ok(!claimed.project.files.find((f:any)=>f.path==='app/page.tsx').content.includes('PROMISIUNE VECHE'));
  const editedFiles=claimed.project.files.map((f:any)=>f.path==='app/page.tsx'?{...f,content:f.content.replace('O cafea. O pauză. Un moment al tău.','Titlu editat de client')}:f);
  store.put('projects',{...claimed.project,files:editedFiles},claimed.project.ownerId);
  const updated=getPublicProposalBySlug(store,events,prep.proposal.publicSlug,{interactiveVisit:false});
  assert.ok(updated.previewHtml.includes('Titlu editat de client'));
 }finally{store.close();}
});

test('2. Modul Bespoke (Opțiunea 1) generează sursă Next.js reală și costă mai multe unități', () => {
  const { store, events, opTokenCtx } = setupOperatorEnv();

  const res = createOrUpdateProposalDemo(store, events, opTokenCtx, {
    businessName: 'Clinica Dentară Zâmbet Brașov',
    industry: 'Stomatologie modernă',
    locality: 'Brașov',
    phone: '0733444555',
    mode: 'bespoke'
  });

  assert.equal(res.proposal.generationMode, 'bespoke');
  assert.equal(res.proposal.costAiUnits, 2500); // Full bespoke compute!
  assert.ok(res.project.files.length > 0); // Real Next.js source code generated!
  assert.ok(res.project.files.some((f: any) => f.path === 'app/page.tsx'));

  store.close();
});

test('3. Selectare automată din cele 10 verticale industriale românești', () => {
  const cases: Array<{ industry: string; name: string; expected: string }> = [
    { industry: 'vulcanizare și detailing', name: 'Mecanic Pro', expected: 'auto-service' },
    { industry: 'coafor și manichiură', name: 'Salon Bella', expected: 'beauty' },
    { industry: 'cabinet stomatologic', name: 'Dr. Ionescu', expected: 'clinic' },
    { industry: 'renovări interioare', name: 'Construct Grup', expected: 'construction' },
    { industry: 'instalații sanitare și termice', name: 'Termo Serv', expected: 'trades' },
    { industry: 'curățenie birouri', name: 'Clean Express', expected: 'cleaning' },
    { industry: 'pensiune turistică', name: 'Vila Bradul', expected: 'hospitality' },
    { industry: 'cafenea de specialitate', name: 'Artisan Coffee', expected: 'restaurant' },
    { industry: 'mobilă de bucătărie la comandă', name: 'Atelier Lemn', expected: 'furniture' },
    { industry: 'fotograf nunți și evenimente', name: 'Foto Vision', expected: 'events' }
  ];

  for (const c of cases) {
    const sel = selectVerticalAndVariant(c.industry, c.name);
    assert.equal(sel.vertical, c.expected, `Failed for ${c.industry}`);
  }
});

test('4. Datele neconfirmate NU sunt fabricate și telefonul confirmat devine WhatsApp', () => {
  const spec = buildProposalSpec({
    proposalId: 'prop-1',
    leadId: 'lead-1',
    lead: {
      businessName: 'Cafeneaua Veche',
      industry: 'Cafenea',
      locality: 'Sibiu',
      normalizedPhone: '+40744123456'
    },
    mode: 'snapshot'
  });

  // Confirmed phone is converted to valid WhatsApp link
  assert.equal(spec.conversion.whatsapp, 'https://wa.me/40744123456');

  // Unknown information is tracked, NOT fabricated
  assert.ok(spec.research.unknownFacts.includes('Prețuri detaliate'));
  assert.equal(spec.content.confirmedTestimonials, undefined);
  assert.equal(spec.content.confirmedPrices, undefined);

  // Template renders safely with clean HTML
  const html = renderVerticalTemplate(spec, '/');
  assert.ok(html.includes('Cafeneaua Veche'));
  assert.ok(html.includes('https://wa.me/40744123456'));
  assert.ok(html.includes('Sibiu'));
});

test('5. Promovarea Snapshot -> Bespoke păstrează identitatea leadului și generează codul Next.js', () => {
  const { store, events, opTokenCtx } = setupOperatorEnv();

  // Create snapshot initially
  const initial = createOrUpdateProposalDemo(store, events, opTokenCtx, {
    businessName: 'Mobilă Design Cluj',
    industry: 'Tâmplărie și mobilă la comandă',
    locality: 'Cluj-Napoca',
    phone: '0755999888',
    mode: 'snapshot'
  });

  assert.equal(initial.proposal.generationMode, 'snapshot');
  assert.ok(initial.project.files.some((f:any)=>f.path==='app/page.tsx'));

  // Promote to bespoke
  const promoted = promoteOperatorProposal(store, events, opTokenCtx, initial.proposal.id, 'bespoke');
  assert.equal(promoted.id, initial.proposal.id);
  assert.equal(promoted.generationMode, 'bespoke');
  assert.equal(promoted.costAiUnits, 2500);

  // Now project has real Next.js files!
  const updatedProject = store.get('projects', initial.project.id);
  assert.ok(updatedProject!.files.length > 0);

  store.close();
});

test('6. Limbaj natural în română: recunoaștere Opțiunea 1, Opțiunea 2 și Promovare', async () => {
  const { store, events, opTokenCtx } = setupOperatorEnv();

  // "Fă opțiunea 2" -> snapshot
  const turn1 = await runOperatorTurn(store, events, opTokenCtx, {
    prompt: 'Pregătește o propunere pentru Frizeria Alex din Arad. Uite telefonul 0722334455. Fă opțiunea 2.'
  },{autonomous:false});
  assert.ok(turn1.reply.content.includes('Opțiunea 2 · Propunere rapidă'));

  // "Transformă în opțiunea 1" -> promotion
  const turn2 = await runOperatorTurn(store, events, opTokenCtx, {
    conversationId: turn1.conversation.id,
    prompt: 'Clientul ăsta pare foarte important. Fă-i opțiunea 1.'
  },{autonomous:false,bespokeBuilder:async()=>({project:store.get('projects',store.list('proposals')[0].projectId)!,proposal:store.list('proposals')[0],alreadyGenerated:false})});
  assert.ok(turn2.reply.content.includes('promovată la opțiunea 1'));

  store.close();
});

test('7. Revocarea imediată a tokenului de operator blochează accesul', () => {
  const { store, opTokenCtx, rawToken, adminCtx, tokenRecord } = setupOperatorEnv();

  // Token is valid
  assert.ok(opTokenCtx.user);

  // Revoke token
  revokeOperatorToken(store, adminCtx, tokenRecord.id);

  // Refresh context with same token -> access immediately revoked!
  const refreshedCtx = sessionContext(store, '', () => {}, '127.0.0.1', `Bearer ${rawToken}`);
  assert.equal(refreshedCtx.user, undefined);
  assert.equal(refreshedCtx.operatorPermissions, undefined);

  store.close();
});

test('8. Revendicare atomică doar cu codul invitației (exact un proprietar)', () => {
  const { store, events, opTokenCtx, client } = setupOperatorEnv();

  const prep = createOrUpdateProposalDemo(store, events, opTokenCtx, {
    businessName: 'Brutăria Artizanală Iași',
    locality: 'Iași',
    phone: '0744000111'
  });

  const slug = prep.proposal.publicSlug;
  const claimCode = prep.claimCode;

  assert.match(claimCode, /^\d{5}$/);
  assert.notEqual(prep.proposal.claimCodePrefix, claimCode);
  assert.equal(prep.proposal.claimOtpHash, null);
  // Client context claims proposal
  const clientSession = sessionContext(store, '', () => {}, '127.0.0.1');
  clientSession.user = client;

  const claim1 = claimProposalWebsite(store, events, clientSession, {
    publicSlug: slug,
    claimCode
  });
  assert.equal(claim1.alreadyClaimedByMe, false);

  // Second claim attempt with same code must be rejected (single-use)
  assert.throws(() => {
    claimProposalWebsite(store, events, opTokenCtx, {
      publicSlug: slug,
      claimCode
    });
  }, /deja revendicată/);

  // Calling again by the winner returns idempotent success
  const claim2 = claimProposalWebsite(store, events, clientSession, {
    publicSlug: slug,
    claimCode
  });
  assert.equal(claim2.alreadyClaimedByMe, true);

  store.close();
});

test('9. Refuz contact (opt-out) persistă și blochează mesajele viitoare', () => {
  const { store, events, opTokenCtx } = setupOperatorEnv();

  const prep = createOrUpdateProposalDemo(store, events, opTokenCtx, {
    businessName: 'Florăria Iris Constanța',
    locality: 'Constanța',
    phone: '0722888999'
  });

  assert.equal(isContactOptedOut(store, '+40722888999'), false);

  // Opt-out from public proposal
  publicOptOutFromProposal(store, events, opTokenCtx, {
    publicSlug: prep.proposal.publicSlug,
    reason: 'Nu doresc mesaje nesolicitate'
  });

  assert.equal(isContactOptedOut(store, '+40722888999'), true);

  store.close();
});

test('10. Securitate: sandbox pe dispozitiv, redactare secrete și igienizare analitice', () => {
  // Path traversal rejection
  assert.equal(isDevicePathAllowed('C:/safe/repo/web', ['C:/safe/repo']), true);
  assert.equal(isDevicePathAllowed('C:/safe/repo/../../Windows/System32', ['C:/safe/repo']), false);

  // Metacharacter rejection
  assert.throws(() => validateStructuredArgs(['file.txt', '|', 'calc.exe']));

  // Secret redaction
  const redacted = redactDeviceOutput('Secret token: starli_op_secret12345678901234567890 and key sk_live_abc123');
  assert.ok(!redacted.includes('starli_op_secret'));
  assert.ok(!redacted.includes('sk_live_abc123'));

  // Analytics query param sanitization
  assert.equal(isSensitiveSearch('?token=starli_op_123'), true);
  assert.equal(isSensitiveSearch('?claimCode=SC-1234-5678-9012'), true);
  assert.equal(isSensitiveSearch('?otp=123456'), true);
  assert.equal(isSensitiveSearch('?utm_source=google'), false);

  assert.equal(shouldTrackRoute('/', '/propunere/test', '?claim=SC-1234'), false);
  assert.equal(sanitizePathForAnalytics('/propunere/test', '?claim=SC-1234&view=mobile'), '/propunere/test?view=mobile');
});


test('11. Codul scurt are cinci încercări persistente pe propunere, inclusiv după rotație de IP', () => {
  const {store,events,opTokenCtx,client}=setupOperatorEnv();
  const prep=createOrUpdateProposalDemo(store,events,opTokenCtx,{businessName:'Atelier cod scurt',locality:'Cluj'});
  for(let i=0;i<5;i++){
    const ctx=sessionContext(store,'',()=>{},'claim-wrong-'+i);ctx.user=client;
    assert.throws(()=>claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode==='00000'?'99999':'00000'}),/nu sunt valide/);
    assert.equal(store.get('proposals',prep.proposal.id)?.claimAttempts,i+1);
  }
  const ctx=sessionContext(store,'',()=>{},'claim-correct-locked');ctx.user=client;
  assert.throws(()=>claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode}),/nu sunt valide/);
  const rotated=rotateOrRevokeClaimCode(store,events,opTokenCtx,prep.proposal.id);
  assert.match(rotated.claimCode!,/^\d{5}$/);
  assert.equal(rotated.proposal.claimAttempts,0);
  const result=claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:rotated.claimCode!});
  assert.equal(result.project.ownerId,client.id);
  store.close();
});

test('12. Codurile expirate sau revocate nu transferă website-ul; codurile vechi rămân compatibile fără OTP',()=>{
  const {store,events,opTokenCtx,client}=setupOperatorEnv();
  const prep=createOrUpdateProposalDemo(store,events,opTokenCtx,{businessName:'Atelier compatibil',locality:'Arad'});
  const ctx=sessionContext(store,'',()=>{},'claim-lifecycle');ctx.user=client;
  store.put('proposals',{...prep.proposal,claimExpiresAt:new Date(Date.now()-1000).toISOString()});
  assert.throws(()=>claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode}),/nu sunt valide/);
  store.put('proposals',{...prep.proposal,claimRevokedAt:now()});
  assert.throws(()=>claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode}),/nu sunt valide/);
  const legacy='SC-ABCD-EFGH-JKLM';
  store.put('proposals',{...prep.proposal,claimCodeHash:hashToken(legacy)});
  const result=claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:legacy});
  assert.equal(result.project.ownerId,client.id);
  store.close();
});

test('13. Revendicarea cere un cont real și nu expediază un al doilea SMS',()=>{
  const {store,events,opTokenCtx}=setupOperatorEnv();
  const prep=createOrUpdateProposalDemo(store,events,opTokenCtx,{businessName:'Atelier cont real',locality:'Oradea'});
  const guest=sessionContext(store,'',()=>{},'claim-guest');
  assert.throws(()=>claimProposalWebsite(store,events,guest,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode}));
  assert.throws(()=>requestProposalClaimOtp(store,events,guest,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode,contact:''}),/Nu este necesar un al doilea SMS/);
  assert.equal(store.list('transactional-otps').length,0);
  assert.equal(store.get('proposals',prep.proposal.id)?.claimedByUserId,null);
  store.close();
});


test('14. Invitația SMS include codul valid de cinci cifre; pregătirea nu expediază și reîncercarea nu rotește',()=>{
  const {store,events,opTokenCtx,client}=setupOperatorEnv();
  const prep=createOrUpdateProposalDemo(store,events,opTokenCtx,{businessName:'Atelier invitație',locality:'Cluj',phone:'0744999222',consentStatus:'GRANTED',consentProvenance:'Solicitare explicită client'});
  const first=prepareProposalMessage(store,events,opTokenCtx,{proposalId:prep.proposal.id,idempotencyKey:'sms-invitation-one'});
  assert.equal(first.message.status,'PREGATIT');
  assert.equal(first.message.deviceJobId,null);
  assert.equal(store.list('operator-jobs').filter(j=>j.kind==='device.sms.send').length,0);
  const code=/Codul tău de revendicare: (\d{5})\./.exec(first.message.body)?.[1];assert.ok(code);
  const issuedHash=store.get('proposals',prep.proposal.id)?.claimCodeHash;
  const retry=prepareProposalMessage(store,events,opTokenCtx,{proposalId:prep.proposal.id,idempotencyKey:'sms-invitation-one'});
  assert.equal(retry.deduplicated,true);assert.equal(retry.message.body,first.message.body);
  assert.equal(store.get('proposals',prep.proposal.id)?.claimCodeHash,issuedHash);
  store.put('outbound-messages',{...first.message,status:'APROBAT'});
  assert.throws(()=>prepareProposalMessage(store,events,opTokenCtx,{proposalId:prep.proposal.id,idempotencyKey:'sms-invitation-two'}),/Există deja o invitație/);
  assert.equal(store.get('proposals',prep.proposal.id)?.claimCodeHash,issuedHash);
  const ctx=sessionContext(store,'',()=>{},'claim-sms-invitation');ctx.user=client;
  assert.equal(claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:code}).project.ownerId,client.id);
  assert.throws(()=>prepareProposalMessage(store,events,opTokenCtx,{proposalId:prep.proposal.id,idempotencyKey:'sms-after-claimed'}),/deja revendicată/);
  store.close();
});

test('15. Eșecul salvării SMS anulează rotația codului și auditul în aceeași tranzacție',()=>{
  const {store,events,opTokenCtx,client}=setupOperatorEnv();
  const prep=createOrUpdateProposalDemo(store,events,opTokenCtx,{businessName:'Atelier tranzacție',locality:'Arad',phone:'0744999333',consentStatus:'GRANTED',consentProvenance:'Solicitare explicită client'});
  const original=store.get('proposals',prep.proposal.id);
  const beforeAudit=store.list('audit').length;
  const originalPut=store.put.bind(store);
  store.put=((collection,value,owner)=>{if(collection==='outbound-messages')throw Error('SMS persistence failure');return originalPut(collection,value,owner);}) as typeof store.put;
  assert.throws(()=>prepareProposalMessage(store,events,opTokenCtx,{proposalId:prep.proposal.id}),/SMS persistence failure/);
  store.put=originalPut;
  assert.deepEqual(store.get('proposals',prep.proposal.id),original);
  assert.equal(store.list('audit').length,beforeAudit);
  assert.equal(store.list('outbound-messages').length,0);
  const ctx=sessionContext(store,'',()=>{},'claim-sms-rollback');ctx.user=client;
  assert.equal(claimProposalWebsite(store,events,ctx,{publicSlug:prep.proposal.publicSlug,claimCode:prep.claimCode}).project.ownerId,client.id);
  store.close();
});

test('failed proposals are recovered in the same project instead of creating another duplicate',()=>{
 const {store,events,adminCtx}=setupOperatorEnv();try{
  const first=createOrUpdateProposalDemo(store,events,adminCtx,{businessName:'Mondo Instal Brasov',locality:'Brașov',phone:'0747020446',mode:'snapshot'});
  store.put('proposals',{...first.proposal,status:'ESEC'},first.proposal.ownerId);
  const second=createOrUpdateProposalDemo(store,events,adminCtx,{businessName:'Mondo Instal Brasov',locality:'Brașov',phone:'0747020446',mode:'snapshot'});
  assert.equal(second.proposal.id,first.proposal.id);assert.equal(second.project.id,first.project.id);assert.equal(second.proposal.publicSlug,first.proposal.publicSlug);assert.equal(store.list('proposals').length,1);assert.equal(store.list('projects').length,1);
 }finally{store.close();}
});
