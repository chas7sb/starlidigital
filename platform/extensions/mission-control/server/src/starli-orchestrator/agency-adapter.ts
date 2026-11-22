import type {AgencyActionPlan} from '../agency-intelligence/types.js';
import type {OrchestrationWorkPackageSpec,RequiredCapability} from './domain.js';
import {digest} from './policy.js';

export function orchestrationWorkFromAgencyActionPlan(input:{plan:AgencyActionPlan;projectId?:string;approvalId?:string;capability?:Pick<RequiredCapability,'availability'|'connection'|'projectScoped'>;dependencyPackageIds?:string[]}):OrchestrationWorkPackageSpec{
 const p=input.plan,projectId=input.projectId||p.entityRefs.find(r=>['project','creative_project'].includes(r.kind))?.id||null,capabilityId=p.capabilityRequirement;
 return{id:`owp:${digest({agencyActionPlanId:p.id}).slice(0,28)}`,target:'AGENCY_ACTION',title:p.action.label,executionMode:'EXECUTABLE',dependencyPackageIds:input.dependencyPackageIds||[],requiredCapabilities:capabilityId?[{capabilityId,projectScoped:input.capability?.projectScoped??!!projectId,availability:input.capability?.availability||'UNKNOWN',connection:input.capability?.connection||'UNKNOWN'}]:[],requiredArtifacts:[],requiredInputs:[],requiredApproval:{kind:p.approvalRequired?'EXPLICIT_APPROVAL':'NONE',approvalId:input.approvalId||null},agencyActionPlanId:p.id,projectId,sourceRef:{kind:'AGENCY_ACTION_PLAN',id:p.id}};
}
