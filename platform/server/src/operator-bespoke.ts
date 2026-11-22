import {Store,id,now,type RecordData} from './store.js';
import type {Events} from './events.js';
import {fail,type Context} from './security.js';
import {requireOperator,redactSecrets,recordOperatorAudit} from './operator-auth.js';
import {settings} from './ai.js';
import {buildNextSite} from './site-builder.js';
import {nextWorkerEnabled,verifyNextProject} from './next-worker.js';
import {validateNextProjectFiles,type SourceFile} from './next-template.js';
import {renderNextPreviewHtml} from './preview-renderer.js';
import {sourceHash} from './billing.js';
import {SerialQueue} from './queue.js';

const running=new Set<string>();
export function recoverInterruptedBespokeBuilds(store:Store):number{
 let recovered=0;for(const project of store.list('projects'))if(project.operatorBespokeStatus==='BUILDING'){
  const message='Construcția AI a fost întreruptă de repornirea serverului și poate fi reluată.';
  store.put('projects',{...project,status:'BUILD_FAILED',buildState:'FAILED',buildStep:null,buildError:message,operatorBespokeStatus:'INTERRUPTED',updatedAt:now()},project.ownerId);
  const proposal=store.list('proposals').find(p=>p.projectId===project.id);if(proposal)store.put('proposals',{...proposal,status:'ESEC',buildVerified:false,lastError:message,updatedAt:now()},proposal.ownerId);recovered++;
 }return recovered;
}
const workerQueue=new SerialQueue();
type Dependencies={build:typeof buildNextSite;verify:typeof verifyNextProject;workerEnabled:()=>boolean;signal?:AbortSignal};
const clean=(value:unknown,max=250)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

/** Raw operator conversation is private. Only these explicitly selected public facts reach the website builder. */
export function bespokeCreativeBrief(lead:RecordData,spec:RecordData,privateBrief=''):string{
 const safeStyleWords=[...new Set((privateBrief.match(/(?:^|\n)\s*(?:stil|palet[ăa]|direc[țt]ie vizual[ăa])\s*:\s*([^\n]{1,180})/i)?.[1]||'')
  .toLowerCase().match(/\b(?:editorial|minimalist|minimal|modern|elegant|premium|cald|crem|verde|albastru|negru|alb|auriu|ro[șs]u|luminos|industrial|natural|cinematic)\b/g)||[])];
 const facts={name:clean(lead.businessName,160),industry:clean(lead.industry,120),locality:clean(lead.locality,100),phone:/^\+?[0-9]{8,15}$/.test(String(lead.normalizedPhone||''))?lead.normalizedPhone:null,email:/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(lead.email||''))?lead.email:null,style:safeStyleWords.length?safeStyleWords.join(', '):clean(spec.branding?.visualMood,60)};
 return `Construiește un website ORIGINAL, personalizat pentru această afacere, în React, Next.js și TypeScript. Nu copia un șablon existent. Alege o direcție vizuală adecvată sectorului, tipografie expresivă, compoziție premium și o experiență mobilă impecabilă.\nDate publice confirmate: ${JSON.stringify(facts)}\nLivrează OBLIGATORIU patru pagini distincte: app/page.tsx, app/servicii/page.tsx, app/despre/page.tsx, app/contact/page.tsx; include cele trei pagini secundare în extraFiles. Navigația trebuie să funcționeze între ele. Include și components/Navbar.tsx și components/Footer.tsx în extraFiles dacă folosești aceste componente. Folosește SEO semantic: un H1 pe pagină, titluri și descrieri specifice, texte românești cu diacritice și imagini cu alt relevant. Folosește materialele vizuale generate dacă sunt disponibile. WhatsApp și telefon numai cu numărul confirmat. Fără contacte, adrese, prețuri, meniu de produse, recenzii, premii, personal, certificări sau promisiuni comerciale inventate. Dacă informațiile lipsesc, arată o prezentare inițială și contactul disponibil; nu pretinde funcționalități de rezervare sau plată neconectate. Instrucțiunile tehnice și administrative nu apar în textele website-ului.`;
}

/** Performs the real AI build; never silently substitutes a deterministic template. */
export async function buildBespokeOperatorProposal(store:Store,events:Events|undefined,ctx:Context,proposalId:string,privateBrief?:string,overrides:Partial<Dependencies>={}):Promise<{project:RecordData;proposal:RecordData;alreadyGenerated:boolean}>{
 const {user}=requireOperator(ctx,'PROPOSALS');
 const proposal=store.get('proposals',proposalId);if(!proposal)fail('Propunerea nu a fost găsită.','NOT_FOUND');
 const lead=store.get('leads',proposal.leadId),original=store.get('projects',proposal.projectId);
 if(!lead||!original)fail('Datele proiectului nu sunt complete.','NOT_FOUND');
 if(original.operatorBespokeStatus==='SUCCEEDED'&&original.operatorBespokeGenerated===true)return{project:original,proposal,alreadyGenerated:true};
 if(running.has(proposalId))fail('Construcția AI pentru această propunere este deja în curs.','CONFLICT');
 if(proposal.claimedByUserId)fail('Proiectul revendicat se modifică din contul proprietarului.','FORBIDDEN');
 const deps:Dependencies={build:buildNextSite,verify:verifyNextProject,workerEnabled:nextWorkerEnabled,...overrides};
 const privateContext=store.get('operator-project-context',proposalId);
 const operatorPrompt=privateBrief||privateContext?.privateInstructions||'';
 let spec:RecordData={id:proposalId};try{spec=JSON.parse(proposal.specJson||'{}');}catch{}
 const brief=bespokeCreativeBrief(lead,spec,operatorPrompt);
 const timestamp=now();
 let closed=false;
 const boundedWork=async<T>(work:Promise<T>):Promise<T>=>new Promise<T>((resolve,reject)=>{
  const stop=()=>{cleanup();reject(new Error('Construcția AI a fost oprită de operator.'));};
  const timer=setTimeout(()=>{cleanup();reject(new Error('Furnizorul AI nu a finalizat construcția în 15 minute. Lucrarea nu este declarată reușită.'));},900000);
  const cleanup=()=>{clearTimeout(timer);deps.signal?.removeEventListener('abort',stop);};
  if(deps.signal?.aborted){stop();return;}deps.signal?.addEventListener('abort',stop,{once:true});work.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
 const saveProject=(patch:Record<string,unknown>)=>{const current=store.get('projects',original.id)||original;const saved={...current,...patch,updatedAt:now()};store.put('projects',saved,current.ownerId);events?.publish('projects');return saved;};
 running.add(proposalId);
 try{
  saveProject({status:'BUILDING',buildState:'BUILDING',buildStep:'Starli AI construiește un website personalizat în React și Next.js…',buildError:null,operatorBespokeStatus:'BUILDING',operatorBespokeStartedAt:timestamp,operatorBespokeGenerated:false});
  store.put('proposals',{...proposal,status:'CONSTRUIRE',buildVerified:false,lastError:null,updatedAt:timestamp},proposal.ownerId);events?.publish('proposals');
  const cfg=settings(store);
  const output=await boundedWork(deps.build(brief,clean(lead.businessName,160),{
   provider:cfg.aiProvider,fallbackToOpenAI:cfg.aiFallbackEnabled,
   requiredPages:['app/page.tsx','app/servicii/page.tsx','app/despre/page.tsx','app/contact/page.tsx'],signal:deps.signal,
   assets:store.get('operator-build-assets',original.id)?.files,
   onAssets:files=>{if(files.length)store.put('operator-build-assets',{id:original.id,files,createdAt:now()},user.id);},
   // Do not present the shared builder's generic competitor fallback as real market research.
   existingResearch:{summary:`Direcție creativă pentru ${clean(lead.businessName,160)}. Structura și designul sunt generate pentru această afacere. Nu a fost efectuată o analiză verificată a competitorilor în această etapă.`,sources:[]},
   onStep:step=>{if(!closed&&!deps.signal?.aborted)saveProject({buildStep:clean(step,300)});}
  }));
  validateNextProjectFiles(output.files);
  for(const path of ['app/page.tsx','app/servicii/page.tsx','app/despre/page.tsx','app/contact/page.tsx'])if(!output.files.some(f=>f.path===path))throw new Error('AI-ul nu a livrat toate cele patru pagini cerute. Propunerea personalizată nu este finalizată.');
  let previewHtml=renderNextPreviewHtml(output.files,{title:lead.businessName,path:'/'}),validationProvider='AST_VERIFIED',validationStatus='PASSED',buildLog:string|null=null;
  for(const path of ['/servicii','/despre','/contact'])renderNextPreviewHtml(output.files,{title:lead.businessName,path});
  if(deps.workerEnabled()){
   saveProject({status:'VERIFYING',buildState:'VERIFYING',buildStep:'Verific build-ul Next.js în workerul izolat…'});
   const verified=await boundedWork(workerQueue.run(()=>deps.verify(output.files)));previewHtml=verified.previewHtml;validationProvider=verified.validationProvider;validationStatus=verified.validationStatus;buildLog=verified.buildLog;
  }
  const current=store.get('projects',original.id)||original;
  const version={id:id(),projectId:current.id,source:'operator-ai',summary:'Website personalizat generat de Starli AI',createdBy:'Starli AI',agentRunId:null,bookmarked:true,sourceHash:sourceHash(output.files),files:output.files,previewHtml,createdAt:now()};
  const publicBrief=`Website de prezentare pentru ${clean(lead.businessName,160)}${lead.industry?' — '+clean(lead.industry,120):''}${lead.locality?', '+clean(lead.locality,100):''}. Pagini dedicate pentru prezentare, servicii, despre afacere și contact.`;
  const project=saveProject({name:clean(lead.businessName,160),brief:publicBrief,files:output.files,previewHtml,html:null,status:'PREVIEW',buildState:'READY',buildStep:null,buildError:null,validationProvider,validationStatus,buildLog,research:output.research||null,sources:output.sources||[],versions:[...(Array.isArray(current.versions)?current.versions:[]),version],operatorBespokeStatus:'SUCCEEDED',operatorBespokeGenerated:true,operatorBespokeCompletedAt:now()});
  const updatedProposal={...(store.get('proposals',proposalId)||proposal),generationMode:'bespoke',status:'PREGATIT',buildVerified:validationProvider==='DOCKER',lastError:null,updatedAt:now()};store.put('proposals',updatedProposal,proposal.ownerId);events?.publish('proposals');
  recordOperatorAudit(store,user.id,'operator.proposal.ai_built',proposalId,{projectId:project.id,sourceHash:version.sourceHash,validationProvider});
  store.remove('operator-build-assets',original.id);
  return{project,proposal:updatedProposal,alreadyGenerated:false};
 }catch(error){
  const detail=redactSecrets(error instanceof Error?error.message:'Generarea personalizată a eșuat.').slice(0,12000);
  const safeError='Construcția personalizată AI nu a fost finalizată. Proiectul păstrează ultima versiune disponibilă; operatorul poate verifica eroarea și reîncerca.';
  saveProject({status:'BUILD_FAILED',buildState:'FAILED',buildStep:null,buildError:safeError,operatorBespokeStatus:'FAILED',operatorBespokeGenerated:false});
  store.put('proposals',{...(store.get('proposals',proposalId)||proposal),status:'ESEC',buildVerified:false,lastError:safeError,updatedAt:now()},proposal.ownerId);events?.publish('proposals');
  store.put('operator-project-context',{...(store.get('operator-project-context',proposalId)||{id:proposalId,projectId:original.id,proposalId,ownerId:proposal.ownerId}),lastBuildError:detail,lastBuildFailedAt:now()},proposal.ownerId);
  throw new Error(detail);
 }finally{closed=true;running.delete(proposalId);}
}
