<script lang="ts">
 import {onMount} from 'svelte';
 import {freshPosition,type LiveSession} from '$lib/utils/starli-live-location';
 import {mapPoint,mapCoordinate,wrappedDelta,standardTileURL} from '$lib/utils/starli-live-map';
 export let sessions:LiveSession[]=[];
 export let ownerId='';
 export let now=Date.now();
 export let tileURL=standardTileURL;
 let surface:HTMLDivElement,width=400,zoom=12,center={latitude:0,longitude:0},follow=true,enabled=false,tileError=false,seenOwner='',drag:{x:number;y:number;cx:number;cy:number}|null=null;
 $: visible=sessions.map(session=>({session,position:freshPosition(session,now)})).filter(value=>value.position!==null);
 $: mine=visible.find(value=>value.session.ownerId===ownerId);
 $: if(follow&&mine?.position)center={latitude:mine.position.latitude,longitude:mine.position.longitude};
 $: if(seenOwner!==ownerId){seenOwner=ownerId;enabled=false;center={latitude:0,longitude:0};follow=true;}
 $: if(!visible.length){enabled=false;center={latitude:0,longitude:0};}
 $: origin=mapPoint(center.latitude,center.longitude,zoom);
 $: tiles=enabled?Array.from({length:Math.ceil(width/256)+2},(_,column)=>Array.from({length:4},(_,row)=>{
  const x=Math.floor((origin.x-width/2)/256)+column,y=Math.floor((origin.y-160)/256)+row,n=2**zoom;
  return{x:((x%n)+n)%n,y,left:x*256-origin.x+width/2,top:y*256-origin.y+160};
 })).flat().filter(tile=>tile.y>=0&&tile.y<2**zoom):[];
 function move(dx:number,dy:number){follow=false;center=mapCoordinate(origin.x+dx,Math.max(0,Math.min(256*2**zoom,origin.y+dy)),zoom);}
 function down(event:PointerEvent){if(event.button!==0)return;follow=false;drag={x:event.clientX,y:event.clientY,cx:origin.x,cy:origin.y};surface.setPointerCapture(event.pointerId);}
 function pan(event:PointerEvent){if(drag)center=mapCoordinate(drag.cx-(event.clientX-drag.x),Math.max(0,Math.min(256*2**zoom,drag.cy-(event.clientY-drag.y))),zoom);}
 function key(event:KeyboardEvent){const deltas:Record<string,[number,number]>={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]};if(deltas[event.key]){event.preventDefault();move(...deltas[event.key]);}}
 onMount(()=>{const observer=new ResizeObserver(entries=>{width=entries[0].contentRect.width;});observer.observe(surface);return()=>observer.disconnect();});
</script>
<section class="space-y-2" aria-label="Authorized live location map">
 {#if !enabled}<p class="text-xs leading-5 text-gray-500">Showing this map loads OpenStreetMap tiles. Tile requests reveal the viewed area to OpenStreetMap.</p><button disabled={!visible.length} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800" on:click={()=>{enabled=true;tileError=false;if(!mine&&visible[0]?.position)center={latitude:visible[0].position.latitude,longitude:visible[0].position.longitude};}}>Show map</button>{/if}
 <div bind:this={surface} class="relative h-80 w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-850" style:touch-action={enabled?'none':'auto'} role="img" aria-label="Live location map. Use the pan and zoom buttons to navigate." on:pointerdown={(event)=>{if(enabled)down(event);}} on:pointermove={pan} on:pointerup={()=>drag=null} on:pointercancel={()=>drag=null}>
  {#if enabled}
   {#each tiles as tile (zoom+':'+tile.left+':'+tile.y)}<img alt="" aria-hidden="true" draggable="false" referrerpolicy="origin" src={tileURL(zoom,tile.x,tile.y)} on:error={()=>tileError=true} style:left={tile.left+'px'} style:top={tile.top+'px'} class="pointer-events-none absolute size-64 max-w-none"/>{/each}
   {#each visible as item (item.session.id)}
    {@const point=mapPoint(item.position?.latitude??0,item.position?.longitude??0,zoom)}
    <span class="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow {item.session.ownerId===ownerId?'bg-blue-500':'bg-violet-500'}" style:left={width/2+wrappedDelta(point.x,origin.x,zoom)+'px'} style:top={160+point.y-origin.y+'px'} title={item.session.ownerId===ownerId?'Your device-reported position':'Authorized connection position'}/>
   {/each}
   <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" class="absolute bottom-0 right-0 bg-white/90 px-1 text-[10px] text-gray-700">© OpenStreetMap contributors</a>
  {:else}<p class="p-4 text-xs text-gray-500">Map tiles are off.</p>{/if}
 </div>
 {#if enabled}<div class="flex flex-wrap gap-2">{#each [{label:'Pan west',x:-100,y:0,icon:'←'},{label:'Pan north',x:0,y:-100,icon:'↑'},{label:'Pan south',x:0,y:100,icon:'↓'},{label:'Pan east',x:100,y:0,icon:'→'}] as direction}<button aria-label={direction.label} on:click={()=>move(direction.x,direction.y)} class="rounded-lg bg-gray-100 px-2 py-1 dark:bg-gray-800">{direction.icon}</button>{/each}<button disabled={zoom>=18} on:click={()=>zoom++} aria-label="Zoom in" class="rounded-lg bg-gray-100 px-3 py-1 dark:bg-gray-800">+</button><button disabled={zoom<=2} on:click={()=>zoom--} aria-label="Zoom out" class="rounded-lg bg-gray-100 px-3 py-1 dark:bg-gray-800">−</button><button disabled={!mine} on:click={()=>follow=true} aria-pressed={follow} class="rounded-lg bg-gray-100 px-3 py-1 text-xs disabled:opacity-40 dark:bg-gray-800">Follow me</button><button on:click={()=>enabled=false} class="rounded-lg px-3 py-1 text-xs">Hide map</button></div>{/if}
 {#if tileError&&enabled}<p role="status" class="text-xs text-gray-500">Some map tiles are unavailable. Authorized position data and freshness are listed below.</p>{/if}
 <p class="text-xs text-gray-500">{visible.length} fresh authorized positions · Device reported · Stale or revoked positions are removed.</p>
</section>
