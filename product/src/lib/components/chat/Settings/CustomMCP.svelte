<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {decodeMcpServer,mcpFields,mcpError,mcpRequestFence,type McpServer,type McpRegistryPort} from '$lib/utils/starli-account-mcp';
 export let ownerId='';
 export let api:McpRegistryPort|null=null;
 export let runtimeAvailable=false;
 let servers:McpServer[]=[],cursor='',hasMore=false,busy=false,error='',notice='',seen='',seenApi:McpRegistryPort|null=null,sessionBlocked=false,ready=false,mounted=false;
 let editor:McpServer|null|undefined=undefined,latest:McpServer|null=null,name='',url='',transport:McpServer['transport']='streamable-http',credential='',clearCredential=false;
 const fence=mcpRequestFence();
 function close(){editor=undefined;latest=null;name='';url='';credential='';clearCredential=false;}
 function edit(server:McpServer|null){editor=server;latest=null;name=server?.name??'';url=server?.url??'';transport=server?.transport??'streamable-http';credential='';clearCredential=false;error='';notice='';}
 async function load(more=false){
  if(!api||!ownerId||sessionBlocked)return;const port=api,owner=ownerId,guard=fence.begin();busy=true;error='';
  try{if(port.capabilities){const caps=await port.capabilities(guard.signal);if(!guard.current()||owner!==ownerId||port!==api)return;runtimeAvailable=caps.remoteConnected&&(caps.transports['streamable-http']||caps.transports.sse);}
   const page=await port.list(more?cursor:'',guard.signal);if(!guard.current()||owner!==ownerId||port!==api)return;
   if(!Array.isArray(page.items)||page.items.length>50||typeof page.cursor!=='string'||page.cursor.length>180||typeof page.hasMore!=='boolean'||(page.hasMore&&(!page.cursor||page.cursor===(more?cursor:''))))throw Error('MCP_RESPONSE_INVALID');
   const rows=page.items.map(decodeMcpServer);servers=more?[...new Map([...servers,...rows].map(s=>[s.id,s])).values()]:rows;cursor=page.cursor;hasMore=page.hasMore;ready=true;
   if(editor&&port.get){const selected=editor,fresh=await port.get(selected.id,guard.signal);if(!guard.current()||owner!==ownerId||port!==api||editor!==selected)return;if(fresh.revision>selected.revision)latest=fresh;}
  }catch(e){if(guard.current()){ready=false;error=mcpError(e);}}finally{if(guard.current())busy=false;}
 }
 async function mutate(action:(port:McpRegistryPort,signal:AbortSignal)=>Promise<McpServer|void>,message:string,closeAfter=false){
  if(!api||busy||!ready||!ownerId||sessionBlocked)return;const port=api,owner=ownerId,guard=fence.begin();busy=true;error='';notice='';
  try{const result=await action(port,guard.signal);if(!guard.current()||owner!==ownerId||port!==api)return;
   if(result){const server=decodeMcpServer(result);servers=[...servers.filter(s=>s.id!==server.id),server].sort((a,b)=>a.name.localeCompare(b.name));}
   notice=message;if(closeAfter)close();
  }catch(e){if(guard.current())error=mcpError(e);}finally{if(guard.current())busy=false;}
 }
 async function save(){
  let fields;try{fields=mcpFields(name,url,transport,credential,clearCredential);}catch(e){error=mcpError(e);credential='';return;}
  const selected=editor;credential='';
  await mutate((port,signal)=>selected?port.update(selected.id,{...fields,expectedRevision:selected.revision},signal):port.create(fields,signal),'Connection saved. Changed settings require fresh discovery.',true);
 }
 async function remove(server:McpServer){if(!confirm('Remove '+server.name+' from your account? This affects all your bots.'))return;
  await mutate(async(port,signal)=>{await port.remove(server.id,server.revision,signal);return undefined},'Connection removed.');
  if(notice==='Connection removed.')servers=servers.filter(s=>s.id!==server.id);
 }
 function testConnection(server:McpServer){return mutate(async(port,signal)=>{if(!port.test)throw Error('MCP_REMOTE_TRANSPORT_UNAVAILABLE');await port.test(server.id,server.revision,signal);},'Connection test succeeded.');}
 function discover(server:McpServer){return mutate((port,signal)=>{if(!port.discover)throw Error('MCP_REMOTE_TRANSPORT_UNAVAILABLE');return port.discover(server.id,server.revision,signal);},'Discovery result received.');}
 function sessionChanged(event:StorageEvent){if(event.key==='token'||event.key===null){sessionBlocked=true;ready=false;fence.clear();servers=[];close();busy=false;error='Your session changed. Reopen Settings to continue.';}}
 $: if(mounted&&(ownerId!==seen||api!==seenApi)){sessionBlocked=false;ready=false;seen=ownerId;seenApi=api;fence.clear();servers=[];cursor='';hasMore=false;close();busy=false;error='';notice='';if(ownerId&&api)void load();}
 onMount(()=>mounted=true);
 onDestroy(()=>{fence.clear();credential='';});
</script>
<svelte:window on:storage={sessionChanged}/>
<section class="flex h-full flex-col gap-4 text-sm" aria-label="Custom MCP connections">
 <header><h2 class="font-medium">Custom MCP</h2><p class="mt-1 text-xs text-gray-500">Add a connection once for your account. Enabled connections apply to all your owned bots.</p></header>
 {#if !api}<p class="rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-850">Account MCP management is not available on this server yet.</p>{/if}
 {#if !runtimeAvailable}<p class="text-xs text-gray-500">Remote tool execution is not available yet. Saved connections are not confirmed as usable.</p>{/if}
 <div class="flex items-center justify-between"><p class="text-xs text-gray-500">Remote HTTPS · Streamable HTTP or SSE</p><button disabled={!api||busy||!ready} class="rounded-lg bg-gray-100 px-3 py-2 text-xs disabled:opacity-40 dark:bg-gray-800" on:click={()=>edit(null)}>Add server</button></div>
 {#if editor!==undefined}
  <form class="space-y-3 rounded-xl border border-gray-100 p-3 dark:border-gray-800" on:submit|preventDefault={save}>
   <h3 class="text-sm font-medium">{editor?'Edit connection':'Add connection'}</h3>
   {#if latest}<div class="rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-850"><p>Newer revision {latest.revision}: {latest.name} · {latest.url} · {latest.transport}</p><p class="mt-1 text-gray-500">Your non-secret edits are kept below. Review before applying them.</p><button type="button" class="mt-2 underline" on:click={()=>{editor=latest;latest=null;clearCredential=false;}}>Use this revision with my edits</button></div>{/if}
   <label class="block text-xs">Name<input required maxlength="100" bind:value={name} disabled={busy} class="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-850"/></label>
   <label class="block text-xs">HTTPS endpoint<input required type="url" bind:value={url} disabled={busy} placeholder="https://example.com/mcp" class="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-850"/></label>
   <label class="block text-xs">Transport<select bind:value={transport} disabled={busy} class="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-850"><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
   <label class="block text-xs">Bearer credential · optional<input type="password" autocomplete="new-password" maxlength="8192" bind:value={credential} disabled={busy||clearCredential} class="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-850"/></label>
   {#if editor?.credentialConfigured}<p class="text-xs text-gray-500">A credential is configured. Leave blank to keep it; stored credentials are never shown.</p><label class="flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={clearCredential} disabled={busy}/> Remove configured credential</label>{/if}
   <div class="flex justify-end gap-2"><button type="button" disabled={busy} class="rounded-lg px-3 py-2 text-xs" on:click={close}>Cancel</button><button disabled={busy} class="rounded-lg bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">{busy?'Saving…':'Save connection'}</button></div>
  </form>
 {/if}
 {#if error}<p role="alert" class="text-xs text-red-600 dark:text-red-400">{error}</p>{/if}
 {#if notice}<p role="status" class="text-xs text-gray-500">{notice}</p>{/if}
 <div class="min-h-0 flex-1 space-y-2 overflow-auto">
  {#each servers as server (server.id)}<article class="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
   <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h3 class="truncate font-medium">{server.name}</h3><p class="mt-1 break-all text-xs text-gray-500">{server.url}</p></div><span class="text-xs text-gray-500">{server.enabled?'Enabled':'Disabled'}</span></div>
   <p class="mt-2 text-xs text-gray-500">{server.status==='DISCOVERED'?'Tools discovered':'Not tested'} · {server.toolCount} tools · {server.credentialConfigured?'Credential configured':'No credential'} · Revision {server.revision}</p>
   <div class="mt-3 flex flex-wrap gap-2 text-xs"><button disabled={busy} class="rounded-lg px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>edit(server)}>Edit</button><button disabled={busy||!ready||!runtimeAvailable||!api?.test} class="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" on:click={()=>testConnection(server)}>Test connection</button><button disabled={busy||!ready||!runtimeAvailable||!api?.discover} class="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" on:click={()=>discover(server)}>Discover tools</button><button disabled={busy||(!runtimeAvailable&&!server.enabled)} class="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" on:click={()=>mutate((port,signal)=>port.enable(server.id,server.revision,!server.enabled,signal),'Connection availability updated for all your bots.')}>{server.enabled?'Disable':'Enable'}</button><button disabled={busy} class="rounded-lg px-2 py-1 text-red-600" on:click={()=>remove(server)}>Remove</button></div>
  </article>{:else}<p class="py-4 text-xs text-gray-500">{busy?'Loading connections…':'No account MCP connections loaded.'}</p>{/each}
 </div>
 <div class="flex gap-2 text-xs"><button disabled={busy||!api} class="rounded-lg px-3 py-2 text-gray-500 disabled:opacity-40" on:click={()=>load()}>Refresh</button>{#if hasMore}<button disabled={busy} class="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800" on:click={()=>load(true)}>Load more</button>{/if}</div>
</section>



