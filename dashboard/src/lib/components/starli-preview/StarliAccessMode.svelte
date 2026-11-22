<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {page} from '$app/stores';
 import {chatId,user} from '$lib/stores';
 import Switch from '$lib/components/common/Switch.svelte';
 import {chatIdFromPath} from '$lib/utils/starli-chat-url';

 type Target={key:string;chatId:string;userId:string};
 let mounted=false,scope='',epoch=0,controller:AbortController|null=null;
 let target:Target|null=null;
 let enabled=false,confirmed=false,ready=false,loading=false,busy=false,error='',agentId='',paused=false;
 $: persistedChat=typeof $chatId==='string'&&!!$chatId&&chatIdFromPath($page.url.pathname)===$chatId;
 $: target=$user?.role==='admin'&&$user?.id&&persistedChat?{key:$user.id+':'+$chatId,chatId:$chatId,userId:$user.id}:null;
 $: if(mounted&&scope!==(target?.key??'')){scope=target?.key??'';void load(target);}

 function current(value:Target,version:number){return mounted&&version===epoch&&scope===value.key&&$user?.id===value.userId&&$chatId===value.chatId&&chatIdFromPath($page.url.pathname)===value.chatId;}
 async function request(value:Target,signal:AbortSignal,method='GET',body?:object){
  const response=await fetch('/api/v1/starli/v3-native/chats/'+encodeURIComponent(value.chatId)+'/platform-access',{
   method,signal,headers:{Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Platform access request failed ('+response.status+')');
  if(data.chatId!==value.chatId||typeof data.enabled!=='boolean')throw Error('Platform access response did not match this conversation');
  return data;
 }
 function apply(data:any){confirmed=!!data.enabled;enabled=confirmed;agentId=typeof data.agentId==='string'?data.agentId:'';paused=confirmed&&data.effectiveEnabled===false;}
 async function load(value:Target|null){
  controller?.abort();const version=++epoch;enabled=false;confirmed=false;agentId='';paused=false;ready=false;error='';busy=false;loading=!!value;
  if(!value)return;
  const active=new AbortController();controller=active;
  try{const data=await request(value,active.signal);if(!current(value,version))return;apply(data);ready=true;}
  catch(e){if(current(value,version)&&!active.signal.aborted)error=e instanceof Error?e.message:'Platform access is unavailable';}
  finally{if(current(value,version))loading=false;}
 }
 async function change(event:CustomEvent){
  const desired=event.detail;
  if(typeof desired!=='boolean'||!ready||loading||busy||desired===confirmed||!target)return;
  const value={...target},version=epoch,expected=agentId;
  controller?.abort();const active=new AbortController();controller=active;busy=true;error='';
  try{const data=await request(value,active.signal,'PATCH',{enabled:desired,...(expected?{expectedAgentId:expected}:{})});if(!current(value,version))return;apply(data);}
  catch(e){if(current(value,version)&&!active.signal.aborted){enabled=confirmed;error=e instanceof Error?e.message:'Unable to change platform access';}}
  finally{if(current(value,version))busy=false;}
 }
 onMount(()=>{mounted=true;});
 onDestroy(()=>{mounted=false;epoch++;controller?.abort();});
</script>
{#if target}
 <section class="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900" aria-label="Platform access for this conversation">
  <div class="flex items-center justify-between gap-3"><div><p class="font-medium">Platform access</p><p class="mt-0.5 text-gray-500">{loading?'Checking this conversation…':busy?'Saving…':enabled?'Granted to this conversation’s agent':'Customer tools only'}</p></div>
   <fieldset disabled={loading||busy||!ready} class="m-0 border-0 p-0 disabled:opacity-40" aria-label="Platform access toggle">
    <Switch bind:state={enabled} label="Platform access for this conversation only" on:change={change}/>
   </fieldset>
  </div>
  {#if paused}<p class="mt-1 text-gray-500">This agent is paused. Its grant applies when it resumes.</p>{/if}
  {#if error}<p role="alert" class="mt-1 text-red-600 dark:text-red-400">{error} <button class="underline" on:click={()=>load(target)}>Retry</button></p>{/if}
 </section>
{/if}
