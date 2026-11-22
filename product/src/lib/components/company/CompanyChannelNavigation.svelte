<script lang="ts">
 import {createEventDispatcher,tick} from 'svelte';
 export let channels:any[]=[];
 export let selected='';
 export let companyName='Company';
 const dispatch=createEventDispatcher();
 let query='',filter:HTMLInputElement;
 $: visible=channels.filter(room=>room.name.toLowerCase().includes(query.trim().toLowerCase()));
 export async function focus(){await tick();filter?.focus();}
 function move(e:KeyboardEvent){const buttons=Array.from((e.currentTarget as HTMLElement).closest('nav').querySelectorAll<HTMLButtonElement>('button[data-channel]'));const index=buttons.indexOf(e.target as HTMLButtonElement);if(index<0||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}
</script>
<nav class="channel-navigation" aria-label={'Channels in '+companyName}>
 <h2>Channels <span>{channels.length}</span></h2>
 <label class="channel-filter">Find a channel<input bind:this={filter} type="search" bind:value={query} placeholder="Filter channels"/></label>
 <div class="channel-links">{#each visible as room(room.id)}<button type="button" data-channel={room.id} on:keydown={move} aria-current={selected===room.id?'page':undefined} on:click={()=>dispatch('select',room.id)}><span aria-hidden="true">{room.visibility==='private'?'◈':'#'}</span><span>{room.name}</span>{#if room.visibility==='private'}<small>Private</small>{/if}{#if Number.isSafeInteger(room.unread)&&room.unread>0}<small class="unread" aria-label={room.unread+' unread messages'}>{room.unread}</small>{/if}</button>{:else}<p>{query?'No matching channels.':'No channels available.'}</p>{/each}</div>
 <p class="scope-note">Shared with this company. Channel access controls who can read.</p>
</nav>
<style>
.channel-navigation{width:190px;flex:none;border-right:1px solid var(--sd-line);padding:4px 12px 4px 0;display:flex;flex-direction:column;gap:12px;min-height:0}h2{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:650}h2 span{color:var(--sd-muted);font-weight:400}.channel-filter{font-size:11px;color:var(--sd-muted)}input{display:block;width:100%;margin-top:5px;padding:7px 9px;border:1px solid var(--sd-line);border-radius:7px;background:var(--sd-card);color:var(--sd-text);font-size:12px;min-width:0}.channel-links{overflow:auto;min-height:0}button{width:100%;display:flex;align-items:center;gap:8px;padding:8px;border-radius:7px;text-align:left;font-size:13px}button span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button[aria-current=page]{color:var(--sd-accent);background:var(--sd-selected);font-weight:600}button:hover{background:var(--sd-selected)}button:focus-visible,input:focus-visible{outline:2px solid var(--sd-accent);outline-offset:2px}.unread{border-radius:999px;padding:1px 6px;background:var(--sd-selected);color:var(--sd-accent)}small{font-size:10px;color:var(--sd-muted);margin-left:auto}.scope-note,.channel-links p{font-size:11px;color:var(--sd-muted);line-height:1.5}.scope-note{margin-top:auto;padding-top:8px}@media(max-width:900px){.channel-navigation{width:150px}}@media(max-width:600px){.channel-navigation{width:100%;border-right:0;border-bottom:1px solid var(--sd-line);padding:0 0 10px}.channel-links{display:flex;gap:4px;overflow-x:auto;max-height:100px}button{width:auto;flex:none;max-width:220px}.scope-note{display:none}.channel-filter{max-width:280px}}
</style>
