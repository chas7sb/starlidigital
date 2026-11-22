<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 export let companyId:string;export let botId:string;export let conversationId:string;export let accessSignal:AbortSignal;
 const dispatch=createEventDispatcher(),controller=new AbortController();const token=localStorage.token||'';
 let consentTool:any=null,consenting=false;
 let loading=true,error='',query='',tools:any[]=[],unavailable:any[]=[];
 $: filtered=tools.filter(t=>(t.name+' '+t.description).toLowerCase().includes(query.toLowerCase()));
 function revoke(){consentTool=null;controller.abort();tools=[];unavailable=[];query='';dispatch('close');}
 async function load(){loading=true;error='';try{
  const r=await fetch('/api/v1/companies/'+encodeURIComponent(companyId)+'/bots/'+encodeURIComponent(botId)+'/tools?conversationId='+encodeURIComponent(conversationId),{signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
  if(controller.signal.aborted||accessSignal.aborted||token!==localStorage.token)return;
  if(!r.ok)throw Error(r.status===404?'The company tool catalogue is not enabled yet.':r.status===403?'You do not have access to this bot’s tools.':'Tools could not be loaded.');
  const d=await r.json();if(controller.signal.aborted||accessSignal.aborted||token!==localStorage.token)return;
  if(d.version!=='starli.company-tools.v1'||d.companyId!==companyId||d.botId!==botId||d.conversationId!==conversationId||!Array.isArray(d.tools)||d.tools.some((t:any)=>typeof t.name!=='string'||typeof t.description!=='string'))throw Error('Tool catalogue scope could not be verified.');
  tools=d.tools;unavailable=Array.isArray(d.unavailable)?d.unavailable:[];
 }catch(e){if(!controller.signal.aborted)error=(e as Error).message;}finally{if(!controller.signal.aborted)loading=false;}}
 async function grant(){
 const tool=consentTool,ref=tool?.accountMcpRef;if(!ref||consenting)return;consenting=true;error='';
 try{const response=await fetch('/api/v1/companies/'+encodeURIComponent(companyId)+'/bots/'+encodeURIComponent(botId)+'/mcp-consents',{method:'POST',signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({conversationId,servers:[{serverId:ref.serverId,expectedRevision:ref.expectedRevision,toolNames:[ref.toolName]}],expiresSeconds:900,acknowledgeAudienceSharing:true})});
 if(controller.signal.aborted||accessSignal.aborted||token!==localStorage.token)return;
 if(!response.ok)throw Error(response.status===409?'The MCP server changed. Reload tools before granting access.':'MCP access could not be enabled. Check its connection in Apps.');
 const result=await response.json();if(result.version!=='starli.company-mcp-consent.v1'||typeof result.consentId!=='string'||result.state!=='PENDING'||result.nextTurnOnly!==true||result.ownership!=='account-owner'||result.companyOwned!==false||!Number.isFinite(result.expiresAt))throw Error('MCP consent scope could not be verified.');
 consentTool=null;dispatch('select',{name:tool.name});
 }catch(cause){if(!controller.signal.aborted)error=(cause as Error).message;}finally{consenting=false;}
 }
 onMount(()=>{accessSignal.addEventListener('abort',revoke,{once:true});if(!accessSignal.aborted)void load();return()=>accessSignal.removeEventListener('abort',revoke);});onDestroy(()=>controller.abort());
</script>
<section class="tools" aria-label="Bot tools"><header><div><h2>Tools</h2><p>Ask your bot to use a tool in this conversation.</p></div><button aria-label="Close tools" on:click={()=>dispatch('close')}>×</button></header>
{#if consentTool}<div class="consent"><h3>Use your account connection?</h3><p>Allow <strong>{consentTool.name}</strong> for this bot’s next task in this conversation. Tool results will be visible to this conversation’s participants. This permission expires after 15 minutes if unused.</p><button disabled={consenting} on:click={grant}>{consenting?'Enabling…':'Allow for next task'}</button><button disabled={consenting} on:click={()=>consentTool=null}>Cancel</button></div>{/if}<input aria-label="Find a tool" placeholder="Find a tool…" bind:value={query}/>
{#if loading}<p role="status">Loading authorized tools…</p>{:else if error}<p role="alert">{error}</p><button on:click={load}>Try again</button>{:else}<div class="tool-list">{#each filtered as tool(tool.name)}<button class="tool" disabled={!['available','requires-run-admission','requires-explicit-consent'].includes(tool.availability)} on:click={()=>tool.availability==='requires-explicit-consent'?consentTool=tool:dispatch('select',{name:tool.name})}><strong>{tool.name}</strong><span>{tool.description}</span><small>{tool.ownership==='account-owner'?'Your account':tool.origin||'Company'} · {tool.effect||'Tool'}{tool.availability!=='available'?' · '+tool.availability:''}</small></button>{:else}<p>No matching tools.</p>{/each}</div>{#if unavailable.length}<details><summary>Other capabilities</summary>{#each unavailable as item}<p><strong>{item.family}</strong> — {item.reason}</p>{/each}</details>{/if}{/if}
</section>
<style>.tools{position:absolute;bottom:calc(100% + 10px);left:0;z-index:25;width:min(500px,100%);max-height:65vh;overflow:auto;padding:18px;background:white;border:1px solid #e6ebf4;border-radius:13px;box-shadow:0 10px 35px #17243f10;color:#17243f}header{display:flex;justify-content:space-between;gap:15px;margin-bottom:15px}h2{margin:0;font-size:14px;font-weight:500}p{font-size:11px;color:#71809a;margin:5px 0;line-height:1.6}button{background:none;border:0;color:inherit;font:inherit;cursor:pointer}header button{font-size:20px;align-self:flex-start}input{width:100%;font:inherit;font-size:12px;border:1px solid #e6ebf4;background:#f6f8fc;padding:9px 11px;border-radius:8px;color:inherit}.tool-list{margin-top:10px}.tool{width:100%;display:flex;flex-direction:column;gap:5px;text-align:left;border-radius:8px;padding:11px}.tool:hover{background:#f6f8fc}.tool strong{font-size:12px;font-weight:500}.tool span{font-size:11px;color:#71809a;line-height:1.5}.tool small{font-size:9px;color:#8493ac}.tool:disabled{opacity:.45;cursor:default}details{margin-top:14px;border-top:1px solid #e6ebf4;padding-top:12px;font-size:11px}summary{cursor:pointer;color:#71809a}.consent{padding:14px;border:1px solid #dce5fc;background:#f6f8fc;border-radius:9px;margin-bottom:14px}.consent h3{font-size:12px;font-weight:500;margin:0 0 7px}.consent button{font-size:11px;color:#3466f6;padding:8px 8px 0 0}
</style>
