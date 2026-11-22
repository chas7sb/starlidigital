<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {activeProject,projectPanel,workspaceTab,dismissPreview} from '$lib/stores/starli-project';
 import {activePreviewReceipt,invalidPreviewBuild} from '$lib/stores/starli-project-receipt';
 import {verifiedPreviewHtml} from '$lib/utils/starli-project-receipt';
 import {verifyBrowserIdentity} from '$lib/utils/starli-browser-session';
 import {showControls,user,socket} from '$lib/stores';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import CodeEditor from '$lib/components/common/CodeEditor.svelte';
 import Tooltip from '$lib/components/common/Tooltip.svelte';
 import StarliSocialPanel from './StarliSocialPanel.svelte';
 import StarliMailboxPanel from './StarliMailboxPanel.svelte';
 import StarliCRMPanel from './StarliCRMPanel.svelte';
 import StarliComputerPanel from './StarliComputerPanel.svelte';
 import StarliIntelligencePanel from './StarliIntelligencePanel.svelte';
 import XMark from '$lib/components/icons/XMark.svelte';
 export let chatId:string|null=null;
 let projects:any[]=[],project:any=null,preview:any=null,error='',busy=false,tab='preview',path='',content='',sha='',dirty=false,epoch=0,snapshotEpoch=0;
 let identity:{key:string;promise:Promise<void>}|null=null;

 async function api(url:string,options:any={}){
  const context=chatId,selected=$activeProject,owner=$user?.id,token=localStorage.token??'';
  if(!owner||!token)throw Error('Sign in to open your projects.');
  const key=owner+'|'+token;
  if(identity?.key!==key)identity={key,promise:verifyBrowserIdentity(token,owner,new AbortController().signal)};
  const verification=identity;try{await verification.promise;}catch{if(identity===verification)identity=null;throw Error('Your account session could not be confirmed. Refresh to continue.');}
  if(context!==chatId||selected!==$activeProject||owner!==$user?.id||token!==localStorage.token)throw Error('Your account session changed. Refresh to continue.');
  const r=await fetch('/api/v1/starli/workspace'+url+(context?(url.includes('?')?'&':'?')+'chatId='+encodeURIComponent(context):''),{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  if(!r.headers.get('content-type')?.includes('json'))throw Error('The project service is unavailable.');
  const d=await r.json().catch(()=>({}));
  if(context!==chatId||selected!==$activeProject||owner!==$user?.id||token!==localStorage.token)throw Error('Your account session changed. Refresh to continue.');
  if(!r.ok){
   if([401,403,404].includes(r.status)&&context===chatId&&selected===$activeProject&&owner===$user?.id){
    project=null;preview=null;path='';content='';sha='';dirty=false;epoch++;
    activeProject.set('');projectPanel.set(false);showControls.set(false);
   }
   throw Error(typeof d.detail==='string'?d.detail:'Project request failed ('+r.status+')');
  }
  return d;
 }
 async function load(){if(!$activeProject||['intelligence','computer'].includes(tab))return;const e=epoch,request=++snapshotEpoch,expected=$activePreviewReceipt;preview=null;try{const [p,v]=await Promise.all([api('/projects/'+encodeURIComponent($activeProject)),api('/projects/'+encodeURIComponent($activeProject)+'/preview')]);if(e!==epoch||request!==snapshotEpoch||expected!==$activePreviewReceipt)return;if(expected){if($invalidPreviewBuild===expected.receipt.buildId)throw Error('Wait for a new verified build before reopening this preview.');if(expected.ownerId!==$user?.id||expected.receipt.chatId!==chatId||expected.receipt.projectId!==$activeProject)throw Error('Preview scope changed. Reopen the project.');verifiedPreviewHtml(v,expected.receipt);}project=p;preview=v;error='';}catch(cause){if(e===epoch&&request===snapshotEpoch){preview=null;if(expected)invalidPreviewBuild.set(expected.receipt.buildId);error=String((cause as Error).message);}}}
 async function file(value:string){if(busy)return;if(dirty&&!confirm('Discard unsaved file changes?'))return;const e=epoch;busy=true;try{const f=await api('/projects/'+encodeURIComponent($activeProject)+'/file?'+new URLSearchParams({path:value}));if(e!==epoch)return;path=value;content=f.content;sha=f.sha256;dirty=false;}catch(errorValue){if(e===epoch)error=String((errorValue as Error).message);}finally{if(e===epoch)busy=false;}}
 function askBuild(){window.dispatchEvent(new CustomEvent("starli-compose",{detail:{prompt:"Build and check the current project "+$activeProject+", fix any compilation errors, and update its live preview."}}));}
 async function save(){if(busy||!path||!dirty)return;const e=epoch;busy=true;try{const d=await api('/projects/'+encodeURIComponent($activeProject)+'/file',{method:'PUT',body:JSON.stringify({path,content,expectedSha256:sha})});if(e!==epoch)return;sha=d.sha256;dirty=false;busy=false;await load();}catch(errorValue){if(e===epoch)error=String((errorValue as Error).message);}finally{if(e===epoch)busy=false;}}
 $: tab=$workspaceTab;
 let viewport='desktop',previewRevision=0;
 let mounted=false,seen='',eventSocket:any=null,seenTab='';
 function projectEvent(event:any){if(event?.chatId===chatId&&event?.projectId===$activeProject&&!dirty)void load();}
 function visible(){if(!document.hidden&&!dirty)void load();}
 function reconnect(){epoch++;snapshotEpoch++;preview=null;if(!dirty)void load();}
 function accountChanged(event:StorageEvent){if(event.key!=='token'&&event.key!==null)return;epoch++;snapshotEpoch++;identity=null;project=null;preview=null;path='';content='';sha='';dirty=false;busy=false;activeProject.set('');error='Your account session changed. Refresh to continue.';}
 $: if(mounted&&$socket!==eventSocket){eventSocket?.off('starli-project',projectEvent);eventSocket?.off('connect',reconnect);eventSocket=$socket;eventSocket?.on('starli-project',projectEvent);eventSocket?.on('connect',reconnect);if(eventSocket?.connected)reconnect();}
 $: if(mounted&&tab!==seenTab){seenTab=tab;if(!['intelligence','computer'].includes(tab)&&!dirty)void load();}
 onMount(()=>{mounted=true;document.addEventListener('visibilitychange',visible);window.addEventListener('storage',accountChanged);});
 onDestroy(()=>{epoch++;eventSocket?.off('starli-project',projectEvent);eventSocket?.off('connect',reconnect);document.removeEventListener('visibilitychange',visible);window.removeEventListener('storage',accountChanged);});
 let seenExpectation:any=null;
 $: if(mounted&&$activePreviewReceipt!==seenExpectation){seenExpectation=$activePreviewReceipt;snapshotEpoch++;preview=null;if(!dirty)void load();else error='A new build is available. Save or discard your file changes before refreshing.';}
 $: contextKey=(chatId??'')+'|'+($user?.id??'')+'|'+$activeProject;
 $: if(mounted&&contextKey!==seen){seen=contextKey;epoch++;snapshotEpoch++;identity=null;project=null;preview=null;path='';content='';sha='';dirty=false;busy=false;void load();}
</script>
<section class="flex h-full min-h-[65vh] flex-col bg-white dark:bg-gray-900" aria-label={tab==='computer'?'Starli Computer':tab==='intelligence'?'Intelligence context':'Project workspace'}>
 <header class="flex items-center justify-between gap-2 border-b border-gray-100 p-3 dark:border-gray-800">
  <div class="min-w-0"><h2 class="truncate text-sm font-medium">{tab==='computer'?'Computer':tab==='intelligence'?'Intelligence':project?.name??'Project preview'}</h2><p class="text-xs text-gray-500">{tab==='computer'?'Computer for this conversation':tab==='intelligence'?'Context for this conversation':project?.status??'Select a project in chat'}</p></div>
  <Tooltip content="Close preview"><button class="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>{dismissPreview();showControls.set(false);}} aria-label="Close preview"><XMark className="size-4"/></button></Tooltip>
 </header>
 {#if !['intelligence','computer'].includes(tab)}<nav class="flex gap-1 border-b border-gray-100 px-3 py-2 dark:border-gray-800" aria-label="Project view">
  {#each ['preview','files','history'] as value}<button class="rounded-lg px-3 py-1.5 text-xs {tab===value?'bg-gray-100 dark:bg-gray-800':'text-gray-500'}" on:click={()=>workspaceTab.set(value)}>{value[0].toUpperCase()+value.slice(1)}</button>{/each}
  <button class="ml-auto px-2 text-xs text-gray-500" on:click={load}>Refresh</button>
 </nav>{/if}
 {#if error&&tab!=='computer'}<p role="alert" class="px-4 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
 {#if tab==='computer'}<StarliComputerPanel {chatId}/>
 {:else if tab==='intelligence'}<StarliIntelligencePanel {chatId}/>
 {:else if tab==='social'}<div class="flex-1 overflow-auto"><StarliSocialPanel compact/></div>
 {:else if tab==='mail'}<div class="flex-1 overflow-auto"><StarliMailboxPanel/></div>
 {:else if tab==='crm'}<div class="flex-1 overflow-auto"><StarliCRMPanel/></div>
 {:else if !$activeProject}<p class="p-5 text-sm text-gray-500">Ask Starli to create a project, then select it in the chat toolbar.</p>
 {:else if !project}<div class="p-5"><Spinner/></div>
 {:else if tab==='preview'}
  {#if preview?.available}
   <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2 text-xs dark:border-gray-800"><label for="preview-viewport">Viewport</label><select id="preview-viewport" bind:value={viewport} class="rounded-lg bg-gray-50 px-2 py-1 dark:bg-gray-800"><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select><button class="ml-auto rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>previewRevision++}>Reload preview</button></div>
   {#if preview.limitations?.length}<p class="border-b border-gray-100 px-4 py-2 text-xs text-gray-500 dark:border-gray-800">{preview.limitations[0]}</p>{/if}
   <div class="flex min-h-0 flex-1 justify-center overflow-auto bg-gray-50 dark:bg-gray-950">{#key previewRevision}<iframe title={project.name+' live preview'} srcdoc={preview.html} sandbox="allow-scripts" referrerpolicy="no-referrer" style:width={viewport==='mobile'?'390px':viewport==='tablet'?'768px':'100%'} class="min-h-[60vh] max-w-full shrink-0 border-0 bg-white"/>{/key}</div>
  {:else}<div class="p-5 text-sm text-gray-500"><p>{preview?.reason??'Build the current project to see its live preview.'}</p><button class="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-gray-900 dark:bg-gray-800 dark:text-gray-100" on:click={askBuild}>Build preview in chat</button></div>{/if}
 {:else if tab==='files'}
  <div class="flex min-h-0 flex-1">
   <nav class="w-40 shrink-0 overflow-auto border-r border-gray-100 p-2 dark:border-gray-800" aria-label="Project files">{#each project.files??[] as f}<button disabled={busy} class="block w-full break-all rounded-lg p-2 text-left text-xs disabled:opacity-40 {path===f.path?'bg-gray-100 dark:bg-gray-800':''}" on:click={()=>file(f.path)}>{f.path}</button>{/each}</nav>
   <div class="flex min-w-0 flex-1 flex-col">{#if path}<div class="flex items-center justify-between border-b border-gray-100 p-2 text-xs dark:border-gray-800"><span>{path}{dirty?' •':''}</span><button disabled={!dirty||busy} class="rounded-lg bg-gray-100 px-3 py-1 disabled:opacity-40 dark:bg-gray-800" on:click={save}>Save</button></div><div class="flex-1 overflow-auto">{#key path}<CodeEditor id={'project-'+project.id} lang={path.endsWith('.html')?'html':path.endsWith('.css')?'css':'javascript'} value={content} onChange={(value)=>{content=value;dirty=true;}} onSave={save}/>{/key}</div>{:else}<p class="p-4 text-sm text-gray-500">Select a file. Starli edits these same saved files through chat.</p>{/if}</div>
  </div>
 {:else}<div class="overflow-auto p-4 text-sm"><p class="mb-3 font-medium">Current version {project.version??1}</p>{#each [...(project.versions??[])].reverse() as v}<p class="border-b border-gray-100 py-3 dark:border-gray-800">Version {v.version} <span class="text-gray-500">{v.updatedAt??''}</span></p>{/each}</div>{/if}
</section>

