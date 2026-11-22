<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {user} from '$lib/stores';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import {createComputerClient,computerErrorText,ComputerError,desktopSocketURL,type ComputerPort,type ComputerState} from '$lib/utils/starli-computer';
 import {loadComputerDesktop,type ComputerDesktop,type DesktopFactory} from '$lib/utils/starli-computer-desktop';
 export let chatId:string|null=null;
 export let api:ComputerPort|null=null;
 export let desktopLoader:()=>Promise<DesktopFactory>=loadComputerDesktop;
 let mounted=false,seen='',seenApi:ComputerPort|null=null,port:ComputerPort|null=null,controller:AbortController|null=null,epoch=0,actionEpoch=0;
 let snapshot:ComputerState|null=null,error='',busy=false,checking=false,blocked=false;
 let screen:HTMLDivElement,viewer:ComputerDesktop|null=null,viewerEpoch=0,connected=false,wantsView=false,connection='closed',desktopEpoch:number|null=null,humanEpoch:number|null=null,retry=0;
 let poll:ReturnType<typeof setInterval>,renew:ReturnType<typeof setInterval>,reconnect:ReturnType<typeof setTimeout>|null=null;
 function current(e:number){return mounted&&e===epoch&&!controller?.signal.aborted&&!blocked;}
 function noInput(){humanEpoch=null;viewer?.control(false);}
 function closeViewer(){viewerEpoch++;noInput();viewer?.disconnect();viewer=null;connected=false;desktopEpoch=null;if(reconnect)clearTimeout(reconnect);reconnect=null;}
 function unavailable(e:unknown){noInput();error=computerErrorText(e);}
 async function refresh(){
  if(!port||!chatId||busy||checking||blocked)return;const e=epoch,a=actionEpoch,context=chatId,service=port,signal=controller!.signal;checking=true;
  try{const next=await service.status(context,signal);if(!current(e)||a!==actionEpoch||service!==port||context!==chatId)return;snapshot=next;error='';
   if(connected&&(next.controlEpoch!==desktopEpoch||!next.desktopReady)){closeViewer();if(wantsView)scheduleReconnect(e);}
   if(next.controlOwner!=='human')noInput();
  }catch(cause){if(current(e)&&a===actionEpoch){snapshot=null;closeViewer();unavailable(cause);}}
  finally{if(current(e))checking=false;}
 }
 function scheduleReconnect(e:number){if(!current(e)||!wantsView||reconnect||retry>=4)return;connection='reconnecting';reconnect=setTimeout(()=>{reconnect=null;if(current(e)&&wantsView)void openDesktop(true);},Math.min(1000*2**retry++,15000));}
 async function openDesktop(automatic=false){
  if(!port||!chatId||busy||connection==='connecting'||blocked||!snapshot?.desktopReady||!snapshot.allowedActions.includes('openDesktop'))return;
  if(!automatic){wantsView=true;retry=0;}const e=epoch,context=chatId,service=port,signal=controller!.signal;closeViewer();const v=viewerEpoch;connection=automatic?'reconnecting':'connecting';error='';
  try{const factory=await desktopLoader();if(!current(e)||v!==viewerEpoch)return;const d=await service.open(context,signal);if(!current(e)||v!==viewerEpoch||service!==port||context!==chatId)return;desktopEpoch=d.epoch;
   viewer=factory(screen,desktopSocketURL(window.location.origin),{
    connected:()=>{if(current(e)&&v===viewerEpoch){connected=true;connection='connected';retry=0;noInput();}},
    disconnected:()=>{if(current(e)&&v===viewerEpoch){closeViewer();connection='disconnected';scheduleReconnect(e);}},
    error:()=>{if(current(e)&&v===viewerEpoch){wantsView=false;closeViewer();connection='unavailable';error='The secure desktop connection could not be confirmed.';}}
   });
  }catch(cause){if(current(e)&&v===viewerEpoch){closeViewer();connection='unavailable';unavailable(cause);if(!(cause instanceof ComputerError&&[401,403,404].includes(cause.status)))scheduleReconnect(e);}}
 }
 async function operate(action:'ensure'|'start'){
  if(!port||!chatId||busy||blocked||!snapshot?.allowedActions.includes(action))return;const e=epoch,context=chatId;busy=true;actionEpoch++;error='';
  try{const d=await port.operate(action,context,crypto.randomUUID(),controller!.signal);if(current(e)&&context===chatId)snapshot=d;}
  catch(cause){if(current(e))unavailable(cause);}finally{if(current(e)){busy=false;void refresh();}}
 }
 async function control(action:'takeover'|'handback'|'renew'){
  if(!port||busy||!connected||desktopEpoch===null||blocked||action==='renew'&&humanEpoch!==desktopEpoch)return;
  const e=epoch,v=viewerEpoch,expected=desktopEpoch;busy=true;actionEpoch++;error='';noInput();
  try{const d=await port.control(action,expected,crypto.randomUUID(),controller!.signal);if(!current(e)||v!==viewerEpoch)return;desktopEpoch=d.epoch;
   if(action!=='handback'&&d.state==='You are controlling'){humanEpoch=d.epoch;viewer?.control(true);}else noInput();
   if(snapshot)snapshot={...snapshot,controlEpoch:d.epoch,controlOwner:action==='handback'?'waiting':'human'};
  }catch(cause){if(current(e)){wantsView=false;closeViewer();connection='disconnected';unavailable(cause);}}
  finally{if(current(e)){busy=false;void refresh();}}
 }
 function reset(){
  epoch++;actionEpoch++;controller?.abort();wantsView=false;closeViewer();snapshot=null;error='';busy=false;checking=false;blocked=false;connection='closed';retry=0;
  controller=new AbortController();port=api??createComputerClient(()=>({ownerId:$user?.id??'',token:typeof localStorage!=='undefined'?localStorage.token??'':''}));if(chatId&&$user?.id)void refresh();
 }
 function sessionChanged(event:StorageEvent){if(event.key==='token'||event.key===null){epoch++;controller?.abort();blocked=true;wantsView=false;closeViewer();snapshot=null;busy=false;checking=false;error='Your account session changed. Reopen Computer to continue.';}}
 $: scope=($user?.id??'')+'|'+(chatId??'');
 $: if(mounted&&(scope!==seen||api!==seenApi)){seen=scope;seenApi=api;reset();}
 $: takingControl=connected&&humanEpoch!==null&&humanEpoch===desktopEpoch;
 $: stateLabel=takingControl?'You are controlling':connection==='connecting'?'Connecting to desktop':connection==='reconnecting'?'Reconnecting':connected?(snapshot?.controlOwner==='agent'?'Starli is controlling':'View only'):snapshot?.observedState??'Not connected';
 onMount(()=>{mounted=true;window.addEventListener('storage',sessionChanged);poll=setInterval(()=>{if(!document.hidden)void refresh();},3000);renew=setInterval(()=>{if(takingControl&&!document.hidden)void control('renew');},10000);});
 onDestroy(()=>{mounted=false;epoch++;controller?.abort();wantsView=false;closeViewer();clearInterval(poll);clearInterval(renew);window.removeEventListener('storage',sessionChanged);});
</script>
<section class="flex h-full min-h-[65vh] flex-col" aria-label="Starli Computer">
 <div class="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 text-xs dark:border-gray-800">
  <span role="status" class="mr-auto text-gray-500">{checking&&!snapshot?'Checking computer…':stateLabel}</span>
  <span class="text-gray-500">{snapshot?.memoryVerified?'1 GB memory':'1 GB limit'}</span>
  <button disabled={busy||checking||blocked||!chatId} class="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" on:click={refresh}>Refresh</button>
 </div>
 {#if !chatId}<p class="p-4 text-sm text-gray-500">Open a Starli conversation to use its computer.</p>
 {:else}
  {#if error}<p role="alert" class="px-4 py-3 text-xs text-amber-700 dark:text-amber-400">{error}</p>{/if}
  <div class="flex flex-wrap gap-2 px-4 py-3 text-xs">
   {#if snapshot?.allowedActions.includes('ensure')}<button disabled={busy||blocked} class="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-40 dark:bg-gray-800" on:click={()=>operate('ensure')}>Connect computer</button>{/if}
   {#if snapshot?.allowedActions.includes('start')}<button disabled={busy||blocked} class="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-40 dark:bg-gray-800" on:click={()=>operate('start')}>Start computer</button>{/if}
   {#if !connected}<button disabled={busy||connection==='connecting'||blocked||!snapshot?.desktopReady||!snapshot?.allowedActions.includes('openDesktop')} class="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-40 dark:bg-gray-800" on:click={()=>openDesktop()}>{connection==='closed'?'Open desktop':'Reconnect'}</button>
   {:else}<button disabled={busy||blocked} class="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-40 dark:bg-gray-800" on:click={()=>control(takingControl?'handback':'takeover')}>{takingControl?'Return control to Starli':'Take control'}</button><button class="rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>{wantsView=false;closeViewer();connection='closed';}}>Stop viewing</button>{/if}
  </div>
  {#if connected&&!takingControl&&snapshot?.controlOwner==='waiting'}<p class="px-4 pb-3 text-xs text-gray-500">Ask Starli in this chat when you want it to continue.</p>{/if}
  <div class="relative min-h-80 flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950"><div class="absolute inset-0" bind:this={screen} aria-label="Computer desktop"/>{#if !connected}<div class="absolute inset-0 flex items-center justify-center gap-2 p-5 text-center text-sm text-gray-500">{#if connection==='connecting'||connection==='reconnecting'}<Spinner/><span>{connection==='connecting'?'Connecting to desktop…':'Reconnecting in view-only mode…'}</span>{:else}<span>{snapshot?.desktopReady?'Open the desktop to see this Starli’s computer.':'The desktop is not ready yet.'}</span>{/if}</div>{/if}</div>
 {/if}
</section>
