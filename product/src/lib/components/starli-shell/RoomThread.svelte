<script lang="ts">
 import {createEventDispatcher,onMount,onDestroy} from 'svelte';
 import type {CompanyClient} from '$lib/utils/company-workspace';
 export let client:CompanyClient;
 export let room:string;
 export let root:any;
 export let directory:any[]=[];
 const dispatch=createEventDispatcher();
 let dialog:HTMLDialogElement,rows:any[]=[],draft='',error='',busy=false,more=false,cursor=0,reading=false,alive=true;
 let attempt:{body:string;key:string}|null=null;
 const speaker=(m:any)=>directory.find(a=>a.id===m.speaker?.id)?.name||(m.speaker?.kind==='agent'?'AI agent bot':'Team member');
 const url=()=>'/rooms/'+encodeURIComponent(room)+'/messages';
 function fail(e:any){if(!alive)return;if([401,403,404].includes(e.status)){rows=[];dispatch('denied');dispatch('close');}else error='Could not confirm the request. Your reply is kept here.';}
 function merge(items:any[]){const map=new Map(rows.map(r=>[r.id,r]));for(const item of items){if(item.roomId!==room||item.parentId!==root.id)throw Error('Wrong thread');map.set(item.id,item);}rows=[...map.values()].sort((a,b)=>a.sequence-b.sequence);}
 async function load(reset=false){
  if(reading)return;reading=true;error='';
  try{const after=reset?0:cursor;const d=await client.request(url()+'?threadRootId='+encodeURIComponent(root.id)+'&after='+after+'&limit=50');if(!alive)return;
   if(!Array.isArray(d.messages)||!Number.isSafeInteger(d.next)||d.hasMore&&d.next<=after)throw Error();
   if(reset)rows=[];merge(d.messages);cursor=d.next;more=d.hasMore===true;
  }catch(e){fail(e);}finally{reading=false;}
 }
 async function send(){
  if(busy||!draft.trim())return;busy=true;error='';attempt??={body:draft.trim(),key:crypto.randomUUID()};
  try{const d=await client.request(url(),'POST',{content:attempt.body,parentId:root.id,mentions:[],dispatchAgentIds:[],attachmentIds:[]},attempt.key);if(!alive)return;merge([d.message]);attempt=null;draft='';dispatch('updated');}catch(e){fail(e);}finally{busy=false;}
 }
 onMount(()=>{dialog.showModal();void load(true);});
 onDestroy(()=>{alive=false;dialog?.close();});
</script>
<dialog bind:this={dialog} aria-labelledby="sd-thread-title" on:cancel={()=>dispatch('close')}><header><h2 id="sd-thread-title">Thread</h2><button aria-label="Close thread" on:click={()=>dispatch('close')}>Close</button></header>
 <div class="history"><article><strong>{speaker(root)}</strong><p>{root.deleted?'Message deleted':root.content}</p></article>
 <h3>Replies</h3>{#each rows as m(m.id)}<article><strong>{speaker(m)}</strong><p>{m.deleted?'Message deleted':m.content}</p></article>{:else}{#if !reading&&!error}<p>No replies yet.</p>{/if}{/each}
 {#if more}<button disabled={reading} on:click={()=>load()}>Show more replies</button>{/if}
 <button disabled={reading||busy} on:click={()=>load(true)}>Refresh thread</button></div>
 {#if error}<p role="alert">{error}</p>{/if}
 <form on:submit|preventDefault={send}><label>Reply to thread<textarea bind:value={draft} readonly={!!attempt} maxlength="32768"/></label><button disabled={busy||!draft.trim()}>{attempt?'Retry reply':'Send reply'}</button></form>
</dialog>
<style>dialog{position:fixed;inset:8px 8px 8px auto;margin:0;width:min(425px,calc(100vw - 16px));height:calc(100dvh - 16px);max-height:none;padding:16px;background:var(--sd-card);color:var(--sd-text);border:1px solid var(--sd-line);border-radius:16px;box-shadow:0 12px 42px #20183a28}dialog[open]{display:flex;flex-direction:column;gap:12px}dialog::backdrop{background:#17132345}header{display:flex;align-items:center;justify-content:space-between}h2{font-size:21px;font-weight:700}h3{font-size:14px;font-weight:650;margin-top:12px}.history{overflow:auto;flex:1}article{padding:10px 0;border-bottom:1px solid var(--sd-line)}article p{white-space:pre-wrap;overflow-wrap:anywhere}button,textarea{border:1px solid var(--sd-line);border-radius:9px;padding:8px;background:var(--sd-card);color:inherit}button{min-height:42px}textarea{width:100%;display:block}form button{margin-top:8px;background:var(--sd-accent);color:var(--sd-card)}:focus-visible{outline:2px solid var(--sd-accent);outline-offset:2px}</style>
