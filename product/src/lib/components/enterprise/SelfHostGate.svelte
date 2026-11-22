<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import InitialAdministrator from './InitialAdministrator.svelte';
 import {loadSetupStatus,createInitialAdministrator,signInInitialAdministrator,installationEntry,type SetupStatus,type InitialAdministrator as AdministratorInput} from '$lib/utils/selfhost-setup';
 let status:SetupStatus|null=null,loading=true,error='',notice='';
 const controller=new AbortController();
 async function refreshStatus(){loading=true;error='';try{status=await loadSetupStatus(controller.signal);}catch(cause){if(!controller.signal.aborted){status=null;error=(cause as Error).message;}}finally{loading=false;}}
 async function initialize(input:AdministratorInput){
  try{
   await createInitialAdministrator(input,controller.signal);
   try{const token=await signInInitialAdministrator(input.email,input.password,controller.signal);localStorage.setItem('token',token);window.dispatchEvent(new Event('starli-session-updated'));}
   catch{notice='Administrator created. Sign in with your new account to continue.';}
   await refreshStatus();
  }catch(cause){notice=(cause as Error).message;await refreshStatus();throw cause;}
 }
 onMount(()=>{void refreshStatus();});
 onDestroy(()=>controller.abort());
</script>

{#if loading}<main class="setup-status" role="status">Checking installation…</main>
{:else if error||!status}<main class="setup-status"><section><h1>Installation unavailable</h1><p role="alert">{error||'Setup state could not be verified.'}</p><button on:click={refreshStatus}>Retry status check</button></section></main>
{:else if installationEntry(status)==='create-initial-administrator'}<InitialAdministrator createAdministrator={initialize} {refreshStatus}/>
{:else}{#if notice}<p class="setup-notice" role="status">{notice}</p>{/if}<slot />{/if}
<style>.setup-status{min-height:100dvh;display:grid;place-items:center;background:#f4f7ff;color:#17243f;font:14px Inter,system-ui,sans-serif;padding:24px;box-sizing:border-box}.setup-status section{max-width:450px;background:#fff;border:1px solid #dfe6f2;border-radius:16px;padding:32px}.setup-status h1{font-size:22px}.setup-status p{line-height:1.6;color:#64748b}.setup-status button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer}.setup-notice{position:fixed;z-index:100;bottom:16px;left:50%;transform:translateX(-50%);width:min(420px,calc(100% - 32px));box-sizing:border-box;padding:14px;border:1px solid #dfe6f2;border-radius:10px;background:#eef3ff;color:#17243f;font:13px system-ui;box-shadow:0 4px 20px #17243f16}</style>
