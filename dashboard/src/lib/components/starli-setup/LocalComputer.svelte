<script lang="ts">
 import { onDestroy, onMount } from 'svelte';
 import { user } from '$lib/stores';
 let state: any = null;
 let error = '';
 let pending = false;
 let frame = '';
 let text = '';
 let epoch = 0;
 let controller: AbortController | undefined;
 const base = '/api/v1/starli/local-vm';
 const keys = ['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'];
 let account = '';
 $: if (account !== ($user?.id || '')) { account = $user?.id || ''; epoch++; controller?.abort(); pending = false; state = null; clearFrame(); text = ''; error = ''; }
 function clearFrame() { if (frame) URL.revokeObjectURL(frame); frame = ''; }
 async function request(path: string, body?: any) {
  const token = localStorage.token;
  if (!token) throw new Error('Sign in before opening the local computer.');
  const result = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
   headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
   body: body === undefined ? undefined : JSON.stringify(body), signal: controller?.signal, cache: 'no-store' });
  if (!result.ok) { const data = await result.json().catch(() => ({})); throw new Error(typeof data.detail === 'string' ? data.detail : 'Local computer request failed.'); }
  if (token !== localStorage.token) throw new Error('Account changed; refresh the local computer.');
  return result;
 }
 async function refreshFrame(revision: number) {
  const blob = await (await request('/frame')).blob();
  if (revision !== epoch) return;
  clearFrame(); frame = URL.createObjectURL(blob);
 }
 async function run(action = 'refresh', payload?: any) {
  if (pending || $user?.role !== 'admin') return;
  pending = true; error = ''; const revision = epoch;
  controller?.abort(); const currentController = new AbortController(); controller = currentController;
  const timer = setTimeout(() => currentController.abort(), 40000);
  try {
   if (action !== 'refresh') await request('/' + action, payload || {});
   const next = await (await request('/status')).json();
   if (revision !== epoch) return;
   state = next;
   if (state.state === 'running') await refreshFrame(revision); else clearFrame();
  } catch (e: any) { if (revision === epoch) error = e?.name === 'AbortError' ? 'Request timed out. Refresh to check the actual VM state.' : e.message || 'Local computer unavailable.'; }
  finally { clearTimeout(timer); if (revision === epoch) pending = false; }
 }
 function click(event: MouseEvent) {
  const image = event.currentTarget as HTMLImageElement;
  const box = image.getBoundingClientRect();
  run('input', { kind: 'pointer', x: Math.floor((event.clientX - box.left) * image.naturalWidth / box.width), y: Math.floor((event.clientY - box.top) * image.naturalHeight / box.height), button: 'left' });
 }
 async function sendText() { const value = text; await run('input', { kind: 'text', text: value }); if (!error && text === value) text = ''; }
 onMount(() => { if ($user?.role === 'admin') run(); });
 onDestroy(() => { epoch++; controller?.abort(); clearFrame(); });
</script>

<section aria-labelledby="setup-computer" class="rounded-2xl border border-gray-100 p-5 dark:border-gray-800">
 <h2 id="setup-computer" class="font-medium">Local computer</h2>
 <p class="mt-2 text-sm text-gray-500">The installation owner can view and control this isolated VM. Company computers and agent enrollment keep their separate permissions.</p>
 {#if $user?.role !== 'admin'}
  <p class="mt-3 text-sm text-gray-500">Sign in with the installation administrator account to check the local VM.</p>
 {:else}
  <div class="mt-4 flex flex-wrap items-center gap-2">
   <button disabled={pending} on:click={() => run()} class="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Refresh</button>
   {#if state?.enabled && state?.configured && state?.state === 'stopped'}
    <button disabled={pending} on:click={() => run('start')} class="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Start VM</button>
   {/if}
   {#if state?.state === 'running'}
    <button disabled={pending} on:click={() => run('stop')} class="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Shut down guest</button>
   {/if}
   <span role="status" class="text-xs text-gray-500">{pending ? 'Checking VM…' : state ? `VM: ${state.state}` : 'Not checked'}</span>
  </div>
  {#if error}<p role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
  {#if state && !state.enabled}
   <p class="mt-3 text-sm text-gray-500">The local VM console is disabled. Follow the VM installation guide to configure a guest and enable this console.</p>
  {:else if state?.enabled && !state?.configured}
   <p class="mt-3 text-sm text-gray-500">No local guest is configured. Complete VM installation before starting it here.</p>
  {/if}
  {#if frame}
   <p class="mt-3 text-xs text-gray-500">Snapshot of the actual guest. Click inside the image to send a guest click; Refresh gets a new frame. VM process state alone does not verify the desktop or browser.</p>
   <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
   <img src={frame} alt="Current isolated local VM display" on:click={click} class="mt-3 w-full cursor-crosshair rounded-lg border border-gray-200 dark:border-gray-700" />
   <div class="mt-3 flex flex-wrap gap-2">
    {#each keys as key}<button disabled={pending} on:click={() => run('input', { kind: 'key', key })} class="rounded border px-2 py-1 text-xs disabled:opacity-40">{key}</button>{/each}
   </div>
   <form on:submit|preventDefault={sendText} class="mt-3 flex gap-2">
    <input bind:value={text} maxlength="1000" pattern="[ -~]+" aria-label="Text to type in the guest" placeholder="Text to type in the focused guest field" autocomplete="off" class="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" />
    <button disabled={pending || !text} class="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Type</button>
   </form>
   <p class="mt-2 text-xs text-gray-500">Typing sends printable English-layout characters; press Enter separately. Guest input delivery does not prove an application completed an action.</p>
  {/if}
 {/if}
</section>
