<script lang="ts">
 import {onMount} from 'svelte';
 import {starliActivity,agentColor,type StarliAgent} from '$lib/stores/starli-activity';
 export let agent:StarliAgent;
 export let size=32;
 export let animated=true;
 let now=Date.now();
 onMount(()=>{const timer=setInterval(()=>now=Date.now(),10000);return()=>clearInterval(timer);});
 $: color=agentColor(agent.id,agent.avatarColor);
 $: activity=$starliActivity[agent.id];
 $: fresh=activity&&now-activity.timestamp<90000;
 $: working=animated&&fresh&&activity.running;
 $: failed=fresh&&activity.failed;
 $: glyph=agent.avatarShape?.trim()||agent.name?.trim().slice(0,1).toUpperCase()||'S';
 $: hint=agent.name+(fresh?' — '+activity.label:agent.status==='PAUSED'?' — Paused':'');
 $: hex=color.slice(1);
 $: luminance=(parseInt(hex.slice(0,2),16)*299+parseInt(hex.slice(2,4),16)*587+parseInt(hex.slice(4,6),16)*114)/1000;
</script>
<span class:working class:failed class="starli-avatar relative inline-flex shrink-0 items-center justify-center rounded-full align-middle" style:width={size+'px'} style:height={size+'px'} style:--agent-color={color} style:background-color={color} style:color={luminance>155?'#111827':'#ffffff'} role="img" aria-label={hint} title={hint}>
 <span class="avatar-glyph select-none font-semibold leading-none" style:font-size={Math.round(size*.46)+'px'} aria-hidden="true">{glyph}</span>
 {#if working}<span class="activity-dot absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-gray-900" aria-hidden="true"/>{:else if failed}<span class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500 dark:border-gray-900" aria-hidden="true"/>{/if}
</span>
<style>
 .starli-avatar{isolation:isolate}
 .starli-avatar.working::before{content:'';position:absolute;inset:-3px;border:1.5px solid var(--agent-color);border-radius:999px;opacity:.3;animation:agent-breathe 1.8s ease-in-out infinite}
 .working .avatar-glyph{animation:agent-look 3.8s ease-in-out infinite}
 .activity-dot{box-shadow:0 0 0 1px rgb(0 0 0/.05)}
 @keyframes agent-breathe{0%,100%{transform:scale(.98);opacity:.3}50%{transform:scale(1.08);opacity:.65}}
 @keyframes agent-look{0%,80%,100%{transform:translateY(0)}86%{transform:translateY(-1px)}92%{transform:translateY(0)}}
 @media(prefers-reduced-motion:reduce){.starli-avatar.working::before,.working .avatar-glyph{animation:none}}
</style>
