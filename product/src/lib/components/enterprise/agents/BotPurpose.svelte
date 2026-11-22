<script lang="ts">
 import {onMount} from 'svelte';import {botPurpose} from './bot-purpose';
 export let companyId:string;export let botId:string;export let purpose='';export let accessSignal:AbortSignal|undefined=undefined;
 let text=purpose.trim(),alive=true;
 onMount(()=>{function changed(event:Event){const d=(event as CustomEvent).detail;if(d?.companyId===companyId&&d?.botId===botId)text=d.purpose;}
 function revoked(){text='';}
 window.addEventListener('starli:bot-purpose',changed);accessSignal?.addEventListener('abort',revoked,{once:true});
 if(!accessSignal?.aborted&&companyId&&botId)void botPurpose(companyId,botId).then(value=>{if(alive&&!accessSignal?.aborted)text=value;}).catch(()=>{});
 return()=>{alive=false;window.removeEventListener('starli:bot-purpose',changed);accessSignal?.removeEventListener('abort',revoked);};});
</script>
{#if text}<small title={text}>{text}</small>{/if}
<style>small{display:block;font-size:10px;line-height:1.5;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}</style>
