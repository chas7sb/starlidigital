<script lang="ts">
  import {createEventDispatcher,onMount,onDestroy} from 'svelte';
  import BossComposer from './BossComposer.svelte';
  import SignedInBusinessChoice from './SignedInBusinessChoice.svelte';
  import {OnboardingTransitionController,VERIFY_ROUTE,type NativeSignal,
    type PublicSnapshot,type TransitionProposal} from './onboarding-transition';

  /** All default false. Only ULTRA's server capability/identity adapter can enable. */
  export let signedIn = false;
  export let intakeEnabled = false;
  export let nativeVerificationEnabled = false;
  export let verifiedAdmissionCapability = false;
  export let verifiedCompanyChoices: {id:string;name:string;membershipRevision:number}[] = [];
  /** Untrusted event hint; native verification is mandatory before any proposal. */
  export let bootstrapEvent: NativeSignal | null = null;

  const dispatch=createEventDispatcher<{
    navigationProposed:TransitionProposal;
    intentRecorded:{intentId:string;originalPrompt:string};
    workspaceChoice:{kind:'existing'|'new';companyId:string|null;requiresNativeConfirmation:true};
  }>();
  let controller:OnboardingTransitionController|null=null;
  let snapshot:PublicSnapshot={
    phase:'IDLE',intentId:null,originalPrompt:'',draft:'',scrollTop:0,message:'',
    navigationProposed:false
  };
  let seenSignal: NativeSignal|null=null;
  let readyOnServer=false;
  let scrollListener:()=>void=()=>{};
  $: isRestoredPending=snapshot.phase==='RESTORED_UNVERIFIED' || snapshot.phase==='REVALIDATING' ||
    (snapshot.phase==='UNAVAILABLE' && Boolean(snapshot.intentId));
  $: blockedByExistingRequest=isRestoredPending || snapshot.navigationProposed ||
    ['PROPOSED','READY_PROPOSED','VERIFYING','DENIED','AUTH_REVOKED'].includes(snapshot.phase);

  function captureScroll(){
    if(!controller || typeof window==='undefined')return;
    controller.setDraft(snapshot.draft,Math.max(0,Math.round(window.scrollY)));
  }
  function onDraftChanged(event:CustomEvent<{draft:string}>){
    if(!controller)return;
    controller.setDraft(event.detail.draft,typeof window==='undefined'?0:Math.max(0,Math.round(window.scrollY)));
  }
  function onIntent(event:CustomEvent<Record<string,unknown>>){
    const receipt=event.detail;
    const accepted=controller?.acceptIntent(receipt);
    if(accepted?.ok && controller?.snapshot.intentId)
      dispatch('intentRecorded',{intentId:controller.snapshot.intentId,
        originalPrompt:controller.snapshot.originalPrompt});
  }
  async function retryRevalidation(){await controller?.revalidateStoredIntent();}

  onMount(()=>{
    controller=new OnboardingTransitionController({
      origin:window.location.origin,
      fetcher:window.fetch,
      storage:window.sessionStorage,
      verifyEndpoint:nativeVerificationEnabled?VERIFY_ROUTE:null,
      onChange:(value)=>snapshot=value,
      onNavigationProposed:(proposal)=>{
        // Never call goto/history.pushState. ULTRA must independently route.
        dispatch('navigationProposed',proposal);
      }
    });
    snapshot=controller.restore();
    const savedScroll=snapshot.scrollTop;
    if(savedScroll>0)window.requestAnimationFrame(()=>window.scrollTo({top:savedScroll,behavior:'instant'}));
    const fn=()=>captureScroll();
    window.addEventListener('scroll',fn,{passive:true});
    scrollListener=()=>window.removeEventListener('scroll',fn);
    if(snapshot.phase==='RESTORED_UNVERIFIED' && intakeEnabled)void retryRevalidation();
  });
  onDestroy(()=>{captureScroll();scrollListener();});

  $: if(controller && bootstrapEvent && bootstrapEvent!==seenSignal){
    seenSignal=bootstrapEvent;
    // Only signal reference is used; client-supplied room IDs never authorize transition.
    void controller.offerNativeEvent(bootstrapEvent);
  }
  $: readyOnServer = snapshot.phase==='READY_PROPOSED';
</script>

{#if signedIn}
  <SignedInBusinessChoice {signedIn} {verifiedAdmissionCapability} {verifiedCompanyChoices}
    on:workspaceChoice={(event)=>dispatch('workspaceChoice',event.detail)} />
{:else}
  <BossComposer signedIn={false} {intakeEnabled} {blockedByExistingRequest}
    restoredDraft={snapshot.draft} on:intent={onIntent} on:draftChanged={onDraftChanged}/>
  <div class="onboarding-status" role="status" aria-live="polite" data-phase={snapshot.phase}>
    {#if isRestoredPending}
      <p>Your earlier business request is saved in this browser. Checking your current guest session before continuing.</p>
      <button type="button" on:click={retryRevalidation} disabled={snapshot.phase==='REVALIDATING'}>Recheck saved request</button>
    {:else if snapshot.phase==='PROPOSED'}
      <p>Original request saved. Company and room provisioning are not yet authorized.</p>
    {:else if snapshot.phase==='VERIFYING'}
      <p>Checking a server-issued company event against current room membership and message history…</p>
    {:else if readyOnServer}
      <p>Native room verification returned an authorized receipt. Navigation awaits the authenticated workspace integration.</p>
    {:else if snapshot.phase==='AUTH_REVOKED'}
      <p class="notice">Your guest or company session was denied/revoked. No navigation occurred.</p>
    {:else if snapshot.phase==='DENIED'||snapshot.phase==='UNAVAILABLE'}
      <p class="notice">{snapshot.message || 'No verified company room is available.'}</p>
    {/if}
    {#if snapshot.phase==='PROPOSED' && !nativeVerificationEnabled}
      <p class="availability">Company transition is not installed on this server yet; your original request remains a proposal.</p>
    {/if}
    <p class="footnote">Starli will not create messages or open a company from browser events alone.</p>
  </div>
{/if}

<style>
 .onboarding-status{max-width:920px;margin:10px auto 0;padding:0 10px;color:#516788;font:12px/1.5 StarliMona,Arial,sans-serif}
 .onboarding-status p{margin:7px 0}
 .onboarding-status .notice{color:#942d38}
 .availability{color:#58688d}
 .footnote{font-size:11px;opacity:.9}
 button{font:inherit;border:1px solid #b8c8ea;background:#fff;border-radius:10px;padding:9px 12px;color:#284cba;cursor:pointer;margin:6px 0}
 button:focus-visible{outline:3px solid #765eef;outline-offset:3px}
 button:disabled{opacity:.6}
 @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style>
