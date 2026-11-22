<script lang="ts">
 import {onMount} from 'svelte';
 import {user} from '$lib/stores';
 import {IntelligenceClient,resolveIntelligenceEndpoint,type View,type Observation} from '$lib/apis/starli-intelligence';
 import StarliLiveLocationPanel from './StarliLiveLocationPanel.svelte';
 import StarliMomentsPanel from './StarliMomentsPanel.svelte';
 import Spinner from '$lib/components/common/Spinner.svelte';
 export let chatId:string|null=null;
 let view:View={status:'closed',message:'',data:null,updatedAt:0},client:IntelligenceClient|null=null;
 let ready=false,seen='',tab='signals',selected:Observation|null=null,now=Date.now(),search='';
 let connectionEpoch=0,authController:AbortController|null=null;
 let saving=false,writeError='',follow: {sourceId:string;name:string;key:string}|null=null;
 async function connect(){
  const epoch=++connectionEpoch,owner=$user?.id,context=chatId,token=localStorage.token??'';authController?.abort();const controller=new AbortController();authController=controller;
  client?.stop();view={status:'connecting',message:'Connecting…',data:null,updatedAt:0};
  let endpoint:URL;try{endpoint=new URL(resolveIntelligenceEndpoint(import.meta.env.VITE_STARLI_INTELLIGENCE_ENDPOINT,import.meta.env.VITE_STARLI_STAGE==='true',location.origin));}catch{view={status:'unavailable',message:'The Intelligence endpoint is not trusted for this build.',data:null,updatedAt:0};return;}
  const ws=new URL(endpoint);ws.protocol=endpoint.protocol==='https:'?'wss:':'ws:';
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('/api/v1/auths/',{headers:{Accept:'application/json',Authorization:'Bearer '+token},credentials:'same-origin',signal:controller.signal});
   const native=response.ok?await response.json():null;
   if(epoch!==connectionEpoch||owner!==$user?.id||context!==chatId)return;
   if(!token||localStorage.token!==token||native?.id!==owner)throw Error('SESSION_CHANGED');
  }catch{
   if(epoch===connectionEpoch){client=null;view={status:'unauthorized',message:'Your native session changed or could not be verified. Refresh and sign in again.',data:null,updatedAt:0};}
   return;
  }finally{clearTimeout(timeout);}
  client=new IntelligenceClient({token:()=>token,httpUrl:endpoint.href,webSocketUrl:ws.href,onChange:value=>{view=value;if(value.status==='unauthorized'||value.status==='reconnecting'||!value.data)selected=null;}});
  void client.start();
 }
 function reset(){connectionEpoch++;authController?.abort();client?.stop();client=null;selected=null;follow=null;saving=false;writeError='';search='';tab='signals';if($user?.id)connect();}
 function evidence(item:Observation){
  // Draft only into this conversation. The native composer still controls submission.
  window.dispatchEvent(new CustomEvent('starli-compose',{detail:{prompt:'Explain this Intelligence observation and why it matters. Observation ID: '+item.id+'. '+(item.title??item.summary)+'. Check its current authorized evidence and freshness; distinguish facts from inferences.'}}));
 }
 function safeLink(value?:string){try{const u=new URL(value??'');return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}}
 function when(value:string){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'Time unavailable';}
 function chooseFollow(item:Observation){follow={sourceId:item.sourceId,name:'Follow '+(item.title??item.summary).slice(0,100),key:crypto.randomUUID()};writeError='';}
 async function save(){
  if(!client||!follow||saving)return;
  const current=follow,account=$user?.id,context=chatId;saving=true;writeError='';
  try{await client.followSource(current.sourceId,current.name,current.key);if(account===$user?.id&&context===chatId&&follow===current)follow=null;}
  catch(error){if(account===$user?.id&&context===chatId)writeError=(error as Error).message;}
  finally{if(account===$user?.id&&context===chatId)saving=false;}
 }
 $: if(ready&&seen!==($user?.id??'')+'|'+(chatId??'')){seen=($user?.id??'')+'|'+(chatId??'');reset();}
 $: items=(view.data?.observations??[]).filter(item=>Date.parse(item.expiresAt)>now&&((item.title??'')+' '+item.summary).toLowerCase().includes(search.toLowerCase()));
 $: if(selected&&!items.some(item=>item.id===selected?.id))selected=null;
 onMount(()=>{
  ready=true;const timer=setInterval(()=>now=Date.now(),10000);
  const storage=(event:StorageEvent)=>{
   if(event.storageArea!==localStorage||(event.key!=='token'&&event.key!==null))return;
   connectionEpoch++;authController?.abort();client?.stop();client=null;selected=null;follow=null;
   view={status:'unauthorized',message:'Your account session changed in another tab. Refresh to continue.',data:null,updatedAt:0};
  };
  window.addEventListener('storage',storage);
  return()=>{ready=false;connectionEpoch++;authController?.abort();clearInterval(timer);window.removeEventListener('storage',storage);client?.stop();};
 });
</script>
<section aria-label="Intelligence context" class="flex min-h-0 flex-1 flex-col text-gray-900 dark:text-gray-100">
 <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
  <p role="status" aria-live="polite" class="flex items-center gap-2 text-xs text-gray-500">{#if view.status==='connecting'}<span class="size-3"><Spinner/></span>{/if}<span class="size-1.5 rounded-full {view.status==='live'?'bg-emerald-500':'bg-gray-400'}" aria-hidden="true"/>{view.message||'Intelligence is not connected.'}</p>
  {#if view.updatedAt}<p class="mt-1 text-xs text-gray-400">Checked {new Date(view.updatedAt).toLocaleTimeString()}</p>{/if}
 </div>
 {#if ['unavailable','unauthorized','closed'].includes(view.status)}
  <div class="space-y-3 p-5 text-sm"><p>{view.status==='unauthorized'?'Your account needs to reconnect.':'No verified Intelligence data is available in this pane.'}</p><p class="text-xs leading-5 text-gray-500">Your chat and projects remain available. Intelligence appears here when its authenticated service is connected.</p><button on:click={connect} class="rounded-lg bg-gray-100 px-3 py-2 text-xs hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">Retry connection</button></div>
 {:else}
  <nav aria-label="Intelligence view" class="flex min-w-0 gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-100 px-3 py-2 dark:border-gray-800">{#each ['signals',...(view.data?.capabilities.socialMoments&&view.data?.capabilities.viewportSnapshots?['moments']:[]),'location','following','sources'] as value}<button aria-current={tab===value?'page':undefined} on:click={()=>tab=value} class="shrink-0 rounded-lg px-3 py-1.5 text-xs {tab===value?'bg-gray-100 dark:bg-gray-800':'text-gray-500'}">{value==='following'?'Watchlists':value==='location'?'Live location':value[0].toUpperCase()+value.slice(1)}</button>{/each}</nav>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
   {#if tab==='signals'}
    <input aria-label="Filter Intelligence signals" bind:value={search} placeholder="Filter signals" class="mb-3 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"/>
    <p class="mb-3 text-xs leading-5 text-gray-500">Up to 100 current observations from your authorized sources. A reported observation is not independent verification.</p>
    {#if !items.length}<p class="py-5 text-sm text-gray-500">{view.status==='connecting'?'Loading current observations…':'No current observations match this view.'}</p>{/if}
    <ul class="space-y-2">{#each items as item (item.id)}<li><button class="w-full rounded-xl border border-gray-100 px-3 py-3 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-850" on:click={()=>selected=selected?.id===item.id?null:item} aria-expanded={selected?.id===item.id}><span class="text-xs text-gray-500">{item.claimType==='INFERENCE'?'Inference':'Reported observation'}</span><span class="mt-1 block text-sm font-medium">{item.title??item.summary}</span><span class="mt-1 block text-xs text-gray-500">{when(item.observedAt)}</span></button>
     {#if selected?.id===item.id}<div class="space-y-3 px-3 py-4 text-sm"><p class="whitespace-pre-wrap break-words">{item.summary}</p><dl class="space-y-2 text-xs text-gray-500"><div><dt class="inline font-medium">Confidence: </dt><dd class="inline">{Number.isFinite(item.confidence)?Math.round(item.confidence*100)+'%':'Unavailable'} · supplied by the source</dd></div><div><dt class="inline font-medium">Expires: </dt><dd class="inline">{when(item.expiresAt)}</dd></div><div><dt class="inline font-medium">Sources: </dt><dd class="inline">{item.sourceIds.map(id=>view.data?.sources.find(source=>source.id===id)?.name??'Source details unavailable').join(', ')}</dd></div></dl>{#if safeLink(item.sourceUrl)}<a href={safeLink(item.sourceUrl)} target="_blank" rel="noopener noreferrer" class="inline-block text-xs underline">Open source ↗</a>{/if}
      {#if Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)}<p class="text-xs text-gray-500">Location: {item.latitude}, {item.longitude}</p><a href={'https://www.openstreetmap.org/?'+new URLSearchParams({mlat:String(item.latitude),mlon:String(item.longitude)})+'#map=12/'+item.latitude+'/'+item.longitude} target="_blank" rel="noopener noreferrer" class="inline-block text-xs underline">View this location on OpenStreetMap ↗</a><p class="text-xs text-gray-400">Opening the map shares this observation’s coordinates with OpenStreetMap.</p>{/if}
      <div class="flex flex-wrap gap-2"><button on:click={()=>evidence(item)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Discuss in this chat</button><button disabled={view.status!=='live'} on:click={()=>chooseFollow(item)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">Follow this source</button></div>
     </div>{/if}</li>{/each}</ul>
   {:else if tab==='moments'&&client}
    <StarliMomentsPanel {client} connected={view.status==='live'} revision={view.updatedAt} canWatch={view.data?.capabilities.watchlists===true} canNotify={view.data?.capabilities.notifications===true}/>
   {:else if tab==='location'&&client}
    <StarliLiveLocationPanel {client} connected={view.status==='live'}/>
   {:else if tab==='following'}
    <p class="mb-4 text-xs leading-5 text-gray-500">Saved on your account. An enabled watchlist does not establish that a collector or notification service is running.</p>
    <ul class="divide-y divide-gray-100 dark:divide-gray-800">{#each view.data?.watchlists??[] as item (item.id)}<li class="py-3"><h3 class="text-sm font-medium">{item.name}</h3><p class="mt-1 text-xs text-gray-500">{item.enabled?'Enabled':'Paused'} · {item.sourceIds?.length??0} sources</p></li>{/each}</ul>{#if !view.data?.watchlists.length}<p class="text-sm text-gray-500">No saved watchlists.</p>{/if}
   {:else}
    <h3 class="mb-3 text-sm font-medium">Your connected sources</h3><ul class="divide-y divide-gray-100 dark:divide-gray-800">{#each view.data?.sources??[] as source (source.id)}<li class="py-3"><h3 class="text-sm">{source.name}</h3><div class="mt-1 text-xs text-gray-500">{source.enabled?'Enabled':'Paused'} · {source.kind}</div></li>{/each}</ul>{#if !view.data?.sources.length}<p class="text-sm text-gray-500">No sources configured.</p>{/if}<h3 class="mb-2 mt-5 text-sm font-medium">Connector coverage</h3>{#each view.data?.connectors??[] as connector}<details class="border-b border-gray-100 py-3 text-xs dark:border-gray-800"><summary class="cursor-pointer">{connector.label} · {connector.available?'Available adapter':'Unavailable'}</summary><p class="mt-2 leading-5 text-gray-500">{connector.reason}</p></details>{/each}
   {/if}
   {#if follow}<form on:submit|preventDefault={save} class="mt-4 space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"><label class="block text-xs">Watchlist name<input aria-label="Watchlist name" maxlength="120" bind:value={follow.name} disabled={saving} class="mt-2 w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-850"/></label><p class="text-xs leading-5 text-gray-500">Save an enabled watchlist for this observation’s source on your account.</p><div class="flex gap-2"><button disabled={saving||!follow.name.trim()||view.status!=='live'} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">{saving?'Saving…':'Save watchlist'}</button><button type="button" disabled={saving} on:click={()=>{follow=null;writeError='';}} class="rounded-lg px-3 py-2 text-xs">Cancel</button></div>{#if writeError}<p role="alert" class="text-xs text-amber-700 dark:text-amber-400">{writeError}</p>{/if}</form>{/if}
  </div>
 {/if}
</section>
