// Native consumer injects its existing verified-session/CSRF request function.
// enabledActions comes from trusted mounted-route evidence, never model output.
export function bindEmailWorkflow(host,{request,companyId,enabledActions=[],signal}){
 const allowed=['preview','review','approve','controlled-send','controlled-state'];
 if(typeof request!=='function'||typeof companyId!=='string'||!companyId)throw Error('Native email binding required');
 if(!Array.isArray(enabledActions)||enabledActions.some(a=>!allowed.includes(a)))throw Error('Unsupported email action');
 host.emailCapabilities=Object.freeze([...new Set(enabledActions)]);
 host.emailRequest=async(resourceId,action,body)=>{
  if(signal?.aborted)throw Error('Company session changed');
  if(!host.emailCapabilities.includes(action)||typeof resourceId!=='string'||!resourceId)throw Error('Email action unavailable');
  const response=await request(`/api/v1/companies/${encodeURIComponent(companyId)}/email-studio/${encodeURIComponent(resourceId)}/${action}`,{method:'POST',signal,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(signal?.aborted)throw Error('Company session changed');
  const data=await response.json();
  if(!response.ok){const error=Error(data.detail||data.error?.message||'Email request failed');error.status=response.status;throw error;}
  return data;
 };
 return ()=>{host.emailCapabilities=Object.freeze([]);host.emailRequest=async()=>{throw Error('Email binding closed');};};
}
