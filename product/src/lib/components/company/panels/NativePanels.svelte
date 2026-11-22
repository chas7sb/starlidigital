<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {get} from 'svelte/store';
 import {user} from '$lib/stores';
 import {PanelHost} from './index.mjs';
 import {httpAdapter} from './http-adapter.mjs';
 import {loadCompanyPanelRegistry} from './company-registry.mjs';
 import {bindEmailWorkflow} from './email/email-workflow.mjs';
 import PanelWorkspace from './PanelWorkspace.svelte';
 import CompanyResourceLauncher from './CompanyResourceLauncher.svelte';
 export let userId:string;export let companyId:string;export let availableTypes:string[]=[];
 let host:PanelHost|null=null,selected='',mounted=false,generation=0,actionError='',nativeRequest:any=null;
 let capturedToken='',sessionAbort=new AbortController(),disposeEmail:(()=>void)|undefined;
 function dispose(){sessionAbort.abort();sessionAbort=new AbortController();disposeEmail?.();disposeEmail=undefined;host?.destroy();host=null;nativeRequest=null;availableTypes=[];}
 function clearSavedScope(){try{localStorage.removeItem('starli.panels.v1:'+JSON.stringify({userId,kind:'company',ownerId:companyId}));}catch{}}
 export function revokeScope(){generation++;clearSavedScope();dispose();actionError='';}
 export async function openAssistantPanel(output:any){if(!host)throw Error('Native resource service is unavailable');return host.assistantOutput(output);}
 async function openHuman(output:any){actionError='';try{await openAssistantPanel(output);}catch{actionError='This resource could not be opened. Refresh the resource list and try again.';}}
 async function reset(){
  const epoch=++generation,scope=JSON.stringify([userId,companyId]),token=localStorage.token;
  dispose();capturedToken=token;actionError='';if(!userId||!companyId)return;
  const signal=sessionAbort.signal;
  const current=()=>epoch===generation&&!signal.aborted&&localStorage.token===token&&scope===JSON.stringify([userId,companyId]);
  const authenticated=async(input:RequestInfo|URL,init:RequestInit={})=>{if(!current())throw Error('Session changed');const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+token);const combined=init.signal?AbortSignal.any([signal,init.signal]):signal;const response=await fetch(input,{...init,signal:combined,credentials:'same-origin',cache:'no-store',headers});if(!current())throw Error('Session changed');return response;};
  let next:PanelHost|null=null;
  try{const {registry,availability,emailActions}=await loadCompanyPanelRegistry({request:authenticated,companyId});if(!current())return;
   next=new PanelHost(registry,httpAdapter(authenticated),localStorage);
   const stopEmail=bindEmailWorkflow(next,{request:authenticated,companyId,enabledActions:emailActions,signal});
   await next.switchScope({userId,kind:'company',ownerId:companyId});
   if(!current()){stopEmail();next.destroy();return;}
   host=next;disposeEmail=stopEmail;nativeRequest=authenticated;availableTypes=availability.map(p=>p.type);
  }catch{next?.destroy();if(current())dispose();}
 }
 onMount(()=>{mounted=true;const changed=(e:StorageEvent)=>{if(e.key==='token'||e.key===null){generation++;clearSavedScope();dispose();actionError='Your session changed. Reopen this workspace.';}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);});
 $: if(mounted&&selected!==JSON.stringify([userId,companyId])){selected=JSON.stringify([userId,companyId]);void reset();}
 onDestroy(()=>{generation++;if(typeof localStorage!=='undefined'&&(capturedToken!==localStorage.token||get(user)?.id!==userId))clearSavedScope();dispose();});
</script>
{#if host&&availableTypes.length}<CompanyResourceLauncher request={nativeRequest} {companyId} {availableTypes} on:open={e=>openHuman(e.detail)}/><PanelWorkspace {host}/>{/if}
{#if actionError}<p role="alert" class="py-3 text-sm text-gray-500">{actionError}</p>{/if}
