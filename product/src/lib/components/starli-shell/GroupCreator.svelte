<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 import {starliAgents} from '$lib/stores/starli-activity';
 import {jsonApi} from './identity';
 import Portrait from './Portrait.svelte';
 const dispatch=createEventDispatcher();
 let caps:any=null,groups:any[]=[],name='',selected:string[]=[],error='',busy=false,loading=true,pending='',attemptBody='';
 const ctrl=new AbortController(),base='/api/v1/starli/group-chats';
 async function load(){loading=true;error='';try{caps=await jsonApi(base+'/capabilities',ctrl.signal);if(caps.version!=='starli.group-chat.v1'||!caps.persistenceAvailable)throw Error();let after='';const rows=[];do{const r=await jsonApi(base+'/?limit=100'+(after?'&after='+encodeURIComponent(after):''),ctrl.signal);rows.push(...r.items);if(r.hasMore&&r.nextCursor===after)throw Error();after=r.hasMore?r.nextCursor:'';}while(after);groups=rows;}catch{caps=null;error='Group conversations are unavailable on this server.';}finally{loading=false;}}
 async function create(){if(busy||!caps||!name.trim()||!selected.length)return;busy=true;error='';
 const body=JSON.stringify({name:name.trim(),memberAgentIds:[...selected],coordinatorAgentId:null});
 if(body!==attemptBody){attemptBody=body;pending=crypto.randomUUID();}
 try{const d=await jsonApi(base+'/',ctrl.signal,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pending},body});if(!d.group?.groupId)throw Error();dispatch('open',d.group);}
 catch{error='Group creation unconfirmed. Retry the same details or refresh the list.';}finally{busy=false;}}
 onMount(load);onDestroy(()=>ctrl.abort());
</script>
<h2>Group conversations</h2><p>Choose agents to join a shared transcript.</p>{#if loading}<p role="status">Loading groups…</p>{:else if caps}
{#each groups as g}<button class="sd-list-link" on:click={()=>dispatch('open',g)}>{g.name}<span>{g.members.length} members</span></button>{/each}
<form on:submit|preventDefault={create}><label>Group name<input required maxlength="100" bind:value={name}/></label><fieldset><legend>Members</legend>{#each Object.values($starliAgents).filter(a=>a.status==='ACTIVE') as agent}<label class="sd-check"><input type="checkbox" value={agent.id} bind:group={selected}/><Portrait {agent} size={26}/>{agent.name}</label>{/each}</fieldset><button class="sd-primary" disabled={busy||!selected.length||selected.length>16||!name.trim()}>Create group</button></form>{/if}{#if error}<p role="status">{error}</p><button class="sd-button" on:click={load}>Refresh groups</button>{/if}
