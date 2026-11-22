<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 export let companyId:string;
 export let roomId:string='';
 export let botId:string='';
 export let runId:string='';
 export let accessSignal:AbortSignal|undefined=undefined;
 const dispatch=createEventDispatcher();
 let frame:any=null,capability:any=null,url='',lastFrameUrl='',text='',error='',busy=false,loaded=false,showText=false;
 let mounted=false,generation=0,context='',roomBotContext='',controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>;
 let token='',imageReady=false;
 $: nextContext=[companyId,roomId,botId,runId].join('|');
 $: if(mounted&&context!==nextContext){
  const nextRoomBot=[companyId,roomId,botId].join('|');
  const preserveFrame=roomBotContext===nextRoomBot&&frame?.available===true;
  context=nextContext;roomBotContext=nextRoomBot;
  void connect(preserveFrame);
 }
 $: canControl=capability?.control===true&&capability?.available===true;
 function clear(preserveFrame=false){
  generation++;controller?.abort();controller=null;
  if(!preserveFrame){frame=null;capability=null;text='';url='';lastFrameUrl='';imageReady=false;loaded=false;}
  busy=false;
 }
 function revoke(){clear(false);error='Your session changed. Sign in again to continue.';dispatch('revoked');}
 function fresh(g:number){if(g!==generation||controller?.signal.aborted||accessSignal?.aborted||token!==localStorage.token)throw Error('Browser access changed.');}
 function diagnosticMessage(status:number,detail:string):string{
  const code=(detail||'').trim();
  if(status===401||code==='BROWSER_NATIVE_SESSION_DENIED')return 'Your session expired. Sign in again to continue.';
  if(code==='BROWSER_AUTHORITY_DENIED')return 'Browser permission (computer.view / computer.control) is not granted for this bot or member.';
  if(code==='BROWSER_NOT_REGISTERED')return 'The isolated Chromium browser is not registered for this company.';
  if(code==='BROWSER_NATIVE_RUN_UNAVAILABLE')return 'Waiting for an active or completed bot browser session in this conversation.';
  if(code==='BROWSER_URL_BLOCKED'||code==='BROWSER_URL_INVALID')return 'That address is blocked by security policy. Enter a public http:// or https:// website.';
  if(code==='BROWSER_NAVIGATION_FAILED')return 'The website could not be reached or timed out.';
  if(code==='BROWSER_COORDINATES_OUTSIDE_FRAME'||code==='BROWSER_COORDINATES_INVALID')return 'Click coordinates were outside the active browser viewport.';
  if(code==='BROWSER_BUSY')return 'All company browser sessions are currently busy. Close an idle session or try again shortly.';
  if(status===409||code==='BROWSER_STALE_FRAME')return 'The browser view updated. Try your action again.';
  if(status===403)return 'Browser access is not permitted for this conversation.';
  return 'The browser could not complete this request.';
 }
 async function request(path:string,g:number,body?:any){
  fresh(g);
  const query=new URLSearchParams({roomId,botId,runId});
  const response=await fetch('/api/v1/starli/companies/'+encodeURIComponent(companyId)+'/browser/'+path+'?'+query,{method:body?'POST':'GET',signal:controller?.signal,cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  fresh(g);
  if(!response.ok){
   let detail='';
   try{const errJson=await response.json();detail=typeof errJson?.detail==='string'?errJson.detail:'';}catch{}
   fresh(g);
   if(response.status===401){revoke();throw Error('Your session expired. Sign in again to continue.');}
   const err:any=new Error(diagnosticMessage(response.status,detail));
   err.status=response.status;err.code=detail;
   throw err;
  }
  const data=await response.json();fresh(g);
  if(data.version!=='starli.browser.v1'||data.scope?.company!==companyId||data.scope?.room!==roomId||data.scope?.bot!==botId||data.scope?.run!==runId)throw Error('Browser scope could not be verified.');
  return data;
 }
 function apply(data:any){if(data.image&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.image))throw Error('Browser image could not be verified.');imageReady=Boolean(data.image);frame=data;if(data.url&&data.url!==lastFrameUrl){lastFrameUrl=data.url;url=data.url;}}
 async function connect(preserveFrame=false){
  clear(preserveFrame);error='';token=localStorage.token||'';if(!companyId||!roomId||!botId||!runId||!token)return;
  controller=new AbortController();const g=generation;busy=true;
  try{capability=await request('capability',g);if(capability.available&&capability.view)apply(await request('frame',g));loaded=true;}
  catch(cause){if(g===generation)error=(cause as Error).message;}finally{if(g===generation)busy=false;}
 }
 async function refresh(){if(busy||!controller||!capability?.view||document.hidden)return;const g=generation;busy=true;
  try{capability=await request('capability',g);if(capability.view&&capability.available)apply(await request('frame',g));else frame=null;error='';}
  catch(cause){if(g===generation)error=(cause as Error).message;}finally{if(g===generation)busy=false;}
 }
 async function action(name:string,args:any){
  if(busy||!canControl||!controller)return;const g=generation;busy=true;error='';
  const body={action:name,args,actionId:crypto.randomUUID(),frameId:frame?.frameId??null};
  try{apply(await request('actions',g,body));if(name==='type')text='';}
  catch(cause:any){
   if(g===generation){
    if(cause?.status===409&&capability?.view){
     try{apply(await request('frame',g));}catch{}
    }
    error=(cause as Error).message;
   }
  }finally{if(g===generation)busy=false;}
 }
 function navigate(){
  try{
   const raw=url.trim();
   const normalized=/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)?raw:'https://'+raw;
   const target=new URL(normalized);
   if(!['https:','http:'].includes(target.protocol)||target.username||target.password)throw Error();
   url=target.href;
   void action('navigate',{url:target.href});
  }catch{error='Enter a public http or https website address.';}
 }
 function click(event:MouseEvent){if(!imageReady)return;const image=(event.currentTarget as HTMLButtonElement).querySelector('img');if(!image)return;const rect=image.getBoundingClientRect();if(!rect.width||!rect.height)return;const natW=image.naturalWidth||1280,natH=image.naturalHeight||720;void action('click',{x:Math.max(0,Math.min(natW-1,Math.floor((event.clientX-rect.left)*natW/rect.width))),y:Math.max(0,Math.min(natH-1,Math.floor((event.clientY-rect.top)*natH/rect.height)))});}
 function storage(event:StorageEvent){if(event.key==='token'||event.key===null)revoke();}
 onMount(()=>{mounted=true;window.addEventListener('storage',storage);accessSignal?.addEventListener('abort',revoke);async function poll(){if(!mounted)return;await refresh();if(mounted)timer=setTimeout(poll,1800);}void poll();});
 onDestroy(()=>{mounted=false;clearTimeout(timer);window.removeEventListener('storage',storage);accessSignal?.removeEventListener('abort',revoke);clear(false);});
</script>

<section class="browser" aria-label="Company browser">
 <header><div class="heading"><span>Browser</span><span class="status" class:live={frame?.available&&!busy}>{busy?'Loading…':frame?.available?'Live':capability?.available?'Ready':'Unavailable'}</span><button class="close-pane" type="button" aria-label="Close browser pane" title="Close browser pane" on:click={()=>dispatch('close')}>&times;</button></div>
 <form on:submit|preventDefault={navigate}><input aria-label="Website address" bind:value={url} maxlength={2048} placeholder="https://example.com"/><button disabled={busy||!canControl} type="submit">{busy?'Loading…':'Open'}</button></form>
 <div class="toolbar"><button type="button" disabled={busy||!capability?.view} on:click={refresh}>Refresh</button><button type="button" disabled={busy||!canControl||!frame?.available} on:click={()=>action('scroll',{direction:'up'})}>↑ Scroll up</button><button type="button" disabled={busy||!canControl||!frame?.available} on:click={()=>action('scroll',{direction:'down'})}>↓ Scroll down</button>{#if frame?.text}<button type="button" on:click={()=>showText=!showText}>{showText?'Hide text':'Page text'}</button>{/if}<span></span><button type="button" disabled={busy||!canControl||!frame?.available} on:click={()=>action('close',{})}>Close page</button></div></header>
 {#if error}<p class="message" role="alert">{error}</p>{/if}
 {#if frame?.available}
  <div class="page-title" title={frame.url}><strong>{frame.title||'Untitled page'}</strong><span> &middot; {frame.url}</span></div>
  <button class="viewport" type="button" aria-label="Click the browser page" disabled={busy||!canControl} on:click={click}><img src={frame.image} alt="Current company browser page" on:load={()=>imageReady=true}/></button>
  {#if showText&&frame.text}<pre class="page-text" aria-label="Extracted page text">{frame.text}</pre>{/if}
  <form class="typing" on:submit|preventDefault={()=>action('type',{text})}><input aria-label="Text for focused field" placeholder="Type into the focused element" bind:value={text} maxlength={2000} disabled={!canControl||busy}/><button type="submit" disabled={!canControl||busy||!text}>Type</button><button type="button" disabled={!canControl||busy} on:click={()=>action('key',{key:'Enter'})}>Enter</button><button type="button" disabled={!canControl||busy} on:click={()=>action('key',{key:'Tab'})}>Tab</button><button type="button" disabled={!canControl||busy} on:click={()=>action('key',{key:'Backspace'})}>⌫</button></form>
 {:else}<div class="empty"><span>{busy?'Opening browser…':'Browse with your bot'}</span><p>{!roomId||!botId||!runId?'Select a bot conversation to connect its browser.':loaded&&!capability?.available?'A browser is not registered for this company or bot.':capability?.available?'Enter a public website address above, or ask your bot in chat to open a website.':'Connecting to the company browser…'}</p>{#if !busy&&roomId&&botId&&runId}<button type="button" on:click={()=>connect(false)}>Check connection</button>{/if}</div>{/if}
</section>

<style>
 .browser{display:flex;flex-direction:column;height:100%;min-height:320px;width:clamp(360px,45vw,780px);flex:none;border-left:1px solid #e6ebf4;color:#17243f;background:#ffffff;font-size:13px;line-height:1.5;font-family:inherit}header{padding:18px 20px 10px;border-bottom:1px solid #e6ebf4}.heading{display:flex;align-items:center;gap:12px;}.heading>span:first-child{flex:1}.heading{justify-content:space-between;margin-bottom:14px;font-weight:500}.status{font-size:11px;color:#71809a;font-weight:400}.status.live{color:#15803d;font-weight:600}form{display:flex;gap:8px}input{min-width:0;flex:1;background:#f6f8fc;border:1px solid #e6ebf4;border-radius:7px;padding:8px 10px;color:inherit;outline:none}input:focus{border-color:#8aa9e4}button{border:1px solid #e6ebf4;background:#f6f8fc;color:#17243f;border-radius:6px;padding:6px 11px;font-size:12px}button:disabled{opacity:.35;cursor:default}.toolbar{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}.toolbar span{flex:1}.toolbar button{border:0;background:transparent;padding:4px 7px;color:#71809a}.message{margin:10px 20px 0;padding:8px 12px;background:#fff1f2;border:1px solid #fecdd3;border-radius:7px;color:#be123c;font-size:12px}.page-title{padding:10px 20px;font-size:11px;color:#71809a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid #f1f5f9}.page-title strong{color:#17243f;font-weight:600}.viewport{padding:0;border:0;border-radius:0;display:block;width:100%;background:#f8fafc;overflow:auto;cursor:crosshair}.viewport:disabled{opacity:1;cursor:default}.viewport img{display:block;width:100%;height:auto}.page-text{margin:0;padding:12px 20px;max-height:160px;overflow:auto;background:#f8fafc;border-top:1px solid #e6ebf4;font-family:ui-monospace,monospace;font-size:11px;white-space:pre-wrap;color:#334155}.typing{padding:14px 16px;border-top:1px solid #e6ebf4;margin-top:auto}.empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:40px 28px;text-align:center}.empty span{color:#17243f;font-size:14px}.empty p{max-width:290px;color:#71809a;font-size:12px;margin:10px 0 18px}
.close-pane{border:0;background:transparent;padding:0 3px;font-size:20px;line-height:1;color:#71809a}@media(max-width:767px){.browser{position:fixed;inset:0 0 0 auto;width:100%;height:100dvh;min-height:0;z-index:60;border-left:0}.typing{flex-wrap:wrap}.typing input{flex-basis:100%}}
</style>
