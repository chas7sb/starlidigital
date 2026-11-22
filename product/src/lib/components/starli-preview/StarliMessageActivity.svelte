<script lang="ts">
 import StarliResponsePreview from './StarliResponsePreview.svelte';
 import {onMount,onDestroy} from 'svelte';
 import {canStopRun,runElapsed} from '$lib/utils/starli-run-view';
 import {cancelPublicRun} from '$lib/utils/starli-run-cancel';
 import {user} from '$lib/stores';
 import {publicRunBinding} from '$lib/utils/starli-message-activity';
 import {observePublicRun} from '$lib/utils/starli-run-observer';
 import {starliActivity,starliActivityFeed,starliRunConnections,starliAgents,activityStatus,starliRunDetails} from '$lib/stores/starli-activity';
 import Spinner from '$lib/components/common/Spinner.svelte';
 export let chatId:string;
 export let assistantMessageId:string;
 export let runMetadata:any=null;
 let cancelBusy=false,cancelError='',cancelController:AbortController|null=null;
 async function stop(){if(cancelBusy||!canStopRun(runMetadata,chatId,assistantMessageId)||!$user?.id)return;const owner=$user.id,token=localStorage.token,run=publicRunBinding(runMetadata),scope=chatId;cancelController?.abort();cancelController=new AbortController();cancelBusy=true;cancelError='';const current=()=>mounted&&$user?.id===owner&&localStorage.token===token&&chatId===scope&&runMetadata?.runId===run?.runId;try{await cancelPublicRun(runMetadata,owner,token,current,cancelController.signal);}catch(error){if(current())cancelError=error instanceof Error?error.message:'Stop could not be confirmed';}finally{if(current())cancelBusy=false;}}
 let observerKey='',stopObserver:(()=>void)|null=null;
 $: if(mounted){const run=publicRunBinding(runMetadata),key=run?[$user?.id,chatId,assistantMessageId,run.runId,['NEEDS_INPUT','WAITING_INPUT','BUDGET_EXHAUSTED'].includes(run.status)?run.status:'active'].join('|'):'';if(key!==observerKey){cancelController?.abort();cancelBusy=false;cancelError='';stopObserver?.();observerKey=key;stopObserver=null;if(run&&run.conversationId===chatId&&run.assistantMessageId===assistantMessageId&&$user?.id)stopObserver=observePublicRun(run,$user.id,(verified)=>{if(runMetadata?.runId===verified.runId&&runMetadata?.requestId===verified.requestId&&(runMetadata.lastSeq??0)<=verified.lastSeq){Object.assign(runMetadata,verified,{bindingPending:false});runMetadata=runMetadata;}});}}
 let now=Date.now(),timer:ReturnType<typeof setInterval>|null=null,mounted=false;
 $: events=$starliActivityFeed.filter(event=>event.chatId===chatId&&event.assistantMessageId===assistantMessageId);
 $: calls=events.filter(event=>!!event.callId).sort((a,b)=>(a.seq??0)-(b.seq??0));
 $: latest=[...events,...Object.values($starliActivity).filter(event=>event.chatId===chatId&&event.assistantMessageId===assistantMessageId)].filter(event=>!runMetadata?.runId||event.runId===runMetadata.runId).sort((a,b)=>a.runId===b.runId?(a.seq??0)-(b.seq??0):a.timestamp-b.timestamp).at(-1);
 $: delegates=events.filter(event=>event.phase==='run_state'&&event.runId!==runMetadata?.runId);
 $: pending=calls.some(call=>['RUNNING','PENDING'].includes(call.status));
 $: runStatus=latest?.phase==='run_state'?latest.status:runMetadata?activityStatus(runMetadata.status):'UNKNOWN';
 $: active=runStatus!=='UNKNOWN'?['RUNNING','PENDING','STOPPING'].includes(runStatus):pending||latest?.running===true;
 $: stoppable=canStopRun(runMetadata,chatId,assistantMessageId);
 $: detail=runMetadata?.runId?$starliRunDetails[runMetadata.runId]:undefined;
 $: elapsed=runElapsed(detail?.createdAt,active||stoppable?now:latest?.timestamp??now);
 $: fresh=!!latest&&now-latest.timestamp<90000;
 $: connection=(runMetadata?.runId??latest?.runId)?$starliRunConnections[runMetadata?.runId??latest.runId]:undefined;
 $: title=connection==='connecting'?'Connecting to live run':connection==='reconnecting'?'Reconnecting':connection==='unavailable'?'Live status unavailable':runMetadata?.bindingPending===true?'Checking run status':runStatus==='STOPPING'?'Stopping':runStatus==='NEEDS_INPUT'?(latest?.label??'Waiting for your input'):runStatus==='ANSWERED'?'Answer ready':active?(fresh?(calls.some(call=>call.status==='RUNNING')?'Working':'Waiting for the next step'):'Waiting for execution updates'):runStatus==='FAILED'?'Execution needs attention':runStatus==='CANCELLED'?'Stopped':runStatus==='COMPLETED'?'Completed':'Tool activity';
 $: if(mounted&&(active||stoppable)&&!timer)timer=setInterval(()=>now=Date.now(),5000);
 $: if(!active&&!stoppable&&timer){clearInterval(timer);timer=null;}
 function label(status:string){return ({RUNNING:'Running',PENDING:'Queued',COMPLETED:'Completed',EMPTY:'No results',RATE_LIMITED:'Rate limited',FAILED:'Failed',DENIED:'Permission needed',UNCERTAIN:'Outcome unconfirmed',CANCELLED:'Cancelled',UNKNOWN:'Status unavailable',STOPPING:'Stopping',NEEDS_INPUT:'Input needed',ANSWERED:'Answer ready'} as Record<string,string>)[status]??'Status unavailable';}
 function color(status:string){return status==='COMPLETED'?'text-emerald-600 dark:text-emerald-400':['RATE_LIMITED','FAILED','DENIED','UNCERTAIN'].includes(status)?'text-amber-700 dark:text-amber-400':'text-gray-500';}
 onMount(()=>{mounted=true;});onDestroy(()=>{mounted=false;cancelController?.abort();stopObserver?.();if(timer)clearInterval(timer);});
</script>
{#if events.length||publicRunBinding(runMetadata)}
 <section class="mb-3 space-y-2 text-xs" aria-label="Execution steps for this response">
  {#if runMetadata?.readOnlyPreview===true}<p class="text-gray-500">Runtime preview · read-only</p>{/if}
  <div class="flex items-center gap-2 text-gray-500"><span class="size-3 shrink-0">{#if active&&fresh&&connection!=='reconnecting'&&connection!=='unavailable'}<Spinner/>{:else}<span class="block size-1.5 rounded-full bg-gray-400" aria-hidden="true"/>{/if}</span><span role="status" aria-live="polite">{title}</span>{#if elapsed}<span class="text-gray-400">Elapsed {elapsed}</span>{/if}<span class="ml-auto text-gray-400">{calls.length} tool {calls.length===1?'step':'steps'}</span>{#if stoppable}<button type="button" class="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800" disabled={cancelBusy||runStatus==='STOPPING'} on:click={stop}>{cancelBusy||runStatus==='STOPPING'?'Stopping…':'Stop'}</button>{/if}</div>
  {#if cancelError}<p role="status" class="text-amber-700 dark:text-amber-400">{cancelError}</p>{/if}
  {#if !calls.length}<p class="pt-3 text-gray-500">Execution updates will appear here.</p>{/if}
  {#if delegates.length}<ul class="space-y-1 text-gray-500" aria-label="Delegated agent progress">{#each delegates as event (event.id)}<li class="flex items-center justify-between gap-3"><span class="truncate">{$starliAgents[event.agentId]?.name??'Starli'}</span><span>{event.label}</span></li>{/each}</ul>{/if}
  <ol class="mt-2 max-h-64 space-y-1 overflow-y-auto">{#each calls as call (call.id)}{@const actor=$starliAgents[call.agentId]}<li><details class="rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"><summary class="flex cursor-pointer list-none items-center justify-between gap-3"><span class="truncate">{call.tool??call.label}</span><span class="shrink-0 {color(call.status)}">{label(call.status)}</span></summary><div class="space-y-2 py-2 text-gray-500"><p>{call.label}</p>{#if actor?.name}<p>{actor.name}</p>{/if}<p>Updated {new Date(call.timestamp).toLocaleTimeString()}</p>{#if call.paths.length}<div><p>Project files</p>{#each call.paths as path}<p class="break-all font-mono">{path}</p>{/each}</div>{/if}</div></details></li>{/each}</ol>
 </section>
{/if}
<StarliResponsePreview {chatId} {assistantMessageId} {runMetadata}/>
