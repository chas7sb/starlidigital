<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 export let panel:any;
 export let host:any;
 let available=false;
 const abort=new AbortController();
 onMount(()=>{const token=localStorage.token||'';fetch('/sheets/editor.json',{cache:'no-store',credentials:'same-origin',signal:abort.signal,headers:token?{Authorization:'Bearer '+token}:{}}).then(async r=>{if(!r.ok)throw Error('Unavailable');const m=await r.json();if(!abort.signal.aborted&&(localStorage.token||'')===token&&m.contract==='starli.sheets.editor.v1')available=true;}).catch(()=>{});});
 onDestroy(()=>abort.abort());
</script>
{#key panel.ref.ownerId+':'+panel.ref.id}
 {#if available&&host}
 <iframe title="Company spreadsheet" src={`/sheets/index.html?company=${encodeURIComponent(panel.ref.ownerId)}&workbook=${encodeURIComponent(panel.ref.id)}`} allow="clipboard-read; clipboard-write" />
 {:else}<p role="status">Spreadsheet editor unavailable.</p>{/if}
{/key}
<style>iframe{width:100%;height:650px;border:0}</style>
