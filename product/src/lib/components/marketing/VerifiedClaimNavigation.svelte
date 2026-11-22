<script lang="ts">
 import {createEventDispatcher,onMount} from 'svelte';
 import OnboardingSessionAdapter from './OnboardingSessionAdapter.svelte';
 import {ClaimedRoomController,type ClaimStatus,type VerifiedNavigation} from './claim-room';
 import type {TransitionProposal,NativeSignal} from './onboarding-transition';

 export let signedIn=false;
 export let intakeEnabled=false;
 export let nativeVerificationEnabled=false;
 export let claimVerificationEnabled=false;
 export let verifiedAdmissionCapability=false;
 export let verifiedCompanyChoices:{id:string;name:string;membershipRevision:number}[]=[];
 export let bootstrapEvent:NativeSignal|null=null;
 let claimController:ClaimedRoomController|null=null;
 let claimStatus:ClaimStatus={phase:'DISABLED',reason:'',claimedRoomId:null,navigationProposed:false};
 let navigationCount=0;
 const dispatch=createEventDispatcher<{
   verifiedRoomNavigationProposed:VerifiedNavigation;
   intentRecorded:{intentId:string;originalPrompt:string};
   workspaceChoice:{kind:'existing'|'new';companyId:string|null;requiresNativeConfirmation:true};
 }>();

 onMount(()=>{
   claimController=new ClaimedRoomController({
     origin:window.location.origin,enabled:claimVerificationEnabled,
     fetcher:window.fetch,
     onChange:next=>claimStatus=next,
     onVerified:ready=>{
       navigationCount+=1;
       // This event is ONLY a proposal. ULTRA owns a fresh native ACL + route change.
       dispatch('verifiedRoomNavigationProposed',ready);
     }
   });
 });
 async function onNativeRoomProposal(event:CustomEvent<TransitionProposal>){
   // Untrusted first-stage trigger never grants access; native registered claim
   // + current membership/room/source must be revalidated by server.
   if(!claimController || !signedIn)return;
   await claimController.check(event.detail,signedIn);
 }
</script>

<section aria-label="Starli onboarding and verified native claim transition" class="w4-claim-navigation">
 <OnboardingSessionAdapter {signedIn} {intakeEnabled} {nativeVerificationEnabled}
   {verifiedAdmissionCapability} {verifiedCompanyChoices} {bootstrapEvent}
   on:navigationProposed={onNativeRoomProposal}
   on:intentRecorded={(event)=>dispatch('intentRecorded',event.detail)}
   on:workspaceChoice={(event)=>dispatch('workspaceChoice',event.detail)} />
 {#if signedIn}
  <div class="claim-note" role="status" aria-live="polite" data-claim-phase={claimStatus.phase}>
   {#if !claimVerificationEnabled}
    <p>Native company claim verification is not available yet. No room navigation will occur.</p>
   {:else if claimStatus.phase==='VERIFYING'}
    <p>Checking the registered owner, verified claim and native room permissions…</p>
   {:else if claimStatus.phase==='CLAIMED_ROOM_PROPOSED'}
    <p>Server verified the claimed room. Awaiting the authorized workspace router to open it.</p>
   {:else if ['REVOKED','DENIED','UNAVAILABLE'].includes(claimStatus.phase)}
    <p class="error">{claimStatus.reason}</p>
   {:else}
    <p>Room navigation remains locked until registered ownership and current native room access are verified.</p>
   {/if}
   <small>Original messages are not re-sent. No preview or company is created by this page.</small>
  </div>
 {/if}
</section>
<style>
 .w4-claim-navigation{width:100%;min-width:0}
 .claim-note{max-width:920px;margin:10px auto 0;padding:10px 14px;color:#4d6186;font:12px/1.5 StarliMona,Arial,sans-serif}
 .claim-note p{margin:5px 0}.claim-note .error{color:#942d38}.claim-note small{font-size:11px;color:#617496}
 @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style>
