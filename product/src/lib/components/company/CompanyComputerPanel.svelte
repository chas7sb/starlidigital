<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher,tick} from 'svelte';
 import Spinner from '$lib/components/common/Spinner.svelte';

 export let companyId:string;
 const dispatch=createEventDispatcher();
 const controller=new AbortController();
 const base='/api/v1/companies/'+encodeURIComponent(companyId)+'/computer/relay/viewers';
 let sessionToken='', viewerId='', relayId='', computerId='', image='', message='Opening desktop…';
 let timer:ReturnType<typeof setTimeout>, freshnessTimer:ReturnType<typeof setTimeout>, cursor=0, failures=0;

 function clearFrame(){
  clearTimeout(freshnessTimer);
  if(image)URL.revokeObjectURL(image);
  image='';
 }
 function waiting(){
  clearTimeout(freshnessTimer);
  message=image?'Last frame · reconnecting':'Connecting to desktop…';
 }
 function schedule(next:()=>Promise<void>, ms:number){
  clearTimeout(timer);
  if(!controller.signal.aborted)timer=setTimeout(()=>void next(),ms);
 }
 function current(){return !controller.signal.aborted && localStorage.token===sessionToken;}
 function headers(){
  return {Authorization:'Bearer '+sessionToken,'X-Company-Id':companyId,...(viewerId&&relayId?{'X-Viewer-Id':viewerId}:{})};
 }
 async function request(path:string,method='GET'){
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]);
  const response=await fetch(path,{method,signal,credentials:'same-origin',cache:'no-store',headers:headers()});
  if(!current())throw Error('Session changed');
  if(response.status===401){
   clearFrame();controller.abort();dispatch('denied');throw Error('Sign-in expired');
  }
  return response;
 }
 async function connect(){
  try{
   const opened=await request(base,'POST');
   if(opened.status===403){clearFrame();message='Computer access unavailable';return;}
   if(!opened.ok)throw Error('Desktop unavailable');
   const grant=await opened.json();
   if(!current())return;
   if(grant.company!==companyId||typeof grant.computer!=='string'||!grant.computer||typeof grant.viewer_id!=='string'||!grant.viewer_id||typeof grant.relayId!=='string'||!grant.relayId){
    clearFrame();message='Computer access unavailable';return;
   }
   if((computerId&&computerId!==grant.computer)||(viewerId&&viewerId!==grant.viewer_id))clearFrame();
   computerId=grant.computer;viewerId=grant.viewer_id;relayId=grant.relayId;cursor=0;failures=0;waiting();
   await frame();
  }catch{
   if(current()){waiting();schedule(connect,Math.min(500*2**Math.min(++failures,4),5000));}
  }
 }
 async function frame(){
  try{
   const path=base+'/'+encodeURIComponent(relayId)+'/frame?after='+cursor;
   const response=await request(path);
   if(response.status===403||response.status===404){
    if(response.status===403){clearFrame();viewerId='';}
    relayId='';waiting();schedule(connect,120);return;
   }
   if(response.status===204){
    schedule(frame,400);return;
   }
   if(!response.ok||!response.headers.get('content-type')?.startsWith('image/jpeg'))throw Error('Invalid frame');
   const seq=Number(response.headers.get('X-Starli-Frame-Cursor'));
   const blob=await response.blob();
   if(!current())return;
   if(!Number.isSafeInteger(seq)||seq<=cursor||blob.size>8*1024*1024||!blob.size)throw Error('Invalid desktop frame');
   const next=URL.createObjectURL(blob);
   const decoded=new Image();decoded.src=next;
   try{await decoded.decode();}catch{URL.revokeObjectURL(next);throw Error('Invalid desktop pixels');}
   if(!current()){URL.revokeObjectURL(next);return;}
   const previous=image;image=next;cursor=seq;clearTimeout(freshnessTimer);
   freshnessTimer=setTimeout(()=>{message='Last frame · waiting for update';},4000);
   message='Live desktop';failures=0;await tick();if(previous)URL.revokeObjectURL(previous);
   schedule(frame,600);
  }catch{
   if(current()){waiting();schedule(frame,Math.min(700*2**Math.min(++failures,3),4000));}
  }
 }
 function closeViewer(){
  if(!sessionToken||!viewerId||!relayId)return;
  void fetch(base+'/'+encodeURIComponent(relayId),{method:'DELETE',credentials:'same-origin',cache:'no-store',keepalive:true,headers:headers()}).catch(()=>{});
  viewerId='';relayId='';
 }
 function changed(event:StorageEvent){if(event.key==='token'||event.key===null){controller.abort();clearTimeout(timer);clearFrame();dispatch('denied');}}
 onMount(()=>{sessionToken=localStorage.token;void connect();window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);});
 onDestroy(()=>{controller.abort();clearTimeout(timer);clearFrame();closeViewer();});
</script>
<section class="company-computer" aria-label="Company Computer">
 <header><strong>Starli Computer</strong><span role="status">{message}</span><button type="button" aria-label="Close computer" on:click={()=>dispatch('close')}>Close</button></header>
 {#if image}<img src={image} alt="Authenticated live company desktop"/>{:else if message!=='Computer access unavailable'}<div class="opening"><Spinner/></div>{/if}
 <small>View only</small>
</section>
<style>.company-computer{margin-top:12px;overflow:hidden;border:1px solid var(--sd-line);border-radius:12px;background:var(--sd-card)}header{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--sd-line);font-size:13px}header span{margin-left:auto;font-size:12px;color:var(--sd-muted)}button{padding:4px 8px;border-radius:6px;font-size:12px}img{display:block;width:100%;max-height:48dvh;object-fit:contain;background:#111827}.opening{display:flex;justify-content:center;padding:24px}p{padding:12px;font-size:13px}small{display:block;padding:6px 12px;font-size:11px;color:var(--sd-muted)}</style>
