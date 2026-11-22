<script lang="ts">
 import ResourcePanel from './ResourcePanel.svelte';
 import CompanyDrivePanel from './drive/CompanyDrivePanel.svelte';
 export let panel:any;export let host:any;
 export let request:(path:string,init?:RequestInit)=>Promise<Response>;
 let browse=false;
</script>
<ResourcePanel {panel} {host}/>
<div class="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
 <button type="button" class="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700" aria-expanded={browse} on:click={()=>browse=!browse}>{browse?'Close Drive browser':'Browse company Drive'}</button>
 {#if browse}<div class="mt-4"><CompanyDrivePanel companyId={panel.ref.ownerId} {request} section={panel.ref.kind==='knowledge'?'documents':'drive'}/></div>{/if}
</div>
