<script lang="ts">
 import {onDestroy} from 'svelte';
 import {portraits,artPosition,portraitIndex,avatarVersions} from './identity';
 import {user} from '$lib/stores';
 import Portrait from './Portrait.svelte';
 export let agent:any=null;
 export let shape:string;
 export let available=false;
 let preview='',file:File|null=null,remove=false,error='',zoom=1,image:HTMLImageElement;
 function discard(){if(preview)URL.revokeObjectURL(preview);preview='';file=null;zoom=1;}
 function choose(event:Event){
  const el=event.currentTarget as HTMLInputElement;const f=el.files?.[0];el.value='';
  if(!f)return;
  if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5*1024*1024){error='Choose a JPEG, PNG or WebP image under 5 MB.';return;}
  discard();error='';file=f;preview=URL.createObjectURL(f);remove=false;
 }
 export async function save(agentId:string,token:string,owner:string){
  if(!file&&!remove)return;
  let blob:Blob|null=null;
  if(file){
   if(!image?.naturalWidth)throw Error('The avatar preview is still loading.');
   const side=Math.min(image.naturalWidth,image.naturalHeight)/zoom;
   const canvas=document.createElement('canvas');canvas.width=canvas.height=384;
   canvas.getContext('2d')!.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,384,384);
   blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',.9));
   if(!blob)throw Error('Could not prepare this image.');
  }
  if(owner!==$user?.id||localStorage.token!==token)throw Error('Account changed. Reopen the agent editor.');
  const r=await fetch('/api/v1/starli/avatars/'+encodeURIComponent(agentId),{method:blob?'PUT':'DELETE',body:blob,headers:{Authorization:'Bearer '+token,...(blob?{'Content-Type':'image/webp'}:{})}});
  if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))throw Error('Agent saved. Avatar update failed. Retry the photo in this editor.');
  const result=await r.json();if(owner!==$user?.id||localStorage.token!==token)return;
  avatarVersions.update(v=>({...v,[agentId]:result.revision||''}));discard();remove=false;
 }
 onDestroy(discard);
</script>
<fieldset class="av"><legend>Agent portrait</legend><div class="preview">
 {#if preview}<span class="crop"><img bind:this={image} src={preview} alt="Avatar crop preview" style:transform={'scale('+zoom+')'} on:error={()=>{discard();error='Could not read this image.'}}/></span>
 {:else}<Portrait agent={{...agent,id:remove?'preview':agent?.id,avatarShape:shape}} size={68}/>{/if}
 <div><label class="upload"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!available} on:change={choose}/>Upload an image</label>
 <small>{available?'JPG, PNG or WebP · up to 5 MB':'Image uploads unavailable on this server'}</small></div>
 </div>
 {#if preview}<label>Crop zoom <input type="range" min="1" max="3" step=".05" bind:value={zoom}/></label>{/if}
 <div class="choices">{#each portraits as label,i}<button type="button" title={label} aria-label={'Use '+label+' portrait'} aria-pressed={!file&&portraitIndex({avatarShape:shape})===i} style:background-position={artPosition(i)} on:click={()=>{discard();shape='p'+i;remove=!!$avatarVersions[agent?.id];}}></button>{/each}</div>
 {#if file||$avatarVersions[agent?.id]}<button type="button" class="restore" on:click={()=>{discard();remove=true}}>Restore generated portrait</button>{/if}
 {#if error}<p role="alert">{error}</p>{/if}</fieldset>
<style>.av{border:0}.av legend{font-weight:650}.preview,.choices{display:flex;align-items:center;gap:12px;margin:10px 0}.crop{width:68px;height:68px;border-radius:50%;display:block;overflow:hidden}.crop img{width:100%;height:100%;object-fit:cover}.choices{flex-wrap:wrap;gap:7px}.choices button{width:40px;height:40px;border-radius:50%;background-image:url('/starli-art/portraits.webp');background-size:300% 300%}.choices button[aria-pressed=true]{outline:2px solid #7642ee;outline-offset:2px}.upload{position:relative;display:inline-flex;border:1px solid #aaa2c3;border-radius:9px;padding:6px 12px;cursor:pointer}.upload:focus-within{outline:2px solid #7642ee}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.av small{display:block;font-size:12px;margin-top:4px}.restore{text-decoration:underline}.av p{color:#a13b53}</style>
