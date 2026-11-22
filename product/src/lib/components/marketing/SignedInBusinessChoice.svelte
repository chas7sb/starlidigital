<script lang="ts">
  import {createEventDispatcher} from 'svelte';
  /** All options MUST be server-confirmed companies of the currently authenticated person. */
  export let signedIn = false;
  export let verifiedCompanyChoices: {id:string;name:string;membershipRevision:number}[] = [];
  export let verifiedAdmissionCapability = false; // backend-authenticated only
  let selected = '';
  let choice: 'existing' | 'new' = 'existing';
  const dispatch=createEventDispatcher<{
    workspaceChoice:{kind:'existing'|'new';companyId:string|null;requiresNativeConfirmation:true};
  }>();
  $: allowed=verifiedCompanyChoices.filter(c=>c&&typeof c.id==='string'&&c.id.length>0&&
    typeof c.name==='string'&&Number.isInteger(c.membershipRevision)&&c.membershipRevision>0);
  function propose(){
    if(!signedIn)return;
    if(choice==='new'){
      if(!verifiedAdmissionCapability)return;
      dispatch('workspaceChoice',{kind:'new',companyId:null,requiresNativeConfirmation:true});
    } else if(allowed.some(c=>c.id===selected)){
      dispatch('workspaceChoice',{kind:'existing',companyId:selected,requiresNativeConfirmation:true});
    }
  }
</script>
{#if signedIn}
<section class="signed-in-choice" aria-label="Choose an existing company or request a new one">
  <p class="intro">You're signed in. Choose how to continue with Starli.</p>
  <fieldset>
    <legend>Business workspace</legend>
    <label><input type="radio" name="business-kind" value="existing" bind:group={choice} /> Existing company</label>
    <label><input type="radio" name="business-kind" value="new" bind:group={choice} /> New business</label>
  </fieldset>
  {#if choice==='existing'}
    <label class="select-title" for="verified-company-choice">Your companies</label>
    <select id="verified-company-choice" bind:value={selected} disabled={!allowed.length}>
      <option value="">Select a verified company</option>
      {#each allowed as company (company.id)}
        <option value={company.id}>{company.name}</option>
      {/each}
    </select>
    <p class="help">Company membership is checked again by the native workspace before opening.</p>
  {:else}
    <p class="help">Creating a new company requires an authenticated native admission endpoint. Guest intake cannot create a signed-in company.</p>
    {#if !verifiedAdmissionCapability}<p class="help">New-business onboarding is not available yet.</p>{/if}
  {/if}
  <button type="button" disabled={!signedIn || (choice==='new'?!verifiedAdmissionCapability:!allowed.some(c=>c.id===selected))} on:click={propose}>
    Continue with verified workspace
  </button>
</section>
{/if}
<style>
  .signed-in-choice{max-width:920px;margin:24px auto 0;padding:19px 21px;border:1px solid #e1e8f9;border-radius:20px;background:#f7f9ff;color:#243758}
  .intro{font-weight:650;margin:0 0 14px}
  fieldset{border:0;padding:0;margin:0 0 14px;display:flex;gap:24px;flex-wrap:wrap;font-size:14px}
  legend{font-size:12px;color:#52688e;margin-bottom:9px}
  fieldset label{display:inline-flex;gap:7px;align-items:center;cursor:pointer}
  .select-title{display:block;font-size:12px;font-weight:650;margin-bottom:6px}
  select{display:block;width:100%;padding:11px 12px;background:#fff;border:1px solid #cfdaf0;border-radius:10px;font:inherit;font-size:14px;color:inherit}
  .help{font-size:12px;color:#536889;margin:8px 0}
  button{border:0;border-radius:11px;background:#3463e9;color:#fff;padding:12px 17px;margin-top:12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
  button:disabled{background:#abb6d4;cursor:not-allowed}
  button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #785eff;outline-offset:3px}
  @media(max-width:380px){.signed-in-choice{padding:14px}fieldset{gap:11px}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
