<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {CompanyClient} from '$lib/utils/company-workspace';
 export let companyId:string;export let kind:'tasks'|'computer'='tasks';
 let client:CompanyClient,items:any[]=[],snapshot:any=null,error='',loading=true,seen='',mounted=false,timer:ReturnType<typeof setInterval>,generation=0;
 $: scope=companyId+'|'+kind;
 $: if(mounted&&seen!==scope){seen=scope;void reset();}
 async function reset(){client?.close();generation++;items=[];snapshot=null;error='';loading=true;client=new CompanyClient(companyId,()=>localStorage.token||'');await refresh();}
 async function refresh(){const current=client,n=++generation;if(!current)return;try{const d=await current.request(kind==='tasks'?'/tasks':'/computer');if(current!==client||n!==generation)return;if(kind==='tasks'){if(!Array.isArray(d.items))throw Error('Task response is unavailable.');items=d.items;}else snapshot=d;error='';}catch(e){if(current===client&&n===generation){items=[];snapshot=null;error=(e as Error).message;}}finally{if(current===client&&n===generation)loading=false;}}
 function changed(e:StorageEvent){if(e.key==='token'||e.key===null){client?.close();generation++;items=[];snapshot=null;error='Your session changed. Reopen the company workspace.';}}
 onMount(()=>{mounted=true;timer=setInterval(()=>{if(!document.hidden)void refresh();},5000);window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);});onDestroy(()=>{client?.close();generation++;clearInterval(timer);});
</script>
<section aria-label={kind==='tasks'?'Company task queue':'Company live computer'}>
 <header><h2>{kind==='tasks'?'Tasks and live jobs':'Shared company computer'}</h2><button class="sd-button" on:click={refresh}>Refresh</button></header>
 {#if loading}<p role="status">Loading company {kind}…</p>{:else if error}<p role="status">{error}</p>
 {:else if kind==='tasks'}<div class="jobs">{#each items as job(job.id)}<article><strong>{job.title||job.name}</strong><span>{job.state||job.status}</span>{#if job.assigneeName}<small>{job.assigneeName}</small>{/if}{#if job.updatedAt}<time>{new Date(job.updatedAt).toLocaleString()}</time>{/if}</article>{:else}<p>No tasks visible to you in this company.</p>{/each}</div>
 {:else if snapshot}<dl><div><dt>Observed state</dt><dd>{snapshot.observedState||snapshot.state||'Unavailable'}</dd></div><div><dt>Memory allocation</dt><dd>{snapshot.memoryBytes===1073741824?'1 GiB verified':'Not verified'}</dd></div><div><dt>Controller</dt><dd>{snapshot.controllerLabel||'No confirmed controller'}</dd></div></dl><p>Company desktop viewing and control require the company-scoped transport. The personal desktop is available in its own conversation.</p>{/if}
</section>
<style>section{min-width:0}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 16px}h2{font-weight:700}p,small,time,dt{color:var(--sd-muted);font-size:13px}.jobs{display:grid;gap:10px}article{border:1px solid var(--sd-line);border-radius:12px;padding:14px;display:flex;flex-wrap:wrap;gap:10px}article strong{flex:1;min-width:120px}span{color:var(--sd-accent)}small,time{width:100%}dl{display:grid;gap:8px}dl div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--sd-line);padding:10px 0}</style>
