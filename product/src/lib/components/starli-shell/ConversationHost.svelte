<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 import {get} from 'svelte/store';import {user} from '$lib/stores';
 import '$lib/starli-messenger/style.css';
 export let owner:string;export let chatId:string|null=null;export let agentId:string|null=null;
 const dispatch=createEventDispatcher();let target:HTMLDivElement,handle:{dispose():void}|null=null,alive=true,error='';
 onMount(()=>{const scope={ownerId:owner,companyId:null,membershipRevision:null,conversationId:chatId,agentId};
  void import('$lib/starli-messenger/messenger.js').then(({mountPersonalConversation})=>{if(!alive)return;handle=mountPersonalConversation(target,scope,()=>({scope:{...scope,ownerId:get(user)?.id||''},token:localStorage.token||''}),id=>{if(alive)dispatch('bound',{chatId:id});});}).catch(()=>{if(alive)error='Conversation could not open. Reopen it to try again.';});
 });
 function session(event:StorageEvent){if(event.key==='token'||event.key===null){handle?.dispose();handle=null;error='Your sign-in changed. Reopen this conversation.';}}
 onMount(()=>{window.addEventListener('storage',session);const off=user.subscribe(value=>{if(value?.id!==owner){handle?.dispose();handle=null;}});return()=>{off();window.removeEventListener('storage',session);};});
 onDestroy(()=>{alive=false;handle?.dispose();});
</script>
<div class="conversation-host" bind:this={target}></div>{#if error}<p role="alert">{error}</p>{/if}
<style>.conversation-host{height:100%;min-height:0;width:100%}p{font-size:13px;padding:16px}</style>
