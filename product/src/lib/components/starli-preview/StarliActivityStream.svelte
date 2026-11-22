<script lang="ts">
 import {user,socket} from '$lib/stores';
 import {verifyBrowserIdentity} from '$lib/utils/starli-browser-session';
 import {onMount,onDestroy} from 'svelte';
 import {receiveStarliActivity} from '$lib/stores/starli-activity';
 export let chatId:string|null=null;
 let seen='',mounted=false,hasMore=false,before:number|null=null,beforeId='',loading=false,error='',epoch=0,initialized=false;
 let controller:AbortController|null=null;
 async function load(older=false){
  if(!chatId||loading)return;
  const current=chatId,requestEpoch=epoch,account=$user?.id,token=localStorage.token??'';if(!account||!token)return;
  controller?.abort();controller=new AbortController();loading=true;error='';
  const params=new URLSearchParams();
  if(older&&before!==null){params.set('before',String(before));if(beforeId)params.set('before_id',beforeId);}
  try{
   await verifyBrowserIdentity(token,account,controller.signal);
   const r=await fetch('/api/v1/starli/workspace/chats/'+encodeURIComponent(current)+'/activity'+(params.size?'?'+params:''),{headers:{Authorization:'Bearer '+token},signal:controller.signal});
   if(!r.ok)throw Error('Activity history is temporarily unavailable ('+r.status+').');
   const d=await r.json();if(current!==chatId||requestEpoch!==epoch||account!==$user?.id||token!==localStorage.token)return;
   for(const event of d.events??[])receiveStarliActivity(event);
   if(older||!initialized){hasMore=d.hasMore===true;before=typeof d.before==='number'?d.before:before;beforeId=typeof d.beforeId==='string'?d.beforeId:beforeId;initialized=true;}
  }catch(e){if(requestEpoch===epoch&&current===chatId&&(e as Error).name!=='AbortError')error=(e as Error).message;}
  finally{if(requestEpoch===epoch)loading=false;}
 }
 $: if(mounted&&(($user?.id??'')+'|'+(chatId??''))!==seen){controller?.abort();epoch++;seen=($user?.id??'')+'|'+(chatId??'');before=null;beforeId='';initialized=false;hasMore=false;loading=false;error='';void load();}
 let eventSocket:any=null;const reconnect=()=>{void load();};
 $: if(mounted&&$socket!==eventSocket){eventSocket?.off('connect',reconnect);eventSocket=$socket;eventSocket?.on('connect',reconnect);}
 onMount(()=>{mounted=true;});
 onDestroy(()=>{epoch++;controller?.abort();eventSocket?.off('connect',reconnect);});
</script>
<!-- Headless hydration only: execution is rendered inside its bound native assistant response. -->
