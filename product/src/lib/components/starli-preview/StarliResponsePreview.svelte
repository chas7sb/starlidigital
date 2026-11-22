<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {user,socket,showControls,showArtifacts,showOverview} from '$lib/stores';
 import {selectProject,openProjectPanel} from '$lib/stores/starli-project';
 import {publicRunBinding} from '$lib/utils/starli-message-activity';
 import {previewReceipt,newerPreview,type PreviewReceipt} from '$lib/utils/starli-project-receipt';
 import {activePreviewReceipt,invalidPreviewBuild} from '$lib/stores/starli-project-receipt';
 export let chatId:string;
 export let assistantMessageId:string;
 export let runMetadata:any=null;
 let receipt:PreviewReceipt|null=null,mounted=false,eventSocket:any=null,scope='',owner='',token='';
 $: binding=publicRunBinding(runMetadata);
 $: nextScope=[$user?.id,chatId,assistantMessageId,binding?.runId,binding?.agentId].join('|');
 $: if(nextScope!==scope){scope=nextScope;receipt=null;owner=$user?.id??'';token=typeof localStorage!=='undefined'?localStorage.token??'':'';}
 function current(){return mounted&&!!owner&&$user?.id===owner&&localStorage.token===token&&binding?.conversationId===chatId&&binding?.assistantMessageId===assistantMessageId;}
 function receive(event:any){
  if(!current()||!binding?.agentId)return;
  const next=previewReceipt(event,{chatId,agentId:binding.agentId,runId:binding.runId});
  if(next&&(newerPreview(next,receipt)||($invalidPreviewBuild===next.buildId&&next.explicitShow))){if($invalidPreviewBuild===next.buildId)invalidPreviewBuild.set('');receipt=next;}
 }
 function open(){if(!receipt||!current()||$invalidPreviewBuild===receipt.buildId)return;activePreviewReceipt.set({ownerId:owner,receipt});selectProject(receipt.projectId);if(openProjectPanel('preview')){showArtifacts.set(false);showOverview.set(false);showControls.set(true);}}
 function sessionChanged(event:StorageEvent){if(event.key==='token'||event.key===null){receipt=null;token='';}}
 $: if(mounted&&$socket!==eventSocket){eventSocket?.off('starli-project',receive);eventSocket=$socket;eventSocket?.on('starli-project',receive);}
 onMount(()=>mounted=true);
 onDestroy(()=>{mounted=false;eventSocket?.off('starli-project',receive);});
</script>
<svelte:window on:storage={sessionChanged}/>
{#if receipt && $invalidPreviewBuild!==receipt.buildId}
 <section class="my-3 flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-3 text-sm dark:border-gray-800" aria-label="Verified project preview">
  <div class="min-w-0 flex-1"><p class="truncate font-medium">{receipt.name}</p><p class="mt-1 text-xs text-gray-500">Build verified · Source version {receipt.sourceVersion}</p></div>
  <button class="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800" on:click={open}>Open preview</button>
 </section>
{/if}
