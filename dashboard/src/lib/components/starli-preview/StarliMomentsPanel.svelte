<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {IntelligenceClient} from '$lib/apis/starli-intelligence';
 export let client:IntelligenceClient;
 export let connected=false;
 export let revision=0;
 export let canWatch=false;export let canNotify=false;
 type Place={kind:string;context:string;latitude?:number;longitude?:number;label?:string;approved:boolean;bounds?:{north:number;south:number;east:number;west:number}};
 type Moment={id:string;text:string;audience:string;state:string;version:number;expiresAt?:string;createdAt:string;place:Place|null};
 let moments:Moment[]|null=null,mine:Moment[]=[],selected:Moment|null=null,latitude='',longitude='',windowHours='24',filterError='',streamError='',areaReady=false;
 let removeStream:(()=>void)|null=null,alive=true,sequence=0,now=Date.now(),seenRevision=-1,hasMore=false;
 let text='',attachPlace=false,working=false,actionError='',draft:Moment|null=null,profile:any=null,profileName='';
 let review:any=null,deleteReview:Moment|null=null,socialAvailable=false,watches:any[]=[],notices:any[]=[],unread=0,watchName='',watchTopic='',notify=false;
 let pending:{kind:string;query:string;variables:Record<string,unknown>}|null=null;
 let mapUrl='',mapPlace='',mapId='';
 const fields='id text audience state version createdAt expiresAt place{kind context latitude longitude label approved bounds{north south east west}}';
 async function hash(){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(crypto.randomUUID())))].map(x=>x.toString(16).padStart(2,'0')).join('');}
 function center(){
  if(!latitude.trim()||!longitude.trim())throw Error('Enter a latitude and longitude to choose an area.');
  const lat=Number(latitude),lon=Number(longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -85||lat>85||lon< -180||lon>180)throw Error('Use latitude −85 to 85 and longitude −180 to 180.');
  return {lat,lon};
 }
 function applyArea(){
  filterError='';try{
   const {lat,lon}=center();removeStream?.();moments=null;selected=null;mapUrl='';streamError='';areaReady=true;
   const bounds={north:Math.min(85,lat+.05),south:Math.max(-85,lat-.05),east:Math.min(180,lon+.05),west:Math.max(-180,lon-.05)};
   removeStream=client.subscribeMoments({bounds,from:new Date(Date.now()-Number(windowHours)*3600000).toISOString(),limit:50},page=>{
    if(!alive)return;moments=page.items;hasMore=page.hasMore===true;streamError='';
    if(selected)selected=moments?.find(m=>m.id===selected?.id)??null;
   },()=>{if(alive){moments=null;selected=null;mapUrl='';streamError='Moment updates are unavailable. Retry this area when the service is connected.';}});
  }catch(error){filterError=(error as Error).message;}
 }
 async function loadMine(){
  const e=++sequence;try{const data=await client.execute('query NativeMyMoments{'+(canWatch?'socialWatchlists{id name enabled notificationsEnabled version} ':'')+(canNotify?'socialNotifications(limit:30){unreadCount items{id readAt evidence{kind id version} chatContext{kind id} moment{id text expiresAt version}}} ':'')+'socialMyProfile{id displayName active version} socialMyMoments(filter:{limit:50}){items{'+fields+'} cursor hasMore}}',{});if(alive&&e===sequence){mine=data.socialMyMoments?.items??[];profile=data.socialMyProfile;watches=data.socialWatchlists??[];notices=data.socialNotifications?.items??[];unread=data.socialNotifications?.unreadCount??0;socialAvailable=true;}}
  catch{if(alive&&e===sequence){mine=[];socialAvailable=false;watches=[];notices=[];}}
 }
 async function run(kind:string,query:string,input:Record<string,unknown>,hashOutside=false){
  if(working)return;
  working=true;const sourceHash=await hash();if(!alive)return;pending={kind,query,variables:hashOutside?{...input,sourceHash}:{input:{...input,sourceHash}}};working=false;await retry();
 }
 async function retry(){
  if(!pending||working||!connected)return;
  const operation=pending;working=true;actionError='';
  try{
   const data=await client.execute(operation.query,operation.variables);if(!alive)return;
   if(operation.kind==='profile')profile=data.socialSaveProfile;
   if(operation.kind==='create'){draft=data.socialCreateMoment;text='';}
   if(operation.kind==='prepare')review=data.socialPrepareMomentShare;
   if(operation.kind==='share'){draft=data.socialShareMoment;review=null;}
   if(operation.kind==='delete'){if(draft?.id===deleteReview?.id)draft=null;deleteReview=null;review=null;}
   pending=null;await loadMine();
  }catch(error){if(alive)actionError=(error as Error).message;}
  finally{if(alive)working=false;}
 }
 function watchArea(){
  try{
   const {lat,lon}=center();const bounds={north:Math.min(85,lat+.05),south:Math.max(-85,lat-.05),east:Math.min(180,lon+.05),west:Math.max(-180,lon-.05)};
   void run('watch','mutation NativeWatchArea($input:SocialMomentWatchInput!,$sourceHash:String!){socialSaveWatchlist(input:$input,sourceHash:$sourceHash){id}}',{input:{name:watchName.trim(),topics:watchTopic.trim()?[watchTopic.trim()]:[],bounds,from:new Date().toISOString(),until:new Date(Date.now()+86400000).toISOString(),enabled:true,notificationsEnabled:notify,cadenceSeconds:60}},true);
  }catch(error){filterError=(error as Error).message;}
 }
 async function discussNotice(id:string){
  if(working)return;working=true;actionError='';
  try{
   const d=await client.execute('query NativeNoticeContext($id:ID!){socialNotificationContext(id:$id){id evidence{kind id version} chatContext{kind id} moment{id text}}}',{id});
   if(!alive)return;const n=d.socialNotificationContext;
   if(!n)throw Error('This notification is no longer available. Its visibility may have changed.');
   window.dispatchEvent(new CustomEvent('starli-compose',{detail:{prompt:'Explain this currently authorized social notification '+n.id+'. Evidence: '+n.evidence.kind+' '+n.evidence.id+' version '+n.evidence.version+'. Chat context: '+n.chatContext.kind+' '+n.chatContext.id+'. '+n.moment.text+'. Recheck access and expiry before using it.'}}));
  }catch(error){if(alive)actionError=(error as Error).message;}finally{if(alive)working=false;}
 }
 function create(){
  if(!text.trim())return;let place:Record<string,unknown>|undefined;
  try{if(attachPlace){const p=center();place={kind:'POINT',context:'PUBLIC_PLACE',latitude:p.lat,longitude:p.lon,approved:true,label:'Selected place'};}}
  catch(error){actionError=(error as Error).message;return;}
  void run('create','mutation NativeCreateMoment($input:SocialCreateMomentInput!){socialCreateMoment(input:$input){'+fields+'}}',{text:text.trim(),mediaRefs:[],...(place?{place}:{})});
 }
 function prepare(moment:Moment){
  draft=moment;review=null;
  void run('prepare','mutation NativeReviewShare($input:SocialPrepareMomentShareInput!){socialPrepareMomentShare(input:$input){token momentId expectedVersion audience memberIds expiresAt reviewExpiresAt purpose}}',{id:moment.id,expectedVersion:moment.version,audience:'PUBLIC',memberIds:[],expiresAt:new Date(Date.now()+86400000).toISOString()});
 }
 function share(){
  if(!review||Date.parse(review.reviewExpiresAt)<=Date.now())return;
  void run('share','mutation NativeShareMoment($input:SocialShareMomentInput!){socialShareMoment(input:$input){'+fields+'}}',{id:review.momentId,expectedVersion:review.expectedVersion,reviewToken:review.token,confirmed:true,purpose:'SHARE_MOMENT'});
 }
 function erase(){
  if(!deleteReview)return;
  void run('delete','mutation NativeDeleteMoment($input:SocialDeleteMomentInput!){socialDeleteMoment(input:$input){id deleted}}',{id:deleteReview.id,expectedVersion:deleteReview.version});
 }
 function showMap(moment:Moment){
  const p=moment.place;if(!p?.approved||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return;
  mapId=moment.id;mapPlace=JSON.stringify(p);
  mapUrl='https://www.openstreetmap.org/export/embed.html?'+new URLSearchParams({bbox:[Math.max(-180,p.longitude!-.025),Math.max(-85,p.latitude!-.015),Math.min(180,p.longitude!+.025),Math.min(85,p.latitude!+.015)].join(','),marker:p.latitude+','+p.longitude,layer:'mapnik'});
 }
 function discuss(moment:Moment){window.dispatchEvent(new CustomEvent('starli-compose',{detail:{prompt:'Discuss social moment '+moment.id+': '+moment.text+'. Check its current visibility, evidence and expiry before using it.'}}));}
 $: visible=(moments??[]).filter(m=>!m.expiresAt||Date.parse(m.expiresAt)>now);
 $: if(selected&&!visible.some(m=>m.id===selected?.id))selected=null;
 $: if(mapUrl&&(!selected||selected.id!==mapId||JSON.stringify(selected.place)!==mapPlace))mapUrl='';
 $: if(!connected){moments=null;mine=[];profile=null;socialAvailable=false;watches=[];notices=[];unread=0;selected=null;mapUrl='';review=null;sequence++;}
 $: if(connected&&revision!==seenRevision){seenRevision=revision;void loadMine();}
 onMount(()=>{const timer=setInterval(()=>now=Date.now(),1000);return()=>clearInterval(timer);});
 onDestroy(()=>{alive=false;sequence++;removeStream?.();});
</script>
<div class="space-y-4">
 <p class="text-xs leading-5 text-gray-500">Choose an area without sharing your location. Moments shown here are subject to their audience and expiry. Text-only sharing is available when the social service is connected.</p>
 <form on:submit|preventDefault={applyArea} class="space-y-2">
  <div class="flex gap-2"><input bind:value={latitude} aria-label="Area latitude" placeholder="Latitude" inputmode="decimal" class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"/><input bind:value={longitude} aria-label="Area longitude" placeholder="Longitude" inputmode="decimal" class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"/></div>
  <div class="flex gap-2"><select aria-label="Moment time window" bind:value={windowHours} class="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850"><option value="24">Last 24 hours</option><option value="168">Last 7 days</option></select><button disabled={!connected} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">Show this area</button></div>
 </form>
 {#if canWatch}<details class="rounded-xl border border-gray-100 p-3 dark:border-gray-800"><summary class="cursor-pointer text-sm">Watch this area</summary><form on:submit|preventDefault={watchArea} class="mt-3 space-y-3"><input aria-label="Area watchlist name" bind:value={watchName} maxlength="100" placeholder="Watchlist name" class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-850"/><input aria-label="Moment topic filter" bind:value={watchTopic} maxlength="100" placeholder="Topic (optional)" class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-850"/><label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={notify} disabled={!canNotify}/>Notify me in the app about matching moments</label><p class="text-xs leading-5 text-gray-500">Watch the selected area for the next 24 hours. Matching checks depend on the configured backend service; this does not enable push notifications.</p><button disabled={!connected||!socialAvailable||working||!!pending||!watchName.trim()} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">Save area watchlist</button></form></details>{/if}
 {#if !socialAvailable}<p role="status" class="text-xs text-gray-500">Social account data is not available yet. Controls will become available when the authenticated social service responds.</p>{/if}
 {#if filterError}<p role="alert" class="text-xs text-amber-700 dark:text-amber-400">{filterError}</p>{/if}
 {#if streamError}<p role="status" class="text-xs text-gray-500">{streamError}</p>{/if}
 {#if areaReady&&!streamError}<p class="text-xs text-gray-500">{moments===null?'Waiting for the authorized moment stream…':visible.length+' visible moments'}{hasMore?' · Showing the first 50. Narrow the area or time window.':''}</p>{/if}
 <ul class="space-y-2">{#each visible as moment (moment.id)}<li><button aria-expanded={selected?.id===moment.id} on:click={()=>selected=selected?.id===moment.id?null:moment} class="w-full rounded-xl border border-gray-100 p-3 text-left text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-850"><span class="block whitespace-pre-wrap break-words">{moment.text}</span><span class="mt-2 block text-xs text-gray-500">{moment.audience.toLowerCase()} · {new Date(moment.createdAt).toLocaleString()}</span></button>
  {#if selected?.id===moment.id}<div class="space-y-2 p-3"><button on:click={()=>discuss(moment)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Discuss in this chat</button>{#if moment.place?.approved&&Number.isFinite(moment.place.latitude)&&Number.isFinite(moment.place.longitude)}<button on:click={()=>showMap(moment)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Show location map</button><p class="text-xs leading-5 text-gray-500">Loading this map shares the moment’s selected coordinates with OpenStreetMap.</p>{/if}</div>{/if}
 </li>{/each}</ul>
 {#if mapUrl}<iframe title="Selected moment location on OpenStreetMap" src={mapUrl} class="h-64 w-full rounded-xl border-0" sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer"/><button on:click={()=>mapUrl=''} class="text-xs underline">Hide map</button>{/if}
 {#if socialAvailable&&!profile?.active}<form on:submit|preventDefault={()=>run('profile','mutation NativeSocialOptIn($input:SocialSaveProfileInput!){socialSaveProfile(input:$input){id displayName active version}}',{displayName:profileName.trim(),discoverable:false,active:true,...(profile?.version?{expectedVersion:profile.version}:{})})} class="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700"><h3 class="text-sm font-medium">Choose to use social moments</h3><p class="text-xs leading-5 text-gray-500">Create an active social profile to save and share moments. Profile discovery stays off. Your drafts remain private until you confirm sharing.</p><input aria-label="Social display name" bind:value={profileName} maxlength="80" placeholder="Display name" class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-850"/><button disabled={!connected||working||!!pending||!profileName.trim()} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">Create social profile</button></form>{/if}
 <div class="border-t border-gray-100 pt-4 dark:border-gray-800">
  <h3 class="mb-3 text-sm font-medium">Your moments</h3>
  <form on:submit|preventDefault={create} class="space-y-3"><textarea aria-label="Private moment draft" bind:value={text} maxlength="2000" rows="3" placeholder="Save a private moment…" disabled={working||!!pending} class="w-full rounded-xl border border-gray-200 bg-transparent p-3 text-sm dark:border-gray-700"/><label class="flex items-start gap-2 text-xs leading-5 text-gray-500"><input type="checkbox" bind:checked={attachPlace} disabled={working||!!pending}/>Attach the selected coordinates as a public place. This is a place I choose to share, not live location tracking.</label><button disabled={!connected||!socialAvailable||working||!!pending||!profile?.active||!text.trim()} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">{working?'Working…':'Save private draft'}</button></form>
  <ul class="mt-4 divide-y divide-gray-100 dark:divide-gray-800">{#each mine as moment (moment.id)}<li class="space-y-2 py-3"><div class="whitespace-pre-wrap break-words text-sm">{moment.text}</div><div class="text-xs text-gray-500">{moment.state.toLowerCase()} · {moment.audience.toLowerCase()}</div><div class="flex gap-2">{#if moment.state==='DRAFT'}<button disabled={working||!!pending} on:click={()=>prepare(moment)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800">Review public sharing</button>{/if}<button disabled={working||!!pending} on:click={()=>deleteReview=moment} class="rounded-lg px-3 py-2 text-xs text-gray-500">Review deletion</button></div></li>{/each}</ul>
 </div>
 {#if canWatch}<details class="border-t border-gray-100 pt-4 dark:border-gray-800"><summary class="cursor-pointer text-sm font-medium">Moment watchlists · {watches.length}</summary><ul class="mt-3 divide-y divide-gray-100 dark:divide-gray-800">{#each watches as watch (watch.id)}<li class="space-y-2 py-3"><div class="text-sm">{watch.name}</div><div class="text-xs text-gray-500">{watch.enabled?'Enabled':'Paused'} · Notifications {watch.notificationsEnabled?'on':'off'}</div><button disabled={working||!!pending||!connected} on:click={()=>run('unwatch','mutation NativeDeleteWatch($id:ID!,$expectedVersion:Int!,$sourceHash:String!){socialDeleteWatchlist(id:$id,expectedVersion:$expectedVersion,sourceHash:$sourceHash)}',{id:watch.id,expectedVersion:watch.version},true)} class="rounded-lg px-2 py-1 text-xs text-gray-500">Stop and remove watchlist</button></li>{/each}</ul></details>{/if}
 {#if canNotify}<details class="border-t border-gray-100 pt-4 dark:border-gray-800"><summary class="cursor-pointer text-sm font-medium">Moment activity · {unread} unread</summary><p class="mt-3 text-xs text-gray-500">The latest 30 authorized notifications. Evidence and access are checked again before sending context to chat.</p><ul class="mt-3 divide-y divide-gray-100 dark:divide-gray-800">{#each notices.filter(n=>!n.moment.expiresAt||Date.parse(n.moment.expiresAt)>now) as notice (notice.id)}<li class="space-y-2 py-3"><div class="text-sm">{notice.moment.text}</div><div class="flex gap-2"><button disabled={working||!!pending||!connected} on:click={()=>discussNotice(notice.id)} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Discuss in this chat</button>{#if !notice.readAt}<button disabled={working||!!pending||!connected} on:click={()=>run('read','mutation NativeMarkRead($id:ID!,$sourceHash:String!){socialMarkNotificationRead(id:$id,sourceHash:$sourceHash)}',{id:notice.id},true)} class="rounded-lg px-3 py-2 text-xs text-gray-500">Mark read</button>{/if}</div></li>{/each}</ul>{#if !notices.length}<p class="mt-3 text-xs text-gray-500">No matching moment notifications.</p>{/if}</details>{/if}
 {#if review&&draft}<div class="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700"><h3 class="text-sm font-medium">Review public sharing</h3><p class="whitespace-pre-wrap break-words text-sm">{draft.text}</p><p class="text-xs leading-5 text-gray-500">Audience: public. {draft.place?'Includes the selected place.':'No location attached.'} Expires {new Date(review.expiresAt).toLocaleString()}. This will be visible to other authorized viewers.</p><button disabled={!connected||working||!!pending||Date.parse(review.reviewExpiresAt)<=now} on:click={share} class="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">Confirm share publicly</button><button disabled={working} on:click={()=>review=null} class="ml-2 px-3 py-2 text-xs">Cancel</button>{#if Date.parse(review.reviewExpiresAt)<=now}<p class="text-xs text-gray-500">This review expired. Prepare a new review before sharing.</p>{/if}</div>{/if}
 {#if deleteReview}<div class="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700"><h3 class="text-sm font-medium">Delete this moment?</h3><p class="text-sm">{deleteReview.text}</p><p class="text-xs text-gray-500">This removes it from your moments and authorized shared views.</p><button disabled={!connected||working||!!pending} on:click={erase} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Confirm deletion</button><button disabled={working} on:click={()=>deleteReview=null} class="ml-2 px-3 py-2 text-xs">Cancel</button></div>{/if}
 {#if actionError}<p role="alert" class="text-xs text-amber-700 dark:text-amber-400">{actionError}</p>{/if}
 {#if pending&&!working}<p class="text-xs leading-5 text-gray-500">The last request is unconfirmed. Retry uses the same operation identifier.</p><button disabled={!connected} on:click={retry} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">Retry unconfirmed request</button>{/if}
</div>
