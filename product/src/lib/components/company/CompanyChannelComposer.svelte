<script lang="ts">
 import { createEventDispatcher, onMount } from 'svelte';

 export let draft = '';
 export let busy = false;
 export let eligible = false;
 const dispatch = createEventDispatcher<{send: void}>();
 let field: HTMLTextAreaElement;
 let value: string;
 function fit(node: HTMLTextAreaElement) {
  node.style.height = 'auto';
  node.style.height = Math.min(node.scrollHeight, 184) + 'px';
 }
 onMount(() => fit(field));
 $: if (field && draft !== value) {
  value = draft;
  fit(field);
 }
 function submit() {
  if (eligible && !busy && draft.trim()) dispatch('send');
 }
 function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
   if (window.matchMedia('(pointer: coarse)').matches) return;
   event.preventDefault();
   submit();
  }
 }
</script>

<form class="company-composer" on:submit|preventDefault={submit}>
 <textarea bind:this={field} bind:value={draft} rows="1" aria-label="Channel message"
  disabled={!eligible} placeholder="Message this channel…" on:input={() => fit(field)} on:keydown={keydown}></textarea>
 <button type="submit" aria-label="Send channel message" disabled={!eligible || busy || !draft.trim()}>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14l6-6"/></svg>
 </button>
</form>

<style>
 .company-composer { display:flex; align-items:center; gap:8px; width:100%; max-width:48rem;
  margin:0 auto; padding:8px 8px 8px 20px; border-radius:26px; background:#f1f2f4; color:#202124; }
 :global(.dark) .company-composer { background:#1e1e1e; color:#f1f1f1; }
 .company-composer:has(:focus-visible) { outline:2px solid #6288bc; outline-offset:2px; }
 textarea { flex:1; min-width:0; min-height:24px; max-height:184px; padding:0; margin:0; resize:none; overflow-y:auto;
  border:0; outline:0; background:transparent; font:inherit; font-size:16px; line-height:24px; color:inherit; }
 textarea::placeholder { color:#66707e; }
 :global(.dark) textarea::placeholder { color:#a7adb5; }
 button { display:grid; place-items:center; flex:none; width:36px; height:36px; border-radius:50%; background:#29292c; color:#fff; }
 button:hover:enabled { background:#414146; }
 button:disabled { background:#d5d5d8; color:#67676c; }
 :global(.dark) button:disabled { background:#39393e; color:#a1a1a8; }
 @media (pointer:coarse) { button { width:44px; height:44px; } .company-composer { padding:5px 5px 5px 16px; } }
</style>
