<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import CompanyInvitations from '$lib/components/enterprise/company/CompanyInvitations.svelte';
 let joinToken='',token='';const access=new AbortController();onDestroy(()=>access.abort());
 onMount(()=>{joinToken=new URL(window.location.href).searchParams.get('token')??'';token=localStorage.token??'';});
</script>
<svelte:head><title>Join your team · Starli</title><meta name="referrer" content="no-referrer" /></svelte:head>
<main><a class="brand" href="/">Starli<span>Company workspace</span></a>{#if joinToken}<CompanyInvitations {joinToken} {token} accessSignal={access.signal}/>{:else}<p>This invitation link is incomplete. Ask your company administrator to resend it.</p>{/if}</main>
<style>:global(body){background:#f6f8fc}main{max-width:740px;margin:0 auto;padding:70px 24px;color:#17243f;font-family:inherit}.brand{display:flex;flex-direction:column;gap:5px;text-decoration:none;color:#17243f;font-size:26px;font-weight:700;margin-bottom:32px}.brand span{font-size:12px;font-weight:400;color:#71809a}</style>
