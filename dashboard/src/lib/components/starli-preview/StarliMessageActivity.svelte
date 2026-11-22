<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {user} from '$lib/stores';
 import {publicRunBinding} from '$lib/utils/starli-message-activity';
 import {observePublicRun} from '$lib/utils/starli-run-observer';
 import {starliActivity,starliActivityFeed} from '$lib/stores/starli-activity';
 import Spinner from '$lib/components/common/Spinner.svelte';
 export let chatId:string;
 export let assistantMessageId:string;
 export let runMetadata:any=null;
 let observerKey='',stopObserver:(()=>void)|null=null;
 $: if(mounted){const run=publicRunBinding(runMetadata),key=run?[$user?.id,chatId,assistantMessageId,run.runId,['NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED'].includes(run.status)?run.status:'active'].join('|'):'';if(key!==observerKey){stopObserver?.();observerKey=key;stopObserver=null;if(run&&run.conversationId===chatId&&run.assistantMessageId===assistantMessageId&&$user?.id)stopObserver=observePublicRun(run,$user.id);}}
 let now=Date.now(),timer:ReturnType<typeof setInterval>|null=null,mounted=false;
 $: events=$starliActivityFeed.filter(event=>event.chatId===chatId&&event.assistantMessageId===assistantMessageId);
 $: calls=events.filter(event=>!!event.callId).sort((a,b)=>(a.seq??0)-(b.seq??0));
 $: latest=[...events,...Object.values($starliActivity).filter(event=>event.chatId===chatId&&event.assistantMessageId===assistantMessageId)].sort((a,b)=>a.runId===b.runId?(a.seq??0)-(b.seq??0):a.timestamp-b.timestamp).at(-1);
 $: pending=calls.some(call=>['RUNNING','PENDING'].includes(call.status));
 $: active=latest?.phase==='run_state'?latest.running:pending||latest?.running===true;
 $: fresh=!!latest&&now-latest.timestamp<90000;
 $: title=latest?.status==='STOPPING'?'Stopping':latest?.status==='NEEDS_INPUT'?latest.label:latest?.status==='ANSWERED'?'Answer ready':active?(fresh?(calls.some(call=>call.status==='RUNNING')?'Working':'Waiting for the next step'):'Waiting for execution updates'):latest?.status==='FAILED'?'Execution needs attention':latest?.status==='CANCELLED'?'Stopped':latest?.status==='COMPLETED'?'Completed':'Tool activity';
 $: if(mounted&&active&&!timer)timer=setInterval(()=>now=Date.now(),5000);
 $: if(!active&&timer){clearInterval(timer);timer=null;}
 function label(status:string){return ({RUNNING:'Running',PENDING:'Queued',COMPLETED:'Completed',FAILED:'Failed',DENIED:'Permission needed',UNCERTAIN:'Outcome unconfirmed',CANCELLED:'Cancelled',UNKNOWN:'Status unavailable',STOPPING:'Stopping',NEEDS_INPUT:'Input needed',ANSWERED:'Answer ready'} as Record<string,string>)[status]??'Status unavailable';}
 function color(status:string){return status==='COMPLETED'?'text-emerald-600 dark:text-emerald-400':['FAILED','DENIED','UNCERTAIN'].includes(status)?'text-amber-700 dark:text-amber-400':'text-gray-500';}
 onMount(()=>{mounted=true;});onDestroy(()=>{mounted=false;stopObserver?.();if(timer)clearInterval(timer);});
</script>
{#if events.length}
 <details class="mb-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-850" aria-label="Activity for this response">
  <summary class="flex cursor-pointer list-none items-center gap-2"><span class="size-3 shrink-0">{#if active&&fresh}<Spinner/>{:else}<span class="block size-1.5 rounded-full bg-gray-400" aria-hidden="true"/>{/if}</span><span role="status" aria-live="polite">{title}</span><span class="ml-auto text-gray-400">{calls.length} tool {calls.length===1?'step':'steps'}</span></summary>
  {#if !calls.length}<p class="pt-3 text-gray-500">Execution updates will appear here.</p>{/if}
  <ol class="mt-2 max-h-64 space-y-1 overflow-y-auto">{#each calls as call (call.id)}<li><details class="rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"><summary class="flex cursor-pointer list-none items-center justify-between gap-3"><span class="truncate">{call.tool??call.label}</span><span class="shrink-0 {color(call.status)}">{label(call.status)}</span></summary><div class="space-y-2 py-2 text-gray-500"><p>{call.label}</p><p>Updated {new Date(call.timestamp).toLocaleTimeString()}</p>{#if call.paths.length}<div><p>Project files</p>{#each call.paths as path}<p class="break-all font-mono">{path}</p>{/each}</div>{/if}</div></details></li>{/each}</ol>
 </details>
{/if}
