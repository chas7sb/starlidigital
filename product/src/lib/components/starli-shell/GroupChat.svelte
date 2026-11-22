<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {user} from '$lib/stores';
 import {jsonApi} from './identity';
 import Icon from './Icon.svelte';
 export let id:string;
 let snapshot:any=null,items:any[]=[],caps:any=null,draft='',targets:string[]=[],error='',busy=false,loaded=false;
 let attempt:{key:string;body:string}|null=null,ctrl=new AbortController(),serial=0,timer:any;
 const base='/api/v1/starli/group-chats';
 async function refresh(){
  const n=++serial;
  try{
   const [c,s]=await Promise.all([jsonApi(base+'/capabilities',ctrl.signal),jsonApi(base+'/'+encodeURIComponent(id),ctrl.signal)]);
   if(s.version!=='starli.group-chat.v1'||s.group?.groupId!==id)throw Error('Group unavailable.');
   let cursor='',rows:any[]=[];do{
    const d=await jsonApi(base+'/'+encodeURIComponent(id)+'/messages?limit=100'+(cursor?'&after='+encodeURIComponent(cursor):''),ctrl.signal);
    if(d.conversationId!==s.group.conversationId||!Array.isArray(d.items))throw Error('Conversation changed.');
    rows=rows.concat(d.items);const next=d.hasMore?d.nextCursor:'';if(next&&next===cursor)throw Error('History cursor unavailable.');cursor=next;
   }while(cursor&&!ctrl.signal.aborted);
   if(n!==serial||ctrl.signal.aborted)return;caps=c;snapshot=s;items=rows;loaded=true;
  }catch(e){if(!ctrl.signal.aborted&&n===serial){error='Group conversation unavailable. Refresh to reconnect.';snapshot=null;items=[];}}
 }
 async function send(){
  if(!snapshot||busy||!draft.trim())return;
  const payload=attempt||{key:crypto.randomUUID(),body:JSON.stringify({content:draft.trim(),expectedCurrentId:snapshot.currentId,expectedGroupRevision:snapshot.group.revision,dispatch:targets.length?{mode:'explicit',targetAgentIds:targets}:{mode:'none'}})};
  attempt=payload;busy=true;error='';
  try{await jsonApi(base+'/'+encodeURIComponent(id)+'/messages',ctrl.signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':payload.key},body:payload.body});draft='';attempt=null;sessionStorage.removeItem('starli.group.draft:'+$user.id+':'+id);await refresh();}
  catch(e){error='Delivery unconfirmed. Retry the same message or refresh the transcript.';}finally{busy=false;}
 }
 onMount(()=>{draft=sessionStorage.getItem('starli.group.draft:'+$user.id+':'+id)||'';void refresh();timer=setInterval(()=>{if(!document.hidden&&!busy)void refresh();},6500);});
 onDestroy(()=>{ctrl.abort();clearInterval(timer);});
</script>
<section class="sd-group"><header><Icon name="groups"/><h2>{snapshot?.group.name||'Group conversation'}</h2><button on:click={refresh}>Refresh</button></header>
 {#if snapshot}<div class="members">{#each snapshot.group.members as m}<span>{m.name}</span>{/each}</div>{/if}
 <div class="transcript" role="log">{#each items as m(m.id)}<article class:mine={m.role==='user'}><strong>{m.role==='user'?'You':m.starliAgentName}</strong><p>{m.content}</p>{#each (m.statusHistory||[]) as step}<small>{step.description||step.status}</small>{/each}</article>{:else}<p>{loaded?'Start a group conversation.':'Loading group history…'}</p>{/each}</div>
 {#if error}<p role="alert">{error}</p>{/if}
 {#if snapshot}{#if caps?.dispatchAvailable}<fieldset><legend>Reply from</legend>{#each snapshot.group.members as m}<label><input type="checkbox" bind:group={targets} value={m.agentId} disabled={!!attempt||!m.available||targets.length>=4&&!targets.includes(m.agentId)}/>{m.name}</label>{/each}</fieldset>{:else}<small>Group notes are available. Agent replies are unavailable on this server.</small>{/if}
 <form on:submit|preventDefault={send}><textarea aria-label="Group message" placeholder="Message your group…" bind:value={draft} readonly={!!attempt} on:input={()=>sessionStorage.setItem('starli.group.draft:'+$user.id+':'+id,draft)}></textarea><button disabled={busy||!draft.trim()}>{attempt?'Retry':'Send'}</button></form>{/if}
</section>
<style>.sd-group{height:100%;display:flex;flex-direction:column;gap:12px;padding:16px;color:var(--sd-text);background:var(--sd-card)}header,.members,form{display:flex;align-items:center;gap:10px}header h2{font-weight:720;flex:1}.members{flex-wrap:wrap}.members span,article{border:1px solid var(--sd-line);border-radius:12px;padding:6px 10px}.transcript{flex:1;overflow:auto;min-height:0}.transcript article{margin:10px 0;max-width:92%}.transcript p{white-space:pre-wrap;overflow-wrap:anywhere}.mine{margin-left:auto!important;background:var(--sd-tint)}.sd-group textarea{resize:vertical;flex:1;min-width:0;border-radius:10px;border:1px solid var(--sd-line);padding:10px;background:var(--sd-card)}form button{background:#6535ed;color:white;border-radius:10px;padding:10px 16px}fieldset label{display:inline-flex;gap:4px;margin-right:8px}</style>
