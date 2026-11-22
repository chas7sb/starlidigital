import {createHash} from 'node:crypto';
import type {CreateOrchestrationPlanInput,OrchestrationPlan,OrchestrationWorkPackage,OrchestrationWorkPackageSpec,OutcomeClassification,StarliIntentKind} from './domain.js';

const ID=/^[A-Za-z0-9_.:@-]{1,180}$/;
const KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
export const MAX_GOAL_BYTES=4096,MAX_PACKAGES=64,MAX_DEPENDENCIES=32,MAX_REQUIREMENTS=32;
export const stable=(x:unknown):string=>Array.isArray(x)?`[${x.map(stable).join(',')}]`:x&&typeof x==='object'?`{${Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`:JSON.stringify(x);
export const digest=(x:unknown)=>createHash('sha256').update(stable(x)).digest('hex');
export const safeId=(value:string,label='identifier')=>{const v=String(value||'').trim();if(!ID.test(v))throw new Error(`Invalid ${label}.`);return v};
export const safeKey=(value:string)=>{if(!KEY.test(value))throw new Error('Invalid orchestration idempotency key.');return value};
export const boundedText=(value:unknown,max=240)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

export function classifyGoal(goal:string):OutcomeClassification{
 const text=goal.toLowerCase(),signals:StarliIntentKind[]=[];
 const add=(kind:StarliIntentKind,re:RegExp)=>{if(re.test(text)&&!signals.includes(kind))signals.push(kind)};
 add('BUILD',/\b(build|create|launch|make|develop|website|app|backend|agent|store)\b/);
 add('OPERATE',/\b(run|operate|manage|monitor|follow up|workflow|routine)\b/);
 add('GROW',/\b(grow|customers|leads|sales|conversion|campaign|market)\b/);
 add('FIX',/\b(fix|repair|broken|error|bug|diagnose|recover)\b/);
 add('CREATE_MEDIA',/\b(video|reel|short|creative|image|content)\b/);
 add('CONNECT',/\b(connect|integrate|crm|calendar|mail|shopify|stripe|github)\b/);
 add('ANALYZE',/\b(analy[sz]e|report|insight|performance|metrics|why)\b/);
 if(!signals.length)signals.push('MIXED');
 return{primary:signals.length===1?signals[0]:'MIXED',signals};
}

const normalizeSpec=(raw:OrchestrationWorkPackageSpec):OrchestrationWorkPackageSpec=>{
 const id=safeId(raw.id,'work package id'),title=boundedText(raw.title,160);if(!title)throw new Error('Work package title is required.');
 if(raw.requiredCapabilities.length>MAX_REQUIREMENTS||raw.requiredArtifacts.length>MAX_REQUIREMENTS||raw.requiredInputs.length>MAX_REQUIREMENTS)throw new Error('Work package requirement limit exceeded.');
 if(!['PLANNING_ONLY','EXECUTABLE'].includes(raw.executionMode))throw new Error('Invalid orchestration execution mode.');
 if(!['NONE','REVIEW','EXPLICIT_APPROVAL'].includes(raw.requiredApproval.kind))throw new Error('Invalid orchestration approval requirement.');
 const dependencyPackageIds=[...new Set(raw.dependencyPackageIds.map(x=>safeId(x,'dependency package id')))];if(dependencyPackageIds.length>MAX_DEPENDENCIES)throw new Error('Too many work package dependencies.');
 const projectId=raw.projectId?safeId(raw.projectId,'project id'):null;
 const requiredCapabilities=raw.requiredCapabilities.slice(0,MAX_REQUIREMENTS).map(c=>{if(!['AVAILABLE','MISSING','UNKNOWN'].includes(c.availability)||!['CONNECTED','MISSING','UNKNOWN','NOT_REQUIRED'].includes(c.connection))throw new Error('Invalid capability requirement state.');return{capabilityId:safeId(c.capabilityId,'capability id'),projectScoped:!!c.projectScoped,availability:c.availability,connection:c.connection}});
 const requiredArtifacts=raw.requiredArtifacts.slice(0,MAX_REQUIREMENTS).map(a=>{const artifactProjectId=a.projectId?safeId(a.projectId,'artifact project id'):null;if(projectId&&artifactProjectId&&artifactProjectId!==projectId)throw new Error('Required artifact project scope conflicts with work package project.');return{kind:boundedText(a.kind,80),artifactId:a.artifactId?safeId(a.artifactId,'artifact id'):null,projectId:artifactProjectId}});
 const requiredInputs=raw.requiredInputs.slice(0,MAX_REQUIREMENTS).map(q=>({id:safeId(q.id,'input requirement id'),question:boundedText(q.question,500)}));
 if(raw.executionMode==='EXECUTABLE'&&!raw.agencyActionPlanId)throw new Error('Executable work requires an AgencyActionPlan reference.');
 return{id,target:raw.target,title,executionMode:raw.executionMode,dependencyPackageIds,requiredCapabilities,requiredArtifacts,requiredInputs,requiredApproval:{kind:raw.requiredApproval.kind,approvalId:raw.requiredApproval.approvalId?safeId(raw.requiredApproval.approvalId,'approval id'):null},agencyActionPlanId:raw.agencyActionPlanId?safeId(raw.agencyActionPlanId,'agency action plan id'):null,projectId,sourceRef:raw.sourceRef?{kind:boundedText(raw.sourceRef.kind,80),id:safeId(raw.sourceRef.id,'source reference id')}:null};
};
export function validatePlanInput(input:CreateOrchestrationPlanInput){
 if(typeof input.goal!=='string'||Buffer.byteLength(input.goal,'utf8')>MAX_GOAL_BYTES)throw new Error('User goal is empty or too large.');const goal=boundedText(input.goal,4096);if(!goal)throw new Error('User goal is empty or too large.');safeKey(input.idempotencyKey);
 if(!Array.isArray(input.workPackages)||input.workPackages.length>MAX_PACKAGES)throw new Error('Too many orchestration work packages.');
 const projectId=input.projectId?safeId(input.projectId,'project id'):null,workPackages=input.workPackages.map(normalizeSpec),ids=new Set(workPackages.map(x=>x.id));if(ids.size!==workPackages.length)throw new Error('Duplicate orchestration work package id.');
 for(const p of workPackages){const effectiveProjectId=p.projectId||projectId;for(const artifact of p.requiredArtifacts)if(effectiveProjectId&&artifact.projectId&&artifact.projectId!==effectiveProjectId)throw new Error('Required artifact project scope conflicts with orchestration project.')}
 for(const p of workPackages)for(const dep of p.dependencyPackageIds){if(dep===p.id)throw new Error('Work package cannot depend on itself.');if(!ids.has(dep))throw new Error(`Unknown work package dependency: ${dep}.`)}
 const visiting=new Set<string>(),done=new Set<string>(),byId=new Map(workPackages.map(x=>[x.id,x]));
 const visit=(id:string)=>{if(done.has(id))return;if(visiting.has(id))throw new Error('Orchestration dependency cycle detected.');visiting.add(id);for(const d of byId.get(id)!.dependencyPackageIds)visit(d);visiting.delete(id);done.add(id)};for(const id of ids)visit(id);
 return{...input,goal,projectId,businessEngineId:input.businessEngineId?safeId(input.businessEngineId,'business engine id'):null,engineVersionId:input.engineVersionId?safeId(input.engineVersionId,'engine version id'):null,workPackages};
}
export const packageSpecHash=(p:OrchestrationWorkPackageSpec)=>digest({...p});
export const immutablePackageSpec=(p:OrchestrationWorkPackage):OrchestrationWorkPackageSpec=>{const base:OrchestrationWorkPackageSpec={id:p.id,target:p.target,title:p.title,executionMode:p.executionMode,dependencyPackageIds:p.dependencyPackageIds,requiredCapabilities:p.requiredCapabilities,requiredArtifacts:p.requiredArtifacts,requiredInputs:p.requiredInputs,requiredApproval:p.requiredApproval,agencyActionPlanId:p.agencyActionPlanId,projectId:p.projectId,sourceRef:p.sourceRef};return p.agencyActionPlanHash===undefined?base:{...base,agencyActionPlanHash:p.agencyActionPlanHash}};
export const planDefinitionHash=(plan:Pick<OrchestrationPlan,'goal'|'classification'|'businessEngineDecision'|'projectDecision'|'businessMaterializationRef'|'workPackages'>)=>digest({goal:{id:plan.goal.id,tenantId:plan.goal.tenantId,ownerId:plan.goal.ownerId,text:plan.goal.text,projectId:plan.goal.projectId,businessEngineId:plan.goal.businessEngineId,createdAt:plan.goal.createdAt},classification:plan.classification,businessEngineDecision:plan.businessEngineDecision,projectDecision:plan.projectDecision,businessMaterializationRef:plan.businessMaterializationRef,workPackages:plan.workPackages.map(immutablePackageSpec)});
export const planStateHash=(plan:Pick<OrchestrationPlan,'status'|'revision'|'updatedAt'|'stoppedAt'|'stopReason'|'workPackages'>)=>digest({status:plan.status,revision:plan.revision,updatedAt:plan.updatedAt,stoppedAt:plan.stoppedAt,stopReason:plan.stopReason,workPackages:plan.workPackages.map(p=>({id:p.id,status:p.status,blockCodes:p.blockCodes,satisfiedInputIds:p.satisfiedInputIds,receiptIds:p.receiptIds,lastExecutionReceiptId:p.lastExecutionReceiptId,executionRequestId:p.executionRequestId??null,executionAttempt:p.executionAttempt??null,retryClass:p.retryClass,updatedAt:p.updatedAt}))});
export function assertPlanIntegrity(plan:OrchestrationPlan){for(const p of plan.workPackages)if(packageSpecHash(immutablePackageSpec(p))!==p.specHash)throw new Error(`Orchestration work package tampered: ${p.id}.`);if(planDefinitionHash(plan)!==plan.planHash)throw new Error('Orchestration plan tampered.');if(plan.stateHash!==undefined&&planStateHash(plan)!==plan.stateHash)throw new Error('Orchestration lifecycle state tampered.');}
