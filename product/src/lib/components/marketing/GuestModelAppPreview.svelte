<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {bootstrapModelPreview} from './guest-authority-client';
 export let build:any=null,intentId='',companyId='',projectId='',owner=false;
 let mounted=false,key='',frameUrl='',appOrigin='',error='',loading=false;
 let request:AbortController|null=null,frame:HTMLIFrameElement;
 onMount(()=>{
  mounted=true;
  const revoked=(event:MessageEvent)=>{
   if(event.source===frame?.contentWindow&&event.origin===appOrigin&&event.data?.type==='STARLI_PREVIEW_AUTHORITY_REVOKED'){
    frameUrl='';error='Application access was revoked.';request?.abort();
   }
  };
  window.addEventListener('message',revoked);
  return ()=>window.removeEventListener('message',revoked);
 });
 onDestroy(()=>{mounted=false;request?.abort();});
 $: nextKey=[build?.buildId,build?.status,build?.preview?.artifactDigest,build?.preview?.generation,companyId,projectId,owner].join(':');
 $: if(mounted&&nextKey!==key){key=nextKey;void open();}
 async function open(){
  request?.abort();frameUrl='';error='';
  if(build?.status!=='READY'||!companyId||!projectId)return;
  const current=new AbortController();request=current;loading=true;
  const timeout=setTimeout(()=>current.abort(),20000);
  try{
   const result=await bootstrapModelPreview({build,intentId,companyId,projectId,owner,
    authToken:owner?localStorage.getItem('token')||'':undefined,parentOrigin:location.origin,
    signal:current.signal,fetcher:fetch});
   if(request!==current||current.signal.aborted)return;
   appOrigin=result.appOrigin;frameUrl=result.frameUrl;
  }catch(cause){if(request===current&&mounted)error=current.signal.aborted?'Application access timed out. Reconnect to try again.':(cause as Error).message;}
  finally{clearTimeout(timeout);if(request===current)loading=false;}
 }
</script>
<section class="model-preview" aria-label="Live application preview">
 <header><h2>Application</h2>{#if frameUrl}<span>Live</span>{/if}</header>
 {#if frameUrl}<iframe bind:this={frame} src={frameUrl} title="Your live application" sandbox="allow-scripts allow-forms allow-same-origin" referrerpolicy="no-referrer"/>
 {:else}<div class="pending" role="status"><p>{loading?'Opening your application…':error||'Your application is being prepared.'}</p>
 {#if error}<button on:click={()=>void open()}>Reconnect application</button>{/if}</div>{/if}
</section>
<style>
 .model-preview{display:flex;flex-direction:column;height:100%;min-height:300px;background:white;border:1px solid #e4eaf5;border-radius:12px;overflow:hidden}
 header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e4eaf5}h2{font-size:16px;margin:0}header span{font-size:12px;color:#087443}
 iframe{flex:1;width:100%;border:0;background:white;min-height:400px}.pending{padding:24px;font-size:14px;color:#506280}button{background:white;border:1px solid #dce5f6;border-radius:8px;padding:10px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #7c62ff;outline-offset:3px}
</style>
