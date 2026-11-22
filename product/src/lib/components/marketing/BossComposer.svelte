<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  // @ts-ignore — .mjs is intentionally runnable by native Node tests without a build step.
  import { BossIntentController } from './boss-intent-controller.mjs';
  export let signedIn = false;
  export let guestEntry=false;
  export let compact=false;
  export let intakeEnabled = false;
  export let restoredDraft = '';
  export let blockedByExistingRequest = false;
  export let verifiedBootstrap = null;
  let draft = '';
  $: if(restoredDraft && !draft) draft = restoredDraft;
  let view = {state:'idle', error:'', receipt:null};
  let controller;
  const dispatch = createEventDispatcher();
  controller = new BossIntentController({
    onState: (value) => {
      view = {state:value.state,error:value.error,receipt:value.receipt};
      if (value.receipt) dispatch('intent',value.receipt);
    }
  });
  let speechAvailable = false;
  let listening = false;
  let speechError = '';
  let recognition;
  onMount(() => {
    speechAvailable = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  });
  function dictate() {
    if (listening) { recognition?.stop(); return; }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return;
    speechError = '';
    recognition = new Speech();
    recognition.lang = document.documentElement.lang || 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      draft = (draft + ' ' + text).trim().slice(0, 4000);
      dispatch('draftChanged', {draft});
    };
    recognition.onerror = () => { speechError = 'Microphone unavailable. You can type your request.'; listening = false; };
    recognition.onend = () => { listening = false; };
    try { recognition.start(); listening = true; }
    catch { speechError = 'Microphone unavailable. You can type your request.'; }
  }
  let currentIntentId = null;
  let lastBootstrapEventKey = '';
  $: if (view.receipt) currentIntentId = view.receipt.intentId;
  $: verifiedChannel = verifiedBootstrap?.schemaVersion === 1 &&
    verifiedBootstrap?.intentId === currentIntentId &&
    verifiedBootstrap?.status === 'READY' &&
    Boolean(verifiedBootstrap?.companyId?.trim()) &&
    Boolean(verifiedBootstrap?.bossDmRoomId?.trim()) &&
    Boolean(verifiedBootstrap?.channelRoomId?.trim()) &&
    Boolean(verifiedBootstrap?.rootProjectId?.trim()) &&
    Number.isInteger(verifiedBootstrap?.bootstrapRevision) && verifiedBootstrap.bootstrapRevision > 0
      ? verifiedBootstrap : null;
  // Only ULTRA's verified native navigation adapter may act on a real bootstrap event.
  function notifyVerifiedBootstrap(bootstrap, originalPrompt, currentDraft) {
    const key = `${bootstrap.intentId}:${bootstrap.companyId}:${bootstrap.bootstrapRevision}`;
    if (lastBootstrapEventKey !== key) {
      lastBootstrapEventKey = key;
      dispatch('bootstrapReady', {receipt:bootstrap, originalPrompt, draft:currentDraft});
    }
  }
  $: if (verifiedChannel && view.receipt) notifyVerifiedBootstrap(verifiedChannel, view.receipt.originalPrompt, draft);
  const busy = () => view.state === 'sending' || view.state === 'checking-session';
  async function send() {
    if (busy() || !intakeEnabled || (signedIn && !guestEntry) || blockedByExistingRequest) return;
    await controller.submit(draft);
  }
  function onKey(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); void send();
    }
  }
  onDestroy(() => { recognition?.abort(); controller.discard(); });
</script>

<section class="boss-wrap" aria-label="Ask Starli to build your business">

  <form on:submit|preventDefault={send} aria-label="Starli business request">
    <label for="boss-business-prompt" class="sr-only">Tell Starli about your business</label>
    <textarea id="boss-business-prompt" bind:value={draft} on:input={() => dispatch('draftChanged', {draft})} on:keydown={onKey} maxlength="4000" rows="2" autocomplete="off"
      placeholder="Tell Starli what business you want to build, or describe your existing business..."
      aria-describedby="boss-send-help boss-progress" />
    <div class="composer-actions">
      {#if speechAvailable}<button type="button" class="mic" on:click={dictate} aria-label={listening ? 'Stop dictation' : 'Dictate your business idea'} aria-pressed={listening} disabled={busy() || blockedByExistingRequest}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/></svg>
      </button>{/if}
    <button class="boss-send" type="submit" disabled={busy() || !intakeEnabled || (signedIn && !guestEntry) || blockedByExistingRequest || !draft.trim() || view.state === 'proposal-received'}
      aria-label="Send your business idea to Starli"><span class="sr-only">{view.state === 'proposal-received' ? 'Saved' : busy() ? 'Saving…' : 'Send'}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 14 0m-6-6 6 6-6 6"/></svg></button>
    </div>
  </form>
  <p id="boss-send-help" class="help" class:sr-only={compact}>Enter to send · Shift+Enter for a new line · Examples and bots above are illustrative.</p>
  {#if speechError}<p class="error" role="status">{speechError}</p>{/if}
  <div id="boss-progress" aria-live="polite" class="progress" role="status">
    {#if compact}
      {#if view.error}<p class="error">{view.error}</p>{#if controller.pending}<button type="button" class="retry" on:click={send}>Retry same request</button>{/if}{/if}
    {:else}
    {#if signedIn && !guestEntry}
      <p>Existing account: open your company workspace to talk to Starli. A new-business session is not yet connected.</p>
    {:else if !intakeEnabled}
      <p>New-business onboarding is not enabled here yet. Your text stays in this browser until you leave this page.</p>
    {:else if busy()}
      <p>Saving your request to your guest session…</p>
    {:else if blockedByExistingRequest && view.state === 'idle'}
      <p>A previous request is being recovered or verified; no second send is allowed.</p>
    {:else if view.state === 'proposal-received'}
      <p>Request saved. No company, bot or app has been created yet. {#if !verifiedChannel}Company setup is awaiting backend confirmation.{:else}Company channel confirmed; continue in your workspace.{/if}</p>
    {:else if view.error}
      <p class="error">{view.error}</p>
      {#if controller.pending}<button type="button" class="retry" on:click={send}>Retry same request</button><button type="button" class="retry" on:click={() => controller.discard()}>Discard pending request</button>{/if}
    {/if}
    {/if}
  </div>
</section>

<style>
 .boss-wrap{color:#203557}
 form{box-sizing:border-box}
 textarea{border:0;background:transparent;color:inherit;font:inherit;line-height:1.6;min-width:0}
 .boss-send{background:#3563ff;color:white;cursor:pointer}
 .boss-send:disabled{background:#a8b6d3;cursor:not-allowed}
 .boss-send:focus-visible,textarea:focus-visible,.retry:focus-visible{outline:3px solid #7c62ff;outline-offset:3px}
 .progress,.help{font-size:12px;line-height:1.5;color:#566c8f}
 .error{color:#9b1c32}
 .retry{background:transparent;border:0;color:#3158df;text-decoration:underline;margin:8px 10px 0 0;cursor:pointer}
 .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
 .boss-wrap{max-width:none;margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none}
 form{display:flex;flex-wrap:wrap;gap:0;border:0;border-radius:12px;padding:12px 14px;background:white}
 textarea{flex:1 1 100%;width:100%;min-height:48px;padding:2px 0;resize:vertical;font-size:14px}
 .composer-actions{width:100%;display:flex;align-items:center;justify-content:flex-end;gap:10px}
 .boss-send,.mic{display:grid;place-items:center;min-width:36px;min-height:36px;padding:8px;border-radius:9px;border:0}
 .mic{background:transparent;color:#657a9e;cursor:pointer}.mic[aria-pressed="true"]{background:#e9edff;color:#3563ff}
 .mic:focus-visible{outline:3px solid #7c62ff;outline-offset:3px}.mic:disabled{opacity:.5;cursor:not-allowed}
 .help{font-size:11px;margin:10px 0 0}.progress:empty{display:none}
 @media(max-width:550px){form{display:flex}textarea{width:100%;font-size:16px}.boss-send{padding:8px}}
</style>
