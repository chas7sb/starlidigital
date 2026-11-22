import {parentPort,workerData} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {bindControlledMail} from './controlled-mail.mjs';
import {nativeDraft} from './native-draft.mjs';
import {Studio} from './studio.mjs';
import {campaign} from './fixture.mjs';
const {config,method,params}=workerData;let studio,binding;
try{
 const domain=(ctx,action,extra={})=>{const r=spawnSync(config.python,[fileURLToPath(new URL('./product-domain.py',import.meta.url)),config.authorityDir,config.driveDir,config.authorityDb,config.blobs],{input:JSON.stringify({...ctx,action,...extra}),encoding:'utf8',timeout:3000,maxBuffer:1024*1024});if(r.error||r.status!==0)throw Error('UNAVAILABLE');const v=JSON.parse(r.stdout);if(!v.ok)throw Error('FORBIDDEN');return v.result;};
 const ctx={actorId:params.actorId,companyId:params.companyId};
 studio=new Studio({path:config.draftDb,authorize:(actorId,companyId,permission)=>domain({actorId,companyId},'scope',{permission}),assets:(ctx,id)=>{const a=domain(ctx,'asset',{id});return {...a,bytes:Buffer.from(a.bytes,'base64')};},identity:(ctx,id)=>domain(ctx,'identity',{id}),delivery:{deliver(){throw Error('SEND_DISABLED');}}});studio.db.exec('PRAGMA busy_timeout=250');
 const current=()=>{const d=studio.get(ctx,params.resourceId);if(d.head!==params.expectedRevision)throw Error('409 stale revision');return d;};let result;
 if(method==='email.controlled-send'||method==='email.controlled-state'){
  if(config.controlledSmtp!==true||!config.controlledMailFile)throw Error('INVALID_REQUEST');
  binding=bindControlledMail(studio,config.controlledMailFile);
  if(method==='email.controlled-send'){current();result=await binding.send(ctx,params.resourceId,params.approvalId,params.expectedRevision);}
  else result=binding.state(ctx,params.resourceId);
 }else if(method==='email.tool-draft')result=nativeDraft(studio,ctx,params.resourceId,params);
 else if(method==='email.list')result=studio.list(ctx);
 else if(method==='email.read')result=studio.get(ctx,params.resourceId);
 else if(method==='email.edit')result=studio.save(ctx,params.resourceId,params.expectedRevision,params.document);
 else if(method==='email.generate'){
  const fixture=JSON.parse(readFileSync(config.fixture,'utf8'));studio.scope(ctx,'bots.run');if(fixture.companyId!==ctx.companyId||fixture.actorId!==ctx.actorId)throw Error('FORBIDDEN');
  const d=structuredClone(campaign);d.identityId=fixture.identityId;d.blocks[0].assetId=fixture.assetId;result=studio.create(ctx,d);result.generator='explicit-synthetic-tool';
 }else if(method==='email.preview'){current();const r=await studio.render(ctx,params.resourceId);current();result={id:params.resourceId,companyId:ctx.companyId,revision:r.revision,previewHtml:r.previewHtml,html:r.html,text:r.text};}
 else if(method==='email.review'){current();result=await studio.review(ctx,params.resourceId);current();studio.assertCurrent(ctx,params.resourceId,result);}
 else if(method==='email.approve'){current();result=studio.approve(ctx,params.resourceId,params.review);}
 else throw Error('INVALID_REQUEST');
 studio.scope(ctx,'read');parentPort.postMessage({ok:true,result});
}catch(e){const conflict=/409|stale/.test(e.message),denied=/FORBIDDEN|forbidden|approval|unissued|human|not found/.test(e.message);parentPort.postMessage({ok:false,status:conflict?409:denied?403:/UNAVAILABLE/.test(e.message)?503:400,error:{code:conflict?'REVISION_CONFLICT':denied?'FORBIDDEN':'UNAVAILABLE',message:conflict?'Email changed. Reload before continuing.':denied?'Email operation denied.':'Email service unavailable.'}});}finally{binding?.close();studio?.db.close();}
