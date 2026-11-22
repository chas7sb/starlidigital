<script lang="ts">
  import {
    evaluatePreviewGate,
    type BoundPreviewReceipt,
    type PreviewAuthorityState,
  } from './app-preview-bootstrap-adapter';

  /** Native shell supplies a verified receipt; model-generated fields are never bound here. */
  export let receipt: BoundPreviewReceipt | null = null;
  export let expectedCompanyId = '';
  export let expectedProjectId = '';
  export let authorizedPreviewId = '';
  export let expectedRevision = 0;
  export let receiptSignatureValid = false;
  export let ticketValidatedByNativeServer = false;
  export let isolatedStorageAttested = false;
  export let authorityState: PreviewAuthorityState = 'PENDING';
  /** Native-only dedicated HTTPS origin, or explicit STAGING_LOOPBACK distinct port in staging. */
  export let previewOrigin: string | null = null;
  export let parentOrigin: string | null = null;
  /** Signed and revocable ticket is embedded in this server-issued iframe URL. */
  export let trustedFrameUrl: string | null = null;
  /** Explicit staging-only opt-in for local loopback distinct-port preview transport (never production). */
  export let allowStagingLoopback = false;
  export let statusMessage = '';

  type Device = 'desktop' | 'tablet' | 'mobile';
  let device: Device = 'desktop';
  const widths: Record<Device, string> = { desktop: '100%', tablet: '834px', mobile: '390px' };

  $: gate = evaluatePreviewGate({
    receipt,
    expectedCompanyId,
    expectedProjectId,
    authorizedPreviewId,
    expectedRevision,
    receiptSignatureValid,
    ticketValidatedByNativeServer,
    isolatedStorageAttested,
    authorityState,
    previewOrigin,
    parentOrigin,
    trustedFrameUrl,
    allowStagingLoopback,
  });

  $: safeFrameUrl = gate.ready ? gate.safeFrameUrl : null;
</script>

<section
  class="private-preview"
  aria-label="Private application preview"
  data-testid="private-app-preview-pane"
  data-preview-state={gate.state}
  data-transport-mode={gate.transportMode}
>
  <header>
    <div>
      <h2>Application preview</h2>
      <small>Private ? Preview access required</small>
    </div>
    <div class="badges">
      {#if gate.transportMode === 'STAGING_LOOPBACK'}
        <span class="staging-badge" data-testid="preview-staging-badge">STAGING LOOPBACK</span>
      {/if}
      {#if safeFrameUrl}
        <span class="ready" aria-label="Preview ready" data-testid="preview-ready-badge">Ready</span>
      {:else}
        <span class="state-badge state-{gate.state.toLowerCase()}" data-testid="preview-state-badge">{gate.state}</span>
      {/if}
    </div>
  </header>

  {#if safeFrameUrl}
    <nav aria-label="Preview screen size">
      <button type="button" aria-pressed={device === 'desktop'}
        on:click={() => device = 'desktop'}>Desktop</button>
      <button type="button" aria-pressed={device === 'tablet'}
        on:click={() => device = 'tablet'}>Tablet</button>
      <button type="button" aria-pressed={device === 'mobile'}
        on:click={() => device = 'mobile'}>Mobile</button>
    </nav>
    <div class="frame-area">
      <!-- Dedicated per-preview origin only: never use this sandbox combo with Starli origin. -->
      <iframe
        title="Private customer application preview"
        data-testid="private-app-iframe"
        src={safeFrameUrl}
        style:width={widths[device]}
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerpolicy="no-referrer"
        loading="lazy"
      ></iframe>
    </div>
  {:else}
    <div class="pending" role="status" aria-live="polite" data-testid="preview-unavailable-box">
      <strong>
        {#if gate.state === 'LOADING'}
          Verifying preview authority?
        {:else if gate.state === 'REVOKED'}
          Preview access revoked
        {:else if gate.state === 'DENIED'}
          Preview access denied
        {:else if gate.state === 'ERROR'}
          Preview verification error
        {:else}
          Preview unavailable
        {/if}
      </strong>
      {#if statusMessage}
        <p>{statusMessage}</p>
      {:else if gate.state === 'REVOKED' || receipt?.status === 'AUTHORITY_REVOKED'}
        <p>Preview access has been revoked. A new verified authorization is required.</p>
      {:else if gate.state === 'DENIED'}
        <p>{gate.reason}</p>
      {:else if gate.state === 'LOADING'}
        <p>Checking bound server receipt, lease, and authority before loading the private app.</p>
      {:else if receipt?.status === 'TEST_FIXTURE_PERSISTED'}
        <p>The isolated DogLove test saved and recovered its data after a Node restart. This is not a public preview: native authority, real database, HTTPS isolation, and guest compute still require independent verification.</p>
      {:else if receipt?.status === 'HTTP_VERIFIED'}
        <p>HTTP and JavaScript checks passed, but no authorized private preview has been established.</p>
      {:else if receipt?.status === 'QUEUED' || receipt?.status === 'STOP_REQUESTED'}
        <p>Private preview compute is unavailable, stopped, or awaiting verified teardown. No unverified application can be opened.</p>
      {:else if receipt?.status === 'FAILED'}
        <p>The preview could not be verified. Review the build and process logs.</p>
      {:else}
        <p>{gate.reason}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .private-preview{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:240px;min-width:0;padding:16px;gap:14px;background:#fff;color:#101828;border:1px solid #dce5fa;border-radius:18px;max-width:920px;margin:12px auto 0}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .badges{display:flex;align-items:center;gap:8px}
  h2{font-size:1rem;font-weight:600;margin:0 0 4px}
  small{font-size:.75rem;color:#667085}
  .ready{font-size:.75rem;font-weight:700;color:#087443;background:#e6f6ee;padding:3px 9px;border-radius:999px}
  .staging-badge{font-size:.7rem;font-weight:700;color:#8f4f06;background:#fff0d6;border:1px solid #f2cf94;padding:2px 8px;border-radius:999px}
  .state-badge{font-size:.7rem;font-weight:700;padding:3px 9px;border-radius:999px;background:#eef2ff;color:#2f4eb2}
  .state-revoked,.state-denied,.state-error{background:#fde8ec;color:#9b1c32}
  nav{display:flex;flex-wrap:wrap;gap:8px}
  button{border:1px solid #cfd4e3;background:#fff;border-radius:9px;padding:8px 12px;cursor:pointer;color:inherit}
  button[aria-pressed="true"]{background:#e9eefb;border-color:#9aade8}
  button:focus-visible{outline:2px solid #265cdc;outline-offset:2px}
  .frame-area{flex:1;min-height:260px;overflow:auto;display:flex;justify-content:center;background:#f2f4f8;border-radius:12px;padding:8px}
  iframe{max-width:100%;height:340px;min-height:260px;background:white;border:1px solid #d0d5dd;border-radius:6px}
  .pending{padding:18px 12px;border:1px dashed #d0d5dd;border-radius:12px}
  .pending strong{font-weight:600}
  .pending p{line-height:1.5;font-size:.9rem;color:#475467;margin:6px 0 0}
</style>
