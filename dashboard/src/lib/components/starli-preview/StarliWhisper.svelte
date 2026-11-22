<script lang="ts">
 import {onMount} from 'svelte';
 import {starliActivity,agentColor,type StarliAgent} from '$lib/stores/starli-activity';
 export let agent:StarliAgent;
 let now=Date.now();
 onMount(()=>{const timer=setInterval(()=>now=Date.now(),10000);return()=>clearInterval(timer);});
 $: activity=$starliActivity[agent.id];
 $: fresh=activity&&now-activity.timestamp<90000;
 $: text=fresh?activity.label:agent.status==='PAUSED'?'Paused':agent.autonomousEnabled?'Autonomous mode enabled':agent.role||'Ready';
</script>
<span class="flex min-w-0 items-center gap-1.5 truncate text-xs text-gray-500 dark:text-gray-400" title={text}>
 {#if fresh}<span class="h-1.5 w-1.5 shrink-0 rounded-full" style:background-color={agentColor(agent.id,agent.avatarColor)} aria-hidden="true"/>{/if}
 <span class="truncate">{text}</span>
</span>
