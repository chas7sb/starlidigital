<script lang="ts">
 import StarliSocialPanel from "$lib/components/starli-preview/StarliSocialPanel.svelte";
 import StarliMailboxPanel from "$lib/components/starli-preview/StarliMailboxPanel.svelte";
 import { page } from '$app/stores';
 import { goto } from '$app/navigation';
 import { onMount } from 'svelte';
 import StarliResourcePanel from '$lib/components/starli-preview/StarliResourcePanel.svelte';
 import StarliBrowserPanel from '$lib/components/starli-preview/StarliBrowserPanel.svelte';
 import StarliCompanyPanel from '$lib/components/starli-preview/StarliCompanyPanel.svelte';
 import StarliBillingPanel from '$lib/components/starli-preview/StarliBillingPanel.svelte';
 import StarliCollectionsPanel from '$lib/components/starli-preview/StarliCollectionsPanel.svelte';
 import StarliApprovalsPanel from '$lib/components/starli-preview/StarliApprovalsPanel.svelte';
 import StarliToolsPanel from '$lib/components/starli-preview/StarliToolsPanel.svelte';
 import StarliCRMPanel from '$lib/components/starli-preview/StarliCRMPanel.svelte';
 import StarliAdminPanel from '$lib/components/starli-preview/StarliAdminPanel.svelte';
 $: section = $page.params.section;
 onMount(() => {
  if ($page.params.section === 'agents') goto('/');
 });
</script>
<div class="h-full w-full overflow-y-auto bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
 {#if section === 'agents'}
  <p class="p-4 text-sm">Subagents moved to chat. <a class="underline" href="/">Open chat</a></p>
 {:else if section === 'social'}
 <StarliSocialPanel/>
 {:else if section === 'mailbox'}
 <StarliMailboxPanel/>
 {:else if ['projects','proposals','mailbox','hosted-agents','videos','activity'].includes(section)}
  <StarliCollectionsPanel kind={section} />
 {:else if section === 'company'}
  <StarliCompanyPanel />
 {:else if section === 'billing'}
  <StarliBillingPanel />
 {:else if section === 'approvals'}
  <StarliApprovalsPanel />
 {:else if section === 'tools'}
  <StarliToolsPanel />
 {:else if section === 'crm'}
  <StarliCRMPanel />
 {:else if section === 'admin'}
  <StarliAdminPanel />
 {:else if section === 'browser'}
  <div class="mx-auto max-w-6xl p-4"><StarliBrowserPanel /></div>
 {:else}
  <StarliResourcePanel {section} />

 {/if}
</div>
