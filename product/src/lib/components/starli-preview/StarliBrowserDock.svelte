<script lang="ts">
 import { onMount } from 'svelte';
 import { page } from '$app/stores';
 import { user,chatId } from '$lib/stores';
 import {chatIdFromPath} from '$lib/utils/starli-chat-url';
 import StarliAccessMode from './StarliAccessMode.svelte';
 import StarliBrowserPanel from './StarliBrowserPanel.svelte';
 let open=false,wasAvailable=false,stopped=false,owner='',epoch=0;
 $: persistedChat=chatIdFromPath($page.url.pathname)===$chatId?$chatId:null;
 $: contextKey=($user?.id??'')+'|'+(persistedChat??'');
 $: if(owner!==contextKey){owner=contextKey;epoch++;open=false;wasAvailable=false;}
 onMount(()=>{
  function showBrowser(event:CustomEvent){if(event.detail?.ownerId===$user?.id&&event.detail?.chatId===persistedChat)open=true;}
  window.addEventListener('starli-open-browser',showBrowser as EventListener);
  async function poll(){
   if(stopped)return;
   if(['admin','user'].includes($user?.role)&&($page.url.pathname==='/'||$page.url.pathname.startsWith('/c/')||/-[0-9a-f-]{36}$/i.test($page.url.pathname))){
    const e=epoch,token=localStorage.token;
    try{const r=await fetch('/api/v1/starli/browser/status',{headers:{Authorization:`Bearer ${localStorage.token}`}});if(r.ok){const s=await r.json();if(e!==epoch||token!==localStorage.token)return;if(s.available&&!wasAvailable)open=true;wasAvailable=!!s.available;}}catch{}
   }
   if(!stopped)setTimeout(poll,3000);
  }
  void poll();return()=>{stopped=true;window.removeEventListener('starli-open-browser',showBrowser as EventListener);};
 });
</script>
{#if ['admin','user'].includes($user?.role)&&($page.url.pathname==='/'||$page.url.pathname.startsWith('/c/')||/-[0-9a-f-]{36}$/i.test($page.url.pathname))}
 <details class="fixed bottom-2 left-3 z-30 rounded-xl bg-white px-2 text-xs text-gray-600 shadow-sm dark:bg-gray-900 dark:text-gray-300"><summary class="cursor-pointer">Runtime controls</summary><StarliAccessMode /></details>
 {#if open}{#key owner}<aside aria-label="Live Starli browser" class="fixed bottom-4 right-4 top-16 z-40 w-[min(580px,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800"><div class="flex justify-end p-2"><button class="rounded-lg px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>open=false}>Hide browser</button></div><StarliBrowserPanel chatId={persistedChat}/></aside>{/key}
 {/if}
{/if}
