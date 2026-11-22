<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 export let compact=false;
 const dispatch=createEventDispatcher();
 let items:any[]=[],loading=true,busy='',error='',timer:ReturnType<typeof setInterval>;
 const headers=()=>({Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'});
 async function load(){try{const r=await fetch('/api/v1/starli/mail/actions',{headers:headers()});if(!r.ok)throw Error('Send reviews unavailable');items=(await r.json()).items??[];error='';}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function decide(item:any,decision:string){busy=item.id;error='';try{const r=await fetch('/api/v1/starli/mail/actions/'+encodeURIComponent(item.id)+'/decision',{method:'POST',headers:headers(),body:JSON.stringify({digest:item.digest,decision})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:'Send action failed');await load();dispatch('change',d);}catch(e){error=(e as Error).message;}finally{busy='';}}
 const addresses=(values:any[])=>values?.map(v=>v.address).join(', ')||'';
 onMount(()=>{void load();timer=setInterval(()=>{if(!busy&&!document.hidden)void load();},7000);});onDestroy(()=>clearInterval(timer));
</script>
<section class={compact?'p-3':''} aria-label="Email send reviews">
 <h2 class="mb-3 text-sm font-medium">Send reviews</h2>
 {#if error}<p role="alert" class="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
 <div class="space-y-3">{#each items as item (item.id)}<article class="rounded-xl border border-gray-100 p-4 dark:border-gray-800"><header class="flex justify-between gap-3"><h3 class="text-sm font-medium">{item.snapshot.subject}</h3><span class="shrink-0 text-xs text-gray-500">{item.status==='SMTP_ACCEPTED'?'Accepted by mail server':item.status}</span></header>
 <dl class="mt-3 space-y-1 text-xs text-gray-500"><div><dt class="inline">From: </dt><dd class="inline">{item.snapshot.displayName} &lt;{item.snapshot.from}&gt;</dd></div><div><dt class="inline">To: </dt><dd class="inline">{addresses(item.snapshot.to)}</dd></div>{#if item.snapshot.cc?.length}<div><dt class="inline">Cc: </dt><dd class="inline">{addresses(item.snapshot.cc)}</dd></div>{/if}{#if item.snapshot.bcc?.length}<div><dt class="inline">Bcc: </dt><dd class="inline">{addresses(item.snapshot.bcc)}</dd></div>{/if}</dl>
 <div class="my-4 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm">{item.snapshot.textBody}</div>
 {#if item.status==='PENDING'}<div class="flex gap-2"><button disabled={busy===item.id} on:click={()=>decide(item,'approve')} class="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">{busy===item.id?'Sending…':'Send this exact email'}</button><button disabled={busy===item.id} on:click={()=>decide(item,'reject')} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Reject</button></div>
 {:else if ['EXECUTING','UNCERTAIN'].includes(item.status)}<p class="text-xs text-gray-500">Check your provider using the Message-ID before retrying. This action will not be sent again automatically.</p>
 {:else if item.status==='SMTP_ACCEPTED'}<p class="text-xs text-gray-500">The SMTP server accepted the message. Recipient delivery has not been verified.</p>{/if}
 {#if item.result?.partialAcceptance}<p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">Some recipients were rejected by the mail server. Review the receipt before taking another action.</p>{/if}
 {#if item.result}<details class="mt-3 text-xs text-gray-500"><summary>Send receipt</summary><pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(item.result,null,2)}</pre></details>{/if}
 </article>{:else}<p class="text-sm text-gray-500">{loading?'Loading send reviews…':'No messages need review. Ask Starli to prepare a saved draft for sending.'}</p>{/each}</div>
</section>
