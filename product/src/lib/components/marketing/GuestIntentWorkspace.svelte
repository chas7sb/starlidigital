<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {consumeGuestSubmit} from './guest-submit-transfer';
 import {goto} from '$app/navigation';
 import {user} from '$lib/stores';
 import {Grokbot1JourneyClient} from './grokbot1-client';
 import {readClaimedConversation} from './guest-authority-client';
 import GuestModelAppPreview from './GuestModelAppPreview.svelte';
 import {temporaryWorkspace,guestBuild,activeGuestWork,verifiedOwnerResume} from './guest-workspace-extension';
 import {authenticateOnboardingAccount} from './onboarding-account-auth';
 import Grokbot1OnboardingPanel from './Grokbot1OnboardingPanel.svelte';
 import {guestWorkspaceRequest,type GuestWorkspace} from './guest-workspace-client';
 export let intentId='';
 let previewDismissed=false;
 let pendingNavigation:any=null,transferBusy=false,transferMessage='';
 $: temporary=temporaryWorkspace(workspace);
 $: build=guestBuild(workspace);
 $: showPreview=Boolean(build)&&!previewDismissed;
 let workspace:GuestWorkspace|null=null,draft='',error='',busy=false,loading=true;
 let authMode:''|'signin'|'signup'='',name='',email='',password='',authError='',authBusy=false,setup=false;
 let pending:{requestId:string;content?:string;replyToMessageId?:string}|null=null;
 let pollTimer:ReturnType<typeof setTimeout>|undefined,pollGeneration=0;
 const lifecycle=new AbortController();
 function stopPolling(){pollGeneration++;clearTimeout(pollTimer);}
 onDestroy(()=>{stopPolling();lifecycle.abort();});
 function pollReadback(){
  stopPolling();const generation=pollGeneration,deadline=Date.now()+90000;
  async function check(){
   if(lifecycle.signal.aborted||generation!==pollGeneration)return;
   try{
    const result=await guestWorkspaceRequest(intentId,lifecycle.signal);
    if(lifecycle.signal.aborted||generation!==pollGeneration)return;
    workspace=result;
    if(result.replyState==='COMPLETE'){pending=null;draft='';if(!activeGuestWork(result)){stopPolling();return;}}
    if(!activeGuestWork(result)){error='The reply has not completed. Check the saved conversation before retrying.';stopPolling();return;}
   }catch(cause){if(!lifecycle.signal.aborted&&generation===pollGeneration){error=(cause as Error).message;stopPolling();}return;}
   if(Date.now()>=deadline){error='The reply is still processing. Check the saved conversation shortly.';stopPolling();return;}
   pollTimer=setTimeout(check,2000);
  }
  pollTimer=setTimeout(check,2000);
 }
 async function load(){
  loading=true;error='';
  try{workspace=await guestWorkspaceRequest(intentId,lifecycle.signal);if(workspace.replyState==='COMPLETE'){pending=null;draft='';}if(activeGuestWork(workspace))pollReadback();}
  catch(cause){if(!lifecycle.signal.aborted)error=(cause as Error).message;}
  finally{loading=false;}
 }
 onMount(()=>{
  // Navigation state is consumed once before any network call; reload never admits inference.
  const launch=consumeGuestSubmit(sessionStorage,intentId);
  void (async()=>{
   const token=localStorage.getItem('token');
   if(token){
    try{const response=await fetch('/api/v1/auths/',{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.any([lifecycle.signal,AbortSignal.timeout(10000)])});
     if(response.ok){const me=await response.json();if(me&&typeof me.id==='string'&&!lifecycle.signal.aborted){user.set(me);if(await resumeOwner(token)!=='UNCLAIMED')return;}}
     else if(response.status===401)user.set(undefined);
    }catch{}
   }
   await load();
   if(!lifecycle.signal.aborted&&workspace&&launch?.intentId===intentId&&launch?.requestId===workspace.requestId){
    pending={requestId:launch.requestId,replyToMessageId:workspace.messages[0].id};
    await send();
   }
  })();
 });
 async function send(first=false){
  if(busy||workspace?.replyState==='RUNNING'||!workspace||(!first&&!draft.trim()&&!pending))return;
  if(!pending)pending=first?{requestId:workspace.requestId,replyToMessageId:workspace.messages[0].id}:{requestId:crypto.randomUUID(),content:draft.trim()};
  busy=true;error='';
  const request=new AbortController(),abort=()=>request.abort();
  lifecycle.signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,60000);
  try{
   const result=await guestWorkspaceRequest(intentId,request.signal,pending);
   if(lifecycle.signal.aborted)return;
   workspace=result;
   if(result.replyState==='COMPLETE'){draft='';pending=null;if(activeGuestWork(result))pollReadback();else stopPolling();}
   else if(result.replyState==='RUNNING')pollReadback();
   else error='The reply has not completed. Check the saved conversation before retrying.';
  }catch(cause){if(!lifecycle.signal.aborted)error=(cause as Error).name==='AbortError'?'Reply timed out. Check the saved conversation before retrying.':(cause as Error).message;}
  finally{clearTimeout(timeout);lifecycle.signal.removeEventListener('abort',abort);busy=false;}
 }
 async function auth(){
  if(authBusy||!authMode)return;authBusy=true;authError='';
  const pw=password;password='';
  try{
   const session=await authenticateOnboardingAccount({mode:authMode,name:name.trim(),email:email.trim(),password:pw,signal:AbortSignal.any([lifecycle.signal,AbortSignal.timeout(15000)])});
   if(lifecycle.signal.aborted)return;
   localStorage.setItem('token',session.token);user.set(session.account);
   window.dispatchEvent(new Event('starli-session-updated'));authMode='';
   await resumeOwner(session.token);
  }catch(cause){if(!lifecycle.signal.aborted)authError=(cause as Error).message;}
  finally{authBusy=false;}
 }
 async function resumeOwner(authToken:string):Promise<'OPENED'|'UNCLAIMED'|'DENIED'>{
  if(!authToken||transferBusy||lifecycle.signal.aborted)return 'DENIED';
  transferBusy=true;transferMessage='';
  const prior=workspace;
  const signal=AbortSignal.any([lifecycle.signal,AbortSignal.timeout(15000)]);
  try{
   const fresh=await readClaimedConversation(intentId,authToken,signal);
   const client=new Grokbot1JourneyClient({
    getBearerToken:()=>authToken,fetcher:(url,init)=>fetch(url,{...init,signal})
   });
   const nav=await client.fetchOwnerNavigation(intentId);
   if(signal.aborted||localStorage.getItem('token')!==authToken)return 'DENIED';
   if(!nav.ok||!verifiedOwnerResume(fresh,nav.data,prior))
    throw Error('The exact claimed conversation could not be verified.');
   stopPolling();
   await goto('/app?onboardingIntent='+encodeURIComponent(intentId));
   return 'OPENED';
  }catch(cause){
   if(lifecycle.signal.aborted)return 'DENIED';
   const status=(cause as Error & {status?:number}).status;
   if(status===404||status===409)return 'UNCLAIMED';
   transferMessage='This signed-in account could not open the claimed conversation.';
   return 'DENIED';
  }finally{transferBusy=false;loading=false;}
 }
 async function openTransferredWorkspace(){
  const result=await resumeOwner(localStorage.getItem('token')||'');
  if(result==='UNCLAIMED')transferMessage='Your conversation transfer is still being verified. Your saved chat remains here.';
 }
 function navigate(event:any){
  const nav=event.detail;
  if(nav?.status!=='READY'||nav.intentId!==intentId||!nav.companyId||!nav.channelRoomId)return;
  pendingNavigation=nav;void openTransferredWorkspace();
 }

</script>
<div class="guest-workspace">
 <aside aria-label="Guest workspace sidebar">
  <a class="brand" href="/">StarliDigital</a>
  {#if temporary}
   <section class="temporary-company" aria-label="Temporary company workspace">
    <p class="guest-label">Temporary workspace</p><strong>{temporary.companyName}</strong>
    <p class="room-name"># {temporary.roomName}</p>
   </section>
  {:else}<p class="guest-label" role="status">Temporary company workspace is awaiting server confirmation.</p>{/if}
  <nav aria-label="Account">
   {#if !$user?.id}
    <button on:click={()=>{authMode='signup';authError='';}}>Register</button>
    <button on:click={()=>{authMode='signin';authError='';}}>Sign in</button>
   {:else}
    <p class="identity">{$user.name||$user.email||'Your account'}</p>
    <a href={'/app?onboardingIntent='+encodeURIComponent(intentId)} on:click|preventDefault={()=>void openTransferredWorkspace()}>Open company workspace</a>
    <button on:click={()=>setup=!setup}>Continue company setup</button>
   {/if}
  </nav>
  {#if authMode}
   <form class="auth-form" on:submit|preventDefault={auth}>
    <h2>{authMode==='signup'?'Create account':'Sign in'}</h2>
    {#if authMode==='signup'}<label>Name<input autocomplete="name" bind:value={name} required disabled={authBusy}/></label>{/if}
    <label>Email<input type="email" autocomplete="email" bind:value={email} required disabled={authBusy}/></label>
    <label>Password<input type="password" autocomplete={authMode==='signup'?'new-password':'current-password'} bind:value={password} required disabled={authBusy}/></label>
    <button class="primary" type="submit" disabled={authBusy}>{authBusy?'Verifying…':'Continue'}</button>
    <button type="button" disabled={authBusy} on:click={()=>{authMode='';password='';}}>Cancel</button>
    {#if authError}<p class="error" role="alert">{authError}</p>{/if}
   </form>
  {/if}
  {#if setup&&$user?.id}<Grokbot1OnboardingPanel {intentId} signedIn={true} on:ownerNavigationReady={navigate}/>{/if}
  {#if pendingNavigation||transferMessage}
   <p class="transfer-status" role="status">{transferMessage||'Verifying your complete conversation transfer…'}</p>
   <button disabled={transferBusy} on:click={()=>void openTransferredWorkspace()}>Check transfer and open workspace</button>
  {/if}
 </aside>
 <div class="workspace-content" class:split={showPreview}>
 <main>
  <header><h1>Starli</h1><span>{temporary?.roomName||'Saved conversation'}</span>
   {#if build}<button on:click={()=>previewDismissed=!previewDismissed}>{showPreview?'Hide app':'Show app'}</button>{/if}
  </header>
  {#if build}<section class="build-progress" role="status" aria-live="polite"><strong>{{QUEUED:'Queued',RUNNING:'Building your app',READY:'App ready',INTERRUPTED:'Build interrupted'}[build.status]}</strong><p>{build.errorCode?'The build could not finish. Your conversation is saved.':''}</p></section>{/if}
  <div class="messages" role="log" aria-live="polite">
   {#if loading}<p role="status">Loading your saved conversation…</p>{/if}
   {#if workspace}
    {#each workspace.messages as message(message.id)}
     <article class:human={message.role==='user'}><strong>{message.role==='user'?'You':'Starli'}</strong><p>{message.content}</p></article>
    {/each}
    {#if workspace.messages.length===1&&workspace.replyState!=='RUNNING'&&workspace.replyState!=='COMPLETE'&&!pending&&!busy}
     <button class="primary" on:click={()=>void send(true)}>Ask Starli</button>
    {/if}

   {/if}
   {#if busy||workspace?.replyState==='RUNNING'}<p role="status">Starli is working…</p>{/if}
   {#if error}<p class="error" role="alert">{error}</p><button on:click={()=>void load()}>Check saved conversation</button>{#if pending}<button on:click={()=>void send()}>Retry same request</button>{/if}{/if}
  </div>
  <form class="composer" on:submit|preventDefault={()=>send()}>
   <label class="sr-only" for="guest-message">Message Starli</label>
   <textarea id="guest-message" bind:value={draft} maxlength="4000" rows="2" placeholder="Message Starli…" disabled={!workspace||busy||workspace?.replyState==='RUNNING'||Boolean(pending)}
    on:keydown={(e)=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}}}/>
   <button class="primary" disabled={!workspace||busy||workspace?.replyState==='RUNNING'||Boolean(pending)||!draft.trim()}>Send</button>
  </form>
 </main>
 {#if showPreview}
  <section class="application-pane" aria-label="Live application panel">
   <GuestModelAppPreview {build} {intentId} companyId={temporary?.companyId||''} projectId={temporary?.projectId||''}/>
  </section>
 {/if}
 </div>
</div>
<style>
 :global(body){margin:0;background:#fff}.guest-workspace{display:flex;min-height:100dvh;color:#192640;font:16px/1.5 Inter,Arial,sans-serif}
 aside{width:260px;flex:none;padding:24px 18px;background:#f5f7fc;border-right:1px solid #e4eaf5;box-sizing:border-box;overflow-wrap:anywhere}
 .brand{font-size:20px;font-weight:750;text-decoration:none;color:inherit}.guest-label,header span{font-size:13px;color:#657a9e}
 nav{display:grid;gap:8px;margin-top:24px}button,nav a{font:inherit;border:1px solid #dce5f6;border-radius:9px;background:white;padding:10px 12px;color:inherit;text-decoration:none;cursor:pointer;text-align:left}
 button:disabled{opacity:.55;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid #7c62ff;outline-offset:3px}
 .primary{background:#3563ff;border-color:#3563ff;color:white;text-align:center}.auth-form{display:grid;gap:12px;margin-top:24px}.auth-form h2{font-size:18px}.auth-form label{display:grid;gap:6px;font-size:14px}.auth-form input{width:100%;box-sizing:border-box;min-width:0;font:inherit;border:1px solid #cbd5e1;border-radius:8px;padding:10px}
 main{flex:1;min-width:0;display:flex;flex-direction:column;height:100dvh}header{padding:18px 28px;border-bottom:1px solid #e4eaf5;display:flex;align-items:center;justify-content:space-between}h1{font-size:20px;margin:0}
 .messages{flex:1;overflow:auto;padding:28px max(24px,calc((100% - 760px)/2));}article{margin-bottom:24px}article strong{font-size:13px}article p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.human{text-align:right}.human p{display:inline-block;text-align:left;border-radius:14px;background:#f0f3f8;padding:12px 16px;max-width:90%}
 .composer{display:flex;align-items:flex-end;gap:12px;margin:16px auto 24px;width:calc(100% - 48px);max-width:760px}.composer textarea{flex:1;min-width:0;border:1px solid #dce5f6;border-radius:12px;padding:12px;font:inherit;resize:vertical}.error{color:#9b1c32}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
 @media(max-width:700px){aside{width:150px;padding:18px 12px}.brand{font-size:16px}nav button,nav a{font-size:14px;padding:9px}.messages{padding:20px 16px}header{padding:16px}.composer{width:calc(100% - 24px);gap:8px}.auth-form input{font-size:16px;padding:7px}}

 .temporary-company{padding:16px 0;border-bottom:1px solid #e4eaf5}.temporary-company strong{display:block;font-size:16px}.room-name{font-size:14px;color:#506280;margin:12px 0 0}
 .workspace-content{flex:1;min-width:0;display:flex}.workspace-content main{width:100%}.workspace-content.split main{flex:1;min-width:0}
 .application-pane{width:45%;min-width:300px;max-width:900px;border-left:1px solid #e4eaf5;overflow:auto;height:100dvh;background:#f8faff;padding:12px;box-sizing:border-box}
 .application-pane :global(.private-preview){height:calc(100% - 24px);margin:0}
 .build-progress{padding:12px 24px;border-bottom:1px solid #e4eaf5;background:#f6f8ff;font-size:14px}.build-progress p{margin:4px 0 0}.build-progress strong{font-size:13px}.transfer-status{font-size:14px;color:#506280}
 @media(max-width:1000px){.workspace-content.split{flex-direction:column}.application-pane{width:100%;max-width:none;min-width:0;height:55dvh;border-left:0;border-top:1px solid #e4eaf5}.workspace-content.split main{height:70dvh;flex:none}.guest-workspace:has(.split){align-items:stretch}}
</style>
