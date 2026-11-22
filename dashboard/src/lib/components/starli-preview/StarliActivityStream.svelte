<script lang="ts">
 import {user,socket} from '$lib/stores';
 import {verifyBrowserIdentity} from '$lib/utils/starli-browser-session';
 import {onMount,onDestroy} from 'svelte';
 import {starliAgents,starliActivity,starliActivityFeed,agentColor,receiveStarliActivity} from '$lib/stores/starli-activity';
 import StarliAvatar from './StarliAvatar.svelte';
 import Spinner from '$lib/components/common/Spinner.svelte';
 export let chatId:string|null=null;
 let now=Date.now(),seen='',mounted=false,hasMore=false,before:number|null=null,beforeId='',loading=false,error='',epoch=0,initialized=false;
 let controller:AbortController|null=null;
 async function load(older=false){
  if(!chatId||loading)return;
  const current=chatId,requestEpoch=epoch,account=$user?.id,token=localStorage.token??'';if(!account||!token)return;
  controller?.abort();controller=new AbortController();loading=true;error='';
  const params=new URLSearchParams();
  if(older&&before!==null){params.set('before',String(before));if(beforeId)params.set('before_id',beforeId);}
  try{
   await verifyBrowserIdentity(token,account,controller.signal);
   const r=await fetch('/api/v1/starli/workspace/chats/'+encodeURIComponent(current)+'/activity'+(params.size?'?'+params:''),{headers:{Authorization:'Bearer '+token},signal:controller.signal});
   if(!r.ok)throw Error('Activity history is temporarily unavailable ('+r.status+').');
   const d=await r.json();if(current!==chatId||requestEpoch!==epoch||account!==$user?.id||token!==localStorage.token)return;
   for(const event of d.events??[])receiveStarliActivity(event);
   if(older||!initialized){hasMore=d.hasMore===true;before=typeof d.before==='number'?d.before:before;beforeId=typeof d.beforeId==='string'?d.beforeId:beforeId;initialized=true;}
  }catch(e){if(requestEpoch===epoch&&current===chatId&&(e as Error).name!=='AbortError')error=(e as Error).message;}
  finally{if(requestEpoch===epoch)loading=false;}
 }
 $: if(mounted&&(($user?.id??'')+'|'+(chatId??''))!==seen){controller?.abort();epoch++;seen=($user?.id??'')+'|'+(chatId??'');before=null;beforeId='';initialized=false;hasMore=false;loading=false;error='';void load();}
 let eventSocket:any=null;const reconnect=()=>{void load();};
 $: if(mounted&&$socket!==eventSocket){eventSocket?.off('connect',reconnect);eventSocket=$socket;eventSocket?.on('connect',reconnect);}
 onMount(()=>{mounted=true;const timer=setInterval(()=>now=Date.now(),5000);return()=>clearInterval(timer);});
 onDestroy(()=>{epoch++;controller?.abort();eventSocket?.off('connect',reconnect);});
 $: events=$starliActivityFeed.filter(event=>event.chatId===chatId&&!event.assistantMessageId).sort((a,b)=>a.timestamp-b.timestamp);
 $: latestRecorded=events[events.length-1];
 $: currentActivity=Object.values($starliActivity).filter(event=>event.chatId===chatId&&!event.assistantMessageId).sort((a,b)=>a.timestamp-b.timestamp).at(-1);
 $: latest=currentActivity&&(!latestRecorded||currentActivity.timestamp>=latestRecorded.timestamp)?currentActivity:latestRecorded;
 $: agent=latest?($starliAgents[latest.agentId]??{id:latest.agentId,name:'Starli'}):null;
 $: live=latest?.running&&now-latest.timestamp<90000;
 $: headerLabel=latest?.phase==='working'&&!live?'Waiting for execution updates':latest?.label;
 function statusClass(value:string){return ['FAILED','DENIED','UNCERTAIN'].includes(value)?'text-amber-700 dark:text-amber-400':value==='COMPLETED'?'text-emerald-700 dark:text-emerald-400':'text-gray-500 dark:text-gray-400';}
</script>
{#if latest&&agent}
 <div class="mx-auto w-full max-w-3xl px-4 pb-2">
  <details class="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900">
   <summary class="flex cursor-pointer list-none items-center gap-2 text-gray-600 dark:text-gray-300">
    <StarliAvatar {agent} size={22}/>
    <span class="font-medium">{agent.name}</span>
    <span class="min-w-0 flex-1 truncate {latest.failed?'text-amber-700 dark:text-amber-400':''}">{headerLabel}</span>
    {#if live}<span class="size-3 shrink-0" aria-label="Task running"><Spinner/></span>{/if}
    <span class="text-gray-400">Activity</span>
   </summary>
   <div class="mt-3 flex items-center justify-between gap-3 text-gray-500"><span>Tool calls and execution status</span><span>{events.length} events</span></div>
   {#if hasMore}<button disabled={loading} class="mt-3 rounded-lg px-2 py-1 text-xs text-gray-500 underline disabled:opacity-50" on:click={()=>load(true)}>{loading?'Loading…':'Load earlier activity'}</button>{/if}
   {#if error}<p class="mt-2 text-amber-700 dark:text-amber-400" role="status">{error}<button class="ml-2 underline" on:click={()=>load()}>Retry</button></p>{/if}
   {#if events.length===0}<p class="mt-3 text-gray-500">No tool calls recorded yet.</p>{/if}
   <ol class="ml-3 mt-3 max-h-72 space-y-2 overflow-y-auto border-l border-gray-100 pl-4 dark:border-gray-800">
    {#each events as event (event.id)}
     {@const actor=$starliAgents[event.agentId]}
     <li class="relative">
      <span class="absolute -left-[19px] top-2 h-1.5 w-1.5 rounded-full" style:background-color={agentColor(event.agentId,actor?.avatarColor)} aria-hidden="true"/>
      <details>
       <summary class="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg py-1 hover:bg-gray-50 dark:hover:bg-gray-850">
        <span class="min-w-0"><span class="font-medium">{actor?.name??'Starli'}</span><span class="ml-2 {statusClass(event.status)}">{event.label}</span></span>
        <time class="shrink-0 text-gray-400" datetime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>
       </summary>
       <dl class="mb-2 ml-1 space-y-1 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-850">
        <div class="flex gap-2"><dt class="w-12 shrink-0 text-gray-500">Status</dt><dd class={statusClass(event.status)}>{event.status==='UNKNOWN'?'Finished':event.status[0]+event.status.slice(1).toLowerCase()}</dd></div>
        {#if event.tool}<div class="flex gap-2"><dt class="w-12 shrink-0 text-gray-500">Tool</dt><dd class="min-w-0 break-all font-mono">{event.tool}</dd></div>{/if}
        {#if event.paths.length}<div class="flex gap-2"><dt class="w-12 shrink-0 text-gray-500">Files</dt><dd class="min-w-0 space-y-1 break-all font-mono">{#each event.paths as path}<div>{path}</div>{/each}</dd></div>{/if}
       </dl>
      </details>
     </li>
    {/each}
   </ol>
  </details>
 </div>
{:else if chatId&&error}
 <div class="mx-auto w-full max-w-3xl px-4 pb-2 text-xs text-gray-500" role="status">{error}<button class="ml-2 underline" on:click={()=>load()}>Retry activity</button></div>
{/if}
