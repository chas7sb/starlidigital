<script lang="ts">
 import {onDestroy,onMount} from 'svelte';
 import {CompanyClient,botPath,memoryLabel,type Bot,type Audience} from '$lib/utils/company-workspace';
 export let companyId:string;export let bot:Bot;export let audience:Audience;
 let client:CompanyClient,ready=false,busy=false,error='',notice='',choices:any[]=[],selection:any=null,choice='';
 let memory:any=null,memoryDenied=false,draft='',baseRevision=0,writeId='',pending='',loadedScope='';
 const modelKey=(c:any,m:string)=>JSON.stringify([c.connectionId,m]);
 $: scope=companyId+'|'+bot.id+'|'+audience.kind+'|'+audience.id;
 $: if(ready&&loadedScope!==scope){loadedScope=scope;void reset();}
 async function reset(){busy=false;client?.close();client=new CompanyClient(companyId,()=>localStorage.token||'');choices=[];selection=null;choice='';memory=null;memoryDenied=false;draft='';baseRevision=0;error='';notice='';writeId='';pending='';await Promise.allSettled([models(),readMemory()]);}
 async function models(){const current=client;try{const d=await current.request(botPath(bot.id)+'/provider-options','GET',undefined,undefined,true);if(current!==client)return;if(!Array.isArray(d.options))throw Error('Provider options are unavailable.');choices=d.options;const s=await current.request(botPath(bot.id)+'/provider-selection');if(current!==client)return;if(s.botId!==bot.id||s.version!=='starli.company-provider.v1')throw Error('Bot provider scope could not be verified.');selection=s;choice=modelKey(s,s.model);}catch(e){if(current===client&&selection)error=(e as Error).message;}}
 async function choose(){if(busy||!choice)return;busy=true;error='';const current=client,[connectionId,model]=JSON.parse(choice);try{await current.request(botPath(bot.id)+'/provider-selection','PUT',{connectionId,model,expectedRevision:selection?.configurationRevision??0},crypto.randomUUID(),true);if(current!==client)return;await models();if(current===client)notice='Model choice saved for '+bot.name+'.';}catch(e){if(current===client)error=(e as Error).message;}finally{if(current===client)busy=false;}}
 function memoryDocument(d:any){if(d?.version!=='starli.memory.view.v1'||d.companyId!==companyId||d.botId!==bot.id||d.audience?.kind!==audience.kind||d.audience?.id!==audience.id||!Number.isSafeInteger(d.document?.revision)||d.document.revision<0||typeof d.document.content!=='string')throw Error('Bot memory scope could not be verified.');return d.document;}
 function denyMemory(e:any){if(![401,403,404].includes(e?.status))return false;memory=null;draft='';baseRevision=0;pending='';writeId='';notice='';memoryDenied=true;error='Memory access changed. Reopen this workspace.';return true;}
 function memPath(){return botPath(bot.id)+'/memory?audienceKind='+encodeURIComponent(audience.kind)+'&audienceId='+encodeURIComponent(audience.id);}
 async function readMemory(){const current=client;try{const d=await current.request(memPath());if(current!==client)return;memory=memoryDocument(d);memoryDenied=false;baseRevision=memory.revision;if(!pending)draft=memory.content;}catch(e){if(current===client){if(!denyMemory(e)){if(memory)error=(e as Error).message;memory=null;}}}}
 async function write(clear=false){if(!memory||busy)return;busy=true;error='';const current=client;const fingerprint=JSON.stringify([clear,draft,baseRevision]);if(pending!==fingerprint){pending=fingerprint;writeId=crypto.randomUUID();}
 try{const d=await current.request(memPath(),clear?'DELETE':'PUT',{...(clear?{}:{content:draft}),expectedRevision:baseRevision,clientWriteId:writeId},writeId);if(current!==client)return;
 memory=memoryDocument(d);memoryDenied=false;baseRevision=memory.revision;draft=memory.content;pending='';writeId='';notice=clear?'Current memory cleared; version history remains.':'Memory saved for '+memoryLabel(bot,audience)+'.';
 }catch(e){if(current===client&&!denyMemory(e))error=(e as Error).message;}finally{if(current===client)busy=false;}}
 function edited(){pending=JSON.stringify(['draft',draft,baseRevision]);}
 function changed(e:StorageEvent){if(e.key==='token'||e.key===null){client?.close();memory=null;choices=[];draft='';error='Your session changed. Reopen this workspace.';}}
 onMount(()=>{ready=true;window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);});onDestroy(()=>client?.close());
</script>
<section class="bot-controls" aria-label={'Controls for '+bot.name}>
 <h3>{bot.name}</h3><p>{bot.role||'AI AGENT BOT'}</p>
 {#if choices.length}<details><summary>Provider and model</summary><p>Active company members can choose a company connection or StarliDigital hosted model.</p>
 {#if selection}<p>{selection.status==='connection_revoked'?'The saved connection was revoked. Choose another connection.':selection.status==='unconfigured'?'No provider selected.':'Saved choice: '+selection.provider+' · '+selection.model}{#if selection.updatedBy} · Changed by {selection.updatedBy} · revision {selection.configurationRevision}{/if}</p>{/if}
 <form on:submit|preventDefault={choose}><label>Model<select bind:value={choice} disabled={busy}><option value="">Choose an available model</option>{#each choices as c}{#each c.models as m}<option value={modelKey(c,m)}>{c.provider==='hosted'?'StarliDigital hosted':c.provider} · {m}</option>{/each}{/each}</select></label><button class="sd-button" disabled={busy||!choice}>Save model choice</button></form></details>{/if}
 {#if memory}<details><summary>Bot memory</summary><strong>{memoryLabel(bot,audience)}</strong><p>Saved facts follow this bot across permitted conversations. Private facts remain restricted to their audience.</p>
 {#if memory}<label>Current memory<textarea bind:value={draft} on:input={edited} rows="7" disabled={busy}/></label><small>Revision {baseRevision} · {audience.kind==='company'?'Visible to company members':audience.kind==='channel'?'Visible to this channel’s permitted members':'Private audience'}</small>
 <div class="actions"><button class="sd-button" disabled={busy} on:click={()=>write()}>Save to memory</button><button class="sd-button" disabled={busy} on:click={readMemory}>Reload current revision</button><button class="sd-button" disabled={busy} on:click={()=>write(true)}>Clear current memory; version history remains</button></div>
 {/if}</details>{/if}
 {#if error}<p role="alert">{error}{#if !memoryDenied} Your draft is retained. Reload updates the revision; review your draft before saving again.{/if}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</section>
<style>.bot-controls{padding:10px 0;border:0;border-radius:0;margin:0;min-width:0}.bot-controls h3{font-weight:700}.bot-controls p,small{font-size:12px;color:var(--sd-muted);margin:6px 0}.bot-controls details{margin-top:12px}.bot-controls summary{cursor:pointer;font-size:13px;font-weight:600}form,label{display:flex;flex-direction:column;gap:7px}select,textarea{width:100%;min-width:0;background:var(--sd-card);color:inherit;border:1px solid var(--sd-line);padding:8px;border-radius:8px}textarea{resize:vertical}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.actions button{font-size:12px;min-height:40px}</style>
