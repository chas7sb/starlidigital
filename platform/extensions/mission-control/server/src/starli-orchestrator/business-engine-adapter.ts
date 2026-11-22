import type {EngineMaterialization,EngineWorkPackage} from '../business-engine/materializer.js';
import type {CreateOrchestrationPlanInput,OrchestrationWorkPackageSpec} from './domain.js';
import {boundedText,digest} from './policy.js';

const title=(target:string)=>target.toLowerCase().split('_').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ');
export function orchestrationFromBusinessEngine(input:{goal:string;idempotencyKey:string;materialization:EngineMaterialization;packages:EngineWorkPackage[];projectId?:string|null}):CreateOrchestrationPlanInput{
 const map=new Map(input.packages.map(p=>[p.id,`owp:${digest({materializationId:input.materialization.id,sourcePackageId:p.id}).slice(0,28)}`]));
 const workPackages:OrchestrationWorkPackageSpec[]=input.packages.map(p=>({
  id:map.get(p.id)!,target:p.target,title:title(p.target),executionMode:'PLANNING_ONLY',dependencyPackageIds:p.dependencyPackageIds.map(id=>map.get(id)!).filter(Boolean),
  requiredCapabilities:p.capabilityRequirements.map(capabilityId=>({capabilityId,projectScoped:false,availability:p.missingCapabilities.includes(capabilityId)?'MISSING':'AVAILABLE',connection:p.missingCapabilities.includes(capabilityId)?'UNKNOWN':p.missingConnections.includes(capabilityId)?'MISSING':'CONNECTED'})),
  requiredArtifacts:[],requiredInputs:p.customerInputQuestions.map((question,index)=>({id:`input:${digest({packageId:p.id,index,question}).slice(0,24)}`,question:boundedText(question,500)})),
  requiredApproval:{kind:p.approvalClass==='NONE'?'NONE':p.approvalClass==='REVIEW'?'REVIEW':'EXPLICIT_APPROVAL',approvalId:null},agencyActionPlanId:null,projectId:input.projectId||null,sourceRef:{kind:'BUSINESS_ENGINE_WORK_PACKAGE',id:p.id}
 }));
 return{goal:input.goal,idempotencyKey:input.idempotencyKey,projectId:input.projectId||null,businessEngineId:input.materialization.businessEngineId,engineVersionId:input.materialization.engineVersionId,businessMaterializationRef:{businessEngineId:input.materialization.businessEngineId,engineVersionId:input.materialization.engineVersionId,materializationId:input.materialization.id},businessEngineDecision:{mode:'REFERENCE_EXISTING',businessEngineId:input.materialization.businessEngineId,engineVersionId:input.materialization.engineVersionId},projectDecision:{mode:input.projectId?'REFERENCE_EXISTING':'CREATE_OR_UPDATE',projectId:input.projectId||null},workPackages};
}
