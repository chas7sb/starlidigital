import type {OperatorToolCallResult} from './operator-tools.js';
import {authorizeOperatorContact} from './operator-contact-intent.js';

type Requirement={id:string;title:string;confirmedBy:number[]};
type Effect={key:string;kind:'job'|'email'|'sms'|'project';id:string;status:string;confirmed:boolean;sequence:number};
const normalized=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Tool-backed acceptance ledger. Model prose cannot mark requirements or queued effects complete. */
export function createOperatorObjective(prompt:string){
 const text=normalized(prompt),requirements:Requirement[]=[],effects=new Map<string,Effect>(),smsJobs=new Map<string,string>(),invitationCodes=new Map<string,string>();
 const clauses=text.split(/[.!?;\n]/).filter(clause=>!/(?:\bnu\s+(?:mai\s+)?|\bfara\s+|\bdo not\s+|\bdon't\s+)(?:crea\w*|construi\w*|execut\w*|rula\w*|trimit\w*|build|create|run|send)/.test(clause));
 const executionRequested=clauses.some(clause=>/\b(?:executa|ruleaza|finalizeaza|termina|run|build|complete|start|trimite|send)\b/.test(clause));
 const build=clauses.some(clause=>/\b(?:creeaza|creaza|construieste|construi|build|create|finalizeaza|genereaza)\b/.test(clause)&&/\b(?:website|site|propunere|website-ul|site-ul)\b/.test(clause));
 const bespoke=build&&/optiunea\s*1|\bbespoke\b|generare ai reala/.test(text);
 const add=(id:string,title:string)=>requirements.push({id,title,confirmedBy:[]});
 if(build)add('website',bespoke?'Website personalizat generat de AI și verificat':'Website creat, cu proiect și propunere verificabile');
 if(build&&/\bverifica\w*\b/.test(text))add('website-review','Proiectul rezultat inspectat după construire');
 if(/\b(?:pregateste|prepare)\b/.test(text)&&/\bsms\b/.test(text))add('sms-prepared','Invitație SMS pregătită cu mesaj identificabil');
 for(const channel of ['SMS','EMAIL'] as const)if((channel==='SMS'?/\bsms\b/:/\be-?mail\b/).test(text)){try{authorizeOperatorContact(prompt,channel,true);add(channel.toLowerCase(),channel==='SMS'?'SMS expediat prin canalul real':'Email acceptat de furnizor');}catch{}}
 if(/\b(?:cauta|cerceteaza|research|search)\b/.test(text)&&/\b(?:lead\w*|afaceri|business\w*|piata|competit\w*)\b/.test(text))add('research','Cercetare cu surse verificabile');
 const confirm=(id:string,sequence:number)=>{const item=requirements.find(r=>r.id===id);if(item&&!item.confirmedBy.includes(sequence))item.confirmedBy.push(sequence);};
 function effect(kind:Effect['kind'],id:unknown,status:unknown,confirmed:boolean,sequence:number){if(typeof id!=='string'||!id)return;const key=kind+':'+id;effects.set(key,{key,kind,id,status:String(status||'NECONFIRMAT'),confirmed,sequence});}
 function observe(tool:string,args:Record<string,unknown>,result:OperatorToolCallResult,sequence:number){
  if(!result.ok)return;const data=result.data||{};const job=data.job as Record<string,unknown>|undefined,email=data.email as Record<string,unknown>|undefined;
  if(tool==='send_proposal_sms'&&!requirements.some(r=>r.id==='sms'))add('sms','SMS expediat prin canalul real');
  if(tool==='send_proposal_email'&&!requirements.some(r=>r.id==='email'))add('email','Email acceptat de furnizor');
  if(job?.id&&(tool==='run_device_tool'||effects.has('job:'+job.id)||executionRequested)){effect('job',job.id,job.status,job.status==='SUCCEEDED',sequence);const smsId=smsJobs.get(String(job.id));if(smsId&&job.status==='SUCCEEDED'){effect('sms',smsId,'EXECUTAT_DISPOZITIV',true,sequence);confirm('sms',sequence);}}
  if(email?.id&&(tool==='send_proposal_email'||requirements.some(r=>r.id==='email')||effects.has('email:'+email.id))){const sent=['ACCEPTED','SENT','DELIVERED'].includes(String(email.status));effect('email',email.id,email.status,sent,sequence);if(sent)confirm('email',sequence);}
  if(tool==='send_proposal_sms'||tool==='inspect_outbound_message'&&(requirements.some(r=>r.id==='sms')||effects.has('sms:'+data.messageId))){const sent=['EXPEDIAT','LIVRAT'].includes(String(data.status))||data.status==='TRIMIS_DISPOZITIV'&&(!data.deviceJobId||data.deviceJobStatus==='SUCCEEDED');effect('sms',data.messageId,data.status,sent,sequence);if(data.deviceJobId){smsJobs.set(String(data.deviceJobId),String(data.messageId));effect('job',data.deviceJobId,data.deviceJobStatus,data.deviceJobStatus==='SUCCEEDED',sequence);}if(sent)confirm('sms',sequence);}
  if(tool==='research_web'&&Array.isArray(data.sources)&&data.sources.length)confirm('research',sequence);
  if(tool==='prepare_proposal_sms'&&data.messageId)confirm('sms-prepared',sequence);
  if(typeof data.claimCode==='string'&&/^\d{5}$/.test(data.claimCode))invitationCodes.set(String(data.proposalId||args.proposalId||data.messageId||'website'),data.claimCode);
  if(['create_lead_proposal','promote_proposal'].includes(tool)){
   const id=data.projectId||data.proposalId;if(id){const ready=!bespoke||data.aiGenerated===true;effect('project',id,ready?'READY':'AI_NEVERIFICAT',ready,sequence);if(ready)confirm('website',sequence);}
  }
  if(['inspect_project','wait_for_project'].includes(tool)){
   const id=String(data.projectId||data.id||args.projectId||''),ready=['PREVIEW','READY','PUBLISHED','DEPLOYED'].includes(String(data.status))&&(!bespoke||data.aiGenerated===true);
   const existing=effects.get('project:'+id);if(existing||(build||executionRequested)&&['BUILDING','VERIFYING'].includes(String(data.status)))effect('project',id,data.status,ready,sequence);
   if(ready&&build){confirm('website',sequence);if(tool==='inspect_project')confirm('website-review',sequence);}
  }
 }
 const snapshot=()=>({objective:prompt,requirements:requirements.map(r=>({...r,confirmedBy:[...r.confirmedBy]})),effects:[...effects.values()].map(e=>({...e})),currentInvitationCodes:[...invitationCodes.values()]});
 const pending=()=>[...requirements.filter(r=>!r.confirmedBy.length).map(r=>r.title),...[...effects.values()].filter(e=>!e.confirmed).map(e=>`${e.kind} ${e.id}: ${e.status}; verifică rezultatul real înainte de finalizare`)];
 const reviewReply=(reply:string)=>{if(!invitationCodes.size)return[];const codes=[...reply.matchAll(/(?<!\d)\d{5}(?!\d)/g)].map(match=>match[0]),valid=new Set(invitationCodes.values());if(/\bcod\w*/.test(normalized(reply))&&codes.some(code=>!valid.has(code)))return['Codul raportat nu corespunde invitației actuale. Folosește currentInvitationCodes din checkpoint.'];return[];};
 // Render requested secrets from owner-scoped tool evidence, never ask the model to invent or recover them.
 const completeReply=(reply:string)=>{if(!invitationCodes.size)return reply;const current=[...new Set(invitationCodes.values())],requested=/\b(?:raporteaza|arata|spune|include)\b/.test(text)&&/\bcod\w*/.test(text);let corrected=reply;
  if(/\bcod\w*/.test(normalized(reply)))corrected=reply.replace(/(?<!\d)\d{5}(?!\d)/g,code=>current.includes(code)?code:current.length===1?current[0]:'[cod înlocuit; vezi codurile actuale]');
  const missing=current.filter(code=>!corrected.includes(code));return missing.length&&(requested||corrected!==reply)?corrected+'\n\n'+(current.length===1?'Codul actual de revendicare: ':'Coduri actuale de revendicare: ')+missing.join(', '):corrected;
 };
 return{observe,snapshot,pending,reviewReply,completeReply};
}
