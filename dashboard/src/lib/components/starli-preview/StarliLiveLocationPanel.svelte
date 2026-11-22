<script lang="ts">
 import {onMount} from 'svelte';
 import type {IntelligenceClient} from '$lib/apis/starli-intelligence';
 import {ForegroundLocation,locationHash,startCurrentForeground,replaceLiveSnapshot,freshPosition,type LiveSession} from '$lib/utils/starli-live-location';
 import {standardTileURL} from '$lib/utils/starli-live-map';
 import StarliLiveMap from './StarliLiveMap.svelte';
 export let client:IntelligenceClient;
 export let connected=false;
 export let mapTileURL=standardTileURL;
 export let hashLocation=locationHash;
 let ready=false,epoch=0,seenClient:IntelligenceClient|null=null,seenConnected=false,supported=false,checking=false,busy=false,message='',consent=false,ownId='',sessions:LiveSession[]=[],peers:{id:string;name:string}[]=[],members:string[]=[];
 let audience:'SELF'|'MEMBERS'='SELF',precision:'APPROXIMATE'|'PRECISE'='APPROXIMATE',preciseConfirmed=false,shareWithAI=false,ttlSeconds=900,review=false,now=Date.now(),tracking=false,expiredStop='';
 let foreground:ForegroundLocation|null=null,unsubscribe:(()=>void)|null=null;
 const fields='id ownerId audience memberIds shareWithAI precision status sequence startedAt expiresAt stoppedAt stopReason version position{latitude longitude accuracyMeters capturedAt receivedAt freshUntil precision}';
 $: own=sessions.find(session=>session.ownerId===ownId&&!['STOPPED','EXPIRED'].includes(session.status));
 function clear(){
  epoch++;unsubscribe?.();unsubscribe=null;void foreground?.stop().catch(()=>{});foreground=null;tracking=false;busy=false;checking=false;sessions=[];supported=false;consent=false;ownId='';peers=[];members=[];review=false;audience='SELF';precision='APPROXIMATE';preciseConfirmed=false;shareWithAI=false;ttlSeconds=900;expiredStop='';
 }
 async function stopServer(id:string,transport=client){const sourceHash=await locationHash({purpose:'STOP_LIVE_LOCATION',sessionId:id});return transport.execute('mutation NativeStopLocation($input:LiveLocationStopInput!){socialStopLiveLocation(input:$input){id status}}',{input:{sessionId:id,confirmed:true,purpose:'STOP_LIVE_LOCATION',sourceHash}});}
 async function load(){
  clear();const e=epoch,active=client;checking=true;message='';
  try{
   const mount=await active.execute('query NativeLocationMount{capabilities:__type(name:"IntelligenceCapabilities"){fields{name}} snapshot:__type(name:"LiveLocationSnapshot"){name}}',{});
   if(e!==epoch)return;
   const fieldsAvailable=new Set((mount.capabilities?.fields??[]).map((field:any)=>field.name));
   if(mount.snapshot?.name!=='LiveLocationSnapshot'||!fieldsAvailable.has('liveLocation')||!fieldsAvailable.has('liveLocationProtocolVersion')){message='Live location is not connected on this service yet.';return;}
   const capability=await active.execute('query NativeLocationCapability{intelligenceCapabilities{liveLocation liveLocationProtocolVersion}}',{});
   if(e!==epoch)return;
   if(capability.intelligenceCapabilities?.liveLocation!==true||capability.intelligenceCapabilities?.liveLocationProtocolVersion!=='starli-live-location.v1'){message='Live location is not available on this service.';return;}
   const data=await active.execute('query NativeLocationState{me{id} socialMyProfile{id active} intelligenceLocationConsent{enabled} socialLiveLocationSessions{cursor resync sessions{'+fields+'}}}',{});
   if(e!==epoch)return;
   consent=data.intelligenceLocationConsent?.enabled===true;ownId=data.me?.id??data.socialMyProfile?.id??'';sessions=replaceLiveSnapshot(data.socialLiveLocationSessions).sessions;supported=true;
   const connections=data.socialMyProfile?.active?await active.execute('query NativeLocationConnections{socialConnections{id initiatorId recipientId status}}',{}):{socialConnections:[]};
   if(e!==epoch)return;
   const ids=(connections.socialConnections??[]).filter((c:any)=>c.status==='ACCEPTED').map((c:any)=>c.initiatorId===ownId?c.recipientId:c.initiatorId);
   const profiles=await Promise.all(ids.slice(0,20).map(async(id:string)=>{try{const p=await active.execute('query NativeLocationPeer($id:ID!){socialProfile(id:$id){id displayName active}}',{id});return p.socialProfile?.active?{id:p.socialProfile.id,name:p.socialProfile.displayName}:null;}catch{return null;}}));
   if(e!==epoch)return;peers=profiles.filter(Boolean) as {id:string;name:string}[];
   unsubscribe=active.subscribeLiveLocations(snapshot=>{if(e!==epoch)return;try{sessions=replaceLiveSnapshot(snapshot).sessions;foreground?.reconcile(sessions);tracking=foreground?.active===true;}catch{sessions=[];message='Live locations need to reconnect.';}},()=>{if(e===epoch){sessions=[];message='Live location updates are reconnecting.';}});
   if(navigator.geolocation)foreground=new ForegroundLocation(navigator.geolocation,()=>ready&&e===epoch&&client===active&&connected&&!document.hidden,{
    start:async(input)=>{const d=await active.execute('mutation NativeStartLocation($input:LiveLocationStartInput!){socialStartLiveLocation(input:$input){'+fields+'}}',{input});return d.socialStartLiveLocation;},
    update:input=>active.execute('mutation NativeUpdateLocation($input:LiveLocationUpdateInput!){socialUpdateLiveLocation(input:$input){id sequence status}}',{input}),
    stop:id=>stopServer(id,active)
   },text=>{if(e===epoch){message=text;tracking=false;}},locationHash);
  }catch{if(e===epoch){supported=false;sessions=[];message='Live location could not be connected. No device location was requested.';}}
  finally{if(e===epoch)checking=false;}
 }
 async function setConsent(enabled:boolean){
  if(busy)return;const e=epoch,active=client;busy=true;message='';
  try{if(!enabled)await stop();if(e!==epoch||client!==active||!ready)return;const d=await active.execute('mutation NativeLocationConsent($enabled:Boolean!){intelligenceSetLocationConsent(enabled:$enabled){enabled}}',{enabled});if(e!==epoch||client!==active||!ready)return;consent=d.intelligenceSetLocationConsent.enabled===true;if(!consent)sessions=[];}
  catch{if(e===epoch)message='The location permission change could not be confirmed.';}finally{if(e===epoch)busy=false;}
 }
 async function start(){
  if(!supported||!connected||!consent||!foreground||busy||!review||!ownId)return;
  if(precision==='PRECISE'&&!preciseConfirmed){message='Confirm precise sharing first.';return;}
  if(audience==='MEMBERS'&&!members.length){message='Choose at least one connection.';return;}
  busy=true;message='';const e=epoch,active=client,selected=foreground;
  try{
   const input={audience,memberIds:audience==='MEMBERS'?[...members]:[],shareWithAI,precision,preciseConfirmed,ttlSeconds:Number(ttlSeconds),confirmed:true as const,purpose:'START_LIVE_LOCATION' as const};
   const started=await startCurrentForeground(selected,input,()=>ready&&e===epoch&&client===active&&foreground===selected&&connected&&review,hashLocation);
   if(started&&e===epoch){tracking=selected.active;review=false;}
  }catch{if(e===epoch)message='Starting location sharing could not be confirmed. Check the active session before trying again.';}
  finally{if(e===epoch)busy=false;}
 }
 async function stop(){
  const e=epoch,active=client,id=own?.id,deviceActive=foreground?.active===true;tracking=false;review=false;
  try{await foreground?.stop();if(id&&!deviceActive)await stopServer(id,active);}
  catch{if(e===epoch)message='Device tracking stopped. Server stop could not be confirmed; freshness and session expiry still apply.';}
 }
 function cancelStart(){review=false;busy=false;void foreground?.stop().catch(()=>{});}
 function hidden(){if(document.hidden)void stop();}
 $: if(ready&&(seenClient!==client||seenConnected!==connected)){seenClient=client;seenConnected=connected;if(connected)void load();else clear();}
 onMount(()=>{ready=true;const timer=setInterval(()=>{now=Date.now();tracking=foreground?.active===true;const activeId=foreground?.sessionId??own?.id,expiry=foreground?.expiresAt??own?.expiresAt;if(activeId&&expiry&&Date.parse(expiry)<=now&&expiredStop!==activeId){expiredStop=activeId;void stop();}},1000);document.addEventListener('visibilitychange',hidden);return()=>{ready=false;clearInterval(timer);document.removeEventListener('visibilitychange',hidden);clear();};});
</script>
<section class="space-y-4" aria-label="Foreground live location">
 <div><h3 class="text-sm font-medium">Live location</h3><p class="mt-1 text-xs leading-5 text-gray-500">You choose the audience, precision, duration, and whether Starli AI may use your own fresh position. Updates stop when this panel closes or the page is hidden. No background tracking.</p></div>
 {#if message}<p role="status" class="text-xs leading-5 text-gray-500">{message}</p>{/if}
 {#if checking}<p class="text-xs text-gray-500">Checking location availability…</p>
 {:else if !supported}<button disabled={!connected} on:click={load} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">Check availability</button>
 {:else}
  {#if !ownId}<p class="text-xs text-gray-500">Your account identity could not be confirmed. Reconnect Intelligence.</p>
  {:else if !consent}<p class="text-xs text-gray-500">Location use is off. Turning it on allows you to review a sharing session; it does not start device tracking.</p><button disabled={busy||!connected} on:click={()=>setConsent(true)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Allow location use</button>
  {:else}
   <fieldset disabled={busy||!!own||!connected} class="space-y-3 disabled:opacity-50">
    <label class="block text-xs">Audience<select bind:value={audience} class="mt-1 block w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800"><option value="SELF">Only me</option><option value="MEMBERS">Selected connections</option></select></label>
    {#if audience==='MEMBERS'}<div class="space-y-2">{#each peers as peer}<label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:group={members} value={peer.id}/>{peer.name}</label>{/each}{#if !peers.length}<p class="text-xs text-gray-500">No accepted connections are available.</p>{/if}</div>{/if}
    <label class="block text-xs">Precision<select bind:value={precision} class="mt-1 block w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800"><option value="APPROXIMATE">Approximate area</option><option value="PRECISE">Precise position</option></select></label>
    {#if precision==='PRECISE'}<label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={preciseConfirmed}/>I confirm sharing precise coordinates.</label>{/if}
    <label class="block text-xs">Duration<select bind:value={ttlSeconds} class="mt-1 block w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800"><option value={900}>15 minutes</option><option value={3600}>1 hour</option></select></label>
    <label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={shareWithAI}/>Allow this location for Starli AI</label>
    <p class="text-xs leading-5 text-gray-500">This applies to your fresh position only. Connections’ live positions are excluded from your AI context.</p>
    <button disabled={!foreground||(audience==='MEMBERS'&&!members.length)||(precision==='PRECISE'&&!preciseConfirmed)} on:click={()=>review=true} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Review sharing</button>
   </fieldset>
   {#if review}<div class="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"><p class="text-xs leading-5">{Number(ttlSeconds)/60} minutes · {audience==='SELF'?'Only me':members.length+' selected connections'} · {precision==='PRECISE'?'Precise position':'Approximate area'} · AI access {shareWithAI?'on':'off'}</p><p class="text-xs text-gray-500">Your browser will ask for device location permission. Starting a session is not proof of a GPS fix.</p><button disabled={busy||!connected} on:click={start} class="rounded-lg bg-black px-3 py-2 text-xs text-white dark:bg-white dark:text-black">Start sharing</button><button on:click={cancelStart} class="px-3 py-2 text-xs">Cancel</button></div>{/if}
   {#if own||tracking}<div class="space-y-2 rounded-xl border border-gray-100 p-3 dark:border-gray-800"><p class="text-xs">{tracking?'Device sharing active':'No active device watcher on this page'} · {own?.status??'Waiting for server update'}</p>{#if own}<p class="text-xs text-gray-500">Ends {new Date(own.expiresAt).toLocaleTimeString()} · {freshPosition(own,now)?'Fresh device-reported fix':'No fresh position'}</p>{/if}<button on:click={stop} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Stop sharing</button></div>{/if}
   <button disabled={busy} on:click={()=>setConsent(false)} class="text-xs text-gray-500 underline">Turn off location use</button>
  {/if}
  <StarliLiveMap {sessions} ownerId={ownId} {now} tileURL={mapTileURL}/>
  <ul class="space-y-2">{#each sessions as session (session.id)}<li class="rounded-lg border border-gray-100 p-3 text-xs dark:border-gray-800"><p>{session.ownerId===ownId?'You':peers.find(peer=>peer.id===session.ownerId)?.name??'Authorized connection'} · {session.status}</p><p class="mt-1 text-gray-500">{freshPosition(session,now)?'Fresh device-reported position':'Position unavailable or stale'} · {session.precision==='PRECISE'?'Precise sharing':'Approximate area'}</p>{#if freshPosition(session,now)}<p class="mt-1 text-gray-500">Reported accuracy ±{Math.ceil(session.position?.accuracyMeters??0)} m · Captured {new Date(session.position?.capturedAt??'').toLocaleTimeString()}</p>{/if}</li>{/each}</ul>
 {/if}
</section>
