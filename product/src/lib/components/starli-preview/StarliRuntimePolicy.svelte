<script lang="ts">
 import {onDestroy} from 'svelte';
 import {user} from '$lib/stores';
 import {runtimePolicyLabel} from '$lib/utils/starli-runtime-policy';
 export let chatId:string|null=null;
 let seen='',label='Checking runtime tool availability…',controller:AbortController|null=null,epoch=0;
 async function load(){controller?.abort();const n=++epoch,owner=$user?.id,context=chatId,token=typeof localStorage!=='undefined'?localStorage.token:'';label='Checking runtime tool availability…';if(!owner||!token)return;const c=new AbortController();controller=c;
  const current=()=>n===epoch&&owner===$user?.id&&context===chatId&&token===localStorage.token;
  try{const r=await fetch('/api/v1/starli/runs/capabilities'+(context?'?'+new URLSearchParams({chatId:context}):''),{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:c.signal});if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))throw Error();const data=await r.json();if(current())label=runtimePolicyLabel(data);}
  catch{if(current()&&!c.signal.aborted)label='Runtime tool availability is not confirmed.';}
 }
 $: key=($user?.id??'')+'|'+(chatId??'');
 $: if(key!==seen){seen=key;void load();}
 function changed(event:StorageEvent){if(event.key==='token'||event.key===null){epoch++;controller?.abort();label='Your session changed. Reopen this conversation.';}}
 function granted(event:CustomEvent){if(event.detail?.chatId===chatId)void load();}
 onDestroy(()=>{epoch++;controller?.abort();});
</script>
<svelte:window on:storage={changed} on:starli-runtime-policy-changed={granted}/>
{#if $user?.id}<p class="px-3 py-1 text-xs text-gray-500" aria-live="polite">{label}</p>{/if}
