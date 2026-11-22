<script lang="ts">
 import {createEventDispatcher} from 'svelte';
 export let busy=false;
 export let accepted=false;
 export let unavailable=false;
 export let error='';
 export let originalPrompt='';
 export let executionSourceMessageId='';
 const dispatch=createEventDispatcher<{confirm:void}>();
</script>
<section class="build-confirmation" aria-label="Confirm building your app" data-testid="claimed-build-confirmation">
 <div>
  <h2>{accepted?'Build requested':'Ready to start building?'}</h2>
  <p>Your original request is saved. Start building adds your confirmation to this company conversation.</p>
  {#if originalPrompt}<blockquote>{originalPrompt}</blockquote>{/if}
 </div>
 <button type="button" class="start-building" on:click={()=>dispatch('confirm')} disabled={busy||accepted||unavailable} data-testid="start-building">
  {busy?'Starting…':accepted?'Build requested':'Start building'}
 </button>
 {#if busy}<p role="status" aria-live="polite">Confirming your access and starting the workers…</p>{/if}
 {#if accepted}<p role="status" aria-live="polite">Your build was accepted. Worker progress appears below.</p>{/if}
 {#if executionSourceMessageId}<small>Confirmation recorded in this conversation.</small>{/if}
 {#if unavailable}<p role="status">Building is unavailable for this request.</p>{/if}
 {#if error}<p class="build-error" role="alert">{error}</p>{/if}
</section>
<style>
 .build-confirmation{display:flex;align-items:center;flex-wrap:wrap;gap:16px;padding:20px;border:1px solid #dce5fa;background:#f6f8ff;border-radius:14px;margin:12px 16px;color:#192640}
 .build-confirmation>div{flex:1;min-width:min(100%,220px)}h2{margin:0 0 6px;font-size:18px;line-height:1.3}p{font-size:14px;line-height:1.5;margin:0}
 blockquote{white-space:pre-wrap;overflow-wrap:anywhere;margin:14px 0 0;font-size:14px;line-height:1.5;color:#506280}
 button{border:0;border-radius:10px;min-height:44px;padding:12px 18px;background:#3563ff;color:white;font:inherit;font-weight:650;cursor:pointer}
 button:disabled{background:#8798bf;cursor:default}button:focus-visible{outline:3px solid #7c62ff;outline-offset:3px}
 .build-confirmation>p,.build-confirmation>small{flex-basis:100%}.build-error{color:#9b1c32}small{font-size:12px;color:#506280}
 @media(max-width:520px){.build-confirmation{margin:12px;padding:16px}button{width:100%}}
</style>
