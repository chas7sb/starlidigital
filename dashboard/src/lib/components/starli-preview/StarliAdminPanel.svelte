<script lang="ts">
 import { onMount } from 'svelte';
 import { user } from '$lib/stores';
 import StarliAccessMode from './StarliAccessMode.svelte';
 import Users from '$lib/components/admin/Users.svelte';
 import Settings from '$lib/components/admin/Settings.svelte';
 let tab='overview', data:any=null, loading=true, error='', query='';
 const tabs=[['overview','Overview'],['users','Users'],['settings','Settings'],['tools','Capabilities']];
 async function load(){
  loading=true;error='';
  try{
   const r=await fetch('/api/v1/starli/platform/admin',{headers:{Authorization:`Bearer ${localStorage.token}`}});
   if(!r.ok)throw Error(`Platform request failed (${r.status})`);data=await r.json();
  }catch(e){error=e instanceof Error?e.message:'Unable to load platform';}finally{loading=false;}
 }
 onMount(()=>{if($user?.role==='admin')void load();});
 $: capabilities=(data?.capabilities??[]).filter((x:any)=>(x.name+' '+x.description).toLowerCase().includes(query.toLowerCase()));
</script>
<section class="mx-auto w-full max-w-7xl p-4 md:p-6">
 <header class="mb-6"><p class="text-xs font-medium text-gray-500">STARLIDIGITAL</p><h1 class="mt-1 text-2xl font-semibold">Platform administration</h1><p class="mt-2 text-sm text-gray-500">Manage your platform, people and AI settings.</p></header>
 {#if $user?.role!=='admin'}<p role="alert">Administrator access required.</p>
 {:else}
 <div class="mb-4"><StarliAccessMode /></div>
 <nav aria-label="Administration sections" class="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-gray-50 p-1 dark:bg-gray-850">
 {#each tabs as item}<button type="button" on:click={()=>tab=item[0]} aria-pressed={tab===item[0]} class="rounded-lg px-4 py-2 text-sm font-medium {tab===item[0]?'bg-white shadow-sm dark:bg-gray-700':'text-gray-500 hover:text-gray-900 dark:hover:text-white'}">{item[1]}</button>{/each}
 </nav>
 {#if tab==='users'}<Users />
 {:else if tab==='settings'}<Settings />
 {:else if loading}<p role="status">Loading platform…</p>
 {:else if error}<div role="alert"><p>{error}</p><button class="mt-3 rounded-xl bg-gray-100 px-4 py-2 dark:bg-gray-800" on:click={load}>Retry</button></div>
 {:else if data}
 {#if tab==='tools'}
  <input aria-label="Search capabilities" placeholder="Search platform capabilities" bind:value={query} class="mb-4 w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-850"/>
  <p class="mb-4 text-sm text-gray-500">{capabilities.length} capabilities. Availability in Starli chat depends on the connected tool and your permissions.</p>
  <div class="grid gap-3 md:grid-cols-2">{#each capabilities as item}<article class="rounded-2xl border border-gray-100 p-4 dark:border-gray-800"><h2 class="font-medium capitalize">{item.name}</h2><p class="mt-2 text-sm text-gray-500">{item.description}</p></article>{/each}</div>
 {:else}
 <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
 {#each [['CRM companies',data.counts.crm_companies],['Website projects',data.counts.projects],['Proposals',data.counts.proposals],['Users',data.counts.users]] as metric}
 <article class="rounded-2xl bg-gray-50 p-5 dark:bg-gray-850"><p class="text-sm text-gray-500">{metric[0]}</p><p class="mt-3 text-3xl font-semibold">{metric[1]??'—'}</p></article>{/each}
 </div>
 <div class="mt-6 grid gap-4 md:grid-cols-2"><article class="rounded-2xl border border-gray-100 p-5 dark:border-gray-800"><h2 class="font-medium">Platform connections</h2><dl class="mt-4 space-y-3 text-sm">{#each Object.entries(data.services) as [label,value]}<div><dt class="capitalize text-gray-500">{label}</dt><dd class="mt-1">{String(value)}</dd></div>{/each}</dl></article>
 <article class="rounded-2xl border border-gray-100 p-5 dark:border-gray-800"><h2 class="font-medium">Release status</h2><p class="mt-3 text-sm text-gray-500">{data.platform.mode}</p><ul class="mt-3 space-y-2 text-sm">{#each data.limitations as item}<li>{item}</li>{/each}</ul></article></div>
 <div class="mt-6 flex flex-wrap gap-3 text-sm"><a class="rounded-xl bg-gray-100 px-4 py-2 dark:bg-gray-800" href="/starli/crm">Open CRM</a><a class="rounded-xl bg-gray-100 px-4 py-2 dark:bg-gray-800" href="/admin/evaluations">Evaluations</a><a class="rounded-xl bg-gray-100 px-4 py-2 dark:bg-gray-800" href="/admin/functions">Functions</a><button class="rounded-xl bg-gray-100 px-4 py-2 dark:bg-gray-800" on:click={load}>Refresh</button></div>
 {/if}{/if}{/if}
</section>
