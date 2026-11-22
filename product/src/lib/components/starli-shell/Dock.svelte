<script lang="ts">
 import {onMount,tick,createEventDispatcher} from 'svelte';
 import {get} from 'svelte/store';
 import {user} from '$lib/stores';
 import {starliAgents} from '$lib/stores/starli-activity';
 import {safeWindow,type WindowItem} from './identity';
 import {chatIdFromPath} from '$lib/utils/starli-chat-url';
 import Icon from './Icon.svelte';
 import Portrait from './Portrait.svelte';
 import ConversationHost from './ConversationHost.svelte';
 import GroupChat from './GroupChat.svelte';
 import {botChatPath} from '$lib/utils/starli-chat-url';
 export let owner:string;
 const dispatch=createEventDispatcher();
 let windows:WindowItem[]=[], ready=false, focusKey='',width=0;
 let container:HTMLElement;
 const key=()=> 'starli.workspace.windows.v1:'+encodeURIComponent(owner);
 function persist(list:WindowItem[]){windows=list;if(ready)try{sessionStorage.setItem(key(),JSON.stringify(list.map(({name,...v})=>({...v,name:''}))));}catch{}}
 function compact(item:WindowItem){update(item.key,{min:true,full:false});}
 function update(id:string,patch:Partial<WindowItem>){persist(windows.map(w=>w.key===id?{...w,...patch}:w));}
 async function focus(id:string){focusKey=id;await tick();container?.querySelector<HTMLElement>('[data-key="'+CSS.escape(id)+'"] .dock-title')?.focus();}
 export function open(item:WindowItem){
  if(!safeWindow(item)||!owner)return;
  const found=windows.find(w=>w.key===item.key||w.path===item.path);
  const next=found?windows.map(w=>w===found?{...w,min:false,name:item.name}:w):[...windows,{...item,min:false,full:false}];
  const id=found?.key||item.key;
  const visibleLimit=width<980?1:Math.max(1,Math.floor((width-80)/405));
  const others=next.filter(w=>w.key!==id&&!w.min);
  const hide=new Set(others.slice(0,Math.max(0,others.length-visibleLimit+1)).map(w=>w.key));
  persist(next.map(w=>hide.has(w.key)?{...w,min:true,full:false}:w));void focus(id);
 }
 function close(id:string){persist(windows.filter(w=>w.key!==id));}
 function toggle(item:WindowItem){if(item.min)open(item);else compact(item);}
 onMount(()=>{
  try{windows=JSON.parse(sessionStorage.getItem(key())||'[]').filter(safeWindow);}catch{}
  ready=true;
 });
</script>
<svelte:window bind:innerWidth={width}/>
<div class="sd-dock" bind:this={container}>
 {#each windows as w(w.key)}
 {@const agent=w.agentId?$starliAgents[w.agentId]:null}
 <section class="dock-window" class:mini={w.min} class:full={w.full} class:front={focusKey===w.key} data-key={w.key} aria-label={(agent?.name||w.name||'Conversation')+' chat window'}>
  <header><button class="dock-title" on:click={()=>toggle(w)} aria-expanded={!w.min}>{#if agent}<Portrait {agent} size={32}/>{:else}<Icon name={w.groupId?'groups':'chat'}/>{/if}<strong>{agent?.name||w.name||'Conversation'}</strong></button>
  {#if !w.min}<button aria-label="Open in main chat" title="Open in main chat" on:click={()=>{close(w.key);dispatch('main',w.path)}}><Icon name="arrow" size={16}/></button><button aria-label={w.full?'Restore compact chat':'Expand to full chat'} on:click={()=>{update(w.key,{full:!w.full});void focus(w.key)}}><Icon name="expand" size={16}/></button><button aria-label="Minimize chat" on:click={()=>compact(w)}><Icon name="minus" size={16}/></button>{/if}
  <button aria-label="Close chat window" on:click={()=>{close(w.key)}}><Icon name="close" size={16}/></button></header>
  <div class="dock-conversation" hidden={w.min}>
   {#if w.groupId}<GroupChat id={w.groupId}/>{:else}<ConversationHost {owner} chatId={chatIdFromPath(w.path)} agentId={w.agentId||null} on:bound={e=>update(w.key,{path:botChatPath(agent?.name||w.name,e.detail.chatId)})}/>{/if}
  </div>
 </section>{/each}
</div>
<style>.sd-dock{position:fixed;bottom:8px;right:12px;left:12px;z-index:46;display:flex;justify-content:flex-end;gap:9px;align-items:flex-end;pointer-events:none;flex-wrap:wrap}.dock-window{width:min(390px,96vw);height:min(510px,72dvh);background:var(--sd-card);border:1px solid var(--sd-line);border-radius:17px;box-shadow:0 10px 48px #25204d32;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;color:var(--sd-text)}.dock-window.mini{height:50px;width:min(180px,46vw)}.dock-window.full{position:fixed;inset:76px 18px 10px 18px;width:auto;height:auto;z-index:2}.dock-window header{background:var(--sd-tint);display:flex;align-items:center;gap:1px;min-height:49px;padding:4px 7px;border-bottom:1px solid var(--sd-line)}.dock-window button{border-radius:8px;display:inline-flex;align-items:center;justify-content:center;min-width:34px;min-height:36px}.dock-window button:hover{background:var(--sd-selected)}.dock-title{flex:1;gap:8px;min-width:0!important;justify-content:flex-start!important}.dock-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dock-conversation{min-height:0;flex:1;width:100%;border:0}.dock-conversation[hidden]{display:none}@media(max-width:700px){.sd-dock{bottom:max(5px,env(safe-area-inset-bottom));justify-content:flex-start}.dock-window:not(.mini){position:fixed;inset:6px 5px max(6px,env(safe-area-inset-bottom));width:auto;height:auto;z-index:3}.mini button{min-height:44px}.dock-window button{min-width:42px;min-height:44px}}</style>
