<script lang="ts">
 import {page} from '$app/stores';
 import {onMount} from 'svelte';
 import {goto} from '$app/navigation';
 import {getChatById} from '$lib/apis/chats';
 import {chatPath,botChatPath} from '$lib/utils/starli-chat-url';
 import Chat from '$lib/components/chat/Chat.svelte';
 import Help from '$lib/components/layout/Help.svelte';
 onMount(async()=>{
  try{
   const chat=await getChatById(localStorage.token,$page.params.id);
   let name=chat?.title??'starli';
   const r=await fetch('/api/v1/starli/v3-native/agents',{headers:{Authorization:'Bearer '+localStorage.token}});
   if(r.ok){const data=await r.json();const agent=(data.items??data.agents??[]).find((a:any)=>a.chatId===$page.params.id);if(agent)name=agent.name;}
   await goto(botChatPath(name,$page.params.id),{replaceState:true});
  }catch{}
 });
</script>
<Help/><Chat chatIdProp={$page.params.id}/>
