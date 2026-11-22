<script lang="ts">
 import {onMount} from 'svelte';
 import {user} from '$lib/stores';
 import {BrowserSession,BrowserRequestError,browserURL,verifyBrowserIdentity,browserScopeQuery,manualBrowserPayload,type ManualBrowserScope} from '$lib/utils/starli-browser-session';
 export let chatId:string|null=null;
 let frame:any=null,url='https://example.com',error='',busy=false,refreshing=false,disposed=true,session:BrowserSession|null=null,typedText='',timer:ReturnType<typeof setTimeout>,owner='',mounted=false,revision=0,identityController:AbortController|null=null,controlsAllowed=false,manualScope:ManualBrowserScope|null=null,imageReady=false;
 $: administrator=$user?.role==='admin';
 $: interactive=administrator&&controlsAllowed&&!!manualScope;
 $: blocked=busy||refreshing;
 function applyFrame(next:any){if(next?.image!==frame?.image)imageReady=false;frame=next;}
 function reset(){revision++;identityController?.abort();identityController=null;session?.invalidate();session=null;controlsAllowed=false;manualScope=null;frame=null;imageReady=false;url='https://example.com';typedText='';busy=false;refreshing=false;error='';}
 async function bindAccount(){
  reset();owner=$user?.id??'';const e=revision,token=localStorage.token,expected=owner;if(!owner||!token)return;
  const controller=new AbortController();identityController=controller;const timeout=setTimeout(()=>controller.abort(),12000);
  try{
   await verifyBrowserIdentity(token,expected,controller.signal);
   if(disposed||e!==revision||owner!==expected||localStorage.token!==token)return;
   session=new BrowserSession(token,()=>localStorage.token);
   await checkAccess();await refresh();
  }catch(cause){if(!disposed&&e===revision)error=(cause as Error).message;}finally{clearTimeout(timeout);}
 }
 $: accountContext=($user?.id??'')+'|'+(chatId??'');
 let seenContext='';
 $: if(mounted&&seenContext!==accountContext){seenContext=accountContext;void bindAccount();}
 function storage(event:StorageEvent){if(event.key==='token'||event.key===null){reset();error='Account changed. Reconnect the browser.';}}
 async function checkAccess(){
  const e=++revision,token=localStorage.token;session?.invalidate();refreshing=false;controlsAllowed=false;manualScope=null;applyFrame(null);
  if(!administrator||!session||!chatId)return;
  try{
   const headers={Authorization:'Bearer '+token},signal=identityController?.signal;
   const bindingResponse=await fetch('/api/v1/starli/v3-native/chats/'+encodeURIComponent(chatId)+'/platform-access',{headers,signal});
   const binding=await bindingResponse.json();
   if(!bindingResponse.ok||binding.chatId!==chatId||typeof binding.agentId!=='string')return;
   const scope={chatId,expectedAgentId:binding.agentId};
   const response=await fetch('/api/v1/starli/browser/capability?'+browserScopeQuery(scope),{headers,signal});
   const data=await response.json();
   if(disposed||e!==revision||token!==localStorage.token||chatId!==scope.chatId)return;
   if(response.ok&&data.chatId===scope.chatId&&data.agentId===scope.expectedAgentId&&data.manualActions===true){manualScope=scope;controlsAllowed=true;}
  }catch{if(e===revision)controlsAllowed=false;}
 }
 async function refresh(){
  if(!session||blocked||document.hidden||(manualScope&&!controlsAllowed))return;const e=revision;refreshing=true;
  try{const next=await session.request(manualScope?'manual/frame?'+browserScopeQuery(manualScope):'frame');if(!disposed&&e===revision){applyFrame(next);error='';}}
  catch(cause){if(!disposed&&e===revision){applyFrame(null);if(cause instanceof BrowserRequestError&&[401,403].includes(cause.status))controlsAllowed=false;error=(cause as Error).message;}}
  finally{if(!disposed&&e===revision)refreshing=false;}
 }
 async function action(path:string,payload?:any,method='POST'){
  if(!session||blocked)return;const e=++revision;busy=true;error='';
  try{const next=await session.request(path,method,payload);if(!disposed&&e===revision){applyFrame(path.includes('session')?null:next);if(frame?.url)url=frame.url;if(path==='type')typedText='';}}
  catch(cause){if(!disposed&&e===revision){applyFrame(null);if(cause instanceof BrowserRequestError&&[401,403].includes(cause.status))controlsAllowed=false;error=(cause as Error).message;}}
  finally{if(!disposed&&e===revision)busy=false;}
 }
 function navigate(){try{void action(manualScope?'manual/navigate':'navigate',{url:browserURL(url),...(manualScope??{})});}catch(cause){error=(cause as Error).message;}}
 function interact(path:string,payload:any){
  if(!interactive||!manualScope||!imageReady)return;
  try{void action(path,manualBrowserPayload(manualScope,frame,payload));}catch(cause){error=(cause as Error).message;}
 }
 function scroll(direction:string){if(manualScope)interact('key',{key:direction==='up'?'ArrowUp':'ArrowDown'});else void action('scroll',{direction});}
 function clickScreenshot(event:MouseEvent){
  if(!interactive||blocked||!imageReady)return;
  const el=event.currentTarget as HTMLImageElement,rect=el.getBoundingClientRect();if(!rect.width||!el.naturalWidth)return;
  interact('click',{x:Math.min(5000,Math.max(0,Math.round((event.clientX-rect.left)*el.naturalWidth/rect.width))),y:Math.min(5000,Math.max(0,Math.round((event.clientY-rect.top)*el.naturalHeight/rect.height)))});
 }
 function pageClick(event:MouseEvent){if(event.detail===0){interact('key',{key:'Enter'});return;}const image=(event.currentTarget as HTMLButtonElement).querySelector('img');if(image&&event.detail>0)clickScreenshot({currentTarget:image,clientX:event.clientX,clientY:event.clientY} as unknown as MouseEvent);}
 function close(){void action(manualScope?'manual/session?'+browserScopeQuery(manualScope):'session',undefined,'DELETE');}
 onMount(()=>{
  disposed=false;mounted=true;window.addEventListener('storage',storage);
  async function poll(){if(disposed)return;await refresh();if(!disposed)timer=setTimeout(poll,1500);}
  void poll();return()=>{disposed=true;mounted=false;clearTimeout(timer);window.removeEventListener('storage',storage);reset();};
 });
</script>
<section class="flex min-h-0 flex-col rounded-2xl border border-gray-100 dark:border-gray-800" aria-label="Starli live browser">
 <header class="border-b border-gray-100 p-4 dark:border-gray-800"><div class="mb-3 flex items-center justify-between"><h2 class="font-medium">Live browser</h2><span class="text-xs text-gray-500" role="status">{busy?'Working…':refreshing?'Updating view…':frame?.available?'Session connected':'Ready for a page'}</span></div>
 {#if !session}<button on:click={bindAccount} class="mb-2 rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Reconnect browser</button>{/if}<form on:submit|preventDefault={navigate} class="flex gap-2"><input aria-label="Public website URL" type="text" inputmode="url" autocomplete="off" spellcheck={false} maxlength={2048} bind:value={url} required class="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-2 text-sm dark:bg-gray-850"/><button disabled={blocked||!session||!!manualScope&&!controlsAllowed} class="rounded-xl bg-gray-100 px-4 py-2 text-sm dark:bg-gray-800">{busy?'Opening…':'Open'}</button></form>
 <p class="mt-2 text-xs text-gray-500">Public website browser. {administrator?(interactive?'Interactive access verified for this session.':'Interactive controls are unavailable in this browser context. You can open and scroll public pages.'):'You can open and scroll public pages.'}{#if administrator}<button class="ml-2 underline" disabled={blocked} on:click={async()=>{await checkAccess();await refresh();}}>Check access</button>{/if}</p></header>
 {#if manualScope&&!frame?.available}<button disabled={blocked} on:click={close} class="mx-4 my-2 rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Close session</button>{/if}
 {#if error}<p role="alert" class="p-4 text-sm">{error}</p>{/if}
 {#if frame?.available}<div class="flex gap-2 px-4 py-2 text-xs"><button class="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800" disabled={blocked} on:click={()=>scroll('up')}>Scroll up</button><button class="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800" disabled={blocked} on:click={()=>scroll('down')}>Scroll down</button><button class="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800" disabled={blocked} on:click={refresh}>Refresh view</button><button class="ml-auto rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800" disabled={blocked} on:click={close}>Close session</button></div>
 {#if administrator}<fieldset disabled={!interactive||blocked||!imageReady} aria-label="Browser interaction controls" class="m-0 flex flex-wrap gap-2 border-0 px-4 pb-2 disabled:opacity-40"><input maxlength={2000} aria-label="Text to type in focused browser field" placeholder="Type into selected field" bind:value={typedText} class="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm dark:bg-gray-850"/><button disabled={blocked||!typedText||!imageReady} on:click={()=>interact('type',{text:typedText})} class="rounded-lg border px-3 text-sm">Type</button><button disabled={blocked} on:click={()=>interact('key',{key:'Enter'})} class="rounded-lg border px-3 text-sm">Enter</button>{#each ['Tab','Escape','Backspace'] as key}<button disabled={blocked} on:click={()=>interact('key',{key})} class="rounded-lg border px-2 text-xs">{key}</button>{/each}</fieldset>{/if}<p class="truncate px-4 pb-2 text-xs text-gray-500">{frame.title} · {frame.url}</p><button disabled={blocked||!interactive||!imageReady} aria-label="Interact with browser page" class="block w-full disabled:cursor-default" on:click={pageClick}><img on:load={()=>imageReady=true} src={frame.image} alt="Current browser page screenshot" class="h-auto w-full rounded-b-2xl"/></button>
 {:else}<div class="p-10 text-center text-sm text-gray-500">Open a website or ask Starli to research a page. Its live view will appear here.</div>{/if}
</section>
