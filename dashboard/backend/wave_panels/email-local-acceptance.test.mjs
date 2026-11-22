import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import nodemailer from 'nodemailer';
import {Studio,validate} from './studio.mjs';
import {campaign,context,fixtureAdapters} from './fixture.mjs';
const directory=new URL('.',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
test('Agata: section revision + reload + exact approval + one SMTP receipt',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'starli-email-'));let messages=[],received='',mode=false;
 const server=net.createServer(socket=>{socket.write('220 localhost Starli fixture\r\n');let buf='';socket.on('data',chunk=>{buf+=chunk;let n;while((n=buf.indexOf('\r\n'))>=0){const line=buf.slice(0,n);buf=buf.slice(n+2);if(mode){if(line==='.'){messages.push(received);received='';mode=false;socket.write('250 2.0.0 accepted fixture-1\r\n');}else received+=line+'\r\n';continue;}if(/^EHLO/.test(line))socket.write('250-localhost\r\n250 8BITMIME\r\n');else if(line==='DATA'){mode=true;socket.write('354 End data\r\n');}else if(line==='QUIT'){socket.end('221 Bye\r\n');}else socket.write('250 OK\r\n');}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const transport=nodemailer.createTransport({host:'127.0.0.1',port,secure:false,ignoreTLS:true});const receipts=new Map();
 const delivery={async deliver(p){if(receipts.has(p.operationId))return receipts.get(p.operationId);const out=await transport.sendMail({envelope:p.envelope,raw:p.rawMime});const receipt={operationId:p.operationId,status:'accepted',adapter:'local-smtp-fixture',response:out.response,accepted:out.accepted};receipts.set(p.operationId,receipt);return receipt;},async status(id){return receipts.get(id);}};
 const adapters=fixtureAdapters(directory);const path=join(temp,'drafts.sqlite');let studio=new Studio({path,...adapters,delivery});
 try{
 let d=studio.create(context,campaign);const id=d.id;const first=await studio.review(context,id);assert.match(first.html,/cid:asset-/);assert.match(first.html,/style=/);assert.match(first.text,/Explore the collection: https:/);assert.match((await studio.render(context,id)).previewHtml,/data:image\/png;base64,/);
 const forged={...first,mime:Buffer.from('injected').toString('base64')};assert.throws(()=>studio.approve(context,id,forged),/unissued/);
 assert.throws(()=>studio.get({...context,companyId:'other'},id),/forbidden/);
 assert.throws(()=>studio.approve({...context,actorId:'agata-bot'},id,first),/human/);
 const a1=studio.approve(context,id,first);assert.deepEqual(studio.approve(context,id,Object.fromEntries(Object.entries(first).reverse())),a1);assert.equal(studio.list(context).drafts[0].id,id);d=studio.reviseSection(context,id,1,'intro',{id:'intro',type:'text',text:'Hello,\nDiscover your next favourite detail in Agata’s new collection. Beautifully chosen, ready for your everyday.'});
 await assert.rejects(studio.send(context,id,a1.approvalId),/stale/);assert.throws(()=>studio.save(context,id,1,campaign),/409/);
 assert.deepEqual(studio.compare(context,id,1,2).blocks,['intro']);studio.db.close();studio=new Studio({path,...adapters,delivery});assert.match(studio.get(context,id).document.blocks[2].text,/next favourite/);
 assert.throws(()=>studio.approve(context,id,first),/stale/);const review=await studio.review(context,id),approval=studio.approve(context,id,review);assert.deepEqual(studio.approve(context,id,review),approval);const receipt=await studio.send(context,id,approval.approvalId);assert.deepEqual(await studio.send(context,id,approval.approvalId),receipt);assert.equal(messages.length,1);assert.match(messages[0],/multipart\/alternative/);assert.match(messages[0],/Content-ID:/);assert.match(messages[0],/image\/png/);
 const malicious=structuredClone(campaign);malicious.blocks[1].text='<script>alert(1)</script>';const m=studio.create(context,malicious);assert.doesNotMatch((await studio.render(context,m.id)).html,/<script/i);malicious.blocks[3].href='javascript:alert(1)';assert.throws(()=>validate(malicious),/https/);
 const badAssets=new Studio({path:join(temp,'bad.sqlite'),...adapters,assets:()=>({companyId:'other',bytes:Buffer.from('x'),sha256:'x'}),delivery});const bad=badAssets.create(context,campaign);await assert.rejects(badAssets.render(context,bad.id),/tenant/);badAssets.db.close();
 writeFileSync(temp+'/acceptance-result.json',JSON.stringify({status:'passed',schema:'starli.email/1',revision:2,checks:['section-only revision','SQLite close/reload','CAS conflict','stale approval denied','forged MIME denied','bot approval denied','cross-company denied','tenant asset denied','script escaped','unsafe link denied','inline CSS','plain-text alternative','CID image MIME','SMTP one delivery','stable retry receipt'],receipt,receivedMessages:messages.length},null,2));
 writeFileSync(temp+'/agata-campaign.html',(await studio.render(context,id)).previewHtml);writeFileSync(temp+'/agata-campaign.eml',Buffer.from(review.mime,'base64'));writeFileSync(temp+'/smtp-received.eml',messages[0]);
 adapters.revoke();assert.throws(()=>studio.approve(context,id,review),/forbidden/);assert.throws(()=>studio.list(context),/forbidden/);assert.throws(()=>studio.get(context,id),/forbidden/);
 }finally{studio.db.close();transport.close();await new Promise(r=>server.close(r));}
});
