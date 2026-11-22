<script lang="ts">
 import {createEventDispatcher} from 'svelte';
 import BotAvatar from './agents/BotAvatar.svelte';
 import BotPurpose from './agents/BotPurpose.svelte';
 export let bots:any[]=[];
 export let companyId='';export let accessSignal:AbortSignal|undefined=undefined;
 export let selectedId='';
 const dispatch=createEventDispatcher<{select:{botId:string}}>();
 function purpose(bot:any){return [bot.purpose,bot.description].find(v=>typeof v==='string'&&v.trim())||'';}
</script>
<section class="directory" aria-labelledby="bot-directory-title"><div class="heading"><div><h2 id="bot-directory-title">Your AI team</h2></div></div><div class="grid">{#each bots as bot,i(bot.id)}<button class="card" class:selected={selectedId===bot.id} on:click={()=>dispatch('select',{botId:bot.id})} aria-label={'Open settings for '+bot.name}><BotAvatar {companyId} botId={bot.id} index={i} name={bot.name} avatar={bot.avatar||''} size={68} {accessSignal}/><strong>{bot.name}</strong><BotPurpose {companyId} botId={bot.id} purpose={bot.purpose||''} {accessSignal}/>{#if purpose(bot)&&purpose(bot)!==bot.purpose}<p>{purpose(bot)}</p>{/if}</button>{:else}<div class="empty-directory"><h3>No bots available</h3><p>Your company has no bots you can access.</p></div>{/each}</div></section>
<style>
 .directory{padding:36px 46px;width:100%;margin:0 auto;overflow:auto}
 .heading{display:flex;align-items:center;margin-bottom:22px}
 .heading h2{font-size:15px;font-weight:500;color:#29364d;margin:0}
 .heading p,.card-action{display:none}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:12px;max-width:1100px}
 .card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:#f3f5f8;border:1px solid transparent;border-radius:13px;padding:24px 16px;min-height:155px;color:#354155;transition:background .15s,border-color .15s;cursor:pointer}
 .card:hover{background:#edf2fa;border-color:#dce7f8}
 .card.selected{background:#eaf1ff;border-color:#d4e2fc}
 .card:focus-visible{outline:2px solid #729ef2;outline-offset:3px}
 .card strong{font-size:12px;font-weight:500;margin-top:17px}
 .card p{font-size:10px;line-height:1.6;color:#8995a9;margin:6px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}
 .empty-directory{grid-column:1/-1;padding:70px 20px;text-align:center;color:#a0a8b4}
 .empty-directory h3{font-size:17px;font-weight:500;color:#7c8798}.empty-directory p{font-size:12px}
 @media(min-width:1500px){.grid{grid-template-columns:repeat(6,minmax(0,1fr))}}
 @media(max-width:700px){.directory{padding:28px 23px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{min-height:145px;padding:22px 14px}}
.heading h2{font-size:22px;font-weight:650;color:#17233b}.grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.card{background:#fff;border-color:#e2e8f0;min-height:210px;border-radius:12px;box-shadow:0 2px 8px #17233b03}.card strong{font-size:15px;font-weight:650}.card p{font-size:12px;color:#64748b}.card:hover{background:#f8faff;border-color:#93b4ff}@media(max-width:700px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:20px 12px}.card p{font-size:11px}}
</style>
