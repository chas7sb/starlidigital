export function runtimePolicyLabel(data:any):string {
 const p=data?.runtimePolicy;
 if(p?.platformGrantOverridesOperatorPolicy!==false)return 'Runtime tool availability is not confirmed.';
 if(p.mode==='readonly-preview')return 'Runtime: read-only tools. Conversation permission does not override this server restriction.';
 if(p.mode==='unavailable')return 'Runtime tools are currently unavailable.';
 if(p.mode==='admin'){
  const scope=data.capabilityScope,allowed=new Set(['starli_source_read','starli_source_list','starli_status','platform_capabilities','platform_overview','api_overview','projects_list','project_get','crm_upsert_prospect','crm_add_activity','outreach_create_draft']);
  if(scope?.version==='starli.capability-scope.v1'&&scope.id==='starli-admin.v1'&&scope.eligibility?.requiresAdministrator===true&&scope.eligibility?.requiresPersistedPlatformGrant===true&&Array.isArray(scope.adminTools)&&scope.adminTools.length<=allowed.size&&new Set(scope.adminTools).size===scope.adminTools.length&&scope.adminTools.every((name:any)=>allowed.has(name)))return 'Runtime: platform tools for this conversation. '+scope.adminTools.length+' administrator tools currently available.';
 }
 if(p.mode==='owned-projects'&&data.capabilityScope?.version==='starli.capability-scope.v1'&&data.capabilityScope?.id==='owned-projects.v1')return 'Runtime: owned project tools. Access remains limited to this agent’s authorized projects.';
 return 'Runtime tool availability is not confirmed.';
}
