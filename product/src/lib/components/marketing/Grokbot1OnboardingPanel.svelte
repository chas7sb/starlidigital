<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { user } from '$lib/stores';
  import { authenticateOnboardingAccount } from './onboarding-account-auth';
  import {
    Grokbot1JourneyClient,
    type ClaimedNativeCompanyV1,
    type NormalizedOwnerNavigationV1,
    type ProvisionalCompanyV1,
  } from './grokbot1-client';

  export let intentId = '';
  export let signedIn = false;
  export let getBearerToken: () => string | null = () =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;

  let authMode:'signin'|'signup'='signin';
  let authName='',authEmail='',authPassword='',authBusy=false,authError='';
  let authRequest:AbortController|null=null;
  onDestroy(()=>authRequest?.abort());
  async function submitAccountAuth(){
    if(authBusy||signedIn||!provisional||!intentId)return;
    authBusy=true;authError='';
    const request=new AbortController();authRequest=request;
    const timeout=setTimeout(()=>request.abort(),15000);
    const password=authPassword;authPassword='';
    try{
      const session=await authenticateOnboardingAccount({
        mode:authMode,name:authName.trim(),email:authEmail.trim(),password,
        signal:request.signal,fetcher:fetch
      });
      if(request.signal.aborted)return;
      // Only the actual native verified session is committed; saved intent/provisional/claim key stay intact.
      localStorage.setItem('token',session.token);
      user.set(session.account);
      window.dispatchEvent(new Event('starli-session-updated'));
      statusMessage='Signed in. Confirm the claim below to continue with your saved request.';
    }catch(cause){
      if(authRequest===request)authError=(cause as Error).name==='AbortError'?
        'Sign-in timed out. Please try again.':(cause as Error).message;
    }finally{
      clearTimeout(timeout);
      if(authRequest===request){authBusy=false;authRequest=null;}
    }
  }

  let provisional: ProvisionalCompanyV1 | null = null;
  let claimed: ClaimedNativeCompanyV1 | null = null;
  let navigation: NormalizedOwnerNavigationV1 | null = null;
  let pendingClaimIdemKey = '';
  let reauthPassword = '';
  let phase:
    | 'IDLE'
    | 'BOOTSTRAPPING'
    | 'RESTRICTED_PROVISIONAL_ACTIVE'
    | 'ONE_ACTIVE_BLOCKED'
    | 'CLAIMING'
    | 'REAUTH_REQUIRED'
    | 'REAUTHENTICATING'
    | 'CLAIMED_COMMITTED'
    | 'NAV_PENDING_FRESHNESS'
    | 'NAV_READY'
    | 'ERROR' = 'IDLE';
  let statusMessage = '';

  const dispatch = createEventDispatcher<{
    provisionalReady: ProvisionalCompanyV1;
    claimCommitted: ClaimedNativeCompanyV1;
    ownerNavigationReady: NormalizedOwnerNavigationV1;
  }>();

  function makeClient() {
    return new Grokbot1JourneyClient({
      fetcher: typeof window !== 'undefined' ? window.fetch : globalThis.fetch,
      getBearerToken,
    });
  }

  export async function bootstrapProvisional() {
    if (!intentId) return;
    phase = 'BOOTSTRAPPING';
    statusMessage = 'Creating restricted provisional company?';
    const res = await makeClient().bootstrapProvisional(intentId);
    if (res.ok === false) {
      if (res.error.code === 'ACTIVE_PROVISIONAL_EXISTS') {
        phase = 'ONE_ACTIVE_BLOCKED';
        statusMessage = 'An active provisional company already exists for this guest session. Continue or claim it before starting another.';
      } else {
        phase = 'ERROR';
        statusMessage = `Provisional setup blocked (${res.error.code}).`;
      }
      return;
    }
    provisional = res.data;
    phase = 'RESTRICTED_PROVISIONAL_ACTIVE';
    statusMessage = `Restricted provisional company ready (revision ${provisional.revision}). Sign in to claim ownership.`;
    dispatch('provisionalReady', provisional);
  }

  export async function claimNow(idempotencyKey?: string) {
    if (!intentId || !provisional || !signedIn) return;
    phase = 'CLAIMING';
    statusMessage = 'Claiming provisional company under your verified account?';
    const idem = idempotencyKey || pendingClaimIdemKey || `claim_${intentId.slice(0, 16)}_rev${provisional.revision}`;
    pendingClaimIdemKey = idem;
    const res = await makeClient().claimProvisional(intentId, provisional.revision, idem);
    if (res.ok === false) {
      if (res.error.status === 401 && res.error.code === 'RECENT_AUTH_REQUIRED') {
        phase = 'REAUTH_REQUIRED';
        statusMessage = 'Recent re-authentication required. Confirm your password to complete the claim.';
        return;
      }
      phase = 'ERROR';
      statusMessage = `Claim failed (${res.error.code}).`;
      return;
    }
    claimed = res.data;
    phase = 'CLAIMED_COMMITTED';
    statusMessage = 'Company claim committed. Verifying native room readback?';
    dispatch('claimCommitted', claimed);
    await refreshOwnerNavigation();
  }

  export async function submitReauthAndResumeClaim() {
    if (!reauthPassword.trim() || !provisional) return;
    phase = 'REAUTHENTICATING';
    statusMessage = 'Verifying recent password re-authentication?';
    const pw = reauthPassword;
    reauthPassword = '';
    const res = await makeClient().reauthenticate(pw);
    if (res.ok === false) {
      phase = 'REAUTH_REQUIRED';
      statusMessage = `Re-authentication failed (${res.error.code}). Try again.`;
      return;
    }
    // Resume the SAME provisional claim with the SAME idempotency key
    await claimNow(pendingClaimIdemKey);
  }

  export async function refreshOwnerNavigation() {
    if (!intentId || !signedIn) return;
    const res = await makeClient().fetchOwnerNavigation(intentId, {
      companyId: claimed?.companyId ?? provisional?.companyId ?? undefined,
      minClaimRevision: claimed?.revision,
    });
    if (res.ok === false) {
      phase = 'ERROR';
      statusMessage = `Owner navigation check denied (${res.error.code}).`;
      return;
    }
    navigation = res.data;
    if (navigation.status === 'READY') {
      phase = 'NAV_READY';
      statusMessage = 'Verified claimed company and room ready to open.';
      dispatch('ownerNavigationReady', navigation);
    } else if (navigation.status === 'PENDING_FRESHNESS_RECEIPT') {
      phase = 'NAV_PENDING_FRESHNESS';
      statusMessage = navigation.reason;
    } else {
      phase = 'ERROR';
      statusMessage = navigation.reason;
    }
  }
</script>

{#if intentId}
  <section
    class="grokbot1-panel"
    aria-label="Provisional company and verified owner claim status"
    data-grokbot1-phase={phase}
  >
    <div class="gb1-row">
      <strong>Onboarding status: {phase}</strong>
      {#if !provisional}
        <button type="button" class="gb1-btn" data-action="bootstrap-provisional" on:click={bootstrapProvisional}>
          Continue provisional setup
        </button>
      {:else if signedIn && !claimed && phase !== 'REAUTH_REQUIRED' && phase !== 'REAUTHENTICATING'}
        <button type="button" class="gb1-btn" data-action="claim-company" on:click={() => claimNow()}>
          Claim company (rev {provisional.revision})
        </button>
      {:else if signedIn && claimed}
        <button type="button" class="gb1-btn" data-action="verify-nav" on:click={refreshOwnerNavigation}>
          Verify room access
        </button>
      {/if}
    </div>

    {#if provisional && !signedIn}
      <form class="gb1-account-form" on:submit|preventDefault={submitAccountAuth} aria-label={authMode==='signin'?'Sign in to claim your company':'Create an account to claim your company'} data-testid="onboarding-account-auth">
        <h2>{authMode==='signin'?'Sign in to continue':'Create your account'}</h2>
        <p>Your business request is saved. Use your account to claim this company.</p>
        {#if authMode==='signup'}
          <label for="gb1-account-name">Name</label>
          <input id="gb1-account-name" name="name" autocomplete="name" bind:value={authName} required maxlength="200" disabled={authBusy}/>
        {/if}
        <label for="gb1-account-email">Email</label>
        <input id="gb1-account-email" name="email" type="email" autocomplete="email" bind:value={authEmail} required maxlength="320" disabled={authBusy}/>
        <label for="gb1-account-password">Password</label>
        <input id="gb1-account-password" name="password" type="password" autocomplete={authMode==='signup'?'new-password':'current-password'} bind:value={authPassword} required disabled={authBusy}/>
        <button type="submit" class="gb1-btn" disabled={authBusy} data-action="submit-account-auth">{authBusy?'Signing in…':authMode==='signin'?'Sign in':'Create account'}</button>
        <button type="button" class="gb1-auth-toggle" disabled={authBusy} on:click={()=>{authMode=authMode==='signin'?'signup':'signin';authPassword='';authError='';}}>
          {authMode==='signin'?'Create an account':'Already have an account? Sign in'}
        </button>
        {#if authError}<p class="gb1-auth-error" role="alert">{authError}</p>{/if}
      </form>
    {/if}

    {#if phase === 'REAUTH_REQUIRED' || phase === 'REAUTHENTICATING'}
      <form class="gb1-reauth-form" on:submit|preventDefault={submitReauthAndResumeClaim}>
        <label for="gb1-reauth-password">Confirm password to claim:</label>
        <input
          id="gb1-reauth-password"
          type="password"
          autocomplete="current-password"
          bind:value={reauthPassword}
          placeholder="Account password"
          required
        />
        <button type="submit" class="gb1-btn" data-action="submit-reauth" disabled={phase === 'REAUTHENTICATING'}>
          {phase === 'REAUTHENTICATING' ? 'Verifying?' : 'Confirm & Claim'}
        </button>
      </form>
    {/if}

    {#if statusMessage}
      <p class="gb1-msg" role="status" aria-live="polite">{statusMessage}</p>
    {/if}
    {#if navigation?.status === 'READY' && navigation.companyId && navigation.channelRoomId}
      <a
        class="gb1-open-link"
        data-action="open-claimed-workspace"
        href={`/app?onboardingIntent=${encodeURIComponent(intentId)}`}
      >
        Open claimed workspace
      </a>
    {/if}
  </section>
{/if}

<style>
  .grokbot1-panel {
    box-sizing: border-box;
    width: 100%;
    max-width: 920px;
    margin: 10px auto 0;
    padding: 12px 16px;
    border: 1px solid #dce5fa;
    border-radius: 16px;
    background: #f8faff;
    color: #1f3356;
    font: 13px/1.5 StarliMona, Arial, sans-serif;
  }
  .gb1-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .gb1-reauth-form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .gb1-reauth-form input {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 6px 10px;
    font: inherit;
    min-width: 180px;
  }
  .gb1-btn {
    border: 1px solid #3563ff;
    background: #3563ff;
    color: #fff;
    border-radius: 10px;
    padding: 7px 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .gb1-btn:focus-visible, .gb1-open-link:focus-visible {
    outline: 3px solid #7c62ff;
    outline-offset: 2px;
  }
  .gb1-msg {
    margin: 8px 0 0;
    font-size: 12px;
    color: #4f6387;
  }
  .gb1-open-link {
    display: inline-block;
    margin-top: 8px;
    color: #2563eb;
    font-weight: 700;
    text-decoration: underline;
  }
  .gb1-account-form{display:grid;gap:10px;max-width:420px;margin:22px auto 8px;background:white;border:1px solid #e3e9f6;border-radius:14px;padding:22px}
  .gb1-account-form h2{font-size:20px;line-height:1.3;margin:0;color:#192640}.gb1-account-form p{font-size:14px;line-height:1.5;margin:0 0 6px}
  .gb1-account-form label{font-size:14px;font-weight:550}.gb1-account-form input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;font-size:16px}
  .gb1-account-form input:focus-visible,.gb1-auth-toggle:focus-visible{outline:3px solid #7c62ff;outline-offset:2px}
  .gb1-account-form .gb1-btn{min-height:44px;font:inherit;margin-top:6px}.gb1-btn:disabled{opacity:.6;cursor:default}
  .gb1-auth-toggle{border:0;background:none;color:#3158df;text-decoration:underline;padding:8px;font:inherit;cursor:pointer}
  .gb1-account-form .gb1-auth-error{color:#9b1c32;overflow-wrap:anywhere}
  @media(max-width:420px){.gb1-account-form{padding:16px}}
</style>
