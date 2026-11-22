<script lang="ts">
 import {page} from '$app/stores';
 import GuestIntentWorkspace from '$lib/components/marketing/GuestIntentWorkspace.svelte';
 $: intentId=$page.url.searchParams.get('intent')||'';
</script>
<svelte:head><title>Guest workspace · Starli</title><meta name="referrer" content="no-referrer"/></svelte:head>
{#if /^[a-f0-9]{40}$/i.test(intentId)}{#key intentId}<GuestIntentWorkspace {intentId}/>{/key}{:else}<main><p>This guest workspace link is incomplete.</p><a href="/">Return home</a></main>{/if}
