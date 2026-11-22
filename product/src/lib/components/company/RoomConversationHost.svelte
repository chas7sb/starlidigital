<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';import {get} from 'svelte/store';import {user} from '$lib/stores';import '$lib/starli-messenger/style.css';
 export let owner:string,companyId:string,room:any,messages:any[]=[],directory:any[]=[],draft='',busy=false,error='';
 export let sendMessage:()=>Promise<void>;export let refreshMessages:()=>Promise<void>;
 const dispatch=createEventDispatcher();let target:HTMLDivElement,handle:any=null,mounted=false,alive=true,loadError='',snapshot:any,token='',scope:any;
 const listeners=new Set<()=>void>();
 function update(){if(!mounted)return;snapshot=Object.freeze({version:'starli.conversation.view.v1',scope,title:room.name||'Company conversation',messages:messages.map(m=>({id:m.id,role:m.speaker.kind==='agent'?'assistant':'user',name:m.speaker.id===owner?(get(user)?.name||'You'):(m.speaker.kind==='agent'?'Shared bot · ':'')+(directory.find(a=>a.id===m.speaker.id)?.name||m.speaker.name||(m.speaker.kind==='agent'?'AI agent':'Team member')),content:m.deleted?'Message deleted':m.content})),draft,status:busy?'sending':'ready',canSend:!busy&&room.kind!=='work_session',canStop:false,canReplyInThread:true,error:error||null});for(const l of listeners)l();}
 $: if(mounted){messages;directory;draft;busy;error;room;update();}
 onMount(()=>{token=localStorage.token||'';scope={ownerId:owner,companyId,membershipRevision:null,conversationId:room.id,agentId:null};mounted=true;update();
  const controller={getSnapshot:()=>snapshot,subscribe:(l:()=>void)=>{listeners.add(l);return()=>listeners.delete(l);},setDraft:(value:string)=>{draft=value;},send:sendMessage,stop:async()=>{},refresh:refreshMessages,openThread:(id:string)=>dispatch('thread',id),detach:()=>listeners.clear()};
  void import('$lib/starli-messenger/messenger.js').then(({mountConversation})=>{if(alive)handle=mountConversation(target,scope,()=>controller,()=>alive&&token===localStorage.token&&owner===get(user)?.id&&companyId===scope.companyId&&room.id===scope.conversationId?scope:null);}).catch(()=>{if(alive)loadError='Company conversation could not open.';});
  const off=user.subscribe(value=>{if(value?.id!==owner){handle?.dispose();handle=null;}});const changed=(e:StorageEvent)=>{if(e.key==='token'||e.key===null){handle?.dispose();handle=null;loadError='Your session changed. Reopen this conversation.';}};window.addEventListener('storage',changed);return()=>{off();window.removeEventListener('storage',changed);};
 });
 onDestroy(()=>{alive=false;handle?.dispose();listeners.clear();});
</script>
<div class="room-conversation-host" bind:this={target}></div>{#if loadError}<p role="alert">{loadError}</p>{/if}
<style>.room-conversation-host{flex:1;min-height:0;overflow:hidden;width:100%}p{padding:12px;font-size:13px}</style>
