<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import VerifiedClaimNavigation from './VerifiedClaimNavigation.svelte';
  import Grokbot1OnboardingPanel from './Grokbot1OnboardingPanel.svelte';
  import WorkerTaskProgressPanel from './WorkerTaskProgressPanel.svelte';
  import PrivateAppPreviewPane from './PrivateAppPreviewPane.svelte';
  import type { VerifiedNavigation } from './claim-room';
  import type { NativeSignal } from './onboarding-transition';
  import type { WorkerExecutionItemV1 } from './worker-task-progress';
  import type {
    ClaimedNativeCompanyV1,
    NormalizedOwnerNavigationV1,
    ProvisionalCompanyV1,
  } from './grokbot1-client';

  export let signedIn = false;
  export let intakeEnabled = false;
  export let nativeVerificationEnabled = false;
  export let claimVerificationEnabled = false;
  export let grokbot1WireEnabled = false;
  export let verifiedAdmissionCapability = false;
  export let verifiedCompanyChoices: { id: string; name: string; membershipRevision: number }[] = [];
  export let bootstrapEvent: NativeSignal | null = null;

  /** Wave1 Fixpass R1 Grokbot2 worker task & execution receipt props */
  export let workerProgressEnabled = false;
  export let workerItems: WorkerExecutionItemV1[] = [];
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
  export let authorityRevoked = false;

  /** Wave1 Grokbot4 right-pane private preview props */
  export let previewPaneEnabled = false;
  export let previewReceipt: {
    schemaVersion: number;
    status: string;
    previewId: string;
    companyId: string;
    projectId: string;
    revision: number;
    audience: string;
    checks: {
      html200: boolean;
      js200: boolean;
      apiPostReadback: boolean;
      restartPersistence: boolean;
      browserExecuted: boolean;
    };
  } | null = null;
  export let authorizedPreviewId = '';
  export let expectedPreviewRevision = 0;
  export let receiptSignatureValid = false;
  export let ticketValidatedByNativeServer = false;
  export let isolatedStorageAttested = false;
  export let previewOrigin: string | null = null;
  export let parentOrigin: string | null = null;
  export let trustedFrameUrl: string | null = null;

  let activeIntentId = '';

  const dispatch = createEventDispatcher<{
    verifiedRoomNavigationProposed: VerifiedNavigation;
    intentRecorded: { intentId: string; originalPrompt: string };
    workspaceChoice: { kind: 'existing' | 'new'; companyId: string | null; requiresNativeConfirmation: true };
    provisionalReady: ProvisionalCompanyV1;
    claimCommitted: ClaimedNativeCompanyV1;
    ownerNavigationReady: NormalizedOwnerNavigationV1;
  }>();

  function handleIntentRecorded(event: CustomEvent<{ intentId: string; originalPrompt: string }>) {
    activeIntentId = event.detail.intentId;
    dispatch('intentRecorded', event.detail);
  }

  $: showSplitLayout = previewPaneEnabled || Boolean(previewReceipt);
  $: showWorkerPanel = workerProgressEnabled || (Array.isArray(workerItems) && workerItems.length > 0);
</script>

<div
  class="boss-onboarding-journey"
  class:split-preview={showSplitLayout}
  data-journey-split={showSplitLayout}
>
  <div class="journey-main">
    <VerifiedClaimNavigation
      {signedIn}
      {intakeEnabled}
      {nativeVerificationEnabled}
      {claimVerificationEnabled}
      {verifiedAdmissionCapability}
      {verifiedCompanyChoices}
      {bootstrapEvent}
      on:verifiedRoomNavigationProposed={(e) => dispatch('verifiedRoomNavigationProposed', e.detail)}
      on:intentRecorded={handleIntentRecorded}
      on:workspaceChoice={(e) => dispatch('workspaceChoice', e.detail)}
    />

    {#if grokbot1WireEnabled && activeIntentId}
      <Grokbot1OnboardingPanel
        intentId={activeIntentId}
        {signedIn}
        on:provisionalReady={(e) => dispatch('provisionalReady', e.detail)}
        on:claimCommitted={(e) => dispatch('claimCommitted', e.detail)}
        on:ownerNavigationReady={(e) => dispatch('ownerNavigationReady', e.detail)}
      />
    {/if}

    {#if showWorkerPanel}
      <WorkerTaskProgressPanel
        rawItems={workerItems}
        {expectedCompanyId}
        {expectedProjectId}
        {expectedSourceMessageId}
        {expectedRequestId}
        {expectedGraphId}
        {expectedRoomId}
        {expectedAuthorizationRevision}
        {expectedRunGeneration}
        {expectedTaskIds}
        {graphCompletionVerified}
        revoked={authorityRevoked}
      />
    {/if}
  </div>

  {#if showSplitLayout}
    <aside class="journey-preview-pane" aria-label="Generated application right preview pane">
      <PrivateAppPreviewPane
        receipt={previewReceipt}
        {expectedCompanyId}
        {expectedProjectId}
        {authorizedPreviewId}
        expectedRevision={expectedPreviewRevision}
        {receiptSignatureValid}
        {ticketValidatedByNativeServer}
        {isolatedStorageAttested}
        {previewOrigin}
        {parentOrigin}
        {trustedFrameUrl}
      />
    </aside>
  {/if}
</div>

<style>
  .boss-onboarding-journey {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
  }
  .boss-onboarding-journey.split-preview {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    gap: 18px;
    align-items: start;
    max-width: 1280px;
    margin: 0 auto;
  }
  .journey-main {
    min-width: 0;
    width: 100%;
  }
  .journey-preview-pane {
    box-sizing: border-box;
    min-width: 0;
    width: 100%;
    margin-top: 24px;
    border: 1px solid #dce5fa;
    border-radius: 20px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 10px 30px rgba(61, 83, 148, 0.08);
  }
  @media (max-width: 960px) {
    .boss-onboarding-journey.split-preview {
      grid-template-columns: minmax(0, 1fr);
    }
    .journey-preview-pane {
      margin-top: 12px;
    }
  }
</style>
