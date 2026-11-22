import {Store,now,type RecordData} from './store.js';
import {hashToken} from './security.js';
import {sourceHash} from './billing.js';
import {sourceDraftEvidence} from './source-evidence.js';
import {parseOperatorBusinessDetails,publicOperatorBrief} from './operator-project-context.js';
import {buildWelcomeMessageText,type LeadRecord,type ProposalRecord} from './leads-proposals.js';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const html=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\{/g,'&#123;').replace(/\}/g,'&#125;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const json=(value:string)=>JSON.stringify(value).slice(1,-1);
const identityKeys=new Set(['id','ownerId','actorId','userId','projectId','leadId','proposalId','publicSlug','welcomeConversationId','claimedByUserId','sourceHash','claimCodeHash','claimOtpHash','claimCodePrefix','claimExpiresAt','claimRevokedAt','createdAt','updatedAt']);

/**
 * Repair confirmed legacy CLI leaks only. Original artifacts remain in an operator-only
 * collection; client edits are preserved by replacing known leaked strings, not entire files.
 * No external request, message dispatch, payment or publication is performed here.
 */
export function repairOperatorPrivacy(store:Store):{projects:number;leads:number;proposals:number;conversations:number;messages:number;snapshots:number}{
 const counts={projects:0,leads:0,proposals:0,conversations:0,messages:0,snapshots:0};
 const histories=store.list('operator-conversations');
 const privateMessages=histories.flatMap(conversation=>(Array.isArray(conversation.messages)?conversation.messages:[]).filter((message:any)=>message.role==='user').map((message:any)=>({text:String(message.content||'').trim(),ownerId:conversation.ownerId})));
 const nested=store.db.isTransaction,savepoint='operator_privacy_repair';
 store.db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
 try{
  for(const originalProposal of store.list('proposals')){
   const originalProject=store.get('projects',originalProposal.projectId),originalLead=store.get('leads',originalProposal.leadId);
   if(!originalProject||!originalLead)continue;
   const raw=String(originalProject.brief||'').trim();
   if(!raw)continue;
   const matching=privateMessages.find(message=>message.text===raw);
   const labelled=/(?:^|[\r\n;]|\s)Nume(?:le)?(?:\s+afacerii)?\s*:/i.test(raw)&&/(?:\bcli\b|\boperator\b|raporteaz[ăa]|nu\s+(?:publica|[îi]ncasa|trimite)|opre[șs]te-te)/i.test(raw);
   if(!matching&&!labelled)continue;
   const details=parseOperatorBusinessDetails(raw,{businessName:originalLead.businessName,locality:originalLead.locality});
   const name=details.businessName||'Website pentru afacerea ta';
   const industry=details.industry||originalLead.industry||'Afacere locală';
   const locality=details.locality||originalLead.locality||'';
   const brief=publicOperatorBrief({businessName:name,industry,locality});
   const privateOwner=[matching?.ownerId,originalProposal.ownerId,...store.users().filter(user=>user.role==='ADMIN').map(user=>user.id)].find(userId=>userId&&store.user(userId)?.role==='ADMIN');
   if(!privateOwner)throw new Error('Repararea confidențialității necesită un proprietar administrator pentru arhiva privată.');
   const originals={project:originalProject,lead:originalLead,proposal:originalProposal,conversations:store.list('conversations').filter(item=>item.projectId===originalProject.id||item.id===originalProposal.welcomeConversationId),snapshots:store.list('source-snapshots').filter(item=>item.projectId===originalProject.id),messages:store.list('outbound-messages').filter(item=>item.proposalId===originalProposal.id)};
   const archiveId='privacy-repair:'+originalProject.id+':'+hashToken(raw).slice(0,20);
   if(!store.get('operator-project-context',archiveId))store.put('operator-project-context',{id:archiveId,ownerId:privateOwner,projectId:originalProject.id,proposalId:originalProposal.id,kind:'legacy-privacy-repair',instructions:raw,originals,createdAt:now()},privateOwner);

   const replacements:[string,string][]=[[raw,brief]];
   for(const oldName of [originalLead.businessName,originalProposal.businessName])if(typeof oldName==='string'&&oldName!==name)replacements.push([oldName,name]);
   if(details.locality&&originalLead.locality&&details.locality!==originalLead.locality&&(/[\r\n]|\b(?:nume|stil|domeniu)\s*:/i.test(originalLead.locality)||originalLead.locality.length>100))replacements.push([originalLead.locality,locality]);
   const pairs=replacements.filter(([from,to])=>from&&from!==to).flatMap(([from,to])=>[[html(from),html(to)],[json(from),json(to)],[from,to]] as [string,string][]).sort((a,b)=>b[0].length-a[0].length);
   const cleanString=(value:string)=>{for(const [from,to]of pairs)if(value.includes(from))value=value.split(from).join(to);return value;};
   const clean=(value:any,key=''):any=>{
    if(identityKeys.has(key))return value;
    if(typeof value==='string')return cleanString(value);
    if(Array.isArray(value))return value.map(item=>clean(item));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,clean(item,name)]));
    return value;
   };
   const lead:RecordData={...clean(originalLead),businessName:name,industry,locality,updatedAt:now()};
   lead.confirmedFacts=(Array.isArray(lead.confirmedFacts)?lead.confirmedFacts:[]).map((fact:any)=>({...fact,value:fact.field==='businessName'?name:fact.field==='industry'?industry:fact.field==='locality'?locality:fact.value}));
   const proposal:RecordData={...clean(originalProposal),businessName:name,industry,locality,confirmedFacts:lead.confirmedFacts,updatedAt:now()};
   if(originalProposal.specJson){try{const spec=clean(JSON.parse(originalProposal.specJson));spec.business={...spec.business,name,city:locality,subcategory:industry};if(spec.branding)spec.branding.logoText=name;proposal.specJson=JSON.stringify(spec);}catch{throw new Error('Specificația propunerii afectate nu poate fi reparată în siguranță.');}}
   const project:RecordData={...clean(originalProject),brief,updatedAt:now()};
   if(originalProject.name===originalLead.businessName||originalProject.name===originalProposal.businessName||originalProject.name===raw)project.name=name;
   for(const field of ['operatorInternalNotes','operatorPrompt','operatorContext','internalNotes'])delete project[field];
   if(project.knowledge){project.knowledge={...project.knowledge};if(typeof originalProject.knowledge?.customInstructions==='string'&&originalProject.knowledge.customInstructions.includes(raw))project.knowledge.customInstructions='';}
   const filesChanged=!same(project.files,originalProject.files);
   if(Array.isArray(project.versions))project.versions=project.versions.map((version:any,index:number)=>!same(version.files,originalProject.versions?.[index]?.files)&&Array.isArray(version.files)?{...version,sourceHash:sourceHash(version.files)}:version);
   if(filesChanged)Object.assign(project,sourceDraftEvidence());
   store.put('leads',lead,lead.ownerId);counts.leads++;
   store.put('proposals',proposal,proposal.ownerId);counts.proposals++;
   store.put('projects',project,project.ownerId);counts.projects++;
   for(const conversation of originals.conversations){
    const updated=clean(conversation);
    if(conversation.id===originalProposal.welcomeConversationId&&Array.isArray(updated.messages)){
     updated.title=`Întâmpinare propunere · ${name}`;
     updated.messages=updated.messages.map((message:any,index:number)=>index===0&&message.role==='assistant'&&(String(message.id||'').startsWith('welcome-')||conversation.proposalId===originalProposal.id)?{...message,content:buildWelcomeMessageText(lead as LeadRecord,proposal as ProposalRecord)}:message);
    }
    if(!same(updated,conversation)){updated.updatedAt=now();store.put('conversations',updated,conversation.ownerId);counts.conversations++;}
   }
   for(const message of originals.messages){
    if(!['PREGATIT','APROBAT','ESUAT'].includes(message.status))continue;
    const updated=clean(message);
    if(!same(updated,message)){updated.updatedAt=now();store.put('outbound-messages',updated,message.ownerId);counts.messages++;}
   }
   for(const snapshot of originals.snapshots){
    const updated=clean(snapshot);
    if(!same(updated,snapshot)){if(Array.isArray(updated.files))updated.sourceHash=sourceHash(updated.files);store.put('source-snapshots',updated,snapshot.ownerId);counts.snapshots++;}
   }
  }
  store.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');return counts;
 }catch(error){
  if(nested){store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}else if(store.db.isTransaction)store.db.exec('ROLLBACK');
  throw error;
 }
}
