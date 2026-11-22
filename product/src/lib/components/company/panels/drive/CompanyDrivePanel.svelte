<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  export let companyId: string;
  export let request: (path: string, init?: RequestInit) => Promise<Response>;
  export let picker = false;
  export let section: 'drive' | 'documents' = 'drive';
  type Item = { id:string; title:string; kind:string; body:string; version:number; parent:string|null; channel:string|null };
  const dispatch = createEventDispatcher();
  let folders: Item[] = [], channels: Array<{id:string}> = [];
  let items: Item[] = [], parent: string|null = null, query = '', mode = 'folder';
  let message = '', busy = false, folderName = '', channel = '', destination = '';
  let selected: Item|null = null, text = '', image = '', fileInput: HTMLInputElement;
  let controller: AbortController|null = null, generation = 0, cursor = 0;
  let mounted = false, scope = '', timer: ReturnType<typeof setInterval>;
  const base = () => '/api/v1/companies/' + encodeURIComponent(companyId) + '/drive';
  function clearPreview() { if(image) URL.revokeObjectURL(image); image=''; text=''; selected=null; }
  async function api(path='', method='GET', body?: unknown) {
    const response = await request(base()+path, {method, cache:'no-store', signal:controller?.signal,
      ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})});
    if (!response.ok) {
      items=[]; folders=[]; channels=[]; clearPreview();
      throw new Error(response.status === 404 ? 'Access is unavailable. Refresh your company membership.' : 'This item changed or the request failed. Refresh and try again.');
    }
    return response;
  }
  async function load() {
    controller?.abort(); controller = new AbortController();
    const current=++generation; busy=true; message='';
    try {
      const params=new URLSearchParams();
      if (query) params.set('q',query);
      else if(mode==='recent') params.set('recent','1');
      else if(mode==='trash') params.set('trash','1');
      else if(parent) params.set('parent',parent);
      if(section==='documents') params.set('kind','knowledge');
      const result=await (await api('?'+params)).json();
      if(current===generation) {
        items=result.data;
        const options=await Promise.all([(await api('?recent=1&kind=folder')).json(),(await api('/channels')).json()]);
        if(current===generation) { folders=options[0].data; channels=options[1].data; }
      }
    } catch(e) { if(current===generation && !(e instanceof DOMException && e.name==='AbortError')) message=String(e); }
    finally { if(current===generation) busy=false; }
  }
  async function action(work:()=>Promise<unknown>) {
    busy=true; message='';
    try { await work(); clearPreview(); await load(); }
    catch(e) { message=String(e); } finally { busy=false; }
  }
  async function mutate(item:Item, operation:string, value?:string|null) {
    await action(()=>api('/'+encodeURIComponent(item.id),'PATCH',{version:item.version,operation,value}));
  }
  async function upload(event:Event) {
    const file=(event.target as HTMLInputElement).files?.[0];
    if(!file) return;
    if(file.size>16*1024*1024) { message='Files must be 16 MiB or smaller.'; return; }
    await action(async()=>{
      const bytes=new Uint8Array(await file.arrayBuffer());
      let binary=''; for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return api('/items','POST',{title:file.name,kind:'file',parent,data:btoa(binary),mime:file.type||'application/octet-stream'});
    });
    fileInput.value='';
  }
  async function preview(item:Item) {
    clearPreview(); selected=item;
    if(item.kind==='knowledge') { text=item.body; return; }
    try {
      const response=await api('/'+encodeURIComponent(item.id)+'/preview?version='+item.version);
      if(selected?.id!==item.id) return;
      const mime=response.headers.get('Content-Type')||'';
      if(mime.startsWith('text/plain')) text=await response.text();
      else if(mime==='image/png'||mime==='image/jpeg') image=URL.createObjectURL(await response.blob());
      else text='Preview is unavailable for this format. Download to open it.';
    } catch(e) { clearPreview(); message=String(e); }
  }
  async function saveDocument() {
    if(!selected) return;
    const item=selected;
    await action(()=>api('/'+item.id+'/document','POST',{version:item.version,title:item.title,body:text}));
  }
  async function download(item:Item) {
    try {
      const response=await api('/'+encodeURIComponent(item.id)+'/content?version='+item.version);
      const url=URL.createObjectURL(await response.blob()), anchor=document.createElement('a');
      anchor.href=url; anchor.download=item.title; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) {message=String(e);}
  }
  async function changes() {
    if(busy) return;
    try {
      const result=await (await api('/events?after='+cursor)).json();
      cursor=result.data.cursor;
      clearPreview();
      await load();
    } catch(e) {items=[];clearPreview();message=String(e);}
  }
  $: if(mounted && scope!==companyId+':'+section) {
    scope=companyId+':'+section; parent=null;query='';cursor=0;items=[];clearPreview();void load();
  }
  onMount(()=>{mounted=true;timer=setInterval(()=>void changes(),15000);});
  onDestroy(()=>{mounted=false;generation++;controller?.abort();clearInterval(timer);clearPreview();});
</script>

<section class="p-4 space-y-4" aria-label={section==='drive'?'Company Drive':'Company documents'}>
  <header class="flex items-center justify-between"><h1 class="text-xl font-semibold">{section==='drive'?'Company Drive':'Documents'}</h1>
    <button type="button" on:click={load} disabled={busy}>Refresh</button></header>
  <form class="flex gap-2" on:submit|preventDefault={load}>
    <input aria-label="Search company files" bind:value={query} placeholder="Search" class="rounded border p-2 bg-transparent"/>
    <button disabled={busy}>Search</button>
  </form>
  <nav class="flex gap-3" aria-label="Drive views">
    {#each ['folder','recent','trash'] as view}
      <button type="button" aria-pressed={mode===view} on:click={()=>{mode=view;query='';parent=null;void load();}}>{view==='folder'?'My Drive':view==='recent'?'Recents':'Trash'}</button>
    {/each}
  </nav>
  {#if section==='drive' && mode!=='trash'}
    <label class="block">Upload file <input bind:this={fileInput} type="file" on:change={upload} disabled={busy}/></label>
    <form class="flex gap-2" on:submit|preventDefault={()=>action(()=>api('/items','POST',{title:folderName,kind:'folder',parent}))}>
      <input aria-label="Folder name" bind:value={folderName} placeholder="Folder name" class="border rounded p-2 bg-transparent"/>
      <button disabled={busy||!folderName}>Create folder</button>
    </form>
  {/if}
  {#if section==='documents'}
    <form class="space-y-2" on:submit|preventDefault={()=>action(()=>api('/items','POST',{title:folderName,kind:'knowledge',body:text}))}>
      <input aria-label="Document title" bind:value={folderName} placeholder="Document title" class="border rounded p-2 bg-transparent"/>
      <textarea aria-label="Document content" bind:value={text} class="block w-full border rounded p-2 bg-transparent"/>
      <button disabled={busy||!folderName}>Create document</button>
    </form>
  {/if}
  {#if parent}<button on:click={()=>{parent=null;void load();}}>Back to My Drive</button>{/if}
  {#if message}<p role="alert">{message}</p>{/if}
  {#if busy}<p role="status">Loading…</p>{/if}
  {#if !busy && !items.length}<p>No accessible items in this view.</p>{/if}
  <ul class="divide-y divide-gray-200 dark:divide-gray-700">
    {#each items as item (item.id)}
      <li class="py-3 space-y-2">
        <div class="flex flex-wrap gap-3 items-center">
          <button class="font-medium" on:click={()=>item.kind==='folder'?(parent=item.id,load()):preview(item)}>{item.title}</button>
          <span class="text-sm text-gray-500">{item.kind} · v{item.version}</span>
          {#if item.kind==='file'}<button on:click={()=>download(item)}>Download</button>{/if}
          {#if picker && item.kind==='file'}<button on:click={()=>dispatch('pick',{id:item.id,version:item.version,companyId})}>Attach</button>{/if}
          {#if mode==='trash'}
            <button on:click={()=>mutate(item,'restore')}>Restore</button>
          {:else}
            <button on:click={()=>mutate(item,'trash')}>Move to trash</button>
            <button on:click={()=>mutate(item,'share',null)}>Revoke sharing</button>
            <button on:click={()=>{selected=item;}}>Share or move</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
  {#if selected}
    <aside class="border rounded p-3 space-y-3" aria-label="Selected item">
      <h2>{selected.title}</h2>
      {#if image}<img src={image} alt={selected.title} class="max-h-72"/>{/if}
      {#if selected.kind==='knowledge'}
        <textarea aria-label="Edit document" bind:value={text} class="block w-full border rounded p-2 bg-transparent"/>
        <button on:click={saveDocument}>Save document</button>
      {:else if text}<pre class="whitespace-pre-wrap">{text}</pre>{/if}
      <label>Channel <select bind:value={channel} class="border rounded p-2 bg-transparent">
        <option value="">Select an authorized channel</option>
        {#each channels as option}<option value={option.id}>{option.id}</option>{/each}
      </select></label>
      <button disabled={!channel} on:click={()=>selected&&mutate(selected,'share',channel)}>Share to channel</button>
      <label>Destination folder <select bind:value={destination} class="border rounded p-2 bg-transparent">
        <option value="">My Drive</option>
        {#each folders.filter(folder=>folder.id!==selected?.id) as folder}<option value={folder.id}>{folder.title}</option>{/each}
      </select></label>
      <button on:click={()=>selected&&mutate(selected,'move',destination||null)}>Move</button>
      <button on:click={clearPreview}>Close</button>
    </aside>
  {/if}
</section>
