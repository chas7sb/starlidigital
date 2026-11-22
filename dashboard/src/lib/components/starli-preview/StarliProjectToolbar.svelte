<script lang="ts">
 import {verifyBrowserIdentity} from '$lib/utils/starli-browser-session';
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 import {get} from 'svelte/store';
 import {activeProject,projectPanel,workspaceTab,activateConversation,selectProject,openProjectPanel,dismissPreview,requestProjectPreview} from '$lib/stores/starli-project';
 import {showControls,showArtifacts,showOverview,user,socket} from '$lib/stores';
 import Tooltip from '$lib/components/common/Tooltip.svelte';
 import Folder from '$lib/components/icons/FolderOpen.svelte';
 export let chatId:string|null=null;
 const dispatch=createEventDispatcher();
 let projects:any[]=[],error='',timer:ReturnType<typeof setInterval>,mounted=false,seen='',eventSocket:any=null,requestEpoch=0;
 function syncPane(open:boolean){if(open){showArtifacts.set(false);showOverview.set(false);showControls.set(true);}else showControls.set(false);}
 async function load(){
  const owner=$user?.id,epoch=++requestEpoch,token=localStorage.token??'';if(!owner||!token)return;
  try{await verifyBrowserIdentity(token,owner,new AbortController().signal);if(epoch!==requestEpoch||token!==localStorage.token||owner!==$user?.id)return;const params=chatId?'?chatId='+encodeURIComponent(chatId):'';const r=await fetch('/api/v1/starli/workspace/projects'+params,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Projects unavailable');const d=await r.json();if(epoch!==requestEpoch||owner!==$user?.id||token!==localStorage.token)return;projects=d.items??[];error='';}
  catch(e){if(epoch===requestEpoch)error=String((e as Error).message);}
 }
 function open(tab='preview'){if(openProjectPanel(tab))syncPane(true);void load();}
 function select(){selectProject($activeProject,{open:!!$activeProject});dispatch('select',{projectId:$activeProject});syncPane(get(projectPanel));}
 function projectEvent(event:any){
  const opened=requestProjectPreview(event);
  if(event?.chatId===chatId&&event?.projectId){dispatch('select',{projectId:get(activeProject)});if(opened)syncPane(true);void load();}
 }
 $: if(mounted&&($user?.id??'')+'|'+(chatId??'')!==seen){
  seen=($user?.id??'')+'|'+(chatId??'');requestEpoch++;projects=[];error='';
  const wasOpen=get(projectPanel);activateConversation(chatId,$user?.id);
  if(get(projectPanel))syncPane(true);else if(wasOpen)syncPane(false);
  dispatch('select',{projectId:get(activeProject)});void load();
 }
 $: if(mounted&&$socket!==eventSocket){eventSocket?.off('starli-project',projectEvent);eventSocket=$socket;eventSocket?.on('starli-project',projectEvent);}
 function accountChanged(event:StorageEvent){if(event.key==='token'||event.key===null){requestEpoch++;projects=[];error='Your account session changed. Refresh to continue.';activeProject.set('');projectPanel.set(false);showControls.set(false);}}
 onMount(()=>{mounted=true;window.addEventListener('storage',accountChanged);timer=setInterval(()=>{if(!document.hidden)void load();},6000);});
 onDestroy(()=>{requestEpoch++;clearInterval(timer);window.removeEventListener('storage',accountChanged);eventSocket?.off('starli-project',projectEvent);});
</script>
<div class="relative z-10 flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap px-4 pb-2 text-xs text-gray-500">
 <Folder className="size-4"/>
 <select class="max-w-64 shrink-0 truncate rounded-lg bg-transparent py-1 text-xs focus:outline-none dark:bg-gray-900" aria-label="Current customer project" bind:value={$activeProject} on:change={select}>
  <option value="">Customer workspace</option>{#each projects as project}<option value={project.id}>{project.name}</option>{/each}
 </select>
 <Tooltip content={$activeProject?'Preview and edit the actual project files':'Ask Starli to create a project first'}><button disabled={!$activeProject} class="shrink-0 rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" on:click={()=>open('preview')}>Preview</button></Tooltip>
 {#each ['crm','mail','social','intelligence'] as tab}<button class="shrink-0 rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>open(tab)}>{tab==='crm'?'CRM':tab[0].toUpperCase()+tab.slice(1)}</button>{/each}
 <span class="hidden truncate lg:block">{error||'Projects · CRM · Mail · Social — ask Starli in chat'}</span>
</div>
