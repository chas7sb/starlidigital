<script lang="ts">
 import {onDestroy} from 'svelte';
 import {user} from '$lib/stores';
 import {portraitIndex,artPosition,avatarVersions} from './identity';
 export let agent:any;
 export let size=44;
 let image='', controller:AbortController|null=null, last='';
 function clear(){controller?.abort();if(image)URL.revokeObjectURL(image);image='';}
 async function load(id:string,version:string,owner:string){
  clear(); if(!version||!owner)return;
  const active=new AbortController();controller=active;
  const token=localStorage.token;
  try{
   const res=await fetch('/api/v1/starli/avatars/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token},signal:active.signal,cache:'no-store'});
   if(!res.ok||res.headers.get('content-type')!=='image/webp')return;
   const blob=await res.blob();
   if(!active.signal.aborted&&owner===$user?.id&&token===localStorage.token)image=URL.createObjectURL(blob);
  }catch{}
 }
 $: version=$avatarVersions[agent?.id]||'';
 $: scope=($user?.id||'')+'|'+agent?.id+'|'+version;
 $: if(scope!==last){last=scope;void load(agent?.id,version,$user?.id);}
 onDestroy(clear);
</script>
<span aria-hidden="true" class="sd-portrait" style:width={size+'px'} style:height={size+'px'} style:background-position={artPosition(portraitIndex(agent))}>{#if image}<img src={image} alt=""/>{/if}</span>
<style>.sd-portrait{display:inline-flex;overflow:hidden;flex:none;border-radius:50%;background:#ede6ff url('/starli-art/portraits.webp') no-repeat;background-size:300% 300%;box-shadow:inset 0 0 0 1px #41337816}.sd-portrait img{width:100%;height:100%;object-fit:cover}</style>
