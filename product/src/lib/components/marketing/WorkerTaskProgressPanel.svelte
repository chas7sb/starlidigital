<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    validateWorkerProgressEnvelope,
    type WorkerExecutionItemV1,
    type WorkerGraphSummary,
  } from './worker-task-progress';

  export let rawItems: WorkerExecutionItemV1[] = [];
  export let expectedCompanyId = '';
  export let expectedProjectId = '';
  export let expectedSourceMessageId = '';
  export let expectedRequestId = '';
  export let expectedGraphId = '';
  export let expectedRoomId = '';
  export let expectedAuthorizationRevision: number | undefined = undefined;
  export let expectedRunGeneration: number | undefined = undefined;
  export let expectedTaskIds: string[] = [];
  export let graphCompletionVerified = false;
  export let revoked = false;

  /** R5 interactive Stop & authoritative error states */
  export let canStop = false;
  export let stopping = false;
  export let stopDisposition: 'NONE' | 'STOP_PENDING' | 'STOPPED' | 'ALREADY_COMPLETED' | 'REVOKED' | 'HOLD_UNCERTAIN' = 'NONE';
  export let stopError = '';
  export let overrideSummary: WorkerGraphSummary | null = null;

  const dispatch = createEventDispatcher<{ stopRequested: { graphId: string } }>();

  $: computedSummary = validateWorkerProgressEnvelope(rawItems, {
    companyId: expectedCompanyId,
    projectId: expectedProjectId,
    sourceMessageId: expectedSourceMessageId,
    requestId: expectedRequestId || undefined,
    graphId: expectedGraphId || undefined,
    roomId: expectedRoomId || undefined,
    authorizationRevision: expectedAuthorizationRevision,
    runGeneration: expectedRunGeneration,
    expectedTaskIds,
    graphCompletionVerified,
    revoked,
  }) as WorkerGraphSummary;

  $: summary = overrideSummary ?? computedSummary;
  $: showStopButton =
    canStop &&
    Boolean(expectedGraphId) &&
    summary.phase !== 'REVOKED' &&
    summary.phase !== 'STOPPED';

  function handleStopClick() {
    if (stopping || !expectedGraphId) return;
    dispatch('stopRequested', { graphId: expectedGraphId });
  }
</script>

<section
  class="worker-progress-panel"
  aria-label="Starli task graph and worker execution receipts"
  data-testid="worker-progress-panel"
  data-worker-phase={summary.phase}
  data-stop-disposition={stopDisposition}
>
 {#if stopDisposition==='ALREADY_COMPLETED'}<p role="status" data-testid="worker-already-completed">Work already completed; no running worker remains. No cancellation was needed.</p>{/if}
  <header class="wp-header">
    <div>
      <h3>Worker task progress</h3>
      <p class="wp-banner" role="status" aria-live="polite">{summary.bannerText}</p>
    </div>
    <div class="wp-controls">
      <span class="wp-phase-badge phase-{summary.phase.toLowerCase()}" data-testid="worker-phase-badge">
        {summary.phase}
      </span>
      {#if showStopButton}
        <button
          type="button"
          class="wp-stop-btn"
          data-testid="worker-stop-btn"
          disabled={stopping}
          on:click={handleStopClick}
        >
          {stopping ? 'Stopping?' : 'Stop'}
        </button>
      {/if}
    </div>
  </header>

  {#if stopError}
    <p class="wp-downgraded" role="alert" data-testid="worker-stop-error">{stopError}</p>
  {/if}

  {#if summary.items.length > 0}
    <ul class="wp-list" aria-label="Dispatched worker tasks">
      {#each summary.items as item (item.taskId)}
        <li
          class="wp-item"
          data-task-id={item.taskId}
          data-bot-id={item.botId}
          data-task-status={item.effectiveStatus}
          data-is-fixture={item.isFixture}
          data-provenance-verified={item.serverProvenanceVerified}
        >
          <div class="wp-item-top">
            <strong class="wp-bot">{item.botId}</strong>
            <span class="wp-room">{item.roomId}</span>
            <span class="wp-status status-{item.effectiveStatus.toLowerCase()}">{item.effectiveStatus}</span>
            {#if item.isFixture}
              <span class="wp-fixture-badge" title="Test fixture receipt ? not live production execution">FIXTURE</span>
            {:else}
              <span class="wp-class-badge">{item.executionClass}</span>
            {/if}
          </div>
          <p class="wp-summary">{item.summary}</p>
          {#if item.artifactDigest}
            <code class="wp-digest" title="Verified artifact SHA-256 digest">{item.artifactDigest.slice(0, 24)}?</code>
          {/if}
          {#if item.downgradedReason}
            <p class="wp-downgraded">{item.downgradedReason}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if summary.rejectedCount > 0}
    <p class="wp-rejected" role="alert">
      Blocked {summary.rejectedCount} unverified, expired, or cross-tenant worker receipt(s).
    </p>
  {/if}
</section>

<style>
  .worker-progress-panel {
    box-sizing: border-box;
    width: 100%;
    max-width: 920px;
    min-width: 0;
    margin: 12px auto 0;
    padding: 14px 16px;
    background: #ffffff;
    border: 1px solid #dce5fa;
    border-radius: 18px;
    color: #1f3356;
    font: 13px/1.5 StarliMona, Arial, sans-serif;
  }
  .wp-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .wp-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wp-stop-btn {
    border: 1px solid #d98395;
    background: #fff5f7;
    color: #9b1c32;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 999px;
    cursor: pointer;
  }
  .wp-stop-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: #192b4d;
  }
  .wp-banner {
    margin: 4px 0 0;
    font-size: 12px;
    color: #4f6387;
  }
  .wp-phase-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 999px;
    background: #eef2ff;
    color: #2f4eb2;
    white-space: nowrap;
  }
  .phase-revoked, .phase-failed {
    background: #fde8ec;
    color: #9b1c32;
  }
  .phase-hold_uncertain, .phase-stop_pending, .phase-stopped, .phase-model_answered_only {
    background: #fff4e5;
    color: #9a5b13;
  }
  .phase-terminal_verified {
    background: #e6f6ee;
    color: #087443;
  }
  .wp-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wp-item {
    padding: 10px 12px;
    border: 1px solid #e6ecf8;
    border-radius: 12px;
    background: #f9fbff;
    min-width: 0;
  }
  .wp-item-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .wp-bot {
    font-weight: 700;
    color: #1c3158;
  }
  .wp-room {
    font-size: 11px;
    color: #5a6e91;
    background: #edf2fc;
    padding: 1px 7px;
    border-radius: 6px;
  }
  .wp-status {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 6px;
    background: #e8eefc;
    color: #2948a8;
  }
  .wp-fixture-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 6px;
    background: #fff0d6;
    color: #8f4f06;
    border: 1px solid #f2cf94;
  }
  .wp-class-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 6px;
    background: #e6f6ee;
    color: #087443;
  }
  .wp-summary {
    margin: 5px 0 0;
    font-size: 12px;
    color: #3d5175;
    word-break: break-word;
  }
  .wp-digest {
    display: inline-block;
    margin-top: 4px;
    font-size: 11px;
    color: #54688c;
    background: #eef2fa;
    padding: 2px 6px;
    border-radius: 5px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wp-downgraded, .wp-rejected {
    margin: 6px 0 0;
    font-size: 11px;
    color: #9b1c32;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
