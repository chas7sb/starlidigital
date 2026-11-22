<script lang="ts">
 import {onMount,onDestroy,getContext,createEventDispatcher} from 'svelte';
 import {toast} from 'svelte-sonner';
 import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import Tooltip from '$lib/components/common/Tooltip.svelte';
 const i18n=getContext('i18n');
 const dispatch=createEventDispatcher();
 function publishState(available:boolean){const saved=providers.filter(p=>p.connected);dispatch('state',{loaded:true,available,connected:saved.length,selected:available&&!!selection?.model&&saved.some(p=>p.id===selection?.provider),provider:selection?.provider,model:selection?.model});}
 let providers:any[]=[],provider:any=null,models:any[]=[],selection:any=null,search='',modelSearch='',total=0,offset=0;
 let loading=true,busy=false,error='',session:any=null,answer='',timer:ReturnType<typeof setInterval>,epoch=0,destroyed=false;
 const api=async(path:string,options:any={})=>{
  const r=await fetch('/api/v1/starli/providers'+path,{...options,headers:{Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'}});
  const d=await r.json();if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:'Provider request failed ('+r.status+')');return d;
 };
 function safeLink(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
 async function load(){loading=true;try{const d=await api('');if(destroyed)return;providers=d.items??[];selection=d.selection;provider=providers.find(p=>p.id===provider?.id)??null;error='';publishState(true);}catch(e){error=String((e as Error).message);publishState(false);}finally{loading=false;}}
 async function choose(p:any){provider=p;modelSearch='';offset=0;models=[];await loadModels();}
 async function loadModels(next=0){if(!provider)return;const e=++epoch,id=provider.id;busy=true;try{const d=await api('/'+encodeURIComponent(id)+'/models?'+new URLSearchParams({q:modelSearch,offset:String(next),limit:'100'}));if(destroyed||e!==epoch||provider?.id!==id)return;models=d.items??[];total=d.total??0;offset=next;}catch(e){error=String((e as Error).message);}finally{if(e===epoch)busy=false;}}
 async function connect(type:string){if(!provider)return;busy=true;error='';try{session=await api('/'+encodeURIComponent(provider.id)+'/login',{method:'POST',body:JSON.stringify({authType:type})});answer='';}catch(e){error=String((e as Error).message);}finally{busy=false;}}
 async function poll(){if(!session||!['CONNECTING','INPUT_REQUIRED'].includes(session.status))return;try{const d=await api('/sessions/'+encodeURIComponent(session.id)+'/status');if(destroyed)return;const oldPrompt=session?.prompt?.id;session=d;if(oldPrompt!==d.prompt?.id)answer='';if(d.status==='CONNECTED'){toast.success('Provider connected');await load();await loadModels();}else if(['FAILED','EXPIRED'].includes(d.status))error=d.error||'Provider login expired. Start a new connection.';}catch(e){error=String((e as Error).message);}}
 async function respond(){if(!session?.prompt||!answer.trim())return;busy=true;try{session=await api('/sessions/'+encodeURIComponent(session.id)+'/answer',{method:'POST',body:JSON.stringify({promptId:session.prompt.id,value:answer})});answer='';}catch(e){error=String((e as Error).message);}finally{busy=false;}}
 async function cancel(){if(!session)return;try{await api('/sessions/'+encodeURIComponent(session.id),{method:'DELETE'});session=null;answer='';}catch(e){error=String((e as Error).message);}}
 async function disconnect(){if(!provider)return;busy=true;try{await api('/'+encodeURIComponent(provider.id),{method:'DELETE'});await load();}catch(e){error=String((e as Error).message);}finally{busy=false;}}
 async function selectModel(model:any){busy=true;try{const d=await api('/selection/default',{method:'PUT',body:JSON.stringify({provider:provider.id,model:model.id})});selection=d.selection;publishState(true);toast.success('Default project model updated');}catch(e){error=String((e as Error).message);}finally{busy=false;}}
 async function refresh(){busy=true;try{await api('/'+encodeURIComponent(provider.id)+'/refresh',{method:'POST'});await loadModels();toast.success('Model catalog refreshed');}catch(e){error=String((e as Error).message);}finally{busy=false;}}
 onMount(()=>{void load();timer=setInterval(()=>void poll(),1500);});
 onDestroy(()=>{destroyed=true;epoch++;clearInterval(timer);});
 $: visible=providers.filter(p=>(p.name+' '+p.id).toLowerCase().includes(search.toLowerCase()));
</script>
<div class="flex h-full flex-col space-y-4 text-sm">
 <div class="space-y-1">
  <button type="button" disabled={loading||busy} on:click={load} class="float-right rounded-lg px-3 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-850">Refresh</button>
  <p>Connect your own model provider for customer-project chat and agents.</p>
  <p class="text-xs text-gray-500">Providers, authentication methods and models come from the installed Pi runtime. Subscription sign-in appears only where Pi supports it. Your credentials are encrypted and isolated to your account.</p>
  {#if selection}<p class="pt-1 text-xs text-gray-500">Default: <span class="font-medium text-gray-700 dark:text-gray-300">{selection.provider} / {selection.model}</span></p>{:else}<p class="pt-1 text-xs text-gray-500">No account model selected. Connect a provider and choose a chat model.</p>{/if}
 </div>
 {#if error}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
 {#if loading}<div class="flex justify-center p-4"><Spinner/></div>{/if}
 <div class="grid min-h-0 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
  <nav class="space-y-2" aria-label="Model providers">
   <input aria-label="Search providers" bind:value={search} placeholder="Search providers" class="w-full rounded-lg bg-gray-50 px-3 py-2 text-xs outline-hidden dark:bg-gray-850"/>
   <div class="max-h-72 space-y-1 overflow-y-auto">{#each visible as p}<button type="button" class="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-850 {provider?.id===p.id?'bg-gray-100 dark:bg-gray-850':''}" aria-current={provider?.id===p.id?'true':undefined} on:click={()=>choose(p)}><span class="block font-medium">{p.name}</span><span class="text-gray-500">{p.connected?'Connected':p.modelCount+' models'}</span></button>{/each}</div>
  </nav>
  <div class="min-w-0 space-y-3">
   {#if provider}
    <div class="flex items-start justify-between gap-2"><div><h3 class="font-medium">{provider.name}</h3><p class="text-xs text-gray-500">{provider.connected?('Connected with '+(provider.credentialType==='oauth'?'provider sign-in':'API key')):'Not connected'}</p></div>{#if provider.connected}<button type="button" disabled={busy} class="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-850" on:click={disconnect}>Disconnect</button>{/if}</div>
    <div class="flex flex-wrap gap-2">{#each provider.authMethods??[] as method}<button type="button" disabled={busy||!method.interactive} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-850" on:click={()=>connect(method.type)}>{method.label}{method.subscription?' Â· subscription':''}</button>{#if !method.interactive}<p class="text-xs text-gray-500">Requires operator-managed environment credentials.</p>{/if}{/each}</div>
    {#if session&&session.provider===provider.id&&['CONNECTING','INPUT_REQUIRED'].includes(session.status)}
     <div class="space-y-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800">
      <div class="flex items-center justify-between"><p class="text-xs font-medium">Connect {provider.name}</p><button type="button" on:click={cancel} class="text-xs text-gray-500">Cancel</button></div>
      {#each session.events??[] as event}
       {#if event.type==='auth_url'&&safeLink(event.url)}<a href={safeLink(event.url)} target="_blank" rel="noopener noreferrer" class="block break-words text-xs underline">Open provider sign-in â†—</a>{#if event.instructions}<p class="whitespace-pre-wrap text-xs text-gray-500">{event.instructions}</p>{/if}
       {:else if event.type==='device_code'}<p class="text-xs">Your code: <span class="select-all font-mono font-medium">{event.userCode}</span></p>{#if safeLink(event.verificationUri)}<a href={safeLink(event.verificationUri)} target="_blank" rel="noopener noreferrer" class="block text-xs underline">Enter code at provider â†—</a>{/if}
       {:else if event.message}<p class="whitespace-pre-wrap text-xs text-gray-500">{event.message}</p>{#each event.links??[] as link}{#if safeLink(link.url)}<a href={safeLink(link.url)} target="_blank" rel="noopener noreferrer" class="block text-xs underline">{link.label??'Open provider instructions'} â†—</a>{/if}{/each}{/if}
      {/each}
      {#if session.prompt}
       <form class="space-y-2" on:submit|preventDefault={respond}>
        <p class="text-xs font-medium">{session.prompt.message}</p>
        {#if session.prompt.type==='select'}<select aria-label={session.prompt.message} bind:value={answer} class="w-full rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-900"><option value="">Choose an option</option>{#each session.prompt.options??[] as option}<option value={option.id}>{option.label}</option>{/each}</select>
        {:else if session.prompt.type==='secret'}<div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900"><SensitiveInput bind:value={answer} placeholder={session.prompt.placeholder??'Enter credential'}/></div>
        {:else}<input aria-label={session.prompt.message} bind:value={answer} placeholder={session.prompt.placeholder??''} autocomplete="off" class="w-full rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-900"/>{/if}
        <button type="submit" disabled={busy||!answer.trim()} class="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">Continue</button>
       </form>
      {:else}<p role="status" class="text-xs text-gray-500">Waiting for providerâ€¦</p>{/if}
     </div>
    {/if}
    <form class="flex gap-2" on:submit|preventDefault={()=>loadModels(0)}><input aria-label="Search models" bind:value={modelSearch} placeholder="Search all models" class="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2 text-xs outline-hidden dark:bg-gray-850"/><button class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-850" type="submit">Search</button>{#if provider.connected&&provider.dynamicModels}<Tooltip content="Refresh the model catalog from this provider"><button class="rounded-lg px-2 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-850" disabled={busy} on:click={refresh} type="button">Refresh</button></Tooltip>{/if}</form>
    <div class="max-h-52 divide-y divide-gray-100 overflow-auto dark:divide-gray-850">
     {#each models as model}<button type="button" disabled={busy||!provider.connected||model.type!=='chat'} on:click={()=>selectModel(model)} class="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-xs hover:bg-gray-50 disabled:cursor-default dark:hover:bg-gray-850"><span class="min-w-0"><span class="block truncate font-medium">{model.name}</span><span class="block truncate text-gray-500">{model.id}{model.contextWindow?' Â· '+model.contextWindow.toLocaleString()+' context':''}{model.input?.includes('image')?' Â· vision':''}</span></span><span class="shrink-0 text-gray-500">{selection?.provider===provider.id&&selection?.model===model.id?'Selected':model.type==='chat'?(provider.connected?'Use model':'Connect first'):model.type}</span></button>{/each}
     {#if !models.length&&!busy}<p class="py-3 text-xs text-gray-500">{provider.dynamicModels&&!provider.connected?'Connect this provider, then refresh its model catalog.':'No models match your search.'}</p>{/if}
    </div>
    {#if total>100}<div class="flex items-center justify-between text-xs text-gray-500"><button disabled={!offset||busy} on:click={()=>loadModels(Math.max(0,offset-100))}>Previous</button><span>{offset+1}â€“{Math.min(total,offset+100)} of {total}</span><button disabled={offset+100>=total||busy} on:click={()=>loadModels(offset+100)}>Next</button></div>{/if}
   {:else}<p class="p-3 text-xs text-gray-500">Choose a provider to connect it and select your model.</p>{/if}
  </div>
 </div>
</div>
