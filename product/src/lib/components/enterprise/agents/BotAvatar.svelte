<script lang="ts">
 import {onMount} from 'svelte';import Orb from '../Orb.svelte';import {botVisual,avatarSelection} from './bot-purpose';
 export let companyId:string;export let botId:string;export let name='';export let index=0;export let size=32;export let avatar='';export let accessSignal:AbortSignal|undefined=undefined;
 let selected=avatarSelection(avatar),alive=true;
 onMount(()=>{function changed(event:Event){const value=(event as CustomEvent).detail;if(value?.companyId===companyId&&value?.botId===botId)selected=value.avatarKey;}
 function revoked(){selected='';}window.addEventListener('starli:bot-avatar',changed);accessSignal?.addEventListener('abort',revoked,{once:true});if(!accessSignal?.aborted&&companyId&&botId)void botVisual(companyId,botId).then(value=>{if(alive&&!accessSignal?.aborted)selected=value.avatarKey;}).catch(()=>{});return()=>{alive=false;window.removeEventListener('starli:bot-avatar',changed);accessSignal?.removeEventListener('abort',revoked);};});
</script>
<Orb {name} {index} {size} avatarKey={selected}/>
