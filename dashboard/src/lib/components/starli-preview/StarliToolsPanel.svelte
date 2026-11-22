<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {user} from '$lib/stores';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import StarliToolFields from './StarliToolFields.svelte';
 import {fieldLabel,initialArguments,toolArguments,toolGroup,resultData,resultFailed,resultPending,canonicalArguments} from '$lib/utils/starli-tool-form';
 let tools:any[]=[],query='',category='All',selected:any=null,values:Record<string,any>={},advanced='',useAdvanced=false;
 let result:any=null,error='',notice='',loading=true,running=false,successful=false,destroyed=false;
 const headers=()=>({Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'});
 const title=(tool:any)=>tool.displayName||fieldLabel(tool.name);
 const group=(tool:any)=>tool.category||toolGroup(tool.name);
 const status=(tool:any)=>tool.previewExecutable?'Ready':tool.approvalAvailable?'Review required':'Connection required';
 async function api(path:string,options:any={}){
  const r=await fetch('/api/v1/starli/'+path,{...options,headers:headers()});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:data.error?.message||'The request could not complete ('+r.status+').');
  return data;
 }
 async function load(){loading=true;error='';try{const data=await api('tools/catalog');if(destroyed)return;tools=(data.tools??[]).filter(t=>t&&typeof t.name==='string');if(selected)selected=tools.find(t=>t.name===selected.name)??null;}catch(e){error=String((e as Error).message);}finally{loading=false;}}
 function choose(tool:any){if(running)return;selected=tool;values=initialArguments(tool.inputSchema);advanced=JSON.stringify(values,null,2);useAdvanced=false;result=null;error='';notice='';successful=false;}
 function advancedMode(){if(!useAdvanced)advanced=JSON.stringify(values,null,2);else{try{values=JSON.parse(advanced);}catch{error='Correct the JSON before returning to the form.';return;}}useAdvanced=!useAdvanced;}
 async function operationKey(args:any,newAction=false){
  const body=canonicalArguments({owner:$user?.id,tool:selected.name,args});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  const id='starli-tool-operation:'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
  let key:string|null=null;try{key=sessionStorage.getItem(id);}catch{}
  if(!key||newAction){key=crypto.randomUUID();try{sessionStorage.setItem(id,key);}catch{}}
  return key;
 }
 function argumentsValue(){
  const parsed=useAdvanced?JSON.parse(advanced):values;
  return toolArguments(selected.inputSchema??{type:'object'},parsed);
 }
 async function invoke(){
  if(running||!selected?.previewExecutable)return;
  running=true;error='';notice='';
  try{
   const args=argumentsValue(),operationKeyValue=await operationKey(args,successful);
   successful=false;
   const data=await api('tools/invoke',{method:'POST',body:JSON.stringify({tool:selected.name,args,operationKey:operationKeyValue})});
   result=resultData(data);
   if(resultFailed(data)){error=typeof result?.error==='string'?result.error:result?.error?.message||'The tool did not report success. Review its result before retrying.';}
   else{successful=!resultPending(data);notice=successful?'Result received':'Action is queued or running. Check its result before starting another execution.';window.dispatchEvent(new CustomEvent('starli-project-updated',{detail:{tool:selected.name,projectId:args.projectId}}));}
  }catch(e){error=e instanceof SyntaxError?'Check the JSON arguments.':String((e as Error).message);}
  finally{running=false;}
 }
 async function prepare(){
  if(running||!selected?.approvalAvailable)return;running=true;error='';notice='';
  try{const data=await api('approvals',{method:'POST',body:JSON.stringify({tool:selected.name,args:argumentsValue()})});result=data;notice='Action prepared. Review its exact details in Approvals before execution.';}
  catch(e){error=e instanceof SyntaxError?'Check the JSON arguments.':String((e as Error).message);}
  finally{running=false;}
 }
 onMount(()=>{void load();});
 onDestroy(()=>{destroyed=true;});
 $: categories=['All',...new Set(tools.map(group))];
 $: visible=tools.filter(t=>(category==='All'||group(t)===category)&&(title(t)+' '+t.name+' '+t.description).toLowerCase().includes(query.toLowerCase()));
 $: resultText=typeof result==='string'?result:JSON.stringify(result,null,2);
</script>
<section class="mx-auto max-w-6xl p-4 text-gray-800 dark:text-gray-100 md:p-6">
 <header class="mb-5 flex items-start justify-between gap-3">
  <div><h1 class="text-xl font-medium">Tools</h1><p class="mt-1 text-sm text-gray-500">Starli uses these tools directly in chat. You can also inspect and run a specific action here.</p></div>
  <button type="button" disabled={loading||running} class="rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-850" on:click={load}>Refresh</button>
 </header>
 <div class="mb-4 flex flex-col gap-2 sm:flex-row">
  <input aria-label="Search tools" placeholder="Search actions, projects, mail…" bind:value={query} class="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850"/>
  <select aria-label="Tool category" bind:value={category} class="rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850">{#each categories as value}<option value={value}>{value}{value==='All'?' · '+tools.length:''}</option>{/each}</select>
 </div>
 {#if loading}<div class="flex items-center gap-2 py-4 text-sm text-gray-500" role="status"><Spinner/> Loading connected tools…</div>{/if}
 <div class="grid items-start gap-5 lg:grid-cols-[minmax(15rem,2fr)_minmax(20rem,3fr)]">
  <nav class="max-h-[65vh] overflow-y-auto" aria-label="Available tools">
   {#each visible as tool (tool.name)}
    <button type="button" disabled={running} aria-current={selected?.name===tool.name?'true':undefined} on:click={()=>choose(tool)} class="mb-1 block w-full rounded-lg px-3 py-3 text-left hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-850 {selected?.name===tool.name?'bg-gray-100 dark:bg-gray-850':''}">
     <div class="flex items-start justify-between gap-3"><span class="text-sm font-medium">{title(tool)}</span><span class="shrink-0 text-[0.65rem] text-gray-500">{status(tool)}</span></div>
     <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{tool.description}</p>
    </button>
   {/each}
   {#if !visible.length&&!loading}<p class="p-3 text-sm text-gray-500">No tools match this search.</p>{/if}
  </nav>
  <div class="min-w-0">
   {#if selected}
    <div class="mb-4 border-b border-gray-100 pb-4 dark:border-gray-850"><p class="mb-1 text-xs text-gray-500">{group(selected)} · {status(selected)}</p><h2 class="font-medium">{title(selected)}</h2><p class="mt-2 text-sm leading-relaxed text-gray-500">{selected.description}</p></div>
    {#key selected.name}
     <form class="space-y-4" on:submit|preventDefault={invoke}>
      {#if useAdvanced}
       <label class="block text-sm font-medium" for="starli-tool-advanced">Arguments</label><textarea id="starli-tool-advanced" bind:value={advanced} disabled={running} rows="12" spellcheck="false" class="w-full rounded-lg bg-gray-50 p-3 font-mono text-xs outline-hidden dark:bg-gray-850"/>
      {:else if Object.keys(selected.inputSchema?.properties??{}).length}
       <StarliToolFields schema={selected.inputSchema} bind:values prefix={'tool-'+selected.name} disabled={running}/>
      {:else}<p class="text-sm text-gray-500">This tool needs no additional information.</p>{/if}
      {#if error}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
      {#if notice}<p role="status" class="text-sm text-gray-500">{notice}</p>{/if}
      {#if !selected.previewExecutable}<p class="text-xs text-gray-500">{selected.unavailableReason||selected.reason||(selected.approvalAvailable?'Review this action before it runs.':'Connect the required account or provider to use this action. Starli can guide you in chat.')}</p>{/if}
      <div class="flex flex-wrap items-center gap-2">
       {#if selected.previewExecutable}<button type="submit" disabled={running} class="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">{running?'Running…':successful?'Run again':'Run action'}</button>{/if}
       {#if selected.approvalAvailable}<button type="button" disabled={running} on:click={prepare} class="rounded-lg bg-gray-100 px-3 py-2 text-sm disabled:opacity-40 dark:bg-gray-850">Prepare for review</button><a href="/starli/approvals" class="px-2 text-xs text-gray-500 underline">Approvals</a>{/if}
       <button type="button" disabled={running} on:click={advancedMode} class="ml-auto rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-850">{useAdvanced?'Use form':'Advanced JSON'}</button>
      </div>
     </form>
    {/key}
    {#if result!==null}<section aria-label="Tool result" class="mt-5 border-t border-gray-100 pt-4 dark:border-gray-850"><h3 class="mb-2 text-sm font-medium">Result</h3><pre class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-xs leading-relaxed dark:bg-gray-850">{resultText}</pre><p class="mt-2 text-xs text-gray-500">This is the backend receipt. A queued, pending or uncertain action is still awaiting its final outcome.</p></section>{/if}
    <details class="mt-5 text-xs text-gray-500"><summary class="cursor-pointer">Parameter schema</summary><pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(selected.inputSchema,null,2)}</pre><p class="mt-2 font-mono">{selected.name}</p></details>
   {:else}<p class="p-4 text-sm text-gray-500">Choose an action to see its inputs, connection status and latest result.</p>{#if error}<p role="alert" class="px-4 text-sm text-red-600 dark:text-red-400">{error}</p>{/if}{/if}
  </div>
 </div>
</section>
