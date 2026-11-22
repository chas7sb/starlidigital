<script lang="ts">
 import {onDestroy} from 'svelte';
 import type {PanelHost,Panel} from './index.mjs';
 import PanelHeader from './PanelHeader.svelte';
 import PanelState from './PanelState.svelte';
 export let host:PanelHost;
 let panels:Panel[]=[];
 const unsubscribe=host.subscribe(value=>panels=value);
 function title(panel:Panel){const value=panel.data as {title?:string;name?:string}|undefined;const labels:Record<string,string>={'resource.document':'Document','resource.tasks':'Task','resource.project':'Project','resource.file':'Drive file','resource.sheet':'Workbook','resource.email':'Email Studio'};return value?.title||value?.name||labels[panel.type]||'Company resource';}
 function focus(panel:Panel){document.getElementById('panel-content-'+encodeURIComponent(panel.key))?.focus();}
 onDestroy(()=>{unsubscribe();host.destroy();});
</script>
<div class="panel-workspace">
 {#each panels as panel(panel.key)}
  {#if panel.mode==='closed'}<button class="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900" on:click={()=>host.setMode(panel.key,'docked')}>Reopen {title(panel)}</button>
  {:else}<section class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" class:expanded={panel.mode==='expanded'} aria-label={title(panel)}>
   <PanelHeader title={title(panel)} revision={panel.revision} expanded={panel.mode==='expanded'} focus={()=>focus(panel)} toggle={()=>host.setMode(panel.key,panel.mode==='expanded'?'docked':'expanded')} close={()=>host.setMode(panel.key,'closed')}/>
   <div id={'panel-content-'+encodeURIComponent(panel.key)} class="panel-content p-4 outline-offset-[-2px]" tabindex="-1" aria-busy={panel.state==='loading'}>
   {#if panel.state!=='ready'}<PanelState state={panel.state} message={panel.message||''}/>
   {:else if panel.renderer}<svelte:component this={panel.renderer} {panel} {host}/>{/if}
   {#if panel.message && panel.state==='ready'}<p role="status">{panel.message}</p>{/if}
   </div>
  </section>{/if}
 {/each}
</div>
<style>.panel-workspace{display:flex;flex-wrap:wrap;gap:12px}section{flex:1 1 360px;min-width:0}.expanded{flex-basis:100%}.panel-content{max-height:72vh;overflow:auto}</style>
