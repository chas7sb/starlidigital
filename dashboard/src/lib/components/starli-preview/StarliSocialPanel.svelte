<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import Tooltip from '$lib/components/common/Tooltip.svelte';
 export let compact=false;
 let connection:any=null,tools:any[]=[],actions:any[]=[],loading=true,busy='',error='',notice='',timer:ReturnType<typeof setInterval>;
 const headers=()=>({Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'});
 async function api(path:string,options:any={}){const r=await fetch('/api/v1/starli/social'+path,{...options,headers:headers()});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:'Social request failed ('+r.status+')');return d;}
 async function load(){try{const [c,a]=await Promise.all([api(''),api('/actions')]);connection=c;actions=a.items??[];if(c.connected){const t=await api('/tools');tools=t.tools??[];}else tools=[];error='';}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function connect(){busy='connect';error='';try{const d=await api('/connect',{method:'POST'});const url=new URL(d.url);const expected=new URL(import.meta.env.VITE_STARLI_SOCIAL_AUTH_ORIGIN?.trim()||window.location.origin);if(url.origin!==expected.origin||url.username||url.password||!['http:','https:'].includes(url.protocol))throw Error('Invalid authorization destination');window.location.assign(url.href);}catch(e){error=(e as Error).message;}finally{busy='';}}
 async function decision(action:any,value:string){busy=action.id;error='';try{await api('/actions/'+encodeURIComponent(action.id)+'/decision',{method:'POST',body:JSON.stringify({digest:action.digest,decision:value})});await load();}catch(e){error=(e as Error).message;}finally{busy='';}}
 function ask(prompt:string){window.dispatchEvent(new CustomEvent('starli-compose',{detail:{prompt}}));notice='Continue this request in the chat composer.';}
 function title(action:any){const tool=action.tool??'';if(tool.includes('schedule'))return 'Schedule post';if(tool.includes('publish_now')||tool.includes('submit'))return 'Publish post';if(tool.includes('loop'))return 'Social automation';if(tool.includes('render'))return 'Generate video';if(tool.includes('image'))return 'Generate image';if(tool.includes('select'))return 'Connect page';return tool.replaceAll('_',' ');}
 function fields(args:any){return Object.entries(args??{}).filter(([key,value])=>!['idempotencyKey','commandId','approvalReferenceId'].includes(key)&&['string','number','boolean'].includes(typeof value));}
 onMount(()=>{void(async()=>{const params=new URLSearchParams(window.location.search);const code=params.get('code'),state=params.get('state');if(code&&state){try{await api('/callback',{method:'POST',body:JSON.stringify({code,state})});notice='Social account connected.';}catch(e){error=(e as Error).message;}finally{history.replaceState({},'',window.location.pathname);}}await load();})();timer=setInterval(()=>{if(!document.hidden&&!busy)void load();},8000);});
 onDestroy(()=>clearInterval(timer));
</script>
<section class={compact?'h-full overflow-auto p-4':'mx-auto max-w-5xl p-4 md:p-6'} aria-label="Social publishing">
 <header class="mb-5 flex items-start justify-between gap-3"><div><h1 class={compact?'text-lg font-semibold':'text-2xl font-semibold'}>Social publishing</h1><p class="mt-2 text-sm text-gray-500">Create campaigns, images, videos and publishing schedules through chat. Review prepared actions here.</p></div><button class="rounded-lg p-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800" on:click={load}>Refresh</button></header>
 {#if loading}<Spinner/>{/if}
 {#if error}<p role="alert" class="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
 {#if notice}<p role="status" class="mb-3 text-sm text-gray-500">{notice}</p>{/if}
 {#if connection&&!connection.connected}
  <div class="mb-5 rounded-xl border border-gray-100 p-4 dark:border-gray-800"><h2 class="font-medium">Connect your publishing account</h2><p class="my-2 text-sm text-gray-500">{connection.reason}</p><button disabled={busy==='connect'||connection.state==='CLIENT_NOT_CONFIGURED'} class="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900" on:click={connect}>Connect Facebook & Instagram</button><p class="mt-2 text-xs text-gray-500">You choose the account, pages and permissions in the secure authorization flow.</p></div>
 {:else if connection?.connected}
  <div class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-850"><div><p class="text-sm font-medium">Publishing account connected</p><p class="mt-1 text-xs text-gray-500">{tools.length} authorized tools Â· Facebook / Instagram capabilities follow your connection permissions.</p></div><button class="rounded-lg px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800" on:click={connect}>Reconnect</button></div>
 {/if}
 <div class="mb-6 flex flex-wrap gap-2">{#each ['Show my connected Facebook pages and Instagram accounts','Create an image post for my client','Create a social video for my client','Schedule a post for my client','Set up a recurring social campaign'] as prompt}<button disabled={!connection?.connected} class="rounded-lg border border-gray-100 px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:hover:bg-gray-850" on:click={()=>ask(prompt)}>{prompt}</button>{/each}</div>
 <h2 class="mb-3 text-sm font-medium">Prepared actions and receipts</h2>
 <div class="space-y-3">{#each actions as action (action.id)}
  <article class="rounded-xl border border-gray-100 p-4 dark:border-gray-800"><div class="flex items-start justify-between gap-3"><h3 class="text-sm font-medium">{title(action)}</h3><span class="text-xs text-gray-500">{action.status}</span></div>
   <dl class="mt-3 space-y-2">{#each fields(action.args) as [key,value]}<div class="text-sm"><dt class="text-xs text-gray-500">{key.replaceAll(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ')}</dt><dd class="mt-0.5 whitespace-pre-wrap break-words">{String(value)}</dd></div>{/each}</dl>
   {#if action.status==='PENDING'}<div class="mt-4 flex gap-2"><button disabled={busy===action.id} class="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900" on:click={()=>decision(action,'approve')}>{busy===action.id?'Executingâ€¦':'Confirm action'}</button><button disabled={busy===action.id} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800" on:click={()=>decision(action,'reject')}>Reject</button></div>
   {:else if ['EXECUTING','UNCERTAIN'].includes(action.status)}<p class="mt-3 text-xs text-gray-500">Check the provider status before preparing another action. This action will not be sent again automatically.</p>{/if}
   <details class="mt-3 text-xs text-gray-500"><summary>Action details{action.result?' and execution receipt':''}</summary><pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify({tool:action.tool,args:action.args,...(action.result?{receipt:action.result}:{})},null,2)}</pre></details>
  </article>
 {:else}<p class="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-500 dark:bg-gray-850">Ask Starli to prepare a post, video or campaign in chat. Nothing has been published from this screen.</p>{/each}</div>
</section>
